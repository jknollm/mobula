from __future__ import annotations

import asyncio
import json
import threading
from contextlib import contextmanager
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Iterator

import numpy as np
import pytest
from fastapi.testclient import TestClient

from mobula.cli import _build_serve_parser, _scene_viewer_url
from mobula.data.scene import RenderedSceneLayer, SceneProfilesRequest, SceneRenderRequest, SceneSliceRequest
from mobula.data.scene_remote import (
    SCENE_LAYER_MEDIA_TYPE,
    SCENE_SOURCE_PROTOCOL_VERSION,
    SCENE_SLICE_MEDIA_TYPE,
    RemoteSceneSource,
    RemoteSceneSourceError,
    decode_scene_layer_payload,
    decode_scene_profiles_payload,
    decode_scene_slice_payload,
    encode_scene_layer_payload,
    encode_scene_profiles_payload,
    encode_scene_slice_payload,
)
from mobula.data.scene_snapshot import SnapshotSceneSource, write_scene_snapshot
from mobula.data.synthetic_scene import SyntheticHybridSceneSource
from mobula.main import create_app
from mobula.service.registry import DatasetRegistry


def test_cli_accepts_authenticated_runtime_source_options() -> None:
    args = _build_serve_parser().parse_args(
        [
            "--scene-source-url",
            "http://127.0.0.1:49152/session/abc",
            "--scene-source-token-env",
            "MOBULA_SCENE_TOKEN",
            "--initial-scene",
            "scene / with spaces",
            "--no-browser",
        ]
    )
    assert args.scene_source_url.endswith("/session/abc")
    assert args.scene_source_token_env == "MOBULA_SCENE_TOKEN"
    assert args.initial_scene == "scene / with spaces"
    assert args.no_browser is True
    assert _scene_viewer_url("http://127.0.0.1:8000", args.initial_scene).endswith(
        "scene_id=scene%20%2F%20with%20spaces"
    )


@contextmanager
def _runtime_server(
    token: str = "test-secret",
    *,
    descriptor_protocol: str = SCENE_SOURCE_PROTOCOL_VERSION,
) -> Iterator[tuple[str, SyntheticHybridSceneSource]]:
    source = SyntheticHybridSceneSource("remote-hybrid")

    class Handler(BaseHTTPRequestHandler):
        def _authorized(self) -> bool:
            return self.headers.get("Authorization") == f"Bearer {token}"

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if not self._authorized():
                self._send(401, b"unauthorized", "text/plain")
                return
            if self.path != "/descriptor":
                self._send(404, b"not found", "text/plain")
                return
            assert self.headers.get("X-Mobula-Scene-Protocol") == SCENE_SOURCE_PROTOCOL_VERSION
            descriptor = asyncio.run(source.describe_scene())
            body = json.dumps(
                {
                    "protocol_version": descriptor_protocol,
                    "descriptor": descriptor.to_dict(),
                }
            ).encode("utf-8")
            self._send(200, body, "application/json")

        def do_POST(self) -> None:  # noqa: N802
            if not self._authorized():
                self._send(401, b"unauthorized", "text/plain")
                return
            if self.path not in {"/render", "/slice", "/profiles"}:
                self._send(404, b"not found", "text/plain")
                return
            assert self.headers.get("X-Mobula-Scene-Protocol") == SCENE_SOURCE_PROTOCOL_VERSION
            length = int(self.headers.get("Content-Length", "0"))
            envelope = json.loads(self.rfile.read(length).decode("utf-8"))
            assert envelope["protocol_version"] == SCENE_SOURCE_PROTOCOL_VERSION
            if self.path == "/profiles":
                raw_request = envelope["request"]
                request = SceneProfilesRequest(
                    **{
                        **raw_request,
                        "profile_axes": tuple(raw_request["profile_axes"]),
                        "plane_axes": tuple(raw_request["plane_axes"]),
                        "spatial_window": {
                            axis: tuple(bounds) for axis, bounds in raw_request["spatial_window"].items()
                        },
                    }
                )
                rendered = asyncio.run(source.render_profiles(request))
                self._send(200, encode_scene_profiles_payload(rendered), "application/json")
            elif self.path == "/slice":
                request = SceneSliceRequest(
                    **{
                        **envelope["request"],
                        "plane_axes": tuple(envelope["request"]["plane_axes"]),
                        "project_dims": tuple(envelope["request"]["project_dims"]),
                    }
                )
                rendered = asyncio.run(source.render_slice(request))
                self._send(200, encode_scene_slice_payload(rendered), SCENE_SLICE_MEDIA_TYPE)
            else:
                request = SceneRenderRequest(**envelope["request"])
                layer = asyncio.run(source.render_layer(request))
                self._send(200, encode_scene_layer_payload(layer), SCENE_LAYER_MEDIA_TYPE)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", source
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5.0)


