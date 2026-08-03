from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

import numpy as np

from mobula.data.schema import CubeDataset

SCENE_SCHEMA_VERSION = "mobula.scene/v1"
REGISTERED_COMPONENT_KINDS: frozenset[str] = frozenset({"raster_field", "point_sources", "component_group"})

ComponentKind = Literal["raster_field", "point_sources", "component_group"]
AxisMappingMode = Literal["invariant", "exact", "select", "interpolate", "project", "unavailable"]
CompositionKind = Literal["additive_emission", "overlay", "replace", "mask"]
RenderTargetKind = Literal["combined", "component"]
SceneAccessMode = Literal["materialized", "slice"]


class SceneValidationError(ValueError):
    """Raised when a Scene descriptor is internally inconsistent."""


@dataclass(frozen=True, slots=True)
class SceneProfileReduction:
    """One source-defined spatial reduction and its value semantics."""

    reduction_id: str
    value_quantity: str
    value_unit: str

    def validate(self) -> None:
        if not self.reduction_id:
            raise SceneValidationError("Scene profile reduction has no reduction_id")
        if not self.value_quantity:
            raise SceneValidationError("Scene profile reduction has no value_quantity")
        if not self.value_unit:
            raise SceneValidationError("Scene profile reduction has no value_unit")


@dataclass(frozen=True, slots=True)
class SceneProfileAccess:
    """Advertise bounded one-dimensional profiles supported by a sparse source."""

    axes: tuple[str, ...]
    plane_axes: tuple[str, str]
    reductions: tuple[SceneProfileReduction, ...]
    include_members: bool = True
    max_output_values: int = 65536

    def validate(self) -> None:
        if not self.axes or any(not axis for axis in self.axes):
            raise SceneValidationError("Scene profile access must advertise at least one axis")
        if len(set(self.axes)) != len(self.axes):
            raise SceneValidationError("Scene profile access contains duplicate axes")
        if len(self.plane_axes) != 2 or self.plane_axes[0] == self.plane_axes[1]:
            raise SceneValidationError("Scene profile access requires two distinct plane axes")
        if not self.reductions:
            raise SceneValidationError("Scene profile access must advertise at least one reduction")
        reduction_ids = [reduction.reduction_id for reduction in self.reductions]
        if len(set(reduction_ids)) != len(reduction_ids):
            raise SceneValidationError("Scene profile access contains duplicate reductions")
        for reduction in self.reductions:
            reduction.validate()
        if self.max_output_values < 1:
            raise SceneValidationError("Scene profile max_output_values must be positive")


@dataclass(frozen=True, slots=True)
class SceneAccess:
    """Advertise how numerical Scene values may be requested.

    ``slice`` is deliberately a stronger contract than a performance hint: a
    source advertising it must return one requested two-dimensional plane and
    Mobula must never fall back to materializing its presentation cube.
    """

    mode: SceneAccessMode = "materialized"
    protocol_version: str | None = None
    full_render: bool = True
    plane_axes: tuple[str, ...] = ()
    sample_modes: tuple[str, ...] = ()
    profiles: SceneProfileAccess | None = None

    def validate(self) -> None:
        if self.mode not in {"materialized", "slice"}:
            raise SceneValidationError(f"unsupported Scene access mode: {self.mode}")
        if self.mode == "slice" and self.full_render:
            raise SceneValidationError("slice Scene access must not advertise full rendering")
        if self.mode == "slice" and not self.protocol_version:
            raise SceneValidationError("slice Scene access must advertise a protocol version")
        if self.profiles is not None:
            if self.mode != "slice":
                raise SceneValidationError("Scene profiles require sparse slice access")
            self.profiles.validate()


@dataclass(frozen=True, slots=True)
class LinearCoordinates:
    """Exact compact encoding for a regular numerical axis."""

    start: float
    step: float
    count: int

    def validate(self, size: int) -> None:
        if self.count != size:
            raise SceneValidationError(
                f"linear coordinate count {self.count} does not match axis size {size}"
            )
        if not np.isfinite(self.start) or not np.isfinite(self.step) or self.step == 0:
            raise SceneValidationError("linear coordinates require a finite start and non-zero finite step")


