from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from mobula.service.api_models import (
    FileInference,
    FileMappingDecision,
    GroupingCandidate,
    ParsedArrayInfo,
    PresetSignature,
    RawInputRef,
)


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


__all__ = [
    "IngestLimits",
    "_DatasetPlanRecord",
    "_Hdf5DatasetCandidate",
    "_InputRecord",
    "_InspectionSession",
    "_PlanRecord",
]