def test_remote_scene_source_fetches_descriptor_without_files() -> None:
    with _runtime_server() as (url, _):
        remote = RemoteSceneSource(url, "test-secret", expected_scene_id="remote-hybrid")
        descriptor = asyncio.run(remote.describe_scene())
        assert descriptor.scene_id == "remote-hybrid"
        assert descriptor.access.mode == "slice"


def test_remote_scene_source_fetches_only_the_requested_2d_slice() -> None:
    with _runtime_server() as (url, local_source):
        remote = RemoteSceneSource(url, "test-secret", expected_scene_id="remote-hybrid")
        request = SceneSliceRequest(
            recipe_id="combined-emission",
            plane_axes=("x", "y"),
            selections={"t": 3, "nu": 1},
            sample_mode="mean",
            max_pixels=10,
        )
        remote_slice = asyncio.run(remote.render_slice(request))
        local_slice = asyncio.run(local_source.render_slice(request))
        assert remote_slice.values.ndim == 2
        assert remote_slice.values.size <= 10
        assert remote_slice.selected_indices == {"t": 3, "nu": 1}
        np.testing.assert_allclose(remote_slice.values, local_slice.values)


def test_remote_scene_source_fetches_one_batched_bounded_profile_request() -> None:
    with _runtime_server() as (url, local_source):
        remote = RemoteSceneSource(url, "test-secret", expected_scene_id="remote-hybrid")
        request = SceneProfilesRequest(
            recipe_id="combined-emission",
            profile_axes=("t", "nu"),
            selections={"t": 2, "nu": 1},
            plane_axes=("x", "y"),
            spatial_window={"x": (1, 5), "y": (2, 6)},
            spatial_reduction="integral",
            include_members=True,
            max_output_values=64,
        )
        remote_profiles = asyncio.run(remote.render_profiles(request))
        local_profiles = asyncio.run(local_source.render_profiles(request))
        assert set(remote_profiles.profiles) == {"t", "nu"}
        assert remote_profiles.value_quantity == "flux_density"
        assert remote_profiles.value_unit == "Jy"
        np.testing.assert_allclose(
            remote_profiles.profiles["t"].per_sample,
            local_profiles.profiles["t"].per_sample,
        )


def test_scene_profile_decoder_rejects_non_vector_summary() -> None:
    source = SyntheticHybridSceneSource("profile-wire-rejection")
    rendered = asyncio.run(
        source.render_profiles(
            SceneProfilesRequest(
                recipe_id="combined-emission",
                profile_axes=("t",),
                selections={"t": 0, "nu": 0},
                spatial_window={"x": (0, 2), "y": (0, 2)},
                spatial_reduction="mean",
            )
        )
    )
    envelope = json.loads(encode_scene_profiles_payload(rendered).decode("utf-8"))
    envelope["result"]["profiles"]["t"]["series_mean"] = [[1.0, 2.0]]
    with pytest.raises(RemoteSceneSourceError, match="one-dimensional"):
        decode_scene_profiles_payload(json.dumps(envelope).encode("utf-8"))


def test_scene_slice_decoder_rejects_dense_payload() -> None:
    source = SyntheticHybridSceneSource("dense-wire-rejection")
    rendered = asyncio.run(
        source.render_slice(
            SceneSliceRequest(
                recipe_id="combined-emission",
                plane_axes=("x", "y"),
                selections={"sample": 0, "t": 0, "nu": 0},
            )
        )
    )
    valid = encode_scene_slice_payload(rendered)
    with np.load(BytesIO(valid), allow_pickle=False) as arrays:
        copied = {key: np.asarray(arrays[key]) for key in arrays.files}
    copied["values"] = copied["values"][None, ...]
    buffer = BytesIO()
    np.savez(buffer, **copied)
    with pytest.raises(RemoteSceneSourceError, match="non-2-D"):
        decode_scene_slice_payload(buffer.getvalue())


def test_remote_scene_source_requires_valid_bearer_token() -> None:
    with _runtime_server() as (url, _):
        remote = RemoteSceneSource(url, "wrong-secret", expected_scene_id="remote-hybrid")
        with pytest.raises(RemoteSceneSourceError, match="HTTP 401"):
            asyncio.run(remote.describe_scene())


def test_remote_scene_source_rejects_unknown_protocol_version() -> None:
    with _runtime_server(descriptor_protocol="mobula.scene-source/v999") as (url, _):
        remote = RemoteSceneSource(url, "test-secret", expected_scene_id="remote-hybrid")
        with pytest.raises(RemoteSceneSourceError, match="unsupported Scene source protocol"):
            asyncio.run(remote.describe_scene())


