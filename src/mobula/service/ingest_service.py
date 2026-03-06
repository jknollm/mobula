from __future__ import annotations

import json
import os
import re
import hashlib
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

import numpy as np
from fastapi import UploadFile

from mobula.data.loaders import _dim_from_ctype, _normalize_stokes_iqu_to_iquv, load_by_extension, pad_dataset_to_canonical
from mobula.data.schema import CANONICAL_DIMS, CubeDataset, reorder_to_canonical
from mobula.paths import default_data_dir
from mobula.service.api_models import (
    AxisCandidate,
    AxisInference,
    FileInference,
    FileMappingDecision,
    GroupingCandidate,
    IngestCommitResponse,
    IngestDatasetPlan,
    IngestInspection,
    IngestPlan,
    MappingDecision,
    MappingPreset,
    ParsedArrayInfo,
    PresetSignature,
    RawInputRef,
)
from mobula.service.registry import DatasetRegistry

SUPPORTED_INGEST_EXTS = {".h5", ".hdf5", ".fits", ".fit", ".fts", ".zarr"}

GROUPING_AXIS_MAP = {
    "files_as_sample": "sample",
    "files_as_t": "t",
    "files_as_nu": "nu",
    "files_as_pol": "pol",
}

_HDF5_STOKES_STACK_PREFIX = "__stokes_stack__:"


@dataclass(slots=True)
class IngestLimits:
    max_total_bytes: int
    max_file_bytes: int
    max_files: int
    session_ttl_seconds: int

    @staticmethod
    def _env_int(name: str, default: int) -> int:
        raw = os.environ.get(name)
        if raw is None:
            return default
        try:
            out = int(raw)
        except ValueError:
            return default
        return out if out > 0 else default

    @classmethod
    def from_env(cls) -> IngestLimits:
        gib = 1024**3
        return cls(
            max_total_bytes=cls._env_int("MOBULA_INGEST_MAX_TOTAL_BYTES", 8 * gib),
            max_file_bytes=cls._env_int("MOBULA_INGEST_MAX_FILE_BYTES", 8 * gib),
            max_files=cls._env_int("MOBULA_INGEST_MAX_FILES", 256),
            session_ttl_seconds=cls._env_int("MOBULA_INGEST_SESSION_TTL_SECONDS", 30 * 60),
        )


@dataclass(slots=True)
class _InputRecord:
    raw_input: RawInputRef
    path: Path
    parsed: ParsedArrayInfo
    recommended_dims: list[str]
    format_name: str


@dataclass(slots=True)
class _InspectionSession:
    inspection_id: str
    expires_at: datetime
    temp_dir: Path
    inputs: dict[str, _InputRecord] = field(default_factory=dict)
    inferences: list[FileInference] = field(default_factory=list)
    grouping_candidates: list[GroupingCandidate] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    signature: PresetSignature | None = None


@dataclass(slots=True)
class _DatasetPlanRecord:
    dataset_id: str
    source_input_ids: list[str]
    canonical_dims: tuple[str, ...]
    projected_shape: tuple[int, ...]
    warnings: list[str] = field(default_factory=list)
    strict_errors: list[str] = field(default_factory=list)


@dataclass(slots=True)
class _PlanRecord:
    plan_id: str
    inspection_id: str
    expires_at: datetime
    grouping_mode: str
    tab_mode: str
    mapping_by_input: dict[str, FileMappingDecision]
    datasets: list[_DatasetPlanRecord]
    warnings: list[str]
    errors: list[str]
    is_valid: bool


@dataclass(slots=True)
class _Hdf5DatasetCandidate:
    path: str
    shape: tuple[int, ...]
    dtype: str
    ndim: int
    size: int
    dims_attr: list[str]
    score: int
    coordinate_like: bool
    kind: str = "dataset"
    member_paths: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "shape": [int(x) for x in self.shape],
            "dtype": self.dtype,
            "ndim": int(self.ndim),
            "size": int(self.size),
            "dims_attr": list(self.dims_attr),
            "score": int(self.score),
            "coordinate_like": bool(self.coordinate_like),
            "kind": self.kind,
            "member_paths": list(self.member_paths),
        }


class _IngestSessionStore:
    def __init__(self, root: Path) -> None:
        self._root = root
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._sessions: dict[str, _InspectionSession] = {}
        self._plans: dict[str, _PlanRecord] = {}

    def _now(self) -> datetime:
        return datetime.now(UTC)

    def _remove_session_locked(self, inspection_id: str) -> None:
        session = self._sessions.pop(inspection_id, None)
        if session is not None:
            try:
                for child in sorted(session.temp_dir.glob("**/*"), reverse=True):
                    if child.is_file() or child.is_symlink():
                        child.unlink(missing_ok=True)
                    elif child.is_dir():
                        child.rmdir()
                session.temp_dir.rmdir()
            except OSError:
                pass
        plan_ids = [pid for pid, plan in self._plans.items() if plan.inspection_id == inspection_id]
        for pid in plan_ids:
            self._plans.pop(pid, None)

    def sweep(self) -> None:
        now = self._now()
        with self._lock:
            expired_sessions = [sid for sid, session in self._sessions.items() if session.expires_at <= now]
            expired_plans = [pid for pid, plan in self._plans.items() if plan.expires_at <= now]
            for sid in expired_sessions:
                self._remove_session_locked(sid)
            for pid in expired_plans:
                self._plans.pop(pid, None)

    def create_session_dir(self, inspection_id: str) -> Path:
        with self._lock:
            session_dir = self._root / inspection_id
            session_dir.mkdir(parents=True, exist_ok=True)
            return session_dir

    def save_session(self, session: _InspectionSession) -> None:
        with self._lock:
            self._sessions[session.inspection_id] = session

    def get_session(self, inspection_id: str) -> _InspectionSession:
        self.sweep()
        with self._lock:
            session = self._sessions.get(inspection_id)
            if session is None:
                raise LookupError(f"inspection session not found: {inspection_id}")
            return session

    def save_plan(self, plan: _PlanRecord) -> None:
        with self._lock:
            self._plans[plan.plan_id] = plan

    def get_plan(self, plan_id: str) -> _PlanRecord:
        self.sweep()
        with self._lock:
            plan = self._plans.get(plan_id)
            if plan is None:
                raise LookupError(f"ingest plan not found: {plan_id}")
            return plan

    def finalize_inspection(self, inspection_id: str) -> None:
        with self._lock:
            self._remove_session_locked(inspection_id)


