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


class SceneValidationError(ValueError):
    """Raised when a Scene descriptor is internally inconsistent."""


@dataclass(frozen=True, slots=True)
class SceneAxis:
    axis_id: str
    size: int
    unit: str
    coordinates: tuple[float | str, ...] | None = None
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
    schema_version: str = SCENE_SCHEMA_VERSION

    def validate(self) -> None:
        if self.schema_version != SCENE_SCHEMA_VERSION:
            raise SceneValidationError(f"unsupported scene schema version: {self.schema_version}")
        if not self.scene_id:
            raise SceneValidationError("scene has no scene_id")

        axis_ids = [axis.axis_id for axis in self.axes]
        if len(set(axis_ids)) != len(axis_ids):
            raise SceneValidationError("scene contains duplicate axis ids")
        for axis in self.axes:
            axis.validate()

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


@runtime_checkable
class SceneSource(Protocol):
    """Asynchronous source for a structured Scene and its presentation layers."""

    async def describe_scene(self) -> SceneDescriptor: ...

    async def render_layer(self, request: SceneRenderRequest) -> RenderedSceneLayer: ...


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
