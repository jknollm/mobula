from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock

from ncube.data.loaders import load_by_extension
from ncube.data.mock_cube import MockCubeConfig, generate_mock_dataset
from ncube.data.schema import CubeDataset


@dataclass(slots=True)
class DatasetSummary:
    data_id: str
    dims: tuple[str, ...]
    shape: tuple[int, ...]
    intensity_unit: str
    source: str


class DatasetRegistry:
    def __init__(self) -> None:
        self._lock = RLock()
        self._datasets: dict[str, CubeDataset] = {}
        self._lazy_datasets: dict[str, tuple[DatasetSummary, Callable[[], CubeDataset]]] = {}
        self._register_lazy_defaults()

    def add(self, dataset: CubeDataset) -> None:
        dataset.validate()
        with self._lock:
            self._datasets[dataset.data_id] = dataset

    def get(self, data_id: str) -> CubeDataset:
        lazy_builder: Callable[[], CubeDataset] | None = None
        with self._lock:
            ds = self._datasets.get(data_id)
            if ds is not None:
                return ds
            lazy = self._lazy_datasets.get(data_id)
            if lazy is not None:
                _, lazy_builder = lazy

        if lazy_builder is not None:
            dataset = lazy_builder()
            dataset.validate()
            with self._lock:
                existing = self._datasets.get(data_id)
                if existing is not None:
                    return existing
                self._datasets[data_id] = dataset
                return dataset

        raise KeyError(f"dataset '{data_id}' not found")

    def list(self) -> list[DatasetSummary]:
        with self._lock:
            loaded = [
                DatasetSummary(
                    data_id=ds.data_id,
                    dims=ds.dims,
                    shape=ds.shape,
                    intensity_unit=ds.intensity_unit,
                    source=str(ds.provenance.get("source", "unknown")),
                )
                for ds in self._datasets.values()
            ]
            loaded_ids = {d.data_id for d in loaded}
            lazy = [summary for data_id, (summary, _) in self._lazy_datasets.items() if data_id not in loaded_ids]
            return loaded + lazy

    def _register_lazy_defaults(self) -> None:
        self._lazy_datasets["mock-volume-256-cube"] = (
            DatasetSummary(
                data_id="mock-volume-256-cube",
                dims=("sample", "pol", "t", "nu", "x", "y", "z"),
                shape=(1, 1, 1, 1, 256, 256, 256),
                intensity_unit="arb",
                source="generated-lazy",
            ),
            lambda: generate_mock_dataset(
                "mock-volume-256-cube",
                MockCubeConfig(sample=1, pol=1, t=1, nu=1, x=256, y=256, z=256, seed=321, model="center_structured"),
            ),
        )
        self._lazy_datasets["mock-volume-time-cube"] = (
            DatasetSummary(
                data_id="mock-volume-time-cube",
                dims=("sample", "pol", "t", "nu", "x", "y", "z"),
                shape=(9, 1, 16, 1, 64, 64, 64),
                intensity_unit="arb",
                source="generated-lazy",
            ),
            lambda: generate_mock_dataset(
                "mock-volume-time-cube",
                MockCubeConfig(sample=9, pol=1, t=16, nu=1, x=64, y=64, z=64, seed=654, model="center_structured_time"),
            ),
        )
        self._lazy_datasets["mock-wide-image-cube"] = (
            DatasetSummary(
                data_id="mock-wide-image-cube",
                dims=("sample", "pol", "t", "nu", "x", "y", "z"),
                shape=(9, 1, 1, 10, 2048, 1024, 1),
                intensity_unit="arb",
                source="generated-lazy",
            ),
            lambda: generate_mock_dataset(
                "mock-wide-image-cube",
                MockCubeConfig(sample=9, pol=1, t=1, nu=10, x=2048, y=1024, z=1, seed=987, model="dynamic"),
            ),
        )

    def load_local(self, path: str, data_id: str | None = None) -> CubeDataset:
        dataset = load_by_extension(path, data_id=data_id)
        self.add(dataset)
        return dataset

    def ensure_default_datasets(self) -> None:
        with self._lock:
            already = set(self._datasets.keys())

        if "mock-7d-cube" not in already:
            self.add(
                generate_mock_dataset(
                    "mock-7d-cube",
                    MockCubeConfig(sample=9, pol=4, t=20, nu=24, x=64, y=64, z=2, seed=42),
                )
            )

        if "mock-hires-cube" not in already:
            self.add(
                generate_mock_dataset(
                    "mock-hires-cube",
                    MockCubeConfig(sample=9, pol=4, t=12, nu=16, x=128, y=128, z=2, seed=77),
                )
            )

        if "mock-volume-cube" not in already:
            self.add(
                generate_mock_dataset(
                    "mock-volume-cube",
                    MockCubeConfig(sample=9, pol=4, t=1, nu=1, x=64, y=64, z=64, seed=123, model="center_structured"),
                )
            )