@dataclass(frozen=True, slots=True)
class SceneAxis:
    axis_id: str
    size: int
    unit: str
    coordinates: tuple[float | str, ...] | None = None
    linear_coordinates: LinearCoordinates | None = None
    label: str | None = None
    minimum: float | None = None
    maximum: float | None = None

    def validate(self) -> None:
        if not self.axis_id:
            raise SceneValidationError("scene axis has no axis_id")
        if self.size < 1:
            raise SceneValidationError(f"scene axis '{self.axis_id}' has invalid size {self.size}")
        if self.coordinates is not None and len(self.coordinates) != self.size:
            raise SceneValidationError(
                f"scene axis '{self.axis_id}' coordinate length {len(self.coordinates)} does not match size {self.size}"
            )
        if self.coordinates is not None and self.linear_coordinates is not None:
            raise SceneValidationError(f"scene axis '{self.axis_id}' has two coordinate encodings")
        if self.linear_coordinates is not None:
            self.linear_coordinates.validate(self.size)


@dataclass(frozen=True, slots=True)
class ComponentAxis:
    axis_id: str
    size: int
    unit: str
    coordinates: tuple[float | str, ...] | None = None

    def validate(self) -> None:
        if not self.axis_id:
            raise SceneValidationError("component axis has no axis_id")
        if self.size < 1:
            raise SceneValidationError(f"component axis '{self.axis_id}' has invalid size {self.size}")
        if self.coordinates is not None and len(self.coordinates) != self.size:
            raise SceneValidationError(
                f"component axis '{self.axis_id}' coordinate length does not match size {self.size}"
            )


@dataclass(frozen=True, slots=True)
class ComponentField:
    field_id: str
    quantity: str
    unit: str
    native_axes: tuple[str, ...]
    role: str = "value"

    def validate(self) -> None:
        if not self.field_id:
            raise SceneValidationError("component field has no field_id")
        if len(set(self.native_axes)) != len(self.native_axes):
            raise SceneValidationError(f"field '{self.field_id}' contains duplicate native axes")


@dataclass(frozen=True, slots=True)
class AxisMapping:
    scene_axis_id: str
    mode: AxisMappingMode
    component_axis_id: str | None = None
    detail: str | None = None

    def validate(self) -> None:
        if not self.scene_axis_id:
            raise SceneValidationError("axis mapping has no scene_axis_id")
        if self.mode == "invariant" and self.component_axis_id is not None:
            raise SceneValidationError("invariant axis mapping must not name a component axis")
        if self.mode != "invariant" and self.mode != "unavailable" and self.component_axis_id is None:
            raise SceneValidationError(f"{self.mode} axis mapping must name a component axis")


