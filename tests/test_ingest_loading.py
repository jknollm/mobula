from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from mobula.data.schema import CANONICAL_DIMS, CubeDataset
from mobula.service.api_models import FileMappingDecision, ParsedArrayInfo, RawInputRef
from mobula.service.ingest.loading import combine_datasets, load_dataset_for_input
from mobula.service.ingest.models import _InputRecord

_STOKES_STACK_PREFIX = "__stokes_stack__:"


def _parse_stokes_stack_token(value: str) -> list[str] | None:
    raw = str(value or "")
    if not raw.startswith(_STOKES_STACK_PREFIX):
        return None
    try:
        payload = json.loads(raw[len(_STOKES_STACK_PREFIX):])
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, list):
        return None
    return [str(item).strip() for item in payload if str(item).strip()]


def _input_record(
    path: Path,
    *,
    shape: list[int] | None = None,
    dataset_path: str | None = "science/main",
    format_name: str = "hdf5",
) -> _InputRecord:
    metadata = {}
    if dataset_path is not None:
        metadata["dataset_path"] = dataset_path
    return _InputRecord(
        raw_input=RawInputRef(
            id="raw-1",
            name=path.name,
            source_type="local_path",
            path_or_upload_ref=str(path),
            format=format_name,
            size_bytes=64,
        ),
        path=path,
        parsed=ParsedArrayInfo(
            shape=shape or [2, 3],
            dtype="float32",
            ndim=len(shape or [2, 3]),
            native_dim_labels=["x", "y"][: len(shape or [2, 3])],
            format_metadata=metadata,
        ),
        recommended_dims=["x", "y"][: len(shape or [2, 3])],
        format_name=format_name,
    )


def _cube_dataset(data_id: str, sample_value: float) -> CubeDataset:
    shape = (1, 1, 1, 1, 2, 3, 1)
    values = np.full(shape, sample_value, dtype=np.float32)
    coords = {dim: np.arange(size, dtype=np.float64) for dim, size in zip(CANONICAL_DIMS, shape, strict=True)}
    units = {
        "sample": "index",
        "pol": "index",
        "t": "s",
        "nu": "Hz",
        "x": "pix",
        "y": "pix",
        "z": "pix",
    }
    dataset = CubeDataset(
        data_id=data_id,
        dims=CANONICAL_DIMS,
        coords=coords,
        values=values,
        units=units,
        intensity_unit="arb",
        wcs={"frame": "test"},
        provenance={"source": "test"},
        uncertainty=None,
    )
    dataset.validate()
    return dataset


def test_load_dataset_for_input_stacks_selected_hdf5_keys(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    path = tmp_path / "selected_keys.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("science/a", data=np.ones((2, 3), dtype=np.float32))
        f.create_dataset("science/b", data=np.full((2, 3), 2, dtype=np.float32))

    dataset = load_dataset_for_input(
        _input_record(path),
        FileMappingDecision(
            raw_input_id="raw-1",
            dims=["sample", "x", "y"],
            dataset_paths=["science/a", "science/b"],
            key_stack_axis="sample",
        ),
        "stacked-keys",
        parse_stokes_stack_token=_parse_stokes_stack_token,
    )

    assert dataset.shape == (2, 2, 3)
    assert dataset.provenance["stacked_kind"] == "selected_keys"
    np.testing.assert_allclose(dataset.values[0], np.ones((2, 3), dtype=np.float32))
    np.testing.assert_allclose(dataset.values[1], np.full((2, 3), 2, dtype=np.float32))


def test_load_dataset_for_input_expands_stokes_token_to_iquv(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    path = tmp_path / "stokes.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("I", data=np.ones((2, 3), dtype=np.float32))
        f.create_dataset("Q", data=np.full((2, 3), 2, dtype=np.float32))
        f.create_dataset("U", data=np.full((2, 3), 3, dtype=np.float32))

    token = f"{_STOKES_STACK_PREFIX}{json.dumps(['I', 'Q', 'U'], separators=(',', ':'))}"
    dataset = load_dataset_for_input(
        _input_record(path, dataset_path=token),
        FileMappingDecision(
            raw_input_id="raw-1",
            dims=["pol", "x", "y"],
            dataset_path=token,
        ),
        "stokes-stack",
        parse_stokes_stack_token=_parse_stokes_stack_token,
    )

    assert dataset.shape == (4, 2, 3)
    assert dataset.provenance["stacked_kind"] == "stokes_iquv"
    np.testing.assert_allclose(dataset.values[3], np.zeros((2, 3), dtype=np.float32))


def test_load_dataset_for_input_rejects_stacked_axis_when_not_mapped_to_axis_zero(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    path = tmp_path / "bad_stack_axis.h5"
    with h5py.File(path, "w") as f:
        f.create_dataset("science/a", data=np.ones((2, 3), dtype=np.float32))
        f.create_dataset("science/b", data=np.ones((2, 3), dtype=np.float32))

    with pytest.raises(ValueError, match="axis 0"):
        load_dataset_for_input(
            _input_record(path),
            FileMappingDecision(
                raw_input_id="raw-1",
                dims=["x", "sample", "y"],
                dataset_paths=["science/a", "science/b"],
                key_stack_axis="sample",
            ),
            "invalid-stack-axis",
            parse_stokes_stack_token=_parse_stokes_stack_token,
        )


def test_combine_datasets_concatenates_singleton_axis_and_records_ingest_provenance() -> None:
    dataset_a = _cube_dataset("part-a", 1.0)
    dataset_b = _cube_dataset("part-b", 2.0)

    combined = combine_datasets(
        [dataset_a, dataset_b],
        combined_data_id="combined",
        combine_axis="sample",
        inspection_id="insp-1",
        plan_id="plan-1",
        source_ids=["raw-a", "raw-b"],
    )

    assert combined.data_id == "combined"
    assert combined.shape == (2, 1, 1, 1, 2, 3, 1)
    assert combined.units["sample"] == "index"
    assert "sample" in combined.provenance["synthetic_coordinate_dims"]
    assert combined.provenance["ingest"] == {
        "inspection_id": "insp-1",
        "plan_id": "plan-1",
        "mode": "files_as_sample",
        "source_input_ids": ["raw-a", "raw-b"],
    }
    np.testing.assert_allclose(combined.values[0], dataset_a.values[0])
    np.testing.assert_allclose(combined.values[1], dataset_b.values[0])
