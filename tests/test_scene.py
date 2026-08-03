from __future__ import annotations

import asyncio

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mobula.data.scene import CubeSceneSource, SceneRenderRequest, SceneValidationError, cube_scene_descriptor
from mobula.data.scene_snapshot import SnapshotSceneSource, write_scene_snapshot
from mobula.data.synthetic_scene import SyntheticHybridSceneSource
from mobula.main import create_app
from mobula.service.api import build_router
from mobula.service.registry import DatasetRegistry


def test_cube_dataset_is_a_compatible_single_raster_scene(base_dataset) -> None:
    descriptor = cube_scene_descriptor(base_dataset)
    assert descriptor.schema_version == "mobula.scene/v1"
    assert descriptor.scene_id == f"cube:{base_dataset.data_id}"
    assert descriptor.components[0].kind == "raster_field"
    assert descriptor.components[0].fields[0].native_axes == base_dataset.dims

    rendered = asyncio.run(
        CubeSceneSource(base_dataset).render_layer(SceneRenderRequest(recipe_id="native", target="combined"))
    )
    assert rendered.dataset is base_dataset


def test_synthetic_hybrid_scene_models_invariant_and_projected_axes() -> None:
    source = SyntheticHybridSceneSource()
    descriptor = asyncio.run(source.describe_scene())
    background = next(item for item in descriptor.components if item.component_id == "background")
    transient = next(item for item in descriptor.components if item.component_id == "transient")
    assert next(item for item in background.axis_mappings if item.scene_axis_id == "t").mode == "invariant"
    assert next(item for item in transient.axis_mappings if item.scene_axis_id == "x").mode == "project"
    assert transient.parent_id == "sky"
    assert tuple(axis.axis_id for axis in background.native_axes) == ("x", "y")
    assert tuple(axis.axis_id for axis in transient.native_axes) == ("sample", "t", "nu")

    combined = asyncio.run(source.render_layer(SceneRenderRequest(recipe_id="combined-emission"))).dataset
    background_cube = asyncio.run(
        source.render_layer(
            SceneRenderRequest(recipe_id="combined-emission", target="component", component_id="background")
        )
    ).dataset
    point_cube = asyncio.run(
        source.render_layer(
            SceneRenderRequest(recipe_id="combined-emission", target="component", component_id="transient")
        )
    ).dataset
    np.testing.assert_array_equal(background_cube.values[:, 0, 0], background_cube.values[:, -1, -1])
    np.testing.assert_allclose(combined.values, background_cube.values + point_cube.values)
    assert np.count_nonzero(point_cube.values[0, 0]) > 0
    assert not np.array_equal(point_cube.values[0, 0], point_cube.values[0, 1])


def test_scene_descriptor_rejects_unknown_recipe_axis() -> None:
    descriptor = asyncio.run(SyntheticHybridSceneSource().describe_scene())
    bad_recipe = descriptor.recipes[0].__class__(
        recipe_id="bad",
        title="Bad",
        presentation_axes=("not-an-axis",),
        layers=descriptor.recipes[0].layers,
        output_quantity="brightness",
        output_unit="arb",
    )
    bad_descriptor = descriptor.__class__(
        scene_id=descriptor.scene_id,
        title=descriptor.title,
        axes=descriptor.axes,
        components=descriptor.components,
        recipes=(bad_recipe,),
        default_recipe_id="bad",
    )
    with pytest.raises(SceneValidationError, match="unknown axes"):
        bad_descriptor.validate()


def test_scene_snapshot_round_trip(tmp_path) -> None:
    source = SyntheticHybridSceneSource("round-trip")
    descriptor = asyncio.run(source.describe_scene())
    combined = asyncio.run(source.render_layer(SceneRenderRequest(recipe_id="combined-emission"))).dataset
    background = asyncio.run(
        source.render_layer(
            SceneRenderRequest(recipe_id="combined-emission", target="component", component_id="background")
        )
    ).dataset
    manifest, _ = write_scene_snapshot(
        tmp_path / "scene.json",
        descriptor,
        {
            ("combined-emission", "combined"): combined,
            ("combined-emission", "background"): background,
        },
    )
    restored = SnapshotSceneSource(manifest)
    assert asyncio.run(restored.describe_scene()).to_dict() == descriptor.to_dict()
    rendered = asyncio.run(restored.render_layer(SceneRenderRequest(recipe_id="combined-emission")))
    np.testing.assert_allclose(rendered.dataset.values, combined.values)

    with TestClient(create_app(scene_snapshot=manifest)) as client:
        scenes = client.get("/api/scenes")
        assert scenes.status_code == 200
        assert scenes.json()["scenes"][0]["scene_id"] == "round-trip"


def test_scene_api_lists_describes_and_materializes_layers() -> None:
    registry = DatasetRegistry()
    source = SyntheticHybridSceneSource("api-hybrid")
    registry.add_scene_source(source.scene_id, source)
    app = FastAPI()
    app.include_router(build_router(registry))
    with TestClient(app) as client:
        listed = client.get("/api/scenes")
        assert listed.status_code == 200
        assert listed.json()["scenes"][0]["scene_id"] == "api-hybrid"

        descriptor = client.get("/api/scenes/api-hybrid")
        assert descriptor.status_code == 200
        assert descriptor.json()["components"][2]["kind"] == "point_sources"

        rendered = client.post(
            "/api/scenes/api-hybrid/render",
            json={"recipe_id": "combined-emission", "target": "component", "component_id": "background"},
        )
        assert rendered.status_code == 200
        data_id = rendered.json()["data_id"]
        context = client.get(f"/api/datasets/{data_id}/scene")
        assert context.status_code == 200
        assert context.json()["active_target_id"] == "background"
