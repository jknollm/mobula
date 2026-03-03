from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pytest

from mobula.data.mock_cube import MockCubeConfig, generate_mock_dataset
from mobula.data.schema import CubeDataset
from mobula.service.registry import DatasetRegistry, DatasetSummary


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
    assert "demo-hires-3d-no-samples" in ids
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
    assert "demo-quicklook-7d-pol-samples" in second
    assert "demo-full-ms-time-3d-samples-no-pol" in second
    assert "demo-hires-xy-nu-pol-samples" in second
    assert "demo-hires-3d-no-samples" in second
    assert "demo-long-2d-movie-pol" in second
    assert "demo-5d-time-3d-samples" in second
    assert "demo-healpix-sky-samples-time-nu" in second
    assert "demo-healpix-sky-hires-samples-time-nu" in second


def test_healpix_demo_metadata_shape() -> None:
    registry = DatasetRegistry()
    summaries = registry.list()
    summary = next(s for s in summaries if s.data_id == "demo-healpix-sky-samples-time-nu")
    assert summary.shape[0] > 1  # sample
    assert summary.shape[2] > 1  # time
    assert summary.shape[3] > 1  # frequency
    assert summary.shape[4] == 3072  # healpix npix
    assert summary.shape[5] == 1


def test_healpix_hires_demo_metadata_shape() -> None:
    registry = DatasetRegistry()
    summaries = registry.list()
    summary = next(s for s in summaries if s.data_id == "demo-healpix-sky-hires-samples-time-nu")
    assert summary.shape[4] == 196608  # healpix npix (nside=128)
    assert summary.shape[5] == 1


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


def test_load_local_with_manual_dims_and_padding(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    values = np.arange(3 * 4, dtype=np.float32).reshape(3, 4)
    h5_path = tmp_path / "registry_manual_dims.h5"
    with h5py.File(h5_path, "w") as f:
        f.create_dataset("values", data=values)

    registry = DatasetRegistry()
    loaded = registry.load_local(str(h5_path), data_id="local-manual", dims=("x", "y"), pad_missing_dims=True)
    assert loaded.data_id == "local-manual"
    assert loaded.dims == ("sample", "pol", "t", "nu", "x", "y", "z")
    assert loaded.shape == (1, 1, 1, 1, 3, 4, 1)
    assert loaded.provenance["padded_dims"] == ["sample", "pol", "t", "nu", "z"]


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


def test_seeded_manifest_registers_lazy_local_dataset(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    h5_path = tmp_path / "seeded.h5"
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    with h5py.File(h5_path, "w") as f:
        ds = f.create_dataset("values", data=values)
        ds.attrs["dims"] = "sample,t,x"

    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "version": 1,
                "datasets": [
                    {
                        "data_id": "seed-manifest-local",
                        "path": h5_path.name,
                        "dims": ["sample", "t", "x"],
                        "shape": [2, 3, 4],
                        "intensity_unit": "arb",
                        "source": "seeded-local-hdf5",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    registry = DatasetRegistry(seeded_manifest_path=manifest_path)
    summaries = registry.list()
    ids = {s.data_id for s in summaries}
    assert "seed-manifest-local" in ids
    loaded = registry.get("seed-manifest-local")
    assert loaded.dims == ("sample", "t", "x")
    assert loaded.shape == (2, 3, 4)