@dataclass(frozen=True, slots=True)
class SceneComponent:
    component_id: str
    title: str
    kind: ComponentKind
    native_axes: tuple[ComponentAxis, ...] = ()
    fields: tuple[ComponentField, ...] = ()
    axis_mappings: tuple[AxisMapping, ...] = ()
    parent_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def validate(self, scene_axis_ids: set[str]) -> None:
        if not self.component_id:
            raise SceneValidationError("scene component has no component_id")
        if self.kind == "component_group" and (self.fields or self.native_axes):
            raise SceneValidationError(f"component group '{self.component_id}' cannot declare a native domain or fields")
        native_axis_ids = [item.axis_id for item in self.native_axes]
        if len(set(native_axis_ids)) != len(native_axis_ids):
            raise SceneValidationError(f"component '{self.component_id}' contains duplicate native axis ids")
        for native_axis in self.native_axes:
            native_axis.validate()
        field_ids = [item.field_id for item in self.fields]
        if len(set(field_ids)) != len(field_ids):
            raise SceneValidationError(f"component '{self.component_id}' contains duplicate field ids")
        for component_field in self.fields:
            component_field.validate()
            unknown_native_axes = set(component_field.native_axes) - set(native_axis_ids)
            if unknown_native_axes:
                raise SceneValidationError(
                    f"field '{component_field.field_id}' uses unknown native axes: {sorted(unknown_native_axes)}"
                )
        mapping_axes = [item.scene_axis_id for item in self.axis_mappings]
        if len(set(mapping_axes)) != len(mapping_axes):
            raise SceneValidationError(f"component '{self.component_id}' maps a scene axis more than once")
        unknown_axes = set(mapping_axes) - scene_axis_ids
        if unknown_axes:
            raise SceneValidationError(f"component '{self.component_id}' maps unknown scene axes: {sorted(unknown_axes)}")
        for mapping in self.axis_mappings:
            mapping.validate()
            if (
                mapping.component_axis_id is not None
                and mapping.component_axis_id not in set(native_axis_ids)
                and mapping.component_axis_id not in set(field_ids)
            ):
                raise SceneValidationError(
                    f"component '{self.component_id}' mapping references unknown native axis or field "
                    f"'{mapping.component_axis_id}'"
                )
        if self.kind != "component_group":
            missing_axes = scene_axis_ids - set(mapping_axes)
            if missing_axes:
                raise SceneValidationError(
                    f"component '{self.component_id}' does not explicitly map scene axes: {sorted(missing_axes)}"
                )


@dataclass(frozen=True, slots=True)
class RecipeLayer:
    component_id: str
    renderer: str
    composition: CompositionKind
    visible: bool = True


@dataclass(frozen=True, slots=True)
class PresentationRecipe:
    recipe_id: str
    title: str
    presentation_axes: tuple[str, ...]
    layers: tuple[RecipeLayer, ...]
    output_quantity: str
    output_unit: str
    composition: CompositionKind = "additive_emission"


@dataclass(frozen=True, slots=True)
class SceneDescriptor:
    scene_id: str
    title: str
    axes: tuple[SceneAxis, ...]
    components: tuple[SceneComponent, ...]
    recipes: tuple[PresentationRecipe, ...]
    default_recipe_id: str
    provenance: dict[str, Any] = field(default_factory=dict)
    access: SceneAccess = field(default_factory=SceneAccess)
    schema_version: str = SCENE_SCHEMA_VERSION

    def validate(self) -> None:
        if self.schema_version != SCENE_SCHEMA_VERSION:
            raise SceneValidationError(f"unsupported scene schema version: {self.schema_version}")
        if not self.scene_id:
            raise SceneValidationError("scene has no scene_id")
        self.access.validate()

        axis_ids = [axis.axis_id for axis in self.axes]
        if len(set(axis_ids)) != len(axis_ids):
            raise SceneValidationError("scene contains duplicate axis ids")
        for axis in self.axes:
            axis.validate()
        if self.access.profiles is not None:
            profile_access = self.access.profiles
            unknown_profile_axes = set(profile_access.axes) - set(axis_ids)
            unknown_plane_axes = set(profile_access.plane_axes) - set(axis_ids)
            if unknown_profile_axes:
                raise SceneValidationError(
                    f"Scene profile access uses unknown axes: {sorted(unknown_profile_axes)}"
                )
            if unknown_plane_axes:
                raise SceneValidationError(
                    f"Scene profile access uses unknown plane axes: {sorted(unknown_plane_axes)}"
                )
            if self.access.plane_axes and tuple(self.access.plane_axes) != profile_access.plane_axes:
                raise SceneValidationError("Scene profile plane axes must match sparse slice plane axes")

        component_ids = [component.component_id for component in self.components]
        if len(set(component_ids)) != len(component_ids):
            raise SceneValidationError("scene contains duplicate component ids")
        component_id_set = set(component_ids)
        for component in self.components:
            component.validate(set(axis_ids))
            if component.parent_id is not None and component.parent_id not in component_id_set:
                raise SceneValidationError(
                    f"component '{component.component_id}' has unknown parent '{component.parent_id}'"
                )
            if component.parent_id == component.component_id:
                raise SceneValidationError(f"component '{component.component_id}' cannot parent itself")

        for component in self.components:
            seen = {component.component_id}
            parent_id = component.parent_id
            while parent_id is not None:
                if parent_id in seen:
                    raise SceneValidationError(f"component hierarchy contains a cycle at '{parent_id}'")
                seen.add(parent_id)
                parent = next(item for item in self.components if item.component_id == parent_id)
                parent_id = parent.parent_id

        recipe_ids = [recipe.recipe_id for recipe in self.recipes]
        if len(set(recipe_ids)) != len(recipe_ids):
            raise SceneValidationError("scene contains duplicate recipe ids")
        if self.default_recipe_id not in set(recipe_ids):
            raise SceneValidationError(f"unknown default recipe '{self.default_recipe_id}'")
        for recipe in self.recipes:
            unknown_axes = set(recipe.presentation_axes) - set(axis_ids)
            if unknown_axes:
                raise SceneValidationError(f"recipe '{recipe.recipe_id}' uses unknown axes: {sorted(unknown_axes)}")
            unknown_components = {layer.component_id for layer in recipe.layers} - component_id_set
            if unknown_components:
                raise SceneValidationError(
                    f"recipe '{recipe.recipe_id}' uses unknown components: {sorted(unknown_components)}"
                )

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)


