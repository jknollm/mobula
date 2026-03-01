from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

import numpy as np
import pytest

from ncube.data.mock_cube import MockCubeConfig, generate_mock_dataset
from ncube.data.schema import CubeDataset
from ncube.service.registry import DatasetRegistry, DatasetSummary


def _tiny_dataset(data_id: str = "tiny") -> CubeDataset:
    return generate_mock_dataset(
        data_id,
        MockCubeConfig(sample=2, pol=3, t=2, nu=3, x=4, y=3, z=2, seed=9, model="dynamic"),
    )


def test_add_and_get_round_trip() -> None:
    registry = DatasetRegistry()
    ds = _tiny_dataset("round-trip")
    registry.add(ds)
    fetched = registry.get("round-trip")
    assert fetched.data_id == "round-trip"
    assert fetched.shape == ds.shape


def test_get_unknown_dataset_raises_key_error() -> None:
    registry = DatasetRegistry()
    with pytest.raises(KeyError, match="not found"):
        registry.get("missing")


def test_list_contains_loaded_and_lazy_summaries() -> None:
    registry = DatasetRegistry()
    ds = _tiny_dataset("listed")
    registry.add(ds)
    summaries = registry.list()
    ids = {s.data_id for s in summaries}
    assert "listed" in ids
    assert "mock-volume-256-cube" in ids
    listed_summary = next(s for s in summaries if s.data_id == "listed")
    assert listed_summary.shape == ds.shape


def test_lazy_dataset_builder_materializes_once() -> None:
    registry = DatasetRegistry()
    builder_calls = {"n": 0}

    def build() -> CubeDataset:
        builder_calls["n"] += 1
        return _tiny_dataset("lazy-tiny")

    registry._lazy_datasets = {  # noqa: SLF001
        "lazy-tiny": (
            DatasetSummary(
                data_id="lazy-tiny",
                dims=("sample", "pol", "t", "nu", "x", "y", "z"),
                shape=(2, 3, 2, 3, 4, 3, 2),
                intensity_unit="arb",
                source="test-lazy",
            ),
            build,
        )
    }

    ds1 = registry.get("lazy-tiny")
    ds2 = registry.get("lazy-tiny")
    assert ds1.data_id == "lazy-tiny"
    assert ds2.data_id == "lazy-tiny"
    assert builder_calls["n"] == 1


def test_ensure_default_datasets_is_idempotent() -> None:
    registry = DatasetRegistry()
    registry.ensure_default_datasets()
    first = sorted(s.data_id for s in registry.list())
    registry.ensure_default_datasets()
    second = sorted(s.data_id for s in registry.list())
    assert first == second
    assert "mock-7d-cube" in second
    assert "mock-hires-cube" in second
    assert "mock-volume-cube" in second


def test_load_local_loads_dataset_by_extension(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    h5_path = tmp_path / "registry_local.h5"
    with h5py.File(h5_path, "w") as f:
        ds = f.create_dataset("values", data=values)
        ds.attrs["dims"] = "sample,t,x"

    registry = DatasetRegistry()
    loaded = registry.load_local(str(h5_path), data_id="local-h5")
    assert loaded.data_id == "local-h5"
    assert loaded.dims == ("sample", "t", "x")
    fetched = registry.get("local-h5")
    assert fetched.shape == (2, 3, 4)


def test_dataset_summary_dataclass_fields_are_stable() -> None:
    summary = DatasetSummary(
        data_id="s",
        dims=("sample", "x"),
        shape=(2, 5),
        intensity_unit="arb",
        source="test",
    )
    assert asdict(summary) == {
        "data_id": "s",
        "dims": ("sample", "x"),
        "shape": (2, 5),
        "intensity_unit": "arb",
        "source": "test",
    }
