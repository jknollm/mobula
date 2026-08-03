from __future__ import annotations

import asyncio
from dataclasses import replace

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mobula.data.scene import (
    CubeSceneSource,
    LinearCoordinates,
    SceneProfilesRequest,
    SceneRenderRequest,
    SceneValidationError,
    cube_scene_descriptor,
    scene_descriptor_from_dict,
)
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


def test_synthetic_profile_integral_applies_pixel_solid_angle() -> None:
    source = SyntheticHybridSceneSource("profile-units")
    common = {
        "recipe_id": "combined-emission",
        "profile_axes": ("t",),
        "selections": {"t": 1, "nu": 1},
        "plane_axes": ("x", "y"),
        "spatial_window": {"x": (1, 5), "y": (2, 6)},
        "include_members": True,
    }
    mean = asyncio.run(source.render_profiles(SceneProfilesRequest(**common, spatial_reduction="mean")))
    integral = asyncio.run(source.render_profiles(SceneProfilesRequest(**common, spatial_reduction="integral")))
    np.testing.assert_allclose(
        integral.profiles["t"].per_sample,
        mean.profiles["t"].per_sample * integral.pixel_count * source.pixel_area_sr,
    )
    assert (integral.value_quantity, integral.value_unit) == ("flux_density", "Jy")
    assert (mean.value_quantity, mean.value_unit) == ("surface_brightness", "Jy/sr")


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
    restored_descriptor = asyncio.run(restored.describe_scene())
    assert restored_descriptor.access.mode == "materialized"
    assert replace(restored_descriptor, access=descriptor.access).to_dict() == descriptor.to_dict()
    rendered = asyncio.run(restored.render_layer(SceneRenderRequest(recipe_id="combined-emission")))
    np.testing.assert_allclose(rendered.dataset.values, combined.values)

    with TestClient(create_app(scene_snapshot=manifest)) as client:
        scenes = client.get("/api/scenes")
        assert scenes.status_code == 200
        assert scenes.json()["scenes"][0]["scene_id"] == "round-trip"


def test_scene_api_lists_describes_and_opens_virtual_layers() -> None:
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
            "/api/scenes/api-hybrid/views",
            json={"recipe_id": "combined-emission", "target": "component", "component_id": "background"},
        )
        assert rendered.status_code == 200
        data_id = rendered.json()["data_id"]
        context = client.get(f"/api/datasets/{data_id}/scene")
        assert context.status_code == 200
        assert context.json()["active_target_id"] == "background"


def test_sparse_scene_view_opens_without_render_and_delegates_only_a_plane() -> None:
    class SparseOnlySource:
        def __init__(self) -> None:
            self.delegate = SyntheticHybridSceneSource("sparse-api")
            self.slice_requests = []
            self.profile_requests = []
            self.dense_calls = 0

        async def describe_scene(self):
            return await self.delegate.describe_scene()

        async def render_slice(self, request):
            self.slice_requests.append(request)
            return await self.delegate.render_slice(request)

        async def render_profiles(self, request):
            self.profile_requests.append(request)
            return await self.delegate.render_profiles(request)

        async def render_layer(self, request):
            self.dense_calls += 1
            raise AssertionError("sparse Scene must never use dense rendering")

    registry = DatasetRegistry()
    source = SparseOnlySource()
    registry.add_scene_source("sparse-api", source)
    app = FastAPI()
    app.include_router(build_router(registry))

    with TestClient(app) as client:
        opened = client.post(
            "/api/scenes/sparse-api/views",
            json={"recipe_id": "combined-emission", "target": "combined"},
        )
        assert opened.status_code == 200
        data_id = opened.json()["data_id"]
        opened_again = client.post(
            "/api/scenes/sparse-api/views",
            json={"recipe_id": "combined-emission", "target": "combined"},
        )
        assert opened_again.json()["data_id"] == data_id
        assert source.slice_requests == []
        assert source.dense_calls == 0
        with pytest.raises(KeyError):
            registry.get(data_id)

        meta = client.get(f"/api/datasets/{data_id}/meta")
        assert meta.status_code == 200
        assert meta.json()["scene_access"] == "slice"
        assert meta.json()["scene_profiles"]["axes"] == ["t", "nu"]
        assert meta.json()["scene_profiles"]["reductions"][0] == {
            "reduction_id": "integral",
            "value_quantity": "flux_density",
            "value_unit": "Jy",
        }
        assert meta.json()["coords"]["t"]["values"] == [0.0, 1.0, 2.0, 3.0]

        sliced = client.get(
            f"/api/datasets/{data_id}/slice",
            params={
                "sample": 0,
                "t": 2,
                "nu": 1,
                "z": 0,
                "sample_mode": "single",
                "plane_x": "x",
                "plane_y": "y",
            },
        )
        assert sliced.status_code == 200
        assert sliced.json()["shape"] == [7, 6]
        assert len(source.slice_requests) == 1
        request = source.slice_requests[0]
        assert request.selections == {"sample": 0, "t": 2, "nu": 1}
        assert request.plane_axes == ("x", "y")
        assert source.dense_calls == 0

        relative_uncertainty = client.get(
            f"/api/datasets/{data_id}/slice",
            params={
                "t": 2,
                "nu": 1,
                "sample_mode": "rel_uncert",
                "plane_x": "x",
                "plane_y": "y",
            },
        )
        assert relative_uncertainty.status_code == 200
        assert relative_uncertainty.json()["intensity_unit"] == "1"
        assert "sample" not in source.slice_requests[-1].selections

        profiled = client.post(
            f"/api/datasets/{data_id}/profiles-plane",
            json={
                "plane_x": "x",
                "plane_y": "y",
                "u0": 1,
                "u1": 5,
                "v0": 2,
                "v1": 6,
                "sample": 1,
                "t": 2,
                "nu": 1,
            },
        )
        assert profiled.status_code == 200
        profile_body = profiled.json()
        assert profile_body["spatial_reduction"] == "integral"
        assert profile_body["value_quantity"] == "flux_density"
        assert profile_body["value_unit"] == "Jy"
        assert profile_body["pixel_count"] == 16
        assert set(profile_body["profiles"]) == {"t", "nu"}
        assert profile_body["time_profile"]["value_unit"] == "Jy"
        assert len(profile_body["time_profile"]["per_sample"]) == 2
        assert len(source.profile_requests) == 1
        profile_request = source.profile_requests[0]
        assert profile_request.profile_axes == ("t", "nu")
        assert profile_request.selections == {"t": 2, "nu": 1}
        assert profile_request.spatial_window == {"x": (1, 5), "y": (2, 6)}
        assert profile_request.spatial_reduction == "integral"
        assert source.dense_calls == 0

        dense_range = client.get(f"/api/datasets/{data_id}/intensity-range")
        assert dense_range.status_code == 409
        assert "dense dataset" in dense_range.json()["detail"]


def test_scene_descriptor_round_trips_exact_linear_coordinates() -> None:
    descriptor = asyncio.run(SyntheticHybridSceneSource("linear-scene").describe_scene())
    x_axis = next(axis for axis in descriptor.axes if axis.axis_id == "x")
    linear_x = replace(
        x_axis,
        coordinates=None,
        linear_coordinates=LinearCoordinates(start=-1.0, step=1.0 / 3.0, count=x_axis.size),
    )
    descriptor = replace(
        descriptor,
        axes=tuple(linear_x if axis.axis_id == "x" else axis for axis in descriptor.axes),
    )
    restored = scene_descriptor_from_dict(descriptor.to_dict())
    assert restored.axes[3].linear_coordinates == linear_x.linear_coordinates