@dataclass(frozen=True, slots=True)
class SceneRenderRequest:
    recipe_id: str
    target: RenderTargetKind = "combined"
    component_id: str | None = None
    exploration_indices: dict[str, int] = field(default_factory=dict)
    spatial_window: dict[str, tuple[int, int]] = field(default_factory=dict)
    sample_mode: str = "single"

    def validate(self) -> None:
        if self.target == "component" and not self.component_id:
            raise SceneValidationError("component render target requires component_id")
        if self.target == "combined" and self.component_id is not None:
            raise SceneValidationError("combined render target must not include component_id")


@dataclass(slots=True)
class RenderedSceneLayer:
    scene_id: str
    recipe_id: str
    target_kind: RenderTargetKind
    target_id: str
    dataset: CubeDataset


@dataclass(frozen=True, slots=True)
class SceneSliceRequest:
    """One bounded two-dimensional presentation request.

    Selections use Scene-axis ids rather than a fixed cube schema so sources
    can preserve arbitrary heterogeneous component domains.
    """

    recipe_id: str
    target: RenderTargetKind = "combined"
    component_id: str | None = None
    plane_axes: tuple[str, str] = ("x", "y")
    selections: dict[str, int] = field(default_factory=dict)
    project_dims: tuple[str, ...] = ()
    sample_mode: str = "single"
    max_pixels: int | None = None

    def validate(self) -> None:
        SceneRenderRequest(
            recipe_id=self.recipe_id,
            target=self.target,
            component_id=self.component_id,
            sample_mode=self.sample_mode,
        ).validate()
        if len(self.plane_axes) != 2 or self.plane_axes[0] == self.plane_axes[1]:
            raise SceneValidationError("Scene slice requires two distinct plane axes")
        if any(not axis for axis in self.plane_axes):
            raise SceneValidationError("Scene slice plane axes must not be empty")
        if set(self.plane_axes) & set(self.project_dims):
            raise SceneValidationError("Scene slice cannot project a visible plane axis")
        if len(set(self.project_dims)) != len(self.project_dims):
            raise SceneValidationError("Scene slice contains duplicate projected axes")
        if self.max_pixels is not None and self.max_pixels < 1:
            raise SceneValidationError("Scene slice max_pixels must be positive")
        if any(index < 0 for index in self.selections.values()):
            raise SceneValidationError("Scene slice selections must be non-negative")


