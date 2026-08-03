from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from hashlib import sha256
from pathlib import Path
from threading import Event, RLock
from time import perf_counter

import numpy as np

from mobula.data.loaders import load_by_extension, pad_dataset_to_canonical
from mobula.data.mock_cube import MockCubeConfig, describe_mock_dataset, generate_mock_dataset
from mobula.data.scene import (
    CubeSceneSource,
    DenseSceneSource,
    PresentationRecipe,
    ProfileSceneSource,
    RenderTargetKind,
    RenderedSceneLayer,
    RenderedSceneProfiles,
    RenderedSceneSlice,
    SceneDescriptor,
    SceneProfilesRequest,
    SceneRenderRequest,
    SceneSliceRequest,
    SceneSource,
    SliceSceneSource,
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
class SceneView:
    """A stable descriptor-only view of one Scene presentation target."""

    data_id: str
    scene_id: str
    descriptor: SceneDescriptor
    recipe_id: str
    target_kind: RenderTargetKind
    target_id: str

    @property
    def recipe(self) -> PresentationRecipe:
        return next(recipe for recipe in self.descriptor.recipes if recipe.recipe_id == self.recipe_id)

    @property
    def summary(self) -> DatasetSummary:
        axes = {axis.axis_id: axis for axis in self.descriptor.axes}
        return DatasetSummary(
            data_id=self.data_id,
            dims=self.recipe.presentation_axes,
            shape=tuple(axes[axis].size for axis in self.recipe.presentation_axes),
            intensity_unit=self.recipe.output_unit,
            source=f"scene-virtual-{self.descriptor.access.mode}",
        )


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
        self._scene_views: dict[str, SceneView] = {}
        self._scene_view_ids: dict[tuple[str, str, str, str], str] = {}
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

    async def open_scene_view(
        self,
        scene_id: str,
        *,
        recipe_id: str,
        target_kind: RenderTargetKind,
        component_id: str | None,
    ) -> SceneView:
        """Register a stable virtual dataset without requesting numerical values."""
        descriptor = await self.scene_descriptor(scene_id)
        recipes = {recipe.recipe_id: recipe for recipe in descriptor.recipes}
        recipe = recipes.get(recipe_id)
        if recipe is None:
            raise KeyError(f"recipe '{recipe_id}' not found")
        if target_kind == "combined" and component_id is None:
            target_id = "combined"
        elif target_kind == "component" and component_id:
            renderable = {layer.component_id for layer in recipe.layers}
            if component_id not in renderable:
                raise KeyError(f"component '{component_id}' is not renderable by recipe '{recipe_id}'")
            target_id = component_id
        else:
            raise ValueError("invalid Scene view target")
        key = (scene_id, recipe_id, target_kind, target_id)
        with self._lock:
            existing_id = self._scene_view_ids.get(key)
            if existing_id is not None:
                return self._scene_views[existing_id]
        digest = sha256("\0".join(key).encode("utf-8")).hexdigest()[:16]
        data_id = scene_id.removeprefix("cube:") if scene_id.startswith("cube:") else f"scene-view-{digest}"
        view = SceneView(
            data_id=data_id,
            scene_id=scene_id,
            descriptor=descriptor,
            recipe_id=recipe_id,
            target_kind=target_kind,
            target_id=target_id,
        )
        with self._lock:
            self._scene_views[view.data_id] = view
            self._scene_view_ids[key] = view.data_id
        return view

    def scene_view(self, data_id: str) -> SceneView | None:
        with self._lock:
            return self._scene_views.get(data_id)

    async def render_scene_slice(self, data_id: str, request: SceneSliceRequest) -> RenderedSceneSlice:
        """Render one sparse-required plane; dense fallback is forbidden."""
        view = self.scene_view(data_id)
        if view is None:
            raise KeyError(f"virtual Scene dataset '{data_id}' not found")
        if view.descriptor.access.mode != "slice":
            raise TypeError("Scene view does not advertise sparse slice access")
        with self._lock:
            source = self._scene_sources.get(view.scene_id)
        if source is None or not isinstance(source, SliceSceneSource):
            raise TypeError("slice Scene source does not implement render_slice")

        axes = {axis.axis_id: axis for axis in view.descriptor.axes}
        recipe_axes = set(view.recipe.presentation_axes)
        if set(request.plane_axes) - recipe_axes:
            raise ValueError("Scene slice plane axes are not part of the presentation")
        if view.descriptor.access.plane_axes and request.plane_axes != tuple(view.descriptor.access.plane_axes):
            raise ValueError("Scene source does not advertise the requested plane axes")
        if (
            view.descriptor.access.sample_modes
            and request.sample_mode not in view.descriptor.access.sample_modes
        ):
            raise ValueError(f"Scene source does not advertise sample mode '{request.sample_mode}'")
        if set(request.project_dims) - recipe_axes:
            raise ValueError("Scene slice projects an unknown presentation axis")
        if request.project_dims:
            raise ValueError("Scene source does not advertise bounded axis projection")
        selections = {axis: index for axis, index in request.selections.items() if axis in recipe_axes}
        reducing_samples = request.sample_mode in {"mean", "std", "rel_uncert"}
        for axis_id in view.recipe.presentation_axes:
            if axis_id in request.plane_axes or axis_id in request.project_dims:
                selections.pop(axis_id, None)
                continue
            if axis_id == "sample" and reducing_samples:
                selections.pop(axis_id, None)
                continue
            index = selections.get(axis_id, axes[axis_id].size // 2)
            if index < 0 or index >= axes[axis_id].size:
                raise ValueError(
                    f"index for Scene axis '{axis_id}' out of bounds: {index} (size={axes[axis_id].size})"
                )
            selections[axis_id] = index
        normalized = SceneSliceRequest(
            recipe_id=view.recipe_id,
            target=view.target_kind,
            component_id=view.target_id if view.target_kind == "component" else None,
            plane_axes=request.plane_axes,
            selections=selections,
            project_dims=request.project_dims,
            sample_mode=request.sample_mode,
            max_pixels=request.max_pixels,
        )
        normalized.validate()
        rendered = await source.render_slice(normalized)
        rendered.validate()
        expected_target = normalized.component_id if normalized.target == "component" else "combined"
        if (
            rendered.scene_id != view.scene_id
            or rendered.recipe_id != view.recipe_id
            or rendered.target_kind != normalized.target
            or rendered.target_id != expected_target
        ):
            raise ValueError("Scene slice identity does not match its virtual dataset")
        if rendered.plane_axes != normalized.plane_axes:
            raise ValueError("Scene slice plane axes do not match the request")
        if rendered.selected_indices != normalized.selections:
            raise ValueError("Scene slice selections do not match the fully specified request")
        expected_full_shape = tuple(axes[axis].size for axis in normalized.plane_axes)
        if rendered.full_shape != expected_full_shape:
            raise ValueError("Scene slice full shape does not match the descriptor")
        if normalized.max_pixels is not None and rendered.values.size > normalized.max_pixels:
            raise ValueError("Scene slice exceeds the requested output pixel bound")
        expected_intensity_unit = "1" if normalized.sample_mode == "rel_uncert" else view.recipe.output_unit
        if rendered.intensity_unit != expected_intensity_unit:
            raise ValueError("Scene slice intensity unit does not match the presentation recipe")
        expected_units = {axis: axes[axis].unit for axis in normalized.plane_axes}
        if rendered.plane_units != expected_units:
            raise ValueError("Scene slice plane units do not match the descriptor")
        return rendered

    async def render_scene_profiles(
        self, data_id: str, request: SceneProfilesRequest
    ) -> RenderedSceneProfiles:
        """Evaluate bounded Scene profiles; slice and dense fallbacks are forbidden."""
        view = self.scene_view(data_id)
        if view is None:
            raise KeyError(f"virtual Scene dataset '{data_id}' not found")
        capability = view.descriptor.access.profiles
        if view.descriptor.access.mode != "slice" or capability is None:
            raise TypeError("Scene view does not advertise sparse profile access")
        with self._lock:
            source = self._scene_sources.get(view.scene_id)
        if source is None or not isinstance(source, ProfileSceneSource):
            raise TypeError("profile Scene source does not implement render_profiles")

        request.validate()
        axes = {axis.axis_id: axis for axis in view.descriptor.axes}
        recipe_axes = set(view.recipe.presentation_axes)
        requested_axes = set(request.profile_axes)
        if requested_axes - recipe_axes:
            raise ValueError("Scene profile axes are not part of the presentation")
        if requested_axes - set(capability.axes):
            raise ValueError("Scene source does not advertise the requested profile axes")
        if requested_axes & set(request.plane_axes):
            raise ValueError("Scene profile axes cannot also be spatial plane axes")
        if request.plane_axes != capability.plane_axes:
            raise ValueError("Scene source does not advertise the requested profile plane")
        reductions = {item.reduction_id: item for item in capability.reductions}
        reduction = reductions.get(request.spatial_reduction)
        if reduction is None:
            raise ValueError(f"Scene source does not advertise reduction '{request.spatial_reduction}'")
        if request.include_members and not capability.include_members:
            raise ValueError("Scene source does not advertise profile member series")
        if request.max_output_values > capability.max_output_values:
            raise ValueError("Scene profile request exceeds the advertised output bound")

        normalized_window: dict[str, tuple[int, int]] = {}
        for axis_id in request.plane_axes:
            lo, hi = request.spatial_window[axis_id]
            size = axes[axis_id].size
            if lo < 0 or hi <= lo or hi > size:
                raise ValueError(f"Scene profile window for '{axis_id}' is out of bounds")
            normalized_window[axis_id] = (lo, hi)

        expected_selection_axes = recipe_axes - set(request.plane_axes) - {"sample"}
        if set(request.selections) != expected_selection_axes:
            missing = sorted(expected_selection_axes - set(request.selections))
            extra = sorted(set(request.selections) - expected_selection_axes)
            raise ValueError(f"Scene profile selections mismatch (missing={missing}, extra={extra})")
        selections: dict[str, int] = {}
        for axis_id in view.recipe.presentation_axes:
            if axis_id not in expected_selection_axes:
                continue
            index = request.selections[axis_id]
            if index < 0 or index >= axes[axis_id].size:
                raise ValueError(
                    f"index for Scene axis '{axis_id}' out of bounds: {index} (size={axes[axis_id].size})"
                )
            selections[axis_id] = index

        normalized = SceneProfilesRequest(
            recipe_id=view.recipe_id,
            target=view.target_kind,
            component_id=view.target_id if view.target_kind == "component" else None,
            profile_axes=request.profile_axes,
            selections=selections,
            plane_axes=request.plane_axes,
            spatial_window=normalized_window,
            spatial_reduction=request.spatial_reduction,
            include_members=request.include_members,
            max_output_values=request.max_output_values,
        )
        normalized.validate()
        rendered = await source.render_profiles(normalized)
        rendered.validate()

        expected_target = normalized.component_id if normalized.target == "component" else "combined"
        if (
            rendered.scene_id != view.scene_id
            or rendered.recipe_id != view.recipe_id
            or rendered.target_kind != normalized.target
            or rendered.target_id != expected_target
        ):
            raise ValueError("Scene profile identity does not match its virtual dataset")
        if rendered.spatial_window != normalized.spatial_window:
            raise ValueError("Scene profile spatial window does not match the request")
        if rendered.spatial_reduction != normalized.spatial_reduction:
            raise ValueError("Scene profile reduction does not match the request")
        expected_pixel_count = int(np.prod([hi - lo for lo, hi in normalized.spatial_window.values()]))
        if rendered.pixel_count != expected_pixel_count:
            raise ValueError("Scene profile pixel count does not match its spatial window")
        if rendered.value_quantity != reduction.value_quantity or rendered.value_unit != reduction.value_unit:
            raise ValueError("Scene profile value semantics do not match the advertised reduction")
        if set(rendered.profiles) != set(normalized.profile_axes):
            raise ValueError("Scene source did not return exactly the requested profile axes")

        output_values = 0
        sample_size = axes["sample"].size if "sample" in recipe_axes else None
        for axis_id, series in rendered.profiles.items():
            axis = axes[axis_id]
            coords = np.asarray(series.coords)
            if series.axis_unit != axis.unit:
                raise ValueError(f"Scene profile unit for '{axis_id}' does not match the descriptor")
            if coords.size != axis.size:
                raise ValueError(f"Scene profile for '{axis_id}' does not cover its complete descriptor axis")
            if axis.coordinates is not None:
                expected_coords = np.asarray(axis.coordinates)
                if expected_coords.dtype.kind in {"f", "i", "u"} and coords.dtype.kind in {"f", "i", "u"}:
                    if not np.allclose(coords.astype(float), expected_coords.astype(float), rtol=1e-10, atol=1e-12):
                        raise ValueError(f"Scene profile coordinates for '{axis_id}' do not match the descriptor")
                elif coords.tolist() != expected_coords.tolist():
                    raise ValueError(f"Scene profile coordinates for '{axis_id}' do not match the descriptor")
            elif axis.linear_coordinates is not None:
                linear = axis.linear_coordinates
                expected_coords = linear.start + linear.step * np.arange(linear.count)
                if coords.dtype.kind not in {"f", "i", "u"} or not np.allclose(
                    coords.astype(float), expected_coords, rtol=1e-10, atol=1e-12
                ):
                    raise ValueError(f"Scene profile coordinates for '{axis_id}' do not match the descriptor")
            expected_fixed = {key: value for key, value in normalized.selections.items() if key != axis_id}
            if series.fixed_indices != expected_fixed:
                raise ValueError(f"Scene profile fixed indices for '{axis_id}' do not match the request")
            member_count = int(np.asarray(series.per_sample).shape[0])
            if normalized.include_members:
                if sample_size is not None and axis_id != "sample" and member_count != sample_size:
                    raise ValueError(f"Scene profile members for '{axis_id}' do not match the sample axis")
            elif member_count != 0:
                raise ValueError("Scene source returned member profiles that were not requested")
            output_values += int(
                np.asarray(series.series_mean).size
                + np.asarray(series.series_std).size
                + np.asarray(series.per_sample).size
            )
        if output_values > normalized.max_output_values:
            raise ValueError("Scene profile response exceeds the requested output bound")
        return rendered

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
        if descriptor.access.mode == "slice":
            raise TypeError("sparse Scene sources cannot be materialized as dense layers")
        if not isinstance(source, DenseSceneSource):
            raise TypeError("Scene source does not support legacy materialized rendering")
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
            view = self._scene_views.get(data_id)
            materialized = self._scene_materializations.get(data_id)
            dataset = self._datasets.get(data_id)
        if view is not None:
            return view.descriptor, view.recipe_id, view.target_kind, view.target_id
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
            virtual = [view.summary for view in self._scene_views.values() if view.data_id not in loaded_ids]
            return loaded + lazy + virtual

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
