from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from threading import RLock

from ncube.data.loaders import load_by_extension, pad_dataset_to_canonical
from ncube.data.mock_cube import MockCubeConfig, generate_mock_dataset
from ncube.data.schema import CubeDataset


@dataclass(slots=True)
class DatasetSummary:
    data_id: str
    dims: tuple[str, ...]
    shape: tuple[int, ...]
    intensity_unit: str
    source: str


@dataclass(frozen=True, slots=True)
class DemoDatasetSpec:
    data_id: str
    cfg: MockCubeConfig
    preload: bool = False


DEMO_DATASETS: tuple[DemoDatasetSpec, ...] = (
    DemoDatasetSpec(
        data_id="demo-quicklook-7d-pol-samples",
        cfg=MockCubeConfig(sample=4, pol=4, t=12, nu=16, x=80, y=80, z=2, seed=42, model="dynamic"),
        preload=True,
    ),
    DemoDatasetSpec(
        data_id="demo-full-ms-time-3d-samples-no-pol",
        cfg=MockCubeConfig(sample=4, pol=1, t=10, nu=12, x=80, y=80, z=12, seed=91, model="center_structured_time"),
    ),
    DemoDatasetSpec(
        data_id="demo-hires-xy-nu-pol-samples",
        cfg=MockCubeConfig(sample=4, pol=4, t=1, nu=10, x=2048, y=1024, z=1, seed=133, model="radio_galaxy"),
    ),
    DemoDatasetSpec(
        data_id="demo-hires-3d-no-samples",
        cfg=MockCubeConfig(sample=1, pol=1, t=1, nu=1, x=256, y=256, z=256, seed=207, model="spiral_galaxy"),
    ),
    DemoDatasetSpec(
        data_id="demo-long-2d-movie-pol",
        cfg=MockCubeConfig(sample=4, pol=4, t=96, nu=1, x=128, y=128, z=1, seed=305, model="filamentary_time"),
    ),
    DemoDatasetSpec(
        data_id="demo-5d-time-3d-samples",
        cfg=MockCubeConfig(sample=4, pol=1, t=16, nu=1, x=64, y=64, z=48, seed=451, model="center_structured_time"),
    ),
)


class DatasetRegistry:
    def __init__(self, seeded_manifest_path: str | Path | None = None) -> None:
        self._lock = RLock()
        self._datasets: dict[str, CubeDataset] = {}
        self._lazy_datasets: dict[str, tuple[DatasetSummary, Callable[[], CubeDataset]]] = {}
        default_manifest = Path(__file__).resolve().parents[3] / "data" / "seeded" / "manifest.json"
        self._seeded_manifest_path = Path(seeded_manifest_path).expanduser().resolve() if seeded_manifest_path else default_manifest
        self._register_lazy_defaults()
        self._register_seeded_local_datasets()

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
        dims = ("sample", "pol", "t", "nu", "x", "y", "z")
        for spec in DEMO_DATASETS:
            cfg = spec.cfg
            summary = DatasetSummary(
                data_id=spec.data_id,
                dims=dims,
                shape=(cfg.sample, cfg.pol, cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z),
                intensity_unit="arb",
                source="demo-generated-lazy",
            )

            def build(local_spec: DemoDatasetSpec = spec) -> CubeDataset:
                ds = generate_mock_dataset(local_spec.data_id, local_spec.cfg)
                ds.provenance["source"] = "demo-generated"
                ds.provenance["demo"] = True
                return ds

            self._lazy_datasets[spec.data_id] = (summary, build)

    def _register_seeded_local_datasets(self) -> None:
        p = self._seeded_manifest_path
        if not p.exists():
            return

        try:
            payload = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return

        datasets = payload.get("datasets")
        if not isinstance(datasets, list):
            return

        for entry in datasets:
            if not isinstance(entry, dict):
                continue
            data_id = entry.get("data_id")
            rel_path = entry.get("path")
            dims = entry.get("dims")
            shape = entry.get("shape")
            intensity_unit = entry.get("intensity_unit", "arb")
            source = entry.get("source", "seeded-local")
            kwargs = entry.get("loader_kwargs", {})
            if not isinstance(data_id, str) or not data_id:
                continue
            if not isinstance(rel_path, str) or not rel_path:
                continue
            if not isinstance(dims, list) or not all(isinstance(d, str) for d in dims):
                continue
            if not isinstance(shape, list) or not all(isinstance(s, int) for s in shape):
                continue
            if len(dims) != len(shape):
                continue
            if not isinstance(kwargs, dict):
                kwargs = {}

            ds_path = (p.parent / rel_path).expanduser().resolve()
            if not ds_path.exists():
                continue
            if data_id in self._datasets or data_id in self._lazy_datasets:
                continue

            summary = DatasetSummary(
                data_id=data_id,
                dims=tuple(dims),
                shape=tuple(shape),
                intensity_unit=str(intensity_unit),
                source=str(source),
            )

            def build(path: Path = ds_path, local_data_id: str = data_id, local_kwargs: dict[str, object] = kwargs) -> CubeDataset:
                return load_by_extension(path, data_id=local_data_id, **local_kwargs)

            self._lazy_datasets[data_id] = (summary, build)

    def load_local(
        self,
        path: str,
        data_id: str | None = None,
        dims: tuple[str, ...] | None = None,
        pad_missing_dims: bool = False,
    ) -> CubeDataset:
        dataset = load_by_extension(path, data_id=data_id, dims=dims)
        if pad_missing_dims:
            dataset, _ = pad_dataset_to_canonical(dataset)
        self.add(dataset)
        return dataset

    def ensure_default_datasets(self) -> None:
        with self._lock:
            already = set(self._datasets.keys())

        preload_ids = [spec.data_id for spec in DEMO_DATASETS if spec.preload]
        for data_id in preload_ids:
            if data_id in already:
                continue
            self.get(data_id)