@dataclass(frozen=True, slots=True)
class SceneProfilesRequest:
    """One bounded, batched profile request over arbitrary presentation axes."""

    recipe_id: str
    target: RenderTargetKind = "combined"
    component_id: str | None = None
    profile_axes: tuple[str, ...] = ()
    selections: dict[str, int] = field(default_factory=dict)
    plane_axes: tuple[str, str] = ("x", "y")
    spatial_window: dict[str, tuple[int, int]] = field(default_factory=dict)
    spatial_reduction: str = "mean"
    include_members: bool = True
    max_output_values: int = 65536

    def validate(self) -> None:
        SceneRenderRequest(
            recipe_id=self.recipe_id,
            target=self.target,
            component_id=self.component_id,
        ).validate()
        if not self.profile_axes or any(not axis for axis in self.profile_axes):
            raise SceneValidationError("Scene profile request requires at least one profile axis")
        if len(set(self.profile_axes)) != len(self.profile_axes):
            raise SceneValidationError("Scene profile request contains duplicate profile axes")
        if len(self.plane_axes) != 2 or self.plane_axes[0] == self.plane_axes[1]:
            raise SceneValidationError("Scene profile request requires two distinct plane axes")
        if set(self.spatial_window) != set(self.plane_axes):
            raise SceneValidationError("Scene profile spatial_window must exactly match plane_axes")
        for axis, bounds in self.spatial_window.items():
            if len(bounds) != 2 or bounds[0] < 0 or bounds[1] <= bounds[0]:
                raise SceneValidationError(f"Scene profile window for '{axis}' is invalid")
        if not self.spatial_reduction:
            raise SceneValidationError("Scene profile request has no spatial_reduction")
        if self.max_output_values < 1:
            raise SceneValidationError("Scene profile max_output_values must be positive")
        if any(index < 0 for index in self.selections.values()):
            raise SceneValidationError("Scene profile selections must be non-negative")


@dataclass(slots=True)
class RenderedSceneProfileSeries:
    axis: str
    axis_unit: str
    coords: np.ndarray
    series_mean: np.ndarray
    series_std: np.ndarray
    per_sample: np.ndarray
    fixed_indices: dict[str, int]

    def validate(self) -> None:
        coords = np.asarray(self.coords)
        mean = np.asarray(self.series_mean)
        std = np.asarray(self.series_std)
        members = np.asarray(self.per_sample)
        if not self.axis:
            raise SceneValidationError("rendered Scene profile has no axis")
        if coords.ndim != 1 or mean.ndim != 1 or std.ndim != 1:
            raise SceneValidationError("rendered Scene profile coordinate and summary arrays must be one-dimensional")
        if coords.size < 1 or mean.size != coords.size or std.size != coords.size:
            raise SceneValidationError("rendered Scene profile arrays have inconsistent lengths")
        if members.ndim != 2 or members.shape[1] != coords.size:
            raise SceneValidationError("rendered Scene profile member array has an invalid shape")
        if (
            mean.dtype.kind not in {"f", "i", "u"}
            or std.dtype.kind not in {"f", "i", "u"}
            or members.dtype.kind not in {"f", "i", "u"}
        ):
            raise SceneValidationError("rendered Scene profile values must be numeric")
        if not np.all(np.isfinite(mean)) or not np.all(np.isfinite(std)) or not np.all(np.isfinite(members)):
            raise SceneValidationError("rendered Scene profile contains non-finite values")
        if coords.dtype.kind in {"f", "i", "u"} and not np.all(np.isfinite(coords)):
            raise SceneValidationError("rendered Scene profile contains non-finite coordinates")
        if np.any(std < 0):
            raise SceneValidationError("rendered Scene profile standard deviation must be non-negative")
        if any(index < 0 for index in self.fixed_indices.values()):
            raise SceneValidationError("rendered Scene profile fixed indices must be non-negative")


