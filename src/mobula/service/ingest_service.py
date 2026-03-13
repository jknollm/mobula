from __future__ import annotations

import json
import math
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import UploadFile

from mobula.data.loaders import _dim_from_ctype, infer_npz_dims, list_npz_array_candidates
from mobula.data.schema import CANONICAL_DIMS, CubeDataset
from mobula.paths import default_data_dir
from mobula.service.api_models import (
    AxisCandidate,
    AxisInference,
    FileInference,
    FileMappingDecision,
    GroupingCandidate,
    IngestCommitResponse,
    IngestInspection,
    IngestPlan,
    MappingDecision,
    ParsedArrayInfo,
    PresetSignature,
    RawInputRef,
)
from mobula.service.ingest.commit import commit_ingest_plan
from mobula.service.ingest.inspect import inspect_inputs
from mobula.service.ingest.loading import (
    combine_datasets as _combine_datasets_helper,
)
from mobula.service.ingest.loading import (
    default_coords_from_shape as _default_coords_from_shape_helper,
)
from mobula.service.ingest.loading import (
    default_units as _default_units_helper,
)
from mobula.service.ingest.loading import (
    load_dataset_for_input as _load_dataset_for_input_helper,
)
from mobula.service.ingest.loading import (
    load_hdf5_dataset_stack as _load_hdf5_dataset_stack_helper,
)
from mobula.service.ingest.loading import (
    load_hdf5_stokes_stack as _load_hdf5_stokes_stack_helper,
)
from mobula.service.ingest.mappings import (
    build_default_mappings as _build_default_mappings_helper,
)
from mobula.service.ingest.mappings import (
    default_hdf5_dataset_path as _default_hdf5_dataset_path_helper,
)
from mobula.service.ingest.mappings import (
    default_mapping as _default_mapping_helper,
)
from mobula.service.ingest.mappings import (
    hdf5_shape_for_dataset_path as _hdf5_shape_for_dataset_path_helper,
)
from mobula.service.ingest.mappings import (
    hdf5_shape_for_dataset_path_from_file as _hdf5_shape_for_dataset_path_from_file_helper,
)
from mobula.service.ingest.mappings import (
    hdf5_stack_shape_from_member_paths as _hdf5_stack_shape_from_member_paths_helper,
)
from mobula.service.ingest.mappings import (
    hdf5_stack_shape_from_member_paths_from_file as _hdf5_stack_shape_from_member_paths_from_file_helper,
)
from mobula.service.ingest.mappings import (
    mapping_hdf5_dataset_paths as _mapping_hdf5_dataset_paths_helper,
)
from mobula.service.ingest.mappings import (
    mapping_hdf5_key_stack_axis as _mapping_hdf5_key_stack_axis_helper,
)
from mobula.service.ingest.mappings import (
    resolve_mappings as _resolve_mappings_helper,
)
from mobula.service.ingest.mappings import (
    shape_for_mapping as _shape_for_mapping_helper,
)
from mobula.service.ingest.models import (
    IngestLimits,
    _Hdf5DatasetCandidate,
    _InputRecord,
    _InspectionSession,
)
from mobula.service.ingest.plan import build_ingest_plan
from mobula.service.ingest.presets import _PresetStore
from mobula.service.ingest.session_store import _IngestSessionStore
from mobula.service.registry import DatasetRegistry

SUPPORTED_INGEST_EXTS = {".h5", ".hdf5", ".fits", ".fit", ".fts", ".npz", ".zarr"}

_HDF5_STOKES_STACK_PREFIX = "__stokes_stack__:"


