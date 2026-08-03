from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from hashlib import sha256
from pathlib import Path
from threading import Event, RLock
from time import perf_counter

from mobula.data.loaders import load_by_extension, pad_dataset_to_canonical
from mobula.data.mock_cube import MockCubeConfig, describe_mock_dataset, generate_mock_dataset
from mobula.data.scene import (
    CubeSceneSource,
    RenderedSceneLayer,
    SceneDescriptor,
    SceneRenderRequest,
    SceneSource,
    cube_scene_descriptor,
)
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
        self._scene_sources: dict[str, SceneSource] = {}
        self._scene_materializations: dict[str, tuple[SceneDescriptor, str, str, str]] = {}
        self._scene_materialization_keys: dict[str, tuple[str, str, str, str, str]] = {}
        self._scene_layer_cache: dict[tuple[str, str, str, str, str], str] = {}
        default_manifest = default_seeded_manifest_path()
        self._seeded_manifest_path = (
            Path(seeded_manifest_path).expanduser().resolve() if seeded_manifest_path else default_manifest
        )
        self._register_lazy_defaults()
        self._register_seeded_local_datasets()

    def add(self, dataset: CubeDataset) -> None:
        dataset.validate()
        with self._lock:
            self._datasets[dataset.data_id] = dataset

    def add_scene_source(self, scene_id: str, source: SceneSource) -> None:
        """Register an asynchronous Scene source without evaluating it."""
        if not scene_id:
            raise ValueError("scene_id must not be empty")
        if not isinstance(source, SceneSource):
            raise TypeError("source does not implement the SceneSource protocol")
        with self._lock:
            if scene_id in self._scene_sources:
                raise ValueError(f"scene source '{scene_id}' is already registered")
            self._scene_sources[scene_id] = source

    async def list_scenes(self) -> list[SceneDescriptor]:
        with self._lock:
            sources = list(self._scene_sources.items())
        descriptors: list[SceneDescriptor] = []
        for scene_id, source in sources:
            descriptor = await source.describe_scene()
            descriptor.validate()
            if descriptor.scene_id != scene_id:
                raise ValueError(f"scene source registered as '{scene_id}' described itself as '{descriptor.scene_id}'")
            descriptors.append(descriptor)
        return descriptors

    async def scene_descriptor(self, scene_id: str) -> SceneDescriptor:
        if scene_id.startswith("cube:"):
            dataset = self.get(scene_id.removeprefix("cube:"))
            return cube_scene_descriptor(dataset)
        with self._lock:
            source = self._scene_sources.get(scene_id)
        if source is None:
            raise KeyError(f"scene '{scene_id}' not found")
        descriptor = await source.describe_scene()
        descriptor.validate()
        return descriptor

    async def render_scene(self, scene_id: str, request: SceneRenderRequest) -> RenderedSceneLayer:
        request.validate()
        target_id = request.component_id if request.target == "component" else "combined"
        selection_key = json.dumps(
            {
                "exploration_indices": request.exploration_indices,
                "spatial_window": request.spatial_window,
                "sample_mode": request.sample_mode,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        cache_key = (scene_id, request.recipe_id, request.target, str(target_id), selection_key)
        with self._lock:
            cached_data_id = self._scene_layer_cache.get(cache_key)
            cached_dataset = self._datasets.get(cached_data_id) if cached_data_id is not None else None
        if cached_dataset is not None:
            return RenderedSceneLayer(
                scene_id=scene_id,
                recipe_id=request.recipe_id,
                target_kind=request.target,
                target_id=str(target_id),
                dataset=cached_dataset,
            )
        if scene_id.startswith("cube:"):
            source: SceneSource = CubeSceneSource(self.get(scene_id.removeprefix("cube:")))
        else:
            with self._lock:
                source = self._scene_sources.get(scene_id)  # type: ignore[assignment]
            if source is None:
                raise KeyError(f"scene '{scene_id}' not found")
        descriptor = await source.describe_scene()
        descriptor.validate()
        rendered = await source.render_layer(request)
        rendered.dataset.validate()
        if rendered.scene_id != descriptor.scene_id:
            raise ValueError("rendered layer scene_id does not match its source descriptor")
        if rendered.target_kind != request.target or rendered.target_id != target_id:
            raise ValueError("rendered layer target identity does not match its request")
        with self._lock:
            existing_dataset = self._datasets.get(rendered.dataset.data_id)
            existing_cache_key = self._scene_materialization_keys.get(rendered.dataset.data_id)
        if existing_dataset is not None and existing_cache_key != cache_key:
            digest = sha256("\0".join(cache_key).encode("utf-8")).hexdigest()[:12]
            rendered = replace(
                rendered, dataset=replace(rendered.dataset, data_id=f"{rendered.dataset.data_id}-{digest}")
            )
        self.add(rendered.dataset)
        with self._lock:
            self._scene_materializations[rendered.dataset.data_id] = (
                descriptor,
                rendered.recipe_id,
                rendered.target_kind,
                rendered.target_id,
            )
            self._scene_materialization_keys[rendered.dataset.data_id] = cache_key
            self._scene_layer_cache[cache_key] = rendered.dataset.data_id
        return rendered

    def scene_context_for_dataset(self, data_id: str) -> tuple[SceneDescriptor, str, str, str] | None:
        with self._lock:
            materialized = self._scene_materializations.get(data_id)
            dataset = self._datasets.get(data_id)
        if materialized is not None:
            return materialized
        if dataset is None:
            return None
        descriptor = cube_scene_descriptor(dataset)
        return descriptor, descriptor.default_recipe_id, "combined", "combined"

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