def test_remote_app_factory_registers_source_lazily() -> None:
    with _runtime_server() as (url, _):
        app = create_app(
            scene_source_url=url,
            scene_source_token="test-secret",
            scene_source_id="remote-hybrid",
        )
        with TestClient(app) as client:
            listed = client.get("/api/scenes")
            assert listed.status_code == 200
            assert listed.json()["scenes"][0]["scene_id"] == "remote-hybrid"
            rendered = client.post(
                "/api/scenes/remote-hybrid/views",
                json={"recipe_id": "combined-emission", "target": "combined"},
            )
            assert rendered.status_code == 200
            assert rendered.json()["target_kind"] == "combined"
            data_id = rendered.json()["data_id"]
            sliced = client.get(
                f"/api/datasets/{data_id}/slice",
                params={"t": 0, "nu": 0, "sample_mode": "mean", "plane_x": "x", "plane_y": "y"},
            )
            assert sliced.status_code == 200
            assert sliced.json()["shape"] == [7, 6]
            profiled = client.post(
                f"/api/datasets/{data_id}/profiles-plane",
                json={
                    "plane_x": "x",
                    "plane_y": "y",
                    "u0": 0,
                    "u1": 7,
                    "v0": 0,
                    "v1": 6,
                    "t": 0,
                    "nu": 0,
                },
            )
            assert profiled.status_code == 200
            assert profiled.json()["value_unit"] == "Jy"


def test_layer_wire_identity_distinguishes_component_named_combined(base_dataset) -> None:
    combined = RenderedSceneLayer(
        scene_id="collision-scene",
        recipe_id="emission",
        target_kind="combined",
        target_id="combined",
        dataset=base_dataset,
    )
    component = RenderedSceneLayer(
        scene_id="collision-scene",
        recipe_id="emission",
        target_kind="component",
        target_id="combined",
        dataset=base_dataset,
    )
    decoded_combined = decode_scene_layer_payload(encode_scene_layer_payload(combined))
    decoded_component = decode_scene_layer_payload(encode_scene_layer_payload(component))
    assert (decoded_combined.target_kind, decoded_combined.target_id) == ("combined", "combined")
    assert (decoded_component.target_kind, decoded_component.target_id) == ("component", "combined")


def test_snapshot_cache_key_distinguishes_component_named_combined(tmp_path) -> None:
    source = SyntheticHybridSceneSource("snapshot-collision")
    descriptor = asyncio.run(source.describe_scene())
    transient = next(item for item in descriptor.components if item.component_id == "transient")
    renamed = replace(transient, component_id="combined")
    recipe = descriptor.recipes[0]
    renamed_layers = tuple(
        replace(layer, component_id="combined") if layer.component_id == "transient" else layer
        for layer in recipe.layers
    )
    descriptor = replace(
        descriptor,
        components=tuple(renamed if item.component_id == "transient" else item for item in descriptor.components),
        recipes=(replace(recipe, layers=renamed_layers),),
    )
    descriptor.validate()
    combined = replace(
        asyncio.run(source.render_layer(SceneRenderRequest(recipe_id="combined-emission"))).dataset,
        data_id="same-provider-id",
    )
    component = replace(
        asyncio.run(
            source.render_layer(
                SceneRenderRequest(recipe_id="combined-emission", target="component", component_id="background")
            )
        ).dataset,
        data_id="same-provider-id",
    )
    manifest, _ = write_scene_snapshot(
        tmp_path / "collision.json",
        descriptor,
        {
            ("combined-emission", "combined", "combined"): combined,
            ("combined-emission", "component", "combined"): component,
        },
    )
    snapshot = SnapshotSceneSource(manifest)
    rendered_combined = asyncio.run(snapshot.render_layer(SceneRenderRequest(recipe_id="combined-emission")))
    rendered_component = asyncio.run(
        snapshot.render_layer(
            SceneRenderRequest(recipe_id="combined-emission", target="component", component_id="combined")
        )
    )
    assert rendered_combined.target_kind == "combined"
    assert rendered_component.target_kind == "component"
    assert not np.array_equal(rendered_combined.dataset.values, rendered_component.dataset.values)

    registry = DatasetRegistry()
    registry.add_scene_source(snapshot.scene_id, snapshot)
    cached_combined = asyncio.run(
        registry.render_scene("snapshot-collision", SceneRenderRequest(recipe_id="combined-emission"))
    )
    component_request = SceneRenderRequest(
        recipe_id="combined-emission",
        target="component",
        component_id="combined",
    )
    cached_component = asyncio.run(registry.render_scene("snapshot-collision", component_request))
    cached_component_again = asyncio.run(registry.render_scene("snapshot-collision", component_request))
    assert cached_combined.dataset.data_id != cached_component.dataset.data_id
    assert cached_component_again.dataset is cached_component.dataset