@dataclass(slots=True)
class RenderedSceneProfiles:
    scene_id: str
    recipe_id: str
    target_kind: RenderTargetKind
    target_id: str
    spatial_window: dict[str, tuple[int, int]]
    spatial_reduction: str
    pixel_count: int
    value_quantity: str
    value_unit: str
    profiles: dict[str, RenderedSceneProfileSeries]

    def validate(self) -> None:
        if not self.scene_id or not self.recipe_id or not self.target_id:
            raise SceneValidationError("rendered Scene profiles have incomplete identity")
        if self.target_kind not in {"combined", "component"}:
            raise SceneValidationError("rendered Scene profiles have an invalid target kind")
        if not self.spatial_reduction or not self.value_quantity or not self.value_unit:
            raise SceneValidationError("rendered Scene profiles have incomplete value semantics")
        if self.pixel_count < 1:
            raise SceneValidationError("rendered Scene profiles have an invalid pixel count")
        if not self.profiles or set(self.profiles) != {series.axis for series in self.profiles.values()}:
            raise SceneValidationError("rendered Scene profile keys do not match their axes")
        for bounds in self.spatial_window.values():
            if len(bounds) != 2 or bounds[0] < 0 or bounds[1] <= bounds[0]:
                raise SceneValidationError("rendered Scene profiles have an invalid spatial window")
        for series in self.profiles.values():
            series.validate()


@dataclass(slots=True)
class RenderedSceneSlice:
    """A source-rendered 2-D plane with enough metadata for the viewer."""

    scene_id: str
    recipe_id: str
    target_kind: RenderTargetKind
    target_id: str
    plane_axes: tuple[str, str]
    values: np.ndarray
    plane_coords: dict[str, np.ndarray]
    plane_units: dict[str, str]
    full_shape: tuple[int, int]
    sampling_step: tuple[int, int]
    selected_indices: dict[str, int]
    selected_coords: dict[str, float | str]
    intensity_unit: str
    wcs: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        values = np.asarray(self.values)
        if values.ndim != 2:
            raise SceneValidationError(f"rendered Scene slice must be 2-D, got shape {values.shape}")
        if len(self.full_shape) != 2 or len(self.sampling_step) != 2:
            raise SceneValidationError("rendered Scene slice shape metadata must contain exactly two values")
        if any(size < 1 for size in self.full_shape) or any(step < 1 for step in self.sampling_step):
            raise SceneValidationError("rendered Scene slice shape and sampling step must be positive")
        if values.shape != tuple(self.full_shape) and any(step != 1 for step in self.sampling_step):
            expected = tuple(
                (size + step - 1) // step for size, step in zip(self.full_shape, self.sampling_step, strict=True)
            )
            if values.shape != expected:
                raise SceneValidationError(
                    f"rendered Scene slice shape {values.shape} does not match sampled full shape {expected}"
                )
        elif values.shape != tuple(self.full_shape):
            raise SceneValidationError(
                f"rendered Scene slice shape {values.shape} does not match full shape {self.full_shape}"
            )
        if len(self.plane_axes) != 2 or self.plane_axes[0] == self.plane_axes[1]:
            raise SceneValidationError("rendered Scene slice has invalid plane axes")
        if set(self.plane_coords) != set(self.plane_axes):
            raise SceneValidationError("rendered Scene slice coordinates do not match its plane axes")
        if set(self.plane_units) != set(self.plane_axes):
            raise SceneValidationError("rendered Scene slice units do not match its plane axes")
        for axis, size in zip(self.plane_axes, values.shape, strict=True):
            if np.asarray(self.plane_coords[axis]).size != size:
                raise SceneValidationError(f"rendered Scene slice coordinate length for '{axis}' is invalid")


@runtime_checkable
class SceneSource(Protocol):
    """Asynchronous metadata source for a structured Scene."""

    async def describe_scene(self) -> SceneDescriptor: ...