class IngestService:
    SUPPORTED_INGEST_EXTS = SUPPORTED_INGEST_EXTS

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
        if suffix == ".npz":
            return "npz"
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
        parsed, recommended_dims, axis_inferences, confidence, confidence_tier, warnings = self._inspect_array_info(
            path
        )

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
        elif suffix == ".npz":
            with np.load(path, allow_pickle=False) as npz:
                candidates_json = list_npz_array_candidates(npz)
                if not candidates_json:
                    raise ValueError("NPZ file does not contain any real numeric arrays that can be displayed")
                selected_meta = candidates_json[0]
                shape = [int(x) for x in selected_meta["shape"]]
                dtype = str(selected_meta["dtype"])
                native_labels = list(infer_npz_dims(npz, str(selected_meta["path"]), tuple(shape)))
                metadata["dataset_path"] = str(selected_meta["path"])
                metadata["dataset_candidates"] = candidates_json[:12]
                if str(selected_meta["path"]) != "values":
                    pre_warnings.append(
                        f"NPZ array 'values' not found; using '{selected_meta['path']}' as the best numeric data candidate."
                    )
                if (
                    len(candidates_json) > 1
                    and (int(candidates_json[0]["score"]) - int(candidates_json[1]["score"])) <= 30
                ):
                    pre_warnings.append(
                        "Multiple plausible NPZ arrays were detected; verify the selected Data Key in the ingest summary."
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
        return _hdf5_stack_shape_from_member_paths_helper(
            format_metadata,
            member_paths,
            parse_stokes_stack_token=cls._parse_stokes_stack_token,
            _seen=_seen,
        )

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
            if (
                isinstance(obj, h5py.Dataset)
                and obj.ndim == 1
                and int(obj.size) > 0
                and np.issubdtype(obj.dtype, np.number)
            ):
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
            if not list(file_obj.keys()):
                raise ValueError("HDF5 file is empty; root group has no datasets or subgroups to inspect")
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
        return await inspect_inputs(self, paths, uploads)

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
        return _default_hdf5_dataset_path_helper(format_metadata)

    @classmethod
    def _mapping_hdf5_dataset_paths(cls, rec: _InputRecord, mapped: FileMappingDecision) -> list[str]:
        return _mapping_hdf5_dataset_paths_helper(rec, mapped)

    @staticmethod
    def _mapping_hdf5_key_stack_axis(mapped: FileMappingDecision) -> str | None:
        return _mapping_hdf5_key_stack_axis_helper(mapped)

    @classmethod
    def _hdf5_shape_for_dataset_path(
        cls,
        format_metadata: dict[str, Any],
        dataset_path: str,
        *,
        _seen: set[str] | None = None,
    ) -> list[int] | None:
        return _hdf5_shape_for_dataset_path_helper(
            format_metadata,
            dataset_path,
            parse_stokes_stack_token=cls._parse_stokes_stack_token,
            _seen=_seen,
        )

    @classmethod
    def _hdf5_shape_for_dataset_path_from_file(
        cls,
        file_path: Path,
        dataset_path: str,
        *,
        _seen: set[str] | None = None,
    ) -> list[int] | None:
        return _hdf5_shape_for_dataset_path_from_file_helper(
            file_path,
            dataset_path,
            parse_stokes_stack_token=cls._parse_stokes_stack_token,
            _seen=_seen,
        )

    @classmethod
    def _hdf5_stack_shape_from_member_paths_from_file(
        cls,
        file_path: Path,
        member_paths: list[str],
        *,
        _seen: set[str] | None = None,
    ) -> list[int] | None:
        return _hdf5_stack_shape_from_member_paths_from_file_helper(
            file_path,
            member_paths,
            parse_stokes_stack_token=cls._parse_stokes_stack_token,
            _seen=_seen,
        )

    def _shape_for_mapping(self, rec: _InputRecord, mapped: FileMappingDecision) -> list[int]:
        return _shape_for_mapping_helper(
            rec,
            mapped,
            parse_stokes_stack_token=self._parse_stokes_stack_token,
        )

    def _default_mapping(self, inf: FileInference) -> FileMappingDecision:
        return _default_mapping_helper(inf)

    def _build_default_mappings(self, session: _InspectionSession) -> list[FileMappingDecision]:
        return _build_default_mappings_helper(session)

    def _resolve_mappings(self, session: _InspectionSession, decision: MappingDecision) -> list[FileMappingDecision]:
        return _resolve_mappings_helper(session, decision, preset_loader=self._preset_store.get)

    def plan(self, inspection_id: str, decision: MappingDecision) -> IngestPlan:
        return build_ingest_plan(self, inspection_id, decision)

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
        return _combine_datasets_helper(
            datasets,
            combined_data_id=combined_data_id,
            combine_axis=combine_axis,
            inspection_id=inspection_id,
            plan_id=plan_id,
            source_ids=source_ids,
        )

    def commit(self, plan_id: str) -> IngestCommitResponse:
        return commit_ingest_plan(self, plan_id)

    @staticmethod
    def _default_coords_from_shape(dims: tuple[str, ...], shape: tuple[int, ...]) -> dict[str, np.ndarray]:
        return _default_coords_from_shape_helper(dims, shape)

    @staticmethod
    def _default_units(dims: tuple[str, ...]) -> dict[str, str]:
        return _default_units_helper(dims)

    @classmethod
    def _load_hdf5_stokes_stack(
        cls,
        rec: _InputRecord,
        mapping: FileMappingDecision,
        data_id: str,
        dataset_path: str,
    ) -> CubeDataset:
        return _load_hdf5_stokes_stack_helper(
            rec,
            mapping,
            data_id,
            dataset_path,
            parse_stokes_stack_token=cls._parse_stokes_stack_token,
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
        return _load_hdf5_dataset_stack_helper(
            rec=rec,
            mapping=mapping,
            data_id=data_id,
            member_paths=member_paths,
            stack_kind=stack_kind,
            dataset_path_repr=dataset_path_repr,
        )

    @classmethod
    def _load_dataset_for_input(cls, rec: _InputRecord, mapping: FileMappingDecision, data_id: str) -> CubeDataset:
        return _load_dataset_for_input_helper(
            rec,
            mapping,
            data_id,
            parse_stokes_stack_token=cls._parse_stokes_stack_token,
        )