class _PresetStore:
    def __init__(self, path: Path, project_scope: str) -> None:
        self._path = path
        self._project_scope = project_scope
        self._lock = RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"version": 1, "presets": []}
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"version": 1, "presets": []}
        if not isinstance(payload, dict):
            return {"version": 1, "presets": []}
        presets = payload.get("presets")
        if not isinstance(presets, list):
            payload["presets"] = []
        return payload

    def _write(self, payload: dict[str, Any]) -> None:
        text = json.dumps(payload, indent=2, sort_keys=True)
        self._path.write_text(f"{text}\n", encoding="utf-8")

    def find_matches(self, signature: PresetSignature | None) -> list[MappingPreset]:
        if signature is None:
            return []
        with self._lock:
            payload = self._read()
            out: list[MappingPreset] = []
            for row in payload.get("presets", []):
                if not isinstance(row, dict):
                    continue
                if row.get("project_scope") != self._project_scope:
                    continue
                sig = row.get("signature")
                if not isinstance(sig, dict):
                    continue
                if (
                    sig.get("format") != signature.format
                    or int(sig.get("ndim", -1)) != signature.ndim
                    or list(sig.get("native_dim_labels", [])) != signature.native_dim_labels
                    or list(sig.get("axis_order_hint", [])) != signature.axis_order_hint
                ):
                    continue
                try:
                    out.append(
                        MappingPreset(
                            preset_id=str(row.get("preset_id", "")),
                            name=str(row.get("name", "Saved Mapping")),
                            project_scope=self._project_scope,
                            signature=signature,
                            default_dims=[str(d) for d in row.get("default_dims", [])],
                            default_grouping_mode=str(row.get("default_grouping_mode", "separate")),
                            default_tab_mode=str(row.get("default_tab_mode", "single_tab")),
                            confidence=float(row.get("confidence", 0.92)),
                            rationale=str(row.get("rationale", "Strong signature match from prior import.")),
                            last_used_at=row.get("last_used_at"),
                        )
                    )
                except Exception:
                    continue
            out.sort(key=lambda item: item.confidence, reverse=True)
            return out

    def get(self, preset_id: str) -> MappingPreset | None:
        with self._lock:
            payload = self._read()
            for row in payload.get("presets", []):
                if not isinstance(row, dict):
                    continue
                if str(row.get("preset_id", "")) != preset_id:
                    continue
                sig_payload = row.get("signature")
                if not isinstance(sig_payload, dict):
                    continue
                try:
                    return MappingPreset(
                        preset_id=preset_id,
                        name=str(row.get("name", "Saved Mapping")),
                        project_scope=self._project_scope,
                        signature=PresetSignature(
                            format=str(sig_payload.get("format", "")),
                            ndim=int(sig_payload.get("ndim", 0)),
                            native_dim_labels=[str(x) for x in sig_payload.get("native_dim_labels", [])],
                            axis_order_hint=[str(x) for x in sig_payload.get("axis_order_hint", [])],
                        ),
                        default_dims=[str(d) for d in row.get("default_dims", [])],
                        default_grouping_mode=str(row.get("default_grouping_mode", "separate")),
                        default_tab_mode=str(row.get("default_tab_mode", "single_tab")),
                        confidence=float(row.get("confidence", 0.92)),
                        rationale=str(row.get("rationale", "")),
                        last_used_at=row.get("last_used_at"),
                    )
                except Exception:
                    return None
            return None

    def upsert(
        self,
        *,
        signature: PresetSignature | None,
        decision: MappingDecision,
        mappings: list[FileMappingDecision],
    ) -> None:
        if signature is None or not mappings:
            return
        default_dims = list(mappings[0].dims)
        if not default_dims:
            return

        key = json.dumps(
            {
                "scope": self._project_scope,
                "signature": signature.model_dump(mode="json"),
                "dims": default_dims,
                "grouping": decision.grouping_mode,
                "tab_mode": decision.tab_mode,
            },
            sort_keys=True,
        )
        stable = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
        preset_id = f"preset-{stable}"

        now = datetime.now(UTC).isoformat()
        row = {
            "preset_id": preset_id,
            "name": "Recent Mapping",
            "project_scope": self._project_scope,
            "signature": signature.model_dump(mode="json"),
            "default_dims": default_dims,
            "default_grouping_mode": decision.grouping_mode,
            "default_tab_mode": decision.tab_mode,
            "confidence": 0.92,
            "rationale": "Matches previously confirmed ingest layout.",
            "last_used_at": now,
        }

        with self._lock:
            payload = self._read()
            presets = [x for x in payload.get("presets", []) if isinstance(x, dict)]
            replaced = False
            for idx, existing in enumerate(presets):
                if str(existing.get("preset_id", "")) == preset_id:
                    presets[idx] = row
                    replaced = True
                    break
            if not replaced:
                presets.append(row)
            payload["presets"] = presets
            self._write(payload)