@runtime_checkable
class DenseSceneSource(SceneSource, Protocol):
    """Legacy source which exposes complete presentation layers."""

    async def render_layer(self, request: SceneRenderRequest) -> RenderedSceneLayer: ...


@runtime_checkable
class SliceSceneSource(SceneSource, Protocol):
    """Sparse-required source which exposes bounded 2-D planes only."""

    async def render_slice(self, request: SceneSliceRequest) -> RenderedSceneSlice: ...


@runtime_checkable
class ProfileSceneSource(SceneSource, Protocol):
    """Sparse source which evaluates bounded one-dimensional profiles directly."""

    async def render_profiles(self, request: SceneProfilesRequest) -> RenderedSceneProfiles: ...


def _axis_from_cube(dataset: CubeDataset, dim: str) -> SceneAxis:
    coord = np.asarray(dataset.coords[dim])
    coordinates: tuple[float | str, ...] | None = None
    if coord.size <= 512:
        if coord.dtype.kind in {"U", "S", "O"}:
            coordinates = tuple(str(item) for item in coord.tolist())
        else:
            coordinates = tuple(float(item) for item in coord.tolist())
    minimum = float(np.nanmin(coord)) if coord.size and coord.dtype.kind not in {"U", "S", "O"} else None
    maximum = float(np.nanmax(coord)) if coord.size and coord.dtype.kind not in {"U", "S", "O"} else None
    return SceneAxis(
        axis_id=dim,
        size=int(coord.size),
        unit=dataset.units[dim],
        coordinates=coordinates,
        minimum=minimum,
        maximum=maximum,
    )


def cube_scene_descriptor(dataset: CubeDataset) -> SceneDescriptor:
    """Describe a legacy cube as a one-component raster Scene."""
    dataset.validate()
    component_id = "raster"
    descriptor = SceneDescriptor(
        scene_id=f"cube:{dataset.data_id}",
        title=dataset.data_id,
        axes=tuple(_axis_from_cube(dataset, dim) for dim in dataset.dims),
        components=(
            SceneComponent(
                component_id=component_id,
                title=dataset.data_id,
                kind="raster_field",
                native_axes=tuple(
                    ComponentAxis(
                        axis_id=dim,
                        size=dataset.shape[index],
                        unit=dataset.units[dim],
                        coordinates=_axis_from_cube(dataset, dim).coordinates,
                    )
                    for index, dim in enumerate(dataset.dims)
                ),
                fields=(
                    ComponentField(
                        field_id="values",
                        quantity="intensity",
                        unit=dataset.intensity_unit,
                        native_axes=dataset.dims,
                    ),
                ),
                axis_mappings=tuple(
                    AxisMapping(scene_axis_id=dim, mode="exact", component_axis_id=dim) for dim in dataset.dims
                ),
            ),
        ),
        recipes=(
            PresentationRecipe(
                recipe_id="native",
                title="Native raster",
                presentation_axes=dataset.dims,
                layers=(RecipeLayer(component_id=component_id, renderer="raster", composition="replace"),),
                output_quantity="intensity",
                output_unit=dataset.intensity_unit,
                composition="replace",
            ),
        ),
        default_recipe_id="native",
        provenance=dict(dataset.provenance),
        access=SceneAccess(mode="materialized"),
    )
    descriptor.validate()
    return descriptor


