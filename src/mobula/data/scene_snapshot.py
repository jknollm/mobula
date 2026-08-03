from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from mobula.data.scene import (
    RenderedSceneLayer,
    SceneDescriptor,
    SceneRenderRequest,
    scene_descriptor_from_dict,
)
from mobula.data.schema import CubeDataset

SCENE_SNAPSHOT_VERSION = "mobula.scene-snapshot/v1"


class SnapshotSceneSource:
    """Read a local JSON+NPZ Scene handoff without provider-specific imports."""

    def __init__(self, manifest_path: str | Path) -> None:
        self.manifest_path = Path(manifest_path).expanduser().resolve()
        payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if payload.get("snapshot_version") != SCENE_SNAPSHOT_VERSION:
            raise ValueError(f"unsupported Scene snapshot version: {payload.get('snapshot_version')}")
        self._descriptor = scene_descriptor_from_dict(payload["descriptor"])
        self._layers = dict(payload.get("layers", {}))
        values_path = payload.get("values_path")
        if not isinstance(values_path, str) or not values_path:
            raise ValueError("Scene snapshot has no values_path")
        self.values_path = (self.manifest_path.parent / values_path).resolve()
        if not self.values_path.is_file():
            raise FileNotFoundError(f"Scene snapshot values not found: {self.values_path}")

    @property
    def scene_id(self) -> str:
        return self._descriptor.scene_id

    async def describe_scene(self) -> SceneDescriptor:
        return self._descriptor

    async def render_layer(self, request: SceneRenderRequest) -> RenderedSceneLayer:
        request.validate()
        target_id = request.component_id if request.target == "component" else "combined"
        layer_key = f"{request.recipe_id}:{target_id}"
        layer = self._layers.get(layer_key)
        if not isinstance(layer, dict):
            raise KeyError(f"Scene snapshot layer '{layer_key}' not found")
        with np.load(self.values_path, allow_pickle=False) as arrays:
            values = np.asarray(arrays[layer["values_key"]])
            dims = tuple(layer["dims"])
            coords = {
                dim: np.asarray(arrays[key]) for dim, key in dict(layer.get("coordinate_keys", {})).items()
            }
            mask_key = layer.get("mask_key")
            mask = np.asarray(arrays[mask_key], dtype=bool) if mask_key else None
        dataset = CubeDataset(
            data_id=str(layer.get("data_id") or f"scene-{self._descriptor.scene_id}-{request.recipe_id}-{target_id}"),
            dims=dims,
            coords=coords,
            values=values,
            units={str(key): str(value) for key, value in dict(layer["units"]).items()},
            intensity_unit=str(layer["intensity_unit"]),
            wcs=dict(layer.get("wcs", {})),
            provenance={
                **dict(layer.get("provenance", {})),
                "source": "scene-snapshot",
                "snapshot_manifest": str(self.manifest_path),
                "scene_id": self._descriptor.scene_id,
                "recipe_id": request.recipe_id,
                "target_id": target_id,
            },
            mask=mask,
            uncertainty=layer.get("uncertainty"),
        )
        dataset.validate()
        return RenderedSceneLayer(
            scene_id=self._descriptor.scene_id,
            recipe_id=request.recipe_id,
            target_id=str(target_id),
            dataset=dataset,
        )


def write_scene_snapshot(
    manifest_path: str | Path,
    descriptor: SceneDescriptor,
    layers: dict[tuple[str, str], CubeDataset],
) -> tuple[Path, Path]:
    """Write a compact local handoff. Each target is a presentation cube, not a scientific Scene flattening."""
    descriptor.validate()
    manifest = Path(manifest_path).expanduser().resolve()
    values_path = manifest.with_suffix(".npz")
    arrays: dict[str, np.ndarray] = {}
    layer_payload: dict[str, dict[str, Any]] = {}
    for index, ((recipe_id, target_id), dataset) in enumerate(layers.items()):
        dataset.validate()
        prefix = f"layer_{index}"
        values_key = f"{prefix}_values"
        arrays[values_key] = np.asarray(dataset.values)
        coordinate_keys: dict[str, str] = {}
        for dim in dataset.dims:
            key = f"{prefix}_coord_{dim}"
            arrays[key] = np.asarray(dataset.coords[dim])
            coordinate_keys[dim] = key
        mask_key = None
        if dataset.mask is not None:
            mask_key = f"{prefix}_mask"
            arrays[mask_key] = np.asarray(dataset.mask, dtype=bool)
        layer_payload[f"{recipe_id}:{target_id}"] = {
            "data_id": dataset.data_id,
            "dims": list(dataset.dims),
            "values_key": values_key,
            "coordinate_keys": coordinate_keys,
            "units": dataset.units,
            "intensity_unit": dataset.intensity_unit,
            "wcs": dataset.wcs,
            "provenance": dataset.provenance,
            "mask_key": mask_key,
            "uncertainty": dataset.uncertainty,
        }
    manifest.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(values_path, **arrays)
    manifest.write_text(
        json.dumps(
            {
                "snapshot_version": SCENE_SNAPSHOT_VERSION,
                "descriptor": descriptor.to_dict(),
                "values_path": values_path.name,
                "layers": layer_payload,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return manifest, values_path
