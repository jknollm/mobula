from __future__ import annotations

import asyncio

import numpy as np

from mobula.data.scene import (
    AxisMapping,
    ComponentAxis,
    ComponentField,
    PresentationRecipe,
    RecipeLayer,
    RenderedSceneLayer,
    RenderedSceneSlice,
    SceneAccess,
    SceneAxis,
    SceneComponent,
    SceneDescriptor,
    SceneRenderRequest,
    SceneSliceRequest,
)
from mobula.data.schema import CubeDataset


class SyntheticHybridSceneSource:
    """Small deterministic Scene source used for conformance tests and demos."""

    def __init__(self, scene_id: str = "synthetic-hybrid") -> None:
        self.scene_id = scene_id
        self._sample = np.arange(2, dtype=np.float32)
        self._time = np.linspace(0.0, 3.0, 4, dtype=np.float32)
        self._frequency = np.asarray([90.0, 110.0, 140.0], dtype=np.float32)
        self._x = np.linspace(-1.0, 1.0, 7, dtype=np.float32)
        self._y = np.linspace(-1.0, 1.0, 6, dtype=np.float32)
        self._descriptor = self._build_descriptor()

    def _build_descriptor(self) -> SceneDescriptor:
        axes = (
            SceneAxis("sample", len(self._sample), "index", tuple(float(v) for v in self._sample)),
            SceneAxis("t", len(self._time), "s", tuple(float(v) for v in self._time)),
            SceneAxis("nu", len(self._frequency), "GHz", tuple(float(v) for v in self._frequency)),
            SceneAxis("x", len(self._x), "deg", tuple(float(v) for v in self._x)),
            SceneAxis("y", len(self._y), "deg", tuple(float(v) for v in self._y)),
        )
        mappings_static = (
            AxisMapping("sample", "invariant"),
            AxisMapping("t", "invariant"),
            AxisMapping("nu", "invariant"),
            AxisMapping("x", "exact", "x"),
            AxisMapping("y", "exact", "y"),
        )
        mappings_point = (
            AxisMapping("sample", "exact", "sample"),
            AxisMapping("t", "exact", "t"),
            AxisMapping("nu", "exact", "nu"),
            AxisMapping("x", "project", "position_x", "nearest-pixel flux-conserving rasterization"),
            AxisMapping("y", "project", "position_y", "nearest-pixel flux-conserving rasterization"),
        )
        components = (
            SceneComponent("sky", "Sky", "component_group"),
            SceneComponent(
                "background",
                "Static background",
                "raster_field",
                native_axes=(
                    ComponentAxis("x", len(self._x), "deg", tuple(float(value) for value in self._x)),
                    ComponentAxis("y", len(self._y), "deg", tuple(float(value) for value in self._y)),
                ),
                fields=(ComponentField("brightness", "surface_brightness", "Jy/sr", ("x", "y")),),
                axis_mappings=mappings_static,
                parent_id="sky",
            ),
            SceneComponent(
                "transient",
                "Dynamic point source",
                "point_sources",
                native_axes=(
                    ComponentAxis("sample", len(self._sample), "index", tuple(float(value) for value in self._sample)),
                    ComponentAxis("t", len(self._time), "s", tuple(float(value) for value in self._time)),
                    ComponentAxis(
                        "nu", len(self._frequency), "GHz", tuple(float(value) for value in self._frequency)
                    ),
                ),
                fields=(
                    ComponentField("flux_density", "flux_density", "Jy", ("sample", "t", "nu")),
                    ComponentField("position_x", "position", "deg", ("t",), role="position_x"),
                    ComponentField("position_y", "position", "deg", ("t",), role="position_y"),
                ),
                axis_mappings=mappings_point,
                parent_id="sky",
            ),
        )
        recipe = PresentationRecipe(
            recipe_id="combined-emission",
            title="Combined emission",
            presentation_axes=("sample", "t", "nu", "x", "y"),
            layers=(
                RecipeLayer("background", "raster", "additive_emission"),
                RecipeLayer("transient", "point_raster", "additive_emission"),
            ),
            output_quantity="surface_brightness",
            output_unit="Jy/sr",
        )
        descriptor = SceneDescriptor(
            scene_id=self.scene_id,
            title="Synthetic hybrid sky",
            axes=axes,
            components=components,
            recipes=(recipe,),
            default_recipe_id=recipe.recipe_id,
            provenance={"source": "synthetic", "purpose": "scene-contract"},
            access=SceneAccess(
                mode="slice",
                protocol_version="mobula.scene-source/v2",
                full_render=False,
                plane_axes=("x", "y"),
                sample_modes=("single", "mean", "std", "rel_uncert"),
            ),
        )
        descriptor.validate()
        return descriptor

    async def describe_scene(self) -> SceneDescriptor:
        await asyncio.sleep(0)
        return self._descriptor

    def _component_values(self) -> tuple[np.ndarray, np.ndarray]:
        xx, yy = np.meshgrid(self._x, self._y, indexing="ij")
        background_native = np.exp(-3.0 * (xx**2 + yy**2)).astype(np.float32)
        shape = (len(self._sample), len(self._time), len(self._frequency), len(self._x), len(self._y))
        background = np.broadcast_to(background_native, shape).copy()
        points = np.zeros(shape, dtype=np.float32)
        for sample in range(shape[0]):
            for time in range(shape[1]):
                ix = min(time + 1, shape[3] - 1)
                iy = min(1 + time, shape[4] - 1)
                for frequency in range(shape[2]):
                    points[sample, time, frequency, ix, iy] = np.float32(
                        (sample + 1) * (time + 1) * (1.0 + frequency / 10.0)
                    )
        return background, points

    async def render_layer(self, request: SceneRenderRequest) -> RenderedSceneLayer:
        request.validate()
        if request.recipe_id != self._descriptor.default_recipe_id:
            raise KeyError(f"recipe '{request.recipe_id}' not found")
        background, points = self._component_values()
        if request.target == "combined":
            target_id = "combined"
            values = background + points
        elif request.component_id == "background":
            target_id = "background"
            values = background
        elif request.component_id == "transient":
            target_id = "transient"
            values = points
        else:
            raise KeyError(f"component '{request.component_id}' is not renderable")

        dataset = CubeDataset(
            data_id=f"scene-{self.scene_id}-{request.recipe_id}-{target_id}",
            dims=("sample", "t", "nu", "x", "y"),
            coords={
                "sample": self._sample,
                "t": self._time,
                "nu": self._frequency,
                "x": self._x,
                "y": self._y,
            },
            values=values,
            units={"sample": "index", "t": "s", "nu": "GHz", "x": "deg", "y": "deg"},
            intensity_unit="Jy/sr",
            wcs={"frame": "synthetic"},
            provenance={
                "source": "scene-source",
                "scene_id": self.scene_id,
                "recipe_id": request.recipe_id,
                "target_id": target_id,
            },
        )
        dataset.validate()
        await asyncio.sleep(0)
        return RenderedSceneLayer(
            scene_id=self.scene_id,
            recipe_id=request.recipe_id,
            target_kind=request.target,
            target_id=target_id,
            dataset=dataset,
        )

    def _native_plane(self, request: SceneSliceRequest, sample: int, t: int, nu: int) -> np.ndarray:
        xx, yy = np.meshgrid(self._x, self._y, indexing="ij")
        background = np.exp(-3.0 * (xx**2 + yy**2)).astype(np.float32)
        points = np.zeros((len(self._x), len(self._y)), dtype=np.float32)
        ix = min(t + 1, len(self._x) - 1)
        iy = min(1 + t, len(self._y) - 1)
        points[ix, iy] = np.float32((sample + 1) * (t + 1) * (1.0 + nu / 10.0))
        if request.target == "combined":
            return background + points
        if request.component_id == "background":
            return background
        if request.component_id == "transient":
            return points
        raise KeyError(f"component '{request.component_id}' is not renderable")

    async def render_slice(self, request: SceneSliceRequest) -> RenderedSceneSlice:
        """Render directly on the requested plane without constructing a cube."""
        request.validate()
        if request.recipe_id != self._descriptor.default_recipe_id:
            raise KeyError(f"recipe '{request.recipe_id}' not found")
        if request.plane_axes != ("x", "y"):
            raise ValueError("synthetic Scene supports only the x/y plane")
        if any(dim not in {"sample", "t", "nu"} for dim in request.project_dims):
            raise ValueError("synthetic Scene cannot project the requested axis")

        axis_sizes = {"sample": len(self._sample), "t": len(self._time), "nu": len(self._frequency)}
        for axis, index in request.selections.items():
            if axis not in axis_sizes or index >= axis_sizes[axis]:
                raise ValueError(f"invalid selection for Scene axis '{axis}'")

        def indices(axis: str) -> range | tuple[int]:
            if axis in request.project_dims:
                return range(axis_sizes[axis])
            return (request.selections[axis],)

        sample_indices: range | tuple[int]
        if request.sample_mode == "single":
            sample_indices = indices("sample")
        elif request.sample_mode in {"mean", "std", "rel_uncert"}:
            sample_indices = range(axis_sizes["sample"])
        else:
            raise ValueError(f"unsupported sample mode '{request.sample_mode}'")

        sample_planes: list[np.ndarray] = []
        for sample in sample_indices:
            projected_planes = [
                self._native_plane(request, sample, t, nu)
                for t in indices("t")
                for nu in indices("nu")
            ]
            sample_planes.append(np.mean(projected_planes, axis=0, dtype=np.float64))
        stack = np.asarray(sample_planes)
        if request.sample_mode == "mean":
            plane = np.mean(stack, axis=0, dtype=np.float64)
        elif request.sample_mode == "std":
            plane = np.std(stack, axis=0, dtype=np.float64)
        elif request.sample_mode == "rel_uncert":
            mean = np.mean(stack, axis=0, dtype=np.float64)
            plane = np.std(stack, axis=0, dtype=np.float64) / np.maximum(np.abs(mean), 1.0e-8)
        else:
            plane = stack[0]

        full_shape = tuple(int(value) for value in plane.shape)
        sampling_step = (1, 1)
        if request.max_pixels is not None and plane.size > request.max_pixels:
            step = max(1, int(np.ceil(np.sqrt(plane.size / float(request.max_pixels)))))
            sampling_step = (min(step, plane.shape[0]), min(step, plane.shape[1]))
            plane = plane[:: sampling_step[0], :: sampling_step[1]]
        selected_indices = {
            axis: index
            for axis, index in request.selections.items()
            if axis not in request.project_dims and not (axis == "sample" and request.sample_mode != "single")
        }
        coords_by_axis = {"sample": self._sample, "t": self._time, "nu": self._frequency}
        selected_coords = {axis: float(coords_by_axis[axis][index]) for axis, index in selected_indices.items()}
        target_id = request.component_id if request.target == "component" else "combined"
        await asyncio.sleep(0)
        return RenderedSceneSlice(
            scene_id=self.scene_id,
            recipe_id=request.recipe_id,
            target_kind=request.target,
            target_id=str(target_id),
            plane_axes=request.plane_axes,
            values=np.asarray(plane, dtype=np.float32),
            plane_coords={
                "x": self._x[:: sampling_step[0]],
                "y": self._y[:: sampling_step[1]],
            },
            plane_units={"x": "deg", "y": "deg"},
            full_shape=full_shape,
            sampling_step=sampling_step,
            selected_indices=selected_indices,
            selected_coords=selected_coords,
            intensity_unit="1" if request.sample_mode == "rel_uncert" else "Jy/sr",
            wcs={"frame": "synthetic"},
            provenance={"source": "synthetic-sparse-scene"},
        )


def synthetic_hybrid_scene_source(scene_id: str = "synthetic-hybrid") -> SyntheticHybridSceneSource:
    return SyntheticHybridSceneSource(scene_id)
