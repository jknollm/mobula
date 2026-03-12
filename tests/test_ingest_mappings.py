from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from mobula.service.api_models import (
    FileInference,
    FileMappingDecision,
    MappingDecision,
    MappingPreset,
    ParsedArrayInfo,
    PresetSignature,
    RawInputRef,
)
from mobula.service.ingest.mappings import (
    mapping_hdf5_dataset_paths,
    resolve_mappings,
    shape_for_mapping,
)
from mobula.service.ingest.models import _InputRecord, _InspectionSession


def _raw_input(input_id: str = "raw-1", *, format_name: str = "hdf5") -> RawInputRef:
    return RawInputRef(
        id=input_id,
        name="demo.h5",
        source_type="local_path",
        path_or_upload_ref="/tmp/demo.h5",
        format=format_name,
        size_bytes=32,
    )


def _parsed(shape: list[int], *, dataset_path: str | None = None, candidates: list[dict] | None = None) -> ParsedArrayInfo:
    metadata = {}
    if dataset_path is not None:
        metadata["dataset_path"] = dataset_path
    if candidates is not None:
        metadata["dataset_candidates"] = candidates
    if dataset_path is not None and shape:
        metadata["shape"] = shape
    return ParsedArrayInfo(
        shape=shape,
        dtype="float32",
        ndim=len(shape),
        native_dim_labels=["x", "y"][: len(shape)],
        format_metadata=metadata,
    )


def _file_inference(input_id: str = "raw-1") -> FileInference:
    return FileInference(
        raw_input=_raw_input(input_id),
        parsed=_parsed([3, 4], dataset_path="science/main"),
        recommended_dims=["x", "y"],
        confidence=0.9,
        confidence_tier="high",
    )


def _input_record(path: Path, *, input_id: str = "raw-1") -> _InputRecord:
    return _InputRecord(
        raw_input=_raw_input(input_id),
        path=path,
        parsed=_parsed([3, 4], candidates=[]),
        recommended_dims=["x", "y"],
        format_name="hdf5",
    )


def test_mapping_hdf5_dataset_paths_prefers_current_dataset_path_over_stale_single_entry(tmp_path: Path) -> None:
    rec = _input_record(tmp_path / "demo.h5")
    mapped = FileMappingDecision(
        raw_input_id="raw-1",
        dims=["x", "y"],
        dataset_path="science/new",
        dataset_paths=["science/old"],
    )

    assert mapping_hdf5_dataset_paths(rec, mapped) == ["science/new"]


def test_resolve_mappings_applies_preset_dims_and_default_hdf5_path(tmp_path: Path) -> None:
    inf = _file_inference()
    session = _InspectionSession(
        inspection_id="insp-1",
        expires_at=datetime.now(UTC),
        temp_dir=tmp_path,
        inputs={},
        inferences=[inf],
    )
    preset = MappingPreset(
        preset_id="preset-1",
        name="Recent Mapping",
        project_scope="test",
        signature=PresetSignature(format="hdf5", ndim=2, native_dim_labels=["x", "y"], axis_order_hint=["x", "y"]),
        default_dims=["t", "x"],
        default_grouping_mode="separate",
        default_tab_mode="single_tab",
        confidence=0.92,
        rationale="test preset",
    )

    resolved = resolve_mappings(
        session,
        MappingDecision(use_preset_id="preset-1"),
        preset_loader=lambda preset_id: preset if preset_id == "preset-1" else None,
    )

    assert len(resolved) == 1
    assert resolved[0].dims == ["t", "x"]
    assert resolved[0].dataset_path == "science/main"
    assert resolved[0].dataset_paths == ["science/main"]


def test_shape_for_mapping_stacks_multiple_hdf5_paths_from_file(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    path = tmp_path / "stacked.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("science/a", data=np.ones((2, 3), dtype=np.float32))
        f.create_dataset("science/b", data=np.zeros((2, 3), dtype=np.float32))

    rec = _input_record(path)
    mapped = FileMappingDecision(
        raw_input_id="raw-1",
        dims=["sample", "x", "y"],
        dataset_paths=["science/a", "science/b"],
        key_stack_axis="sample",
    )

    shape = shape_for_mapping(rec, mapped, parse_stokes_stack_token=lambda _path: None)
    assert shape == [2, 2, 3]