class IngestService:
    def __init__(self, registry: DatasetRegistry, limits: IngestLimits | None = None) -> None:
        self._registry = registry
        self._limits = limits or IngestLimits.from_env()
        ingest_root = default_data_dir() / "ingest_sessions"
        self._sessions = _IngestSessionStore(ingest_root)
        preset_path = default_data_dir() / "ingest" / "presets.json"
        self._preset_store = _PresetStore(preset_path, str(Path.cwd().expanduser().resolve()))

    def _now(self) -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _suffix_for_path(path: Path) -> str:
        return path.suffix.lower()

    @staticmethod
    def _parse_dims_attr(value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="ignore")
        if isinstance(value, str):
            return [part.strip().lower() for part in value.split(",") if part.strip()]
        if isinstance(value, (list, tuple)):
            return [str(item).strip().lower() for item in value if str(item).strip()]
        return []

    @staticmethod
    def _format_name_from_suffix(suffix: str) -> str:
        if suffix in {".h5", ".hdf5"}:
            return "hdf5"
        if suffix in {".fits", ".fit", ".fts"}:
            return "fits"
        if suffix == ".zarr":
            return "zarr"
        return "unknown"

    @staticmethod
    def _safe_file_stem(name: str) -> str:
        stem = Path(name).stem or "dataset"
        clean = re.sub(r"[^a-zA-Z0-9_.-]+", "-", stem).strip("-._")
        return clean or "dataset"

    @staticmethod
    def _format_bytes(size: int) -> str:
        gib = 1024**3
        mib = 1024**2
        if size >= gib:
            return f"{size / gib:.2f} GiB"
        return f"{size / mib:.1f} MiB"

    def _dir_size_bytes(self, path: Path, limit_hint: int) -> int:
        total = 0
        for child in path.rglob("*"):
            if not child.is_file():
                continue
            try:
                total += child.stat().st_size
            except OSError:
                continue
            if total > limit_hint:
                break
        return total

    def _inspect_local_input(self, input_id: str, path: Path) -> tuple[_InputRecord, FileInference]:
        suffix = self._suffix_for_path(path)
        if suffix not in SUPPORTED_INGEST_EXTS:
            raise ValueError(f"unsupported file extension: {suffix or '(none)'}")

        if suffix == ".zarr":
            if not path.is_dir():
                raise ValueError(".zarr input must be a folder path")
            size_bytes = self._dir_size_bytes(path, self._limits.max_total_bytes + 1)
        else:
            if not path.is_file():
                raise ValueError("input path must be a file")
            size_bytes = int(path.stat().st_size)

        raw_input = RawInputRef(
            id=input_id,
            name=path.name,
            source_type="local_path",
            path_or_upload_ref=str(path),
            format=self._format_name_from_suffix(suffix),
            size_bytes=size_bytes,
        )
        parsed, recommended_dims, axis_inferences, confidence, confidence_tier, warnings = self._inspect_array_info(path)

        inference = FileInference(
            raw_input=raw_input,
            parsed=parsed,
            axis_inferences=axis_inferences,
            recommended_dims=recommended_dims,
            confidence=confidence,
            confidence_tier=confidence_tier,
            conflicts=[],
            warnings=warnings,
        )
        rec = _InputRecord(
            raw_input=raw_input,
            path=path,
            parsed=parsed,
            recommended_dims=recommended_dims,
            format_name=raw_input.format,
        )
        return rec, inference

    def _inspect_array_info(
        self, path: Path
    ) -> tuple[ParsedArrayInfo, list[str], list[AxisInference], float, str, list[str]]:
        suffix = self._suffix_for_path(path)
        metadata: dict[str, Any] = {}
        native_labels: list[str] = []
        pre_warnings: list[str] = []

        if suffix in {".h5", ".hdf5"}:
            import h5py

            with h5py.File(path, "r") as f:
                selected, candidates = self._inspect_hdf5_datasets(f)
                shape = [int(x) for x in selected.shape]
                dtype = str(selected.dtype)
                native_labels = list(selected.dims_attr)
                metadata["dataset_path"] = selected.path
                metadata["dataset_candidates"] = [cand.to_json() for cand in candidates]
                if selected.path != "values":
                    selected_label = (
                        f"stokes stack ({', '.join(selected.member_paths)})"
                        if selected.kind == "stokes_stack"
                        else selected.path
                    )
                    pre_warnings.append(
                        f"HDF5 dataset 'values' not found; using '{selected_label}' as the best numeric data candidate."
                    )
                if len(candidates) > 1 and (candidates[0].score - candidates[1].score) <= 30:
                    pre_warnings.append(
                        "Multiple plausible HDF5 datasets were detected; verify the selected Data Key in the mapper toolbar."
                    )
        elif suffix in {".fits", ".fit", ".fts"}:
            from astropy.io import fits

            with fits.open(path, memmap=True) as hdul:
                hdu = hdul[0]
                shape = [int(x) for x in (hdu.shape or ())]
                if not shape:
                    raise ValueError("FITS HDU 0 does not contain n-D array data")
                header = hdu.header
                ctype_labels: list[str] = []
                inferred_from_ctype: list[str] = []
                for axis in range(1, len(shape) + 1):
                    ctype = str(header.get(f"CTYPE{axis}", "")).strip()
                    ctype_labels.append(ctype)
                    inferred = _dim_from_ctype(ctype) if ctype else None
                    inferred_from_ctype.append("" if inferred is None else inferred)
                ctype_labels = list(reversed(ctype_labels))
                inferred_from_ctype = list(reversed(inferred_from_ctype))
                metadata["ctype_labels"] = ctype_labels
                metadata["ctype_inferred_dims"] = inferred_from_ctype
                dtype = "float32"
                if all(label for label in inferred_from_ctype):
                    native_labels = [label.lower() for label in inferred_from_ctype]
        elif suffix == ".zarr":
            import zarr

            root = zarr.open_group(path, mode="r")
            if "values" not in root:
                raise ValueError("zarr group missing array 'values'")
            arr = root["values"]
            shape = [int(x) for x in arr.shape]
            dtype = str(arr.dtype)
            native_labels = self._parse_dims_attr(arr.attrs.get("dims") or arr.attrs.get("_ARRAY_DIMENSIONS"))
            metadata["data_key"] = "values"
        else:
            raise ValueError(f"unsupported file extension: {suffix or '(none)'}")

        ndim = len(shape)
        if ndim < 1:
            raise ValueError("array rank must be >= 1")

        recommended_dims, confidence, confidence_tier, axis_inferences, warnings = self._infer_axis_mapping(
            path.name,
            shape,
            native_labels,
            metadata,
        )
        warnings = [*pre_warnings, *warnings]

        parsed = ParsedArrayInfo(
            shape=shape,
            dtype=dtype,
            ndim=ndim,
            native_dim_labels=native_labels,
            format_metadata=metadata,
        )
        return parsed, recommended_dims, axis_inferences, confidence, confidence_tier, warnings

    def _infer_axis_mapping(
        self,
        filename: str,
        shape: list[int],
        native_labels: list[str],
        metadata: dict[str, Any],
    ) -> tuple[list[str], float, str, list[AxisInference], list[str]]:
        ndim = len(shape)
        fallback = [str(dim) for dim in CANONICAL_DIMS[-ndim:]]
        warnings: list[str] = []

        labels = [str(label).strip().lower() for label in native_labels]
        recommended = list(fallback)
        confidence = 0.45
        source = "heuristic"

        if len(labels) == ndim and all(label in CANONICAL_DIMS for label in labels) and len(set(labels)) == ndim:
            recommended = labels
            confidence = 0.95
            source = "embedded"
        elif len(labels) == ndim:
            warnings.append("native dimension labels were present but invalid for canonical mapping")

        ctype_dims = [str(x).strip().lower() for x in metadata.get("ctype_inferred_dims", []) if str(x).strip()]
        if (
            len(ctype_dims) == ndim
            and all(dim in CANONICAL_DIMS for dim in ctype_dims)
            and len(set(ctype_dims)) == ndim
            and source != "embedded"
        ):
            recommended = ctype_dims
            confidence = 0.88
            source = "header"

        if len(set(recommended)) != len(recommended):
            recommended = list(fallback)
            confidence = min(confidence, 0.55)
            source = "heuristic"
            warnings.append("non-unique inferred dimensions detected; reverted to heuristic fallback")

        axis_inferences: list[AxisInference] = []
        for axis_index in range(ndim):
            native = labels[axis_index] if axis_index < len(labels) else None
            axis_candidates: list[AxisCandidate] = [
                AxisCandidate(
                    target_dim=str(recommended[axis_index]),
                    score=float(confidence),
                    reason=f"Primary {source}-based inference",
                    source="embedded" if source == "embedded" else ("header" if source == "header" else "heuristic"),
                )
            ]
            fallback_dim = fallback[axis_index]
            if fallback_dim != recommended[axis_index]:
                axis_candidates.append(
                    AxisCandidate(
                        target_dim=str(fallback_dim),
                        score=max(0.3, float(confidence - 0.3)),
                        reason="Canonical positional fallback",
                        source="heuristic",
                    )
                )
            axis_inferences.append(
                AxisInference(
                    axis_index=axis_index,
                    native_label=native,
                    candidates=axis_candidates,
                    recommended=str(recommended[axis_index]),
                )
            )

        name_tokens = self._filename_tokens(filename)
        if "time" in name_tokens and "t" not in recommended and "t" in CANONICAL_DIMS:
            warnings.append("filename suggests temporal ordering but inferred axes did not include 't'")
        if "freq" in name_tokens and "nu" not in recommended:
            warnings.append("filename suggests spectral ordering but inferred axes did not include 'nu'")

        if confidence >= 0.85:
            tier = "high"
        elif confidence >= 0.60:
            tier = "medium"
        else:
            tier = "low"

        return recommended, confidence, tier, axis_inferences, warnings

    @staticmethod
    def _filename_tokens(name: str) -> set[str]:
        lower = Path(name).stem.lower()
        split = re.split(r"[^a-z0-9]+", lower)
        tokens = {part for part in split if part}
        if any(part.startswith("t") and part[1:].isdigit() for part in tokens):
            tokens.add("time")
        if any(part.startswith("nu") and part[2:].isdigit() for part in tokens):
            tokens.add("freq")
        if any(part.startswith("f") and part[1:].isdigit() for part in tokens):
            tokens.add("freq")
        if any(part.startswith("pol") for part in tokens) or "stokes" in tokens or "channel" in tokens:
            tokens.add("pol")
        return tokens

    @staticmethod
    def _hdf5_key_score(name: str, ndim: int, size: int, dims_attr: list[str]) -> tuple[int, int, int, str]:
        base = name.rsplit("/", 1)[-1].lower()
        full = name.lower()
        preferred = ("values", "data", "cube", "image", "intensity", "signal", "science", "flux")
        coord_like_tokens = (
            "coord",
            "axis",
            "header",
            "meta",
            "wcs",
            "unit",
            "mask",
            "flag",
            "quality",
            "weight",
            "variance",
            "uncertainty",
            "error",
            "index",
            "indices",
        )

        score = 0
        if base == "values":
            score += 240
        if base in preferred:
            score += 90
        for idx, token in enumerate(preferred):
            if token in base:
                score += max(0, 24 - idx * 3)
                break

        if ndim >= 2:
            score += 48
        if ndim >= 3:
            score += 42
        if ndim >= 4:
            score += 28
        if ndim == 1:
            score -= 45

        if size > 0:
            score += int(min(36, round(math.log10(float(size + 1)) * 8)))

        if len(dims_attr) == ndim and len(set(dims_attr)) == ndim and all(dim in CANONICAL_DIMS for dim in dims_attr):
            score += 30

        if base in CANONICAL_DIMS:
            score -= 85
        if any(token in full for token in coord_like_tokens):
            score -= 70

        return score, int(ndim), int(size), name

    @staticmethod
    def _stokes_stack_token(member_paths: list[str]) -> str:
        return f"{_HDF5_STOKES_STACK_PREFIX}{json.dumps(member_paths, separators=(',', ':'))}"

    @staticmethod
    def _parse_stokes_stack_token(path: str) -> list[str] | None:
        txt = str(path).strip()
        if not txt.startswith(_HDF5_STOKES_STACK_PREFIX):
            return None
        payload = txt[len(_HDF5_STOKES_STACK_PREFIX) :]
        try:
            parsed = json.loads(payload)
        except ValueError:
            return None
        if not isinstance(parsed, list):
            return None
        out = [str(item).strip() for item in parsed if str(item).strip()]
        return out if out else None

    @classmethod
    def _hdf5_stack_shape_from_member_paths(
        cls,
        format_metadata: dict[str, Any],
        member_paths: list[str],
        *,
        _seen: set[str] | None = None,
    ) -> list[int] | None:
        if not member_paths:
            return None
        shapes: list[list[int]] = []
        seen = _seen if _seen is not None else set()
        for member in member_paths:
            member_shape = cls._hdf5_shape_for_dataset_path(format_metadata, member, _seen=seen)
            if member_shape is None:
                return None
            shapes.append(member_shape)
        first = shapes[0]
        if any(shape != first for shape in shapes[1:]):
            return None
        return [int(len(shapes)), *[int(x) for x in first]]

    @staticmethod
    def _infer_stokes_component_dims(shape: tuple[int, ...], time_like_lengths: set[int]) -> list[str]:
        ndim = len(shape)
        if ndim <= 0:
            return []
        if ndim == 1:
            if int(shape[0]) in time_like_lengths:
                return ["t"]
            return ["x"]
        if ndim == 2:
            return ["x", "y"]
        if ndim == 3:
            if int(shape[0]) in time_like_lengths:
                return ["t", "x", "y"]
            return ["nu", "x", "y"]
        tail = list(CANONICAL_DIMS[-ndim:])
        return [str(dim) for dim in tail]

    def _build_stokes_stack_candidates(
        self,
        base_candidates: list[_Hdf5DatasetCandidate],
        time_like_lengths: set[int],
    ) -> list[_Hdf5DatasetCandidate]:
        by_parent: dict[str, dict[str, _Hdf5DatasetCandidate]] = {}
        for cand in base_candidates:
            if cand.kind != "dataset":
                continue
            parent, _, base = cand.path.rpartition("/")
            key = parent.strip("/")
            if base.lower() not in {"i", "q", "u", "v"}:
                continue
            if cand.ndim < 2:
                continue
            bucket = by_parent.setdefault(key, {})
            bucket[base.upper()] = cand

        out: list[_Hdf5DatasetCandidate] = []
        for _, bucket in by_parent.items():
            if not all(name in bucket for name in ("I", "Q", "U", "V")):
                continue
            ordered = [bucket["I"], bucket["Q"], bucket["U"], bucket["V"]]
            shape = ordered[0].shape
            if any(c.shape != shape for c in ordered[1:]):
                continue
            member_paths = [c.path for c in ordered]
            component_dims = (
                list(ordered[0].dims_attr)
                if len(ordered[0].dims_attr) == len(shape)
                else self._infer_stokes_component_dims(shape, time_like_lengths)
            )
            dims_attr = ["pol", *component_dims]
            score = int(max(c.score for c in ordered) + 160)
            out.append(
                _Hdf5DatasetCandidate(
                    path=self._stokes_stack_token(member_paths),
                    shape=(4, *shape),
                    dtype=str(ordered[0].dtype),
                    ndim=1 + len(shape),
                    size=int(4 * int(np.prod(shape))),
                    dims_attr=dims_attr,
                    score=score,
                    coordinate_like=False,
                    kind="stokes_stack",
                    member_paths=member_paths,
                )
            )
        return out

    def _inspect_hdf5_datasets(self, file_obj: Any) -> tuple[_Hdf5DatasetCandidate, list[_Hdf5DatasetCandidate]]:
        import h5py

        coord_like_tokens = (
            "coord",
            "axis",
            "header",
            "meta",
            "wcs",
            "unit",
            "mask",
            "flag",
            "quality",
            "weight",
            "variance",
            "uncertainty",
            "error",
            "index",
            "indices",
        )

        time_like_lengths: set[int] = set()
        for key in ("time", "times", "t"):
            if key not in file_obj:
                continue
            obj = file_obj[key]
            if isinstance(obj, h5py.Dataset) and obj.ndim == 1 and int(obj.size) > 0 and np.issubdtype(obj.dtype, np.number):
                time_like_lengths.add(int(obj.shape[0]))

        ranked: list[tuple[tuple[int, int, int, str], _Hdf5DatasetCandidate]] = []

        def _visit(name: str, obj: Any) -> None:
            if not isinstance(obj, h5py.Dataset):
                return
            if obj.ndim < 1 or int(obj.size) < 1:
                return
            if not np.issubdtype(obj.dtype, np.number):
                return
            dims_attr = self._parse_dims_attr(obj.attrs.get("dims"))
            score = self._hdf5_key_score(name, int(obj.ndim), int(obj.size), dims_attr)
            ranked.append(
                (
                    score,
                    _Hdf5DatasetCandidate(
                        path=str(name),
                        shape=tuple(int(x) for x in obj.shape),
                        dtype=str(obj.dtype),
                        ndim=int(obj.ndim),
                        size=int(obj.size),
                        dims_attr=dims_attr,
                        score=int(score[0]),
                        coordinate_like=any(token in str(name).lower() for token in coord_like_tokens),
                    ),
                )
            )

        file_obj.visititems(_visit)
        base_candidates = [item[1] for item in ranked]
        for stacked in self._build_stokes_stack_candidates(base_candidates, time_like_lengths):
            rank = (int(stacked.score), int(stacked.ndim), int(stacked.size), stacked.path)
            ranked.append((rank, stacked))
        if not ranked:
            raise ValueError("HDF5 file does not contain any numeric datasets that can be displayed")

        ranked.sort(key=lambda item: item[0], reverse=True)
        candidates = [item[1] for item in ranked]
        return candidates[0], candidates[:12]

    def _grouping_candidates(self, inferences: list[FileInference]) -> tuple[list[GroupingCandidate], list[str]]:
        if len(inferences) <= 1:
            return [GroupingCandidate(mode="separate", score=1.0, rationale="Single-file import")], []

        warnings: list[str] = []
        shapes = [tuple(info.parsed.shape) for info in inferences]
        all_shapes_equal = len({shape for shape in shapes}) == 1

        tokens = [self._filename_tokens(item.raw_input.name) for item in inferences]
        token_union = set().union(*tokens)

        candidates: list[GroupingCandidate] = [
            GroupingCandidate(
                mode="separate",
                score=0.66,
                rationale="Safe default for ambiguous multi-file imports.",
            )
        ]

        if "time" in token_union:
            candidates.append(
                GroupingCandidate(
                    mode="files_as_t",
                    score=0.84,
                    rationale="Filename tokens indicate temporal sequencing.",
                )
            )
        if "freq" in token_union:
            candidates.append(
                GroupingCandidate(
                    mode="files_as_nu",
                    score=0.84,
                    rationale="Filename tokens indicate spectral sequencing.",
                )
            )
        if "pol" in token_union:
            candidates.append(
                GroupingCandidate(
                    mode="files_as_pol",
                    score=0.76,
                    rationale="Filename tokens indicate channel/polarization grouping.",
                )
            )

        sample_score = 0.58
        sample_reason = "Default multi-file stacking candidate."
        if all_shapes_equal:
            sample_score = 0.73
            sample_reason = "All files share identical shapes, suitable for stacking as sample axis."
        candidates.append(
            GroupingCandidate(
                mode="files_as_sample",
                score=sample_score,
                rationale=sample_reason,
            )
        )

        candidates.sort(key=lambda item: item.score, reverse=True)
        if len(candidates) > 1 and abs(candidates[0].score - candidates[1].score) <= 0.10:
            warnings.append(
                f"Grouping candidates '{candidates[0].mode}' and '{candidates[1].mode}' are close in score; explicit choice required."
            )

        if candidates[0].score < 0.60 and candidates[0].mode != "separate":
            warnings.append("Low-confidence grouping detected; defaulting to separate datasets is recommended.")

        return candidates, warnings

    def _build_signature(self, inferences: list[FileInference]) -> PresetSignature | None:
        if not inferences:
            return None
        first = inferences[0]
        if any(item.raw_input.format != first.raw_input.format for item in inferences):
            return None
        if any(item.parsed.ndim != first.parsed.ndim for item in inferences):
            return None
        if any(item.parsed.native_dim_labels != first.parsed.native_dim_labels for item in inferences):
            return None
        return PresetSignature(
            format=first.raw_input.format,
            ndim=first.parsed.ndim,
            native_dim_labels=list(first.parsed.native_dim_labels),
            axis_order_hint=list(first.recommended_dims),
        )

    async def inspect(self, paths: list[str], uploads: list[UploadFile]) -> IngestInspection:
        self._sessions.sweep()
        local_paths = [Path(p).expanduser().resolve() for p in paths]
        upload_files = list(uploads)
        total_inputs = len(local_paths) + len(upload_files)
        if total_inputs < 1:
            raise ValueError("inspect requires at least one local path or uploaded file")
        if total_inputs > self._limits.max_files:
            raise ValueError(f"too many inputs ({total_inputs}); max is {self._limits.max_files}")

        inspection_id = f"insp-{uuid4().hex[:12]}"
        expires_at = self._now() + timedelta(seconds=self._limits.session_ttl_seconds)
        session_dir = self._sessions.create_session_dir(inspection_id)

        total_bytes = 0
        inputs: dict[str, _InputRecord] = {}
        inferences: list[FileInference] = []

        try:
            # Local paths
            for idx, path in enumerate(local_paths):
                if not path.exists():
                    raise ValueError(f"path does not exist: {path}")
                input_id = f"raw-{idx + 1}"
                rec, inf = self._inspect_local_input(input_id, path)
                if rec.raw_input.size_bytes > self._limits.max_file_bytes:
                    raise ValueError(
                        f"input '{rec.raw_input.name}' exceeds max file size "
                        f"({self._format_bytes(rec.raw_input.size_bytes)} > {self._format_bytes(self._limits.max_file_bytes)})"
                    )
                total_bytes += rec.raw_input.size_bytes
                if total_bytes > self._limits.max_total_bytes:
                    raise ValueError(
                        f"total ingest size exceeds limit "
                        f"({self._format_bytes(total_bytes)} > {self._format_bytes(self._limits.max_total_bytes)})"
                    )
                inputs[input_id] = rec
                inferences.append(inf)

            # Uploaded files
            base_idx = len(inputs)
            for up_idx, upload in enumerate(upload_files):
                filename = str(upload.filename or "upload").strip() or "upload"
                suffix = Path(filename).suffix.lower()
                if suffix not in SUPPORTED_INGEST_EXTS or suffix == ".zarr":
                    raise ValueError(
                        "drag-and-drop supports FITS and HDF5 uploads only; use local path selection for .zarr folders"
                    )
                input_id = f"raw-{base_idx + up_idx + 1}"
                target = session_dir / f"{uuid4().hex[:8]}-{Path(filename).name}"
                written = 0
                with target.open("wb") as out:
                    while True:
                        chunk = await upload.read(1024 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > self._limits.max_file_bytes:
                            raise ValueError(
                                f"uploaded file '{filename}' exceeds max file size "
                                f"({self._format_bytes(written)} > {self._format_bytes(self._limits.max_file_bytes)})"
                            )
                        total_bytes += len(chunk)
                        if total_bytes > self._limits.max_total_bytes:
                            raise ValueError(
                                f"total ingest size exceeds limit "
                                f"({self._format_bytes(total_bytes)} > {self._format_bytes(self._limits.max_total_bytes)})"
                            )
                        out.write(chunk)

                rec, inf = self._inspect_local_input(input_id, target)
                rec.raw_input.name = filename
                rec.raw_input.source_type = "upload"
                rec.raw_input.path_or_upload_ref = filename
                rec.raw_input.size_bytes = written

                inf.raw_input.name = filename
                inf.raw_input.source_type = "upload"
                inf.raw_input.path_or_upload_ref = filename
                inf.raw_input.size_bytes = written

                inputs[input_id] = rec
                inferences.append(inf)
                await upload.close()

            grouping_candidates, grouping_warnings = self._grouping_candidates(inferences)
            signature = self._build_signature(inferences)
            preset_suggestions = self._preset_store.find_matches(signature)

            warnings = list(grouping_warnings)
            for inf in inferences:
                warnings.extend(inf.warnings)

            session = _InspectionSession(
                inspection_id=inspection_id,
                expires_at=expires_at,
                temp_dir=session_dir,
                inputs=inputs,
                inferences=inferences,
                grouping_candidates=grouping_candidates,
                warnings=warnings,
                signature=signature,
            )
            self._sessions.save_session(session)

            return IngestInspection(
                inspection_id=inspection_id,
                expires_at=expires_at.isoformat(),
                files=inferences,
                grouping_candidates=grouping_candidates,
                global_warnings=warnings,
                preset_suggestions=preset_suggestions,
            )
        except Exception:
            self._sessions.finalize_inspection(inspection_id)
            raise

    @staticmethod
    def _validate_dims(shape: list[int], dims: list[str]) -> tuple[tuple[str, ...], tuple[int, ...]]:
        if len(dims) != len(shape):
            raise ValueError(f"dims length ({len(dims)}) does not match array ndim ({len(shape)})")
        if len(set(dims)) != len(dims):
            raise ValueError("dims contain duplicates")
        invalid = [dim for dim in dims if dim not in CANONICAL_DIMS]
        if invalid:
            raise ValueError(f"unknown dimensions: {invalid}")

        src_index = {dim: i for i, dim in enumerate(dims)}
        ordered_dims = tuple(dim for dim in CANONICAL_DIMS if dim in src_index)
        ordered_shape = tuple(int(shape[src_index[dim]]) for dim in ordered_dims)

        canonical_shape: dict[str, int] = {dim: 1 for dim in CANONICAL_DIMS}
        for dim, size in zip(ordered_dims, ordered_shape, strict=True):
            canonical_shape[dim] = int(size)

        projected_shape = tuple(canonical_shape[dim] for dim in CANONICAL_DIMS)
        return ordered_dims, projected_shape

    @staticmethod
    def _common_prefix(names: list[str]) -> str:
        if not names:
            return "dataset"
        stems = [Path(name).stem for name in names]
        prefix = os.path.commonprefix(stems).strip("-_. ")
        return prefix or "dataset"

    @staticmethod
    def _unique_data_id(base: str, existing: set[str]) -> str:
        candidate = base
        idx = 2
        while candidate in existing:
            candidate = f"{base}-{idx}"
            idx += 1
        existing.add(candidate)
        return candidate

    @staticmethod
    def _healpix_nside_from_npix(npix: int) -> int | None:
        if npix < 12:
            return None
        nside = int(round(math.sqrt(float(npix) / 12.0)))
        if 12 * nside * nside != npix:
            return None
        if nside <= 0 or (nside & (nside - 1)) != 0:
            return None
        return nside

    @staticmethod
    def _default_hdf5_dataset_path(format_metadata: dict[str, Any]) -> str | None:
        path = str(format_metadata.get("dataset_path", "")).strip()
        return path or None

    @classmethod
    def _mapping_hdf5_dataset_paths(cls, rec: _InputRecord, mapped: FileMappingDecision) -> list[str]:
        raw = [str(x).strip() for x in mapped.dataset_paths if str(x).strip()]
        single = str(mapped.dataset_path or "").strip()
        if single and raw:
            if len(raw) == 1 and raw[0] != single:
                # Guard against stale single-path state when dataset_path changed in UI.
                return [single]
            if len(raw) > 1 and single in raw and raw[0] != single:
                reordered = [single, *[path for path in raw if path != single]]
                return reordered
        if raw:
            # Preserve order but drop duplicates.
            dedup = list(dict.fromkeys(raw))
            return dedup
        single = str(single or cls._default_hdf5_dataset_path(rec.parsed.format_metadata) or "").strip()
        return [single] if single else []

    @staticmethod
    def _mapping_hdf5_key_stack_axis(mapped: FileMappingDecision) -> str | None:
        axis = str(mapped.key_stack_axis or "").strip().lower()
        if not axis:
            return None
        return axis

    @classmethod
    def _hdf5_shape_for_dataset_path(
        cls,
        format_metadata: dict[str, Any],
        dataset_path: str,
        *,
        _seen: set[str] | None = None,
    ) -> list[int] | None:
        target = str(dataset_path).strip()
        if not target:
            return None
        seen = _seen if _seen is not None else set()
        if target in seen:
            return None
        seen.add(target)
        token_members = cls._parse_stokes_stack_token(target)
        if token_members is not None:
            shape = cls._hdf5_stack_shape_from_member_paths(format_metadata, token_members, _seen=seen)
            if shape is not None:
                return shape
        selected = cls._default_hdf5_dataset_path(format_metadata)
        if selected == target:
            shape = format_metadata.get("shape")
            if isinstance(shape, list) and all(isinstance(x, int) for x in shape):
                return [int(x) for x in shape]
        candidates = format_metadata.get("dataset_candidates")
        if not isinstance(candidates, list):
            return None
        for row in candidates:
            if not isinstance(row, dict):
                continue
            if str(row.get("path", "")).strip() != target:
                continue
            shape = row.get("shape")
            if isinstance(shape, list) and all(isinstance(x, int) for x in shape):
                return [int(x) for x in shape]
            return None
        return None

    @classmethod
    def _hdf5_shape_for_dataset_path_from_file(
        cls,
        file_path: Path,
        dataset_path: str,
        *,
        _seen: set[str] | None = None,
    ) -> list[int] | None:
        target = str(dataset_path).strip()
        if not target:
            return None
        seen = _seen if _seen is not None else set()
        if target in seen:
            return None
        seen.add(target)

        token_members = cls._parse_stokes_stack_token(target)
        if token_members is not None:
            return cls._hdf5_stack_shape_from_member_paths_from_file(file_path, token_members, _seen=seen)

        try:
            import h5py

            with h5py.File(file_path, "r") as f:
                if target not in f:
                    return None
                ds = f[target]
                if not isinstance(ds, h5py.Dataset):
                    return None
                if int(getattr(ds, "ndim", 0)) < 1:
                    return None
                return [int(x) for x in getattr(ds, "shape", ())]
        except Exception:
            return None

    @classmethod
    def _hdf5_stack_shape_from_member_paths_from_file(
        cls,
        file_path: Path,
        member_paths: list[str],
        *,
        _seen: set[str] | None = None,
    ) -> list[int] | None:
        if not member_paths:
            return None
        seen = _seen if _seen is not None else set()
        shapes: list[list[int]] = []
        for member in member_paths:
            shape = cls._hdf5_shape_for_dataset_path_from_file(file_path, member, _seen=seen)
            if shape is None:
                return None
            shapes.append(shape)
        first = shapes[0]
        if any(shape != first for shape in shapes[1:]):
            return None
        return [int(len(shapes)), *[int(x) for x in first]]

    def _shape_for_mapping(self, rec: _InputRecord, mapped: FileMappingDecision) -> list[int]:
        if rec.format_name != "hdf5":
            return [int(x) for x in rec.parsed.shape]
        selected_paths = self._mapping_hdf5_dataset_paths(rec, mapped)
        if not selected_paths:
            return [int(x) for x in rec.parsed.shape]

        shapes: list[list[int]] = []
        for path in selected_paths:
            shape = self._hdf5_shape_for_dataset_path(rec.parsed.format_metadata, path)
            if shape is None:
                shape = self._hdf5_shape_for_dataset_path_from_file(rec.path, path)
            if shape is None:
                raise ValueError(f"dataset_path '{path}' is not available from inspect candidates or source file")
            shapes.append(shape)

        if len(shapes) == 1:
            return [int(x) for x in shapes[0]]

        stack_axis = self._mapping_hdf5_key_stack_axis(mapped)
        if stack_axis is None:
            raise ValueError("dataset_paths requires key_stack_axis when multiple keys are selected")
        if stack_axis not in CANONICAL_DIMS:
            raise ValueError(f"unknown key_stack_axis '{stack_axis}'")
        first = shapes[0]
        if any(shape != first for shape in shapes[1:]):
            raise ValueError("selected dataset_paths must have matching shapes for key stacking")
        return [int(len(shapes)), *[int(x) for x in first]]

    def _default_mapping(self, inf: FileInference) -> FileMappingDecision:
        default_dataset_path = None
        if inf.raw_input.format == "hdf5":
            default_dataset_path = self._default_hdf5_dataset_path(inf.parsed.format_metadata)
        return FileMappingDecision(
            raw_input_id=inf.raw_input.id,
            dims=list(inf.recommended_dims),
            ignore=False,
            dataset_path=default_dataset_path,
            dataset_paths=[default_dataset_path] if default_dataset_path else [],
        )

    def _build_default_mappings(self, session: _InspectionSession) -> list[FileMappingDecision]:
        return [self._default_mapping(inf) for inf in session.inferences]

    def _resolve_mappings(self, session: _InspectionSession, decision: MappingDecision) -> list[FileMappingDecision]:
        if decision.file_mappings:
            mapping_by_id = {entry.raw_input_id: entry for entry in decision.file_mappings}
            out: list[FileMappingDecision] = []
            for inf in session.inferences:
                mapped = mapping_by_id.get(inf.raw_input.id)
                if mapped is None:
                    out.append(self._default_mapping(inf))
                else:
                    if inf.raw_input.format == "hdf5":
                        default_path = self._default_hdf5_dataset_path(inf.parsed.format_metadata)
                        if not mapped.dataset_path and default_path:
                            mapped.dataset_path = default_path
                        if not mapped.dataset_paths and mapped.dataset_path:
                            mapped.dataset_paths = [mapped.dataset_path]
                    out.append(mapped)
            return out

        if decision.use_preset_id:
            preset = self._preset_store.get(decision.use_preset_id)
            if preset is not None and preset.default_dims:
                return [
                    FileMappingDecision(
                        raw_input_id=inf.raw_input.id,
                        dims=list(preset.default_dims),
                        ignore=False,
                        dataset_path=self._default_hdf5_dataset_path(inf.parsed.format_metadata)
                        if inf.raw_input.format == "hdf5"
                        else None,
                        dataset_paths=(
                            [self._default_hdf5_dataset_path(inf.parsed.format_metadata)]
                            if inf.raw_input.format == "hdf5" and self._default_hdf5_dataset_path(inf.parsed.format_metadata)
                            else []
                        ),
                    )
                    for inf in session.inferences
                ]

        return self._build_default_mappings(session)

    def plan(self, inspection_id: str, decision: MappingDecision) -> IngestPlan:
        session = self._sessions.get_session(inspection_id)

        selected_mappings = self._resolve_mappings(session, decision)
        mapping_by_input = {entry.raw_input_id: entry for entry in selected_mappings}

        errors: list[str] = []
        warnings = list(session.warnings)
        selected_inputs: list[str] = []
        canonical_shapes: dict[str, tuple[int, ...]] = {}

        for inf in session.inferences:
            input_id = inf.raw_input.id
            mapped = mapping_by_input.get(input_id)
            if mapped is None:
                errors.append(f"missing mapping decision for input {input_id}")
                continue
            if mapped.ignore:
                continue

            rec = session.inputs[input_id]
            try:
                mapped_shape = self._shape_for_mapping(rec, mapped)
            except ValueError as exc:
                errors.append(f"{inf.raw_input.name}: {exc}")
                continue

            mapped_dims = [str(dim) for dim in mapped.dims]
            if rec.format_name == "hdf5":
                selected_paths = self._mapping_hdf5_dataset_paths(rec, mapped)
                if len(selected_paths) > 1:
                    stack_axis = self._mapping_hdf5_key_stack_axis(mapped)
                    if stack_axis is None:
                        errors.append(f"{inf.raw_input.name}: key_stack_axis is required when multiple dataset_paths are selected")
                        continue
                    if not mapped_dims or mapped_dims[0] != stack_axis:
                        errors.append(
                            f"{inf.raw_input.name}: key_stack_axis '{stack_axis}' must be assigned to axis 0 for stacked keys"
                        )
                        continue
                    if stack_axis not in mapped_dims:
                        errors.append(
                            f"{inf.raw_input.name}: key_stack_axis '{stack_axis}' must appear in mapped dimensions"
                        )
                        continue
            try:
                _, projected_shape = self._validate_dims(mapped_shape, mapped_dims)
            except ValueError as exc:
                errors.append(f"{inf.raw_input.name}: {exc}")
                continue

            pol_axis = next((idx for idx, dim in enumerate(mapped_dims) if dim == "pol"), -1)
            if pol_axis >= 0:
                pol_size = int(mapped_shape[pol_axis])
                if pol_size not in {1, 3, 4}:
                    errors.append(f"{inf.raw_input.name}: pol axis must have size 1, 3, or 4 (got {pol_size})")
                    continue
                if pol_size == 3:
                    warnings.append(
                        f"{inf.raw_input.name}: pol axis has 3 channels; assuming I,Q,U and padding V=0 during load."
                    )

            if mapped.sphere_axis is not None:
                sphere_axis = int(mapped.sphere_axis)
                if sphere_axis < 0 or sphere_axis >= len(mapped_dims):
                    errors.append(f"{inf.raw_input.name}: sphere_axis={sphere_axis} is out of bounds")
                    continue
                sphere_dim = mapped_dims[sphere_axis]
                if sphere_dim != "x":
                    errors.append(f"{inf.raw_input.name}: sphere axis must be mapped to canonical dim 'x' (got '{sphere_dim}')")
                    continue
                npix = int(mapped_shape[sphere_axis])
                nside = self._healpix_nside_from_npix(npix)
                if nside is None:
                    errors.append(
                        f"{inf.raw_input.name}: sphere axis requires HEALPix npix=12*nside^2 with power-of-two nside (got N={npix})"
                    )
                    continue

            selected_inputs.append(input_id)
            canonical_shapes[input_id] = projected_shape

        if not selected_inputs:
            errors.append("no inputs selected for ingest")

        grouping_mode = decision.grouping_mode
        if grouping_mode != "separate" and len(selected_inputs) <= 1:
            warnings.append("Only one file selected; grouping mode has been reduced to separate dataset creation.")
            grouping_mode = "separate"

        existing_ids = {summary.data_id for summary in self._registry.list()}
        dataset_plans: list[_DatasetPlanRecord] = []

        if grouping_mode == "separate":
            for input_id in selected_inputs:
                rec = session.inputs[input_id]
                mapped = mapping_by_input[input_id]
                base_id = self._safe_file_stem(mapped.data_id or rec.raw_input.name)
                dataset_id = self._unique_data_id(base_id, existing_ids)
                dataset_plans.append(
                    _DatasetPlanRecord(
                        dataset_id=dataset_id,
                        source_input_ids=[input_id],
                        canonical_dims=tuple(CANONICAL_DIMS),
                        projected_shape=canonical_shapes[input_id],
                    )
                )
        else:
            axis = GROUPING_AXIS_MAP.get(grouping_mode)
            if axis is None:
                errors.append(f"unsupported grouping mode: {grouping_mode}")
            else:
                axis_idx = CANONICAL_DIMS.index(axis)
                base_shape: tuple[int, ...] | None = None
                strict_errors: list[str] = []
                for input_id in selected_inputs:
                    shape = canonical_shapes[input_id]
                    if shape[axis_idx] != 1:
                        strict_errors.append(
                            f"{session.inputs[input_id].raw_input.name}: axis '{axis}' must be singleton (size=1) for strict file-axis combine"
                        )
                    if base_shape is None:
                        base_shape = shape
                        continue
                    for idx, dim in enumerate(CANONICAL_DIMS):
                        if idx == axis_idx:
                            continue
                        if shape[idx] != base_shape[idx]:
                            strict_errors.append(
                                f"shape mismatch on dim '{dim}' between files for combine mode '{grouping_mode}'"
                            )

                if base_shape is None:
                    errors.append("unable to build combined dataset: no valid input shapes")
                else:
                    combined_shape = list(base_shape)
                    combined_shape[axis_idx] = len(selected_inputs)
                    names = [session.inputs[input_id].raw_input.name for input_id in selected_inputs]
                    suggested_base = self._safe_file_stem(decision.combined_data_id or f"{self._common_prefix(names)}-{axis}-stack")
                    dataset_id = self._unique_data_id(suggested_base, existing_ids)
                    dataset_plans.append(
                        _DatasetPlanRecord(
                            dataset_id=dataset_id,
                            source_input_ids=list(selected_inputs),
                            canonical_dims=tuple(CANONICAL_DIMS),
                            projected_shape=tuple(combined_shape),
                            strict_errors=strict_errors,
                            warnings=[] if not strict_errors else ["Resolve strict compatibility errors before commit."],
                        )
                    )

        for ds_plan in dataset_plans:
            errors.extend(ds_plan.strict_errors)

        is_valid = not errors
        plan_id = f"plan-{uuid4().hex[:12]}"
        plan_record = _PlanRecord(
            plan_id=plan_id,
            inspection_id=inspection_id,
            expires_at=session.expires_at,
            grouping_mode=grouping_mode,
            tab_mode=decision.tab_mode,
            mapping_by_input=mapping_by_input,
            datasets=dataset_plans,
            warnings=warnings,
            errors=errors,
            is_valid=is_valid,
        )
        self._sessions.save_plan(plan_record)

        return IngestPlan(
            plan_id=plan_id,
            inspection_id=inspection_id,
            expires_at=session.expires_at.isoformat(),
            grouping_mode=grouping_mode,
            tab_mode=decision.tab_mode,
            datasets=[
                IngestDatasetPlan(
                    dataset_id=ds_plan.dataset_id,
                    source_input_ids=list(ds_plan.source_input_ids),
                    canonical_dims=[str(dim) for dim in ds_plan.canonical_dims],
                    projected_shape=[int(x) for x in ds_plan.projected_shape],
                    warnings=list(ds_plan.warnings),
                    strict_errors=list(ds_plan.strict_errors),
                )
                for ds_plan in dataset_plans
            ],
            warnings=warnings,
            errors=errors,
            is_valid=is_valid,
        )

    @staticmethod
    def _combine_datasets(
        datasets: list[CubeDataset],
        *,
        combined_data_id: str,
        combine_axis: str,
        inspection_id: str,
        plan_id: str,
        source_ids: list[str],
    ) -> CubeDataset:
        if not datasets:
            raise ValueError("no datasets provided for combine")

        axis_idx = CANONICAL_DIMS.index(combine_axis)
        base = datasets[0]
        for ds in datasets:
            if ds.shape[axis_idx] != 1:
                raise ValueError(f"axis '{combine_axis}' must be singleton across files for strict combine")

        values = np.concatenate([np.asarray(ds.values, dtype=np.float32) for ds in datasets], axis=axis_idx)

        masks = [np.asarray(ds.mask) for ds in datasets if ds.mask is not None]
        mask = np.concatenate(masks, axis=axis_idx) if masks else None

        coords = {dim: np.asarray(base.coords[dim]).copy() for dim in base.dims}
        coords[combine_axis] = np.arange(values.shape[axis_idx], dtype=np.float64)
        units = dict(base.units)
        units[combine_axis] = "index"

        provenance = dict(base.provenance)
        provenance["ingest"] = {
            "inspection_id": inspection_id,
            "plan_id": plan_id,
            "mode": f"files_as_{combine_axis}",
            "source_input_ids": source_ids,
        }

        combined = CubeDataset(
            data_id=combined_data_id,
            dims=tuple(base.dims),
            coords=coords,
            values=values,
            units=units,
            intensity_unit=base.intensity_unit,
            wcs=dict(base.wcs),
            provenance=provenance,
            mask=mask,
            uncertainty=None,
        )
        combined.validate()
        return combined

    def commit(self, plan_id: str) -> IngestCommitResponse:
        plan = self._sessions.get_plan(plan_id)
        session = self._sessions.get_session(plan.inspection_id)

        if not plan.is_valid:
            raise ValueError("ingest plan is invalid; resolve errors before commit")

        created_ids: list[str] = []
        existing_ids = {summary.data_id for summary in self._registry.list()}

        for ds_plan in plan.datasets:
            if len(ds_plan.source_input_ids) == 1:
                input_id = ds_plan.source_input_ids[0]
                rec = session.inputs[input_id]
                mapping = plan.mapping_by_input[input_id]
                target_id = self._unique_data_id(ds_plan.dataset_id, existing_ids)

                loaded = self._load_dataset_for_input(rec, mapping, target_id)
                loaded, _ = pad_dataset_to_canonical(loaded)
                loaded.provenance["ingest"] = {
                    "inspection_id": session.inspection_id,
                    "plan_id": plan.plan_id,
                    "mode": "separate",
                    "raw_input_id": input_id,
                }
                loaded.validate()
                self._registry.add(loaded)
                created_ids.append(target_id)
                continue

            if plan.grouping_mode == "separate":
                raise ValueError("unexpected multi-source dataset plan under separate grouping mode")

            axis = GROUPING_AXIS_MAP.get(plan.grouping_mode)
            if axis is None:
                raise ValueError(f"unsupported grouping mode: {plan.grouping_mode}")

            merged_inputs = ds_plan.source_input_ids
            loaded_parts: list[CubeDataset] = []
            for input_id in merged_inputs:
                rec = session.inputs[input_id]
                mapping = plan.mapping_by_input[input_id]
                temp_ds = self._load_dataset_for_input(rec, mapping, self._safe_file_stem(rec.raw_input.name))
                temp_ds, _ = pad_dataset_to_canonical(temp_ds)
                loaded_parts.append(temp_ds)

            target_id = self._unique_data_id(ds_plan.dataset_id, existing_ids)
            combined = self._combine_datasets(
                loaded_parts,
                combined_data_id=target_id,
                combine_axis=axis,
                inspection_id=session.inspection_id,
                plan_id=plan.plan_id,
                source_ids=list(merged_inputs),
            )
            self._registry.add(combined)
            created_ids.append(target_id)

        # Save/update a lightweight preset for repeated imports.
        used_mappings = [
            plan.mapping_by_input[input_id]
            for input_id in plan.mapping_by_input
            if input_id in session.inputs and not plan.mapping_by_input[input_id].ignore
        ]
        decision = MappingDecision(
            grouping_mode=plan.grouping_mode,
            file_mappings=used_mappings,
            tab_mode=plan.tab_mode,
        )
        self._preset_store.upsert(signature=session.signature, decision=decision, mappings=used_mappings)

        self._sessions.finalize_inspection(session.inspection_id)
        return IngestCommitResponse(created_data_ids=created_ids, tab_mode=plan.tab_mode, warnings=list(plan.warnings))

    @staticmethod
    def _default_coords_from_shape(dims: tuple[str, ...], shape: tuple[int, ...]) -> dict[str, np.ndarray]:
        return {dim: np.arange(shape[axis], dtype=np.float64) for axis, dim in enumerate(dims)}

    @staticmethod
    def _default_units(dims: tuple[str, ...]) -> dict[str, str]:
        units = {
            "sample": "index",
            "pol": "index",
            "t": "s",
            "nu": "Hz",
            "x": "pix",
            "y": "pix",
            "z": "pix",
        }
        return {dim: units.get(dim, "unknown") for dim in dims}

    @classmethod
    def _load_hdf5_stokes_stack(
        cls,
        rec: _InputRecord,
        mapping: FileMappingDecision,
        data_id: str,
        dataset_path: str,
    ) -> CubeDataset:
        member_paths = cls._parse_stokes_stack_token(dataset_path)
        if not member_paths:
            raise ValueError("invalid stokes stack dataset_path token")
        return cls._load_hdf5_dataset_stack(
            rec=rec,
            mapping=mapping,
            data_id=data_id,
            member_paths=member_paths,
            stack_kind="stokes_iquv",
            dataset_path_repr=dataset_path,
        )

    @classmethod
    def _load_hdf5_dataset_stack(
        cls,
        *,
        rec: _InputRecord,
        mapping: FileMappingDecision,
        data_id: str,
        member_paths: list[str],
        stack_kind: str,
        dataset_path_repr: str,
    ) -> CubeDataset:
        import h5py

        with h5py.File(rec.path, "r") as f:
            arrays: list[np.ndarray] = []
            first_ds: Any = None
            for member in member_paths:
                if member not in f:
                    raise ValueError(f"stack member dataset '{member}' not found")
                ds = f[member]
                if not np.issubdtype(ds.dtype, np.number):
                    raise ValueError(f"stack member dataset '{member}' is not numeric")
                arr = np.asarray(ds, dtype=np.float32)
                if arr.ndim < 1 or arr.size < 1:
                    raise ValueError(f"stack member dataset '{member}' is empty")
                if arrays and arr.shape != arrays[0].shape:
                    raise ValueError("stack member datasets have incompatible shapes")
                if first_ds is None:
                    first_ds = ds
                arrays.append(arr)
            values = np.stack(arrays, axis=0).astype(np.float32, copy=False)

            dims = tuple(str(dim) for dim in mapping.dims)
            values, dims = reorder_to_canonical(values, dims)
            coords = cls._default_coords_from_shape(dims, tuple(int(x) for x in values.shape))
            units = cls._default_units(dims)

            intensity_unit = "arb"
            if first_ds is not None and hasattr(first_ds, "attrs"):
                raw_unit = first_ds.attrs.get("intensity_unit")
                if isinstance(raw_unit, bytes):
                    raw_unit = raw_unit.decode("utf-8", errors="ignore")
                if raw_unit is not None:
                    intensity_unit = str(raw_unit)

        axis_types: dict[str, str] = {}
        for dim in dims:
            if dim == "nu":
                axis_types[dim] = "spectral"
            elif dim == "t":
                axis_types[dim] = "time"
            elif dim == "pol":
                axis_types[dim] = "polarization"
            elif dim == "sample":
                axis_types[dim] = "sample"
            else:
                axis_types[dim] = "spatial"

        provenance = {
            "source": "hdf5",
            "path": str(rec.path),
            "dataset_path": dataset_path_repr,
            "stacked_member_paths": member_paths,
            "stacked_kind": stack_kind,
            "key_stack_axis": str(mapping.key_stack_axis or ""),
        }
        values, coords, provenance = _normalize_stokes_iqu_to_iquv(values, dims, coords, provenance)

        out = CubeDataset(
            data_id=data_id,
            dims=dims,
            coords=coords,
            values=values,
            units=units,
            intensity_unit=str(intensity_unit),
            wcs={"frame": "unknown", "source": "hdf5", "axis_types": axis_types},
            provenance=provenance,
        )
        out.validate()
        return out

    @classmethod
    def _load_dataset_for_input(cls, rec: _InputRecord, mapping: FileMappingDecision, data_id: str) -> CubeDataset:
        kwargs: dict[str, Any] = {
            "data_id": data_id,
            "dims": tuple(str(dim) for dim in mapping.dims),
        }
        if rec.format_name == "hdf5":
            selected_paths = cls._mapping_hdf5_dataset_paths(rec, mapping)
            if len(selected_paths) > 1:
                stack_axis = cls._mapping_hdf5_key_stack_axis(mapping)
                if stack_axis is None:
                    raise ValueError("key_stack_axis is required when multiple dataset_paths are selected")
                if stack_axis not in CANONICAL_DIMS:
                    raise ValueError(f"unknown key_stack_axis '{stack_axis}'")
                mapped_dims = [str(dim) for dim in mapping.dims]
                if not mapped_dims or mapped_dims[0] != stack_axis:
                    raise ValueError(f"key_stack_axis '{stack_axis}' must be assigned to axis 0 for stacked keys")
                return cls._load_hdf5_dataset_stack(
                    rec=rec,
                    mapping=mapping,
                    data_id=data_id,
                    member_paths=selected_paths,
                    stack_kind="selected_keys",
                    dataset_path_repr=f"stack({', '.join(selected_paths)})",
                )
            dataset_path = str(
                selected_paths[0] if selected_paths else rec.parsed.format_metadata.get("dataset_path", "values")
            ).strip()
            if cls._parse_stokes_stack_token(dataset_path):
                return cls._load_hdf5_stokes_stack(rec, mapping, data_id, dataset_path)
            kwargs["dataset_path"] = dataset_path or "values"
        if rec.format_name == "zarr":
            data_key = str(rec.parsed.format_metadata.get("data_key", "values")).strip()
            kwargs["data_key"] = data_key or "values"
        return load_by_extension(rec.path, **kwargs)
