from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from threading import Event, RLock
from time import perf_counter

from mobula.data.loaders import load_by_extension, pad_dataset_to_canonical
from mobula.data.mock_cube import MockCubeConfig, describe_mock_dataset, generate_mock_dataset
from mobula.data.schema import CubeDataset
from mobula.paths import default_seeded_manifest_path


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


@dataclass(slots=True)
class _PendingDatasetLoad:
    event: Event
    error: Exception | None = None


DEMO_DATASETS: tuple[DemoDatasetSpec, ...] = (
    DemoDatasetSpec(
        data_id="movie-2d-pol-hd",
        cfg=MockCubeConfig(sample=4, pol=4, t=120, nu=1, x=144, y=144, z=1, seed=305, model="filamentary_time"),
    ),
    DemoDatasetSpec(
        data_id="time-5d-volume-samples-hd",
        cfg=MockCubeConfig(sample=4, pol=1, t=20, nu=1, x=80, y=80, z=56, seed=451, model="center_structured_time"),
    ),
    DemoDatasetSpec(
        data_id="xy-nu-pol-radio-galaxy",
        cfg=MockCubeConfig(sample=4, pol=4, t=1, nu=10, x=2048, y=1024, z=1, seed=133, model="radio_galaxy"),
    ),
    DemoDatasetSpec(
        data_id="volume-3d-spiral-galaxy",
        cfg=MockCubeConfig(sample=1, pol=1, t=1, nu=1, x=256, y=256, z=256, seed=207, model="spiral_galaxy"),
    ),
    DemoDatasetSpec(
        data_id="healpix-sky-time-nu-hd",
        cfg=MockCubeConfig(sample=4, pol=1, t=20, nu=12, x=196608, y=1, z=1, seed=613, model="healpix_sky"),
    ),
)


class DatasetRegistry:
    def __init__(self, seeded_manifest_path: str | Path | None = None) -> None:
        self._lock = RLock()
        self._datasets: dict[str, CubeDataset] = {}
        self._lazy_datasets: dict[str, tuple[DatasetSummary, Callable[[], CubeDataset]]] = {}
        self._lazy_metadata: dict[str, Callable[[], dict[str, object]]] = {}
        self._pending_loads: dict[str, _PendingDatasetLoad] = {}
        default_manifest = default_seeded_manifest_path()
        self._seeded_manifest_path = Path(seeded_manifest_path).expanduser().resolve() if seeded_manifest_path else default_manifest
        self._register_lazy_defaults()
        self._register_seeded_local_datasets()

    def add(self, dataset: CubeDataset) -> None:
        dataset.validate()
        with self._lock:
            self._datasets[dataset.data_id] = dataset

    def get(self, data_id: str) -> CubeDataset:
        dataset, _ = self.get_with_stats(data_id)
        return dataset

    def get_with_stats(self, data_id: str) -> tuple[CubeDataset, dict[str, object]]:
        lazy_builder: Callable[[], CubeDataset] | None = None
        pending: _PendingDatasetLoad | None = None
        should_build = False
        with self._lock:
            ds = self._datasets.get(data_id)
            if ds is not None:
                return ds, {"cache": "hit", "load_ms": 0.0}
            lazy = self._lazy_datasets.get(data_id)
            if lazy is not None:
                _, lazy_builder = lazy
                pending = self._pending_loads.get(data_id)
                if pending is None:
                    pending = _PendingDatasetLoad(event=Event())
                    self._pending_loads[data_id] = pending
                    should_build = True

        if lazy_builder is not None and should_build:
            started = perf_counter()
            try:
                dataset = lazy_builder()
                dataset.validate()
                load_ms = (perf_counter() - started) * 1000.0
            except Exception as exc:
                with self._lock:
                    current_pending = self._pending_loads.get(data_id)
                    if current_pending is not None:
                        current_pending.error = exc
                        current_pending.event.set()
                        self._pending_loads.pop(data_id, None)
                raise

            with self._lock:
                existing = self._datasets.get(data_id)
                current_pending = self._pending_loads.get(data_id)
                if existing is not None:
                    if current_pending is not None:
                        current_pending.event.set()
                        self._pending_loads.pop(data_id, None)
                    return existing, {"cache": "hit", "load_ms": 0.0}
                self._datasets[data_id] = dataset
                if current_pending is not None:
                    current_pending.event.set()
                    self._pending_loads.pop(data_id, None)
                return dataset, {"cache": "miss", "load_ms": load_ms}

        if lazy_builder is not None and pending is not None:
            pending.event.wait()
            with self._lock:
                ds = self._datasets.get(data_id)
                if ds is not None:
                    return ds, {"cache": "hit", "load_ms": 0.0}
                err = pending.error
            if err is not None:
                raise err

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

    def lazy_metadata(self, data_id: str) -> dict[str, object] | None:
        with self._lock:
            if data_id in self._datasets:
                return None
            builder = self._lazy_metadata.get(data_id)
        if builder is None:
            return None
        return builder()

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

            def build_meta(local_spec: DemoDatasetSpec = spec) -> dict[str, object]:
                payload = describe_mock_dataset(local_spec.data_id, local_spec.cfg)
                raw_provenance = payload.get("provenance", {})
                provenance = dict(raw_provenance) if isinstance(raw_provenance, dict) else {}
                provenance["source"] = "demo-generated"
                provenance["demo"] = True
                payload["provenance"] = provenance
                return payload

            self._lazy_datasets[spec.data_id] = (summary, build)
            self._lazy_metadata[spec.data_id] = build_meta

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
            typed_kwargs = {str(key): value for key, value in kwargs.items()}
            typed_data_id = data_id

            ds_path = (p.parent / rel_path).expanduser().resolve()
            if not ds_path.exists():
                continue
            if typed_data_id in self._datasets or typed_data_id in self._lazy_datasets:
                continue

            summary = DatasetSummary(
                data_id=typed_data_id,
                dims=tuple(dims),
                shape=tuple(shape),
                intensity_unit=str(intensity_unit),
                source=str(source),
            )

            def build(
                path: Path = ds_path,
                local_data_id: str = typed_data_id,
                local_kwargs: dict[str, object] = typed_kwargs,
            ) -> CubeDataset:
                return load_by_extension(path, data_id=local_data_id, **local_kwargs)

            self._lazy_datasets[typed_data_id] = (summary, build)

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