def scene_descriptor_from_dict(payload: dict[str, Any]) -> SceneDescriptor:
    """Decode the transport-neutral v1 descriptor representation."""
    axes = tuple(
        SceneAxis(
            axis_id=item["axis_id"],
            size=item["size"],
            unit=item["unit"],
            coordinates=tuple(item["coordinates"]) if item.get("coordinates") is not None else None,
            linear_coordinates=(
                LinearCoordinates(**item["linear_coordinates"])
                if item.get("linear_coordinates") is not None
                else None
            ),
            label=item.get("label"),
            minimum=item.get("minimum"),
            maximum=item.get("maximum"),
        )
        for item in payload.get("axes", [])
    )
    components = tuple(
        SceneComponent(
            component_id=item["component_id"],
            title=item["title"],
            kind=item["kind"],
            native_axes=tuple(
                ComponentAxis(
                    axis_id=value["axis_id"],
                    size=value["size"],
                    unit=value["unit"],
                    coordinates=tuple(value["coordinates"]) if value.get("coordinates") is not None else None,
                )
                for value in item.get("native_axes", [])
            ),
            fields=tuple(
                ComponentField(
                    field_id=value["field_id"],
                    quantity=value["quantity"],
                    unit=value["unit"],
                    native_axes=tuple(value.get("native_axes", [])),
                    role=value.get("role", "value"),
                )
                for value in item.get("fields", [])
            ),
            axis_mappings=tuple(AxisMapping(**value) for value in item.get("axis_mappings", [])),
            parent_id=item.get("parent_id"),
            metadata=dict(item.get("metadata", {})),
        )
        for item in payload.get("components", [])
    )
    recipes = tuple(
        PresentationRecipe(
            recipe_id=item["recipe_id"],
            title=item["title"],
            presentation_axes=tuple(item.get("presentation_axes", [])),
            layers=tuple(RecipeLayer(**value) for value in item.get("layers", [])),
            output_quantity=item["output_quantity"],
            output_unit=item["output_unit"],
            composition=item.get("composition", "additive_emission"),
        )
        for item in payload.get("recipes", [])
    )
    descriptor = SceneDescriptor(
        scene_id=payload["scene_id"],
        title=payload["title"],
        axes=axes,
        components=components,
        recipes=recipes,
        default_recipe_id=payload["default_recipe_id"],
        provenance=dict(payload.get("provenance", {})),
        access=SceneAccess(
            mode=dict(payload.get("access", {})).get("mode", "materialized"),
            protocol_version=dict(payload.get("access", {})).get("protocol_version"),
            full_render=bool(dict(payload.get("access", {})).get("full_render", True)),
            plane_axes=tuple(dict(payload.get("access", {})).get("plane_axes", ())),
            sample_modes=tuple(dict(payload.get("access", {})).get("sample_modes", ())),
            profiles=(
                SceneProfileAccess(
                    axes=tuple(dict(dict(payload.get("access", {}))["profiles"]).get("axes", ())),
                    plane_axes=tuple(dict(dict(payload.get("access", {}))["profiles"]).get("plane_axes", ())),
                    reductions=tuple(
                        SceneProfileReduction(**item)
                        for item in dict(dict(payload.get("access", {}))["profiles"]).get("reductions", ())
                    ),
                    include_members=bool(
                        dict(dict(payload.get("access", {}))["profiles"]).get("include_members", True)
                    ),
                    max_output_values=int(
                        dict(dict(payload.get("access", {}))["profiles"]).get("max_output_values", 65536)
                    ),
                )
                if dict(payload.get("access", {})).get("profiles") is not None
                else None
            ),
        ),
        schema_version=payload.get("schema_version", SCENE_SCHEMA_VERSION),
    )
    descriptor.validate()
    return descriptor


class CubeSceneSource:
    """Compatibility adapter exposing a CubeDataset through the SceneSource API."""

    def __init__(self, dataset: CubeDataset) -> None:
        self._dataset = dataset
        self._descriptor = cube_scene_descriptor(dataset)

    async def describe_scene(self) -> SceneDescriptor:
        return self._descriptor

    async def render_layer(self, request: SceneRenderRequest) -> RenderedSceneLayer:
        request.validate()
        if request.recipe_id != "native":
            raise KeyError(f"recipe '{request.recipe_id}' not found")
        if request.target == "component" and request.component_id != "raster":
            raise KeyError(f"component '{request.component_id}' not found")
        return RenderedSceneLayer(
            scene_id=self._descriptor.scene_id,
            recipe_id="native",
            target_kind=request.target,
            target_id="raster" if request.target == "component" else "combined",
            dataset=self._dataset,
        )
