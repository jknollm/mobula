from __future__ import annotations

import asyncio
import io
import json
from dataclasses import asdict
from typing import Any, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from zipfile import BadZipFile

import numpy as np

from mobula.data.scene import (
    RenderedSceneLayer,
    RenderedSceneSlice,
    RenderTargetKind,
    SceneDescriptor,
    SceneSliceRequest,
    SceneValidationError,
    scene_descriptor_from_dict,
)
from mobula.data.schema import CubeDataset

SCENE_SOURCE_PROTOCOL_VERSION = "mobula.scene-source/v2"
SCENE_LAYER_MEDIA_TYPE = "application/x-mobula-scene-layer+npz"
SCENE_SLICE_MEDIA_TYPE = "application/x-mobula-scene-slice+npz"
_METADATA_KEY = "__mobula_metadata__"
_VALUES_KEY = "values"
_MASK_KEY = "mask"


class RemoteSceneSourceError(RuntimeError):
    """A remote Scene source violated or could not fulfill the runtime contract."""


def _validated_base_url(source_url: str) -> str:
    raw = str(source_url or "").strip().rstrip("/")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Scene source URL must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Scene source URL must not contain credentials")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")


def encode_scene_layer_payload(layer: RenderedSceneLayer) -> bytes:
    """Encode one rendered presentation layer for the v1 runtime protocol."""
    layer.dataset.validate()
    coordinate_keys = {dim: f"coord_{index}" for index, dim in enumerate(layer.dataset.dims)}
    metadata = {
        "protocol_version": SCENE_SOURCE_PROTOCOL_VERSION,
        "scene_id": layer.scene_id,
        "recipe_id": layer.recipe_id,
        "target_kind": layer.target_kind,
        "target_id": layer.target_id,
        "dataset": {
            "data_id": layer.dataset.data_id,
            "dims": list(layer.dataset.dims),
            "coordinate_keys": coordinate_keys,
            "units": layer.dataset.units,
            "intensity_unit": layer.dataset.intensity_unit,
            "wcs": layer.dataset.wcs,
            "provenance": layer.dataset.provenance,
            "uncertainty": layer.dataset.uncertainty,
            "values_key": _VALUES_KEY,
            "mask_key": _MASK_KEY if layer.dataset.mask is not None else None,
        },
    }
    arrays: dict[str, np.ndarray] = {
        _METADATA_KEY: np.frombuffer(_json_bytes(metadata), dtype=np.uint8),
        _VALUES_KEY: np.asarray(layer.dataset.values),
    }
    for dim, key in coordinate_keys.items():
        arrays[key] = np.asarray(layer.dataset.coords[dim])
    if layer.dataset.mask is not None:
        arrays[_MASK_KEY] = np.asarray(layer.dataset.mask, dtype=bool)
    buffer = io.BytesIO()
    np.savez(buffer, **arrays)
    return buffer.getvalue()


def decode_scene_layer_payload(payload: bytes) -> RenderedSceneLayer:
    """Decode and validate one v1 rendered-layer response without writing a temporary file."""
    try:
        with np.load(io.BytesIO(payload), allow_pickle=False) as arrays:
            metadata_raw = np.asarray(arrays[_METADATA_KEY], dtype=np.uint8).tobytes()
            metadata = json.loads(metadata_raw.decode("utf-8"))
            if metadata.get("protocol_version") != SCENE_SOURCE_PROTOCOL_VERSION:
                raise RemoteSceneSourceError(f"unsupported Scene source protocol: {metadata.get('protocol_version')}")
            dataset_meta = metadata["dataset"]
            dims = tuple(dataset_meta["dims"])
            coordinate_keys = dict(dataset_meta["coordinate_keys"])
            values = np.asarray(arrays[dataset_meta["values_key"]])
            coords = {dim: np.asarray(arrays[coordinate_keys[dim]]) for dim in dims}
            mask_key = dataset_meta.get("mask_key")
            mask = np.asarray(arrays[mask_key], dtype=bool) if mask_key else None
            scene_id = str(metadata["scene_id"])
            recipe_id = str(metadata["recipe_id"])
            target_kind = str(metadata["target_kind"])
            target_id = str(metadata["target_id"])
    except RemoteSceneSourceError:
        raise
    except (BadZipFile, KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RemoteSceneSourceError(f"invalid Scene layer payload: {exc}") from exc

    try:
        dataset = CubeDataset(
            data_id=str(dataset_meta["data_id"]),
            dims=dims,
            coords=coords,
            values=values,
            units={str(key): str(value) for key, value in dict(dataset_meta["units"]).items()},
            intensity_unit=str(dataset_meta["intensity_unit"]),
            wcs=dict(dataset_meta.get("wcs", {})),
            provenance=dict(dataset_meta.get("provenance", {})),
            mask=mask,
            uncertainty=dataset_meta.get("uncertainty"),
        )
        dataset.validate()
    except (KeyError, TypeError, ValueError) as exc:
        raise RemoteSceneSourceError(f"invalid rendered Scene dataset: {exc}") from exc
    if target_kind not in {"combined", "component"}:
        raise RemoteSceneSourceError(f"invalid rendered layer target kind: {target_kind}")
    return RenderedSceneLayer(
        scene_id=scene_id,
        recipe_id=recipe_id,
        target_kind=cast(RenderTargetKind, target_kind),
        target_id=target_id,
        dataset=dataset,
    )


def encode_scene_slice_payload(rendered: RenderedSceneSlice) -> bytes:
    """Encode one bounded 2-D Scene response for the v2 runtime protocol."""
    rendered.validate()
    coordinate_keys = {axis: f"coord_{index}" for index, axis in enumerate(rendered.plane_axes)}
    metadata = {
        "protocol_version": SCENE_SOURCE_PROTOCOL_VERSION,
        "scene_id": rendered.scene_id,
        "recipe_id": rendered.recipe_id,
        "target_kind": rendered.target_kind,
        "target_id": rendered.target_id,
        "slice": {
            "plane_axes": list(rendered.plane_axes),
            "coordinate_keys": coordinate_keys,
            "units": rendered.plane_units,
            "intensity_unit": rendered.intensity_unit,
            "full_shape": list(rendered.full_shape),
            "sampling_step": list(rendered.sampling_step),
            "selected_indices": rendered.selected_indices,
            "selected_coords": rendered.selected_coords,
            "wcs": rendered.wcs,
            "provenance": rendered.provenance,
            "values_key": _VALUES_KEY,
        },
    }
    arrays: dict[str, np.ndarray] = {
        _METADATA_KEY: np.frombuffer(_json_bytes(metadata), dtype=np.uint8),
        _VALUES_KEY: np.asarray(rendered.values),
    }
    for axis, key in coordinate_keys.items():
        arrays[key] = np.asarray(rendered.plane_coords[axis])
    buffer = io.BytesIO()
    np.savez(buffer, **arrays)
    return buffer.getvalue()


def decode_scene_slice_payload(payload: bytes) -> RenderedSceneSlice:
    """Decode a v2 slice while rejecting any dense or higher-dimensional payload."""
    try:
        with np.load(io.BytesIO(payload), allow_pickle=False) as arrays:
            metadata = json.loads(np.asarray(arrays[_METADATA_KEY], dtype=np.uint8).tobytes().decode("utf-8"))
            if metadata.get("protocol_version") != SCENE_SOURCE_PROTOCOL_VERSION:
                raise RemoteSceneSourceError(f"unsupported Scene source protocol: {metadata.get('protocol_version')}")
            slice_meta = dict(metadata["slice"])
            plane_axes = tuple(slice_meta["plane_axes"])
            if len(plane_axes) != 2:
                raise RemoteSceneSourceError("Scene slice response must name exactly two plane axes")
            coordinate_keys = dict(slice_meta["coordinate_keys"])
            values = np.asarray(arrays[slice_meta["values_key"]])
            if values.ndim != 2:
                raise RemoteSceneSourceError(f"Scene source returned a non-2-D payload with shape {values.shape}")
            plane_coords = {axis: np.asarray(arrays[coordinate_keys[axis]]) for axis in plane_axes}
            plane_units = {str(axis): str(unit) for axis, unit in dict(slice_meta["units"]).items()}
            target_kind = str(metadata["target_kind"])
            if target_kind not in {"combined", "component"}:
                raise RemoteSceneSourceError(f"invalid rendered slice target kind: {target_kind}")
            rendered = RenderedSceneSlice(
                scene_id=str(metadata["scene_id"]),
                recipe_id=str(metadata["recipe_id"]),
                target_kind=cast(RenderTargetKind, target_kind),
                target_id=str(metadata["target_id"]),
                plane_axes=cast(tuple[str, str], plane_axes),
                values=values,
                plane_coords=plane_coords,
                plane_units=plane_units,
                full_shape=cast(tuple[int, int], tuple(int(value) for value in slice_meta["full_shape"])),
                sampling_step=cast(tuple[int, int], tuple(int(value) for value in slice_meta["sampling_step"])),
                selected_indices={str(key): int(value) for key, value in dict(slice_meta["selected_indices"]).items()},
                selected_coords=dict(slice_meta["selected_coords"]),
                intensity_unit=str(slice_meta["intensity_unit"]),
                wcs=dict(slice_meta.get("wcs", {})),
                provenance=dict(slice_meta.get("provenance", {})),
            )
            rendered.validate()
    except RemoteSceneSourceError:
        raise
    except SceneValidationError as exc:
        raise RemoteSceneSourceError(f"invalid Scene slice payload: {exc}") from exc
    except (BadZipFile, KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RemoteSceneSourceError(f"invalid Scene slice payload: {exc}") from exc
    return rendered


class RemoteSceneSource:
    """Authenticated asynchronous SceneSource backed by a local HTTP runtime."""

    def __init__(
        self,
        source_url: str,
        token: str,
        *,
        expected_scene_id: str,
        timeout_seconds: float = 300.0,
        max_layer_bytes: int = 256 * 1024**2,
    ) -> None:
        self.source_url = _validated_base_url(source_url)
        self._token = str(token or "").strip()
        if not self._token:
            raise ValueError("Scene source bearer token must not be empty")
        self.expected_scene_id = str(expected_scene_id or "").strip()
        if not self.expected_scene_id:
            raise ValueError("expected Scene id must not be empty")
        if timeout_seconds <= 0:
            raise ValueError("Scene source timeout must be positive")
        if max_layer_bytes <= 0:
            raise ValueError("Scene source maximum layer size must be positive")
        self.timeout_seconds = float(timeout_seconds)
        self.max_layer_bytes = int(max_layer_bytes)
        self._descriptor: SceneDescriptor | None = None

    def _request(self, path: str, *, body: bytes | None = None, accept: str) -> tuple[bytes, str]:
        headers = {
            "Accept": accept,
            "Authorization": f"Bearer {self._token}",
            "X-Mobula-Scene-Protocol": SCENE_SOURCE_PROTOCOL_VERSION,
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(
            f"{self.source_url}/{path.lstrip('/')}",
            data=body,
            headers=headers,
            method="POST" if body is not None else "GET",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                content_length = response.headers.get("Content-Length")
                if content_length is not None:
                    try:
                        declared_length = int(content_length)
                    except ValueError as exc:
                        raise RemoteSceneSourceError("Scene source returned invalid Content-Length") from exc
                    if declared_length < 0:
                        raise RemoteSceneSourceError("Scene source returned invalid Content-Length")
                    if declared_length > self.max_layer_bytes:
                        raise RemoteSceneSourceError("Scene source response exceeds configured size limit")
                payload = response.read(self.max_layer_bytes + 1)
                if len(payload) > self.max_layer_bytes:
                    raise RemoteSceneSourceError("Scene source response exceeds configured size limit")
                return payload, str(response.headers.get("Content-Type", ""))
        except RemoteSceneSourceError:
            raise
        except HTTPError as exc:
            raise RemoteSceneSourceError(f"Scene source returned HTTP {exc.code}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise RemoteSceneSourceError(
                f"Scene source request failed: {exc.reason if isinstance(exc, URLError) else exc}"
            ) from exc

    async def describe_scene(self) -> SceneDescriptor:
        if self._descriptor is not None:
            return self._descriptor
        payload, content_type = await asyncio.to_thread(
            self._request,
            "descriptor",
            accept="application/json",
        )
        if "application/json" not in content_type.lower():
            raise RemoteSceneSourceError(f"Scene descriptor has unsupported content type: {content_type or 'missing'}")
        try:
            envelope = json.loads(payload.decode("utf-8"))
            if envelope.get("protocol_version") != SCENE_SOURCE_PROTOCOL_VERSION:
                raise RemoteSceneSourceError(f"unsupported Scene source protocol: {envelope.get('protocol_version')}")
            descriptor = scene_descriptor_from_dict(envelope["descriptor"])
        except RemoteSceneSourceError:
            raise
        except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RemoteSceneSourceError(f"invalid Scene descriptor response: {exc}") from exc
        if descriptor.scene_id != self.expected_scene_id:
            raise RemoteSceneSourceError(
                f"Scene source returned '{descriptor.scene_id}', expected '{self.expected_scene_id}'"
            )
        if descriptor.access.mode != "slice":
            raise RemoteSceneSourceError("remote Scene source must advertise sparse slice access")
        if descriptor.access.protocol_version != SCENE_SOURCE_PROTOCOL_VERSION:
            raise RemoteSceneSourceError(
                f"Scene access advertises unsupported protocol: {descriptor.access.protocol_version}"
            )
        if descriptor.access.full_render:
            raise RemoteSceneSourceError("remote Scene source must not advertise dense full rendering")
        self._descriptor = descriptor
        return descriptor

    async def render_slice(self, request: SceneSliceRequest) -> RenderedSceneSlice:
        request.validate()
        descriptor = await self.describe_scene()
        request_body = _json_bytes(
            {
                "protocol_version": SCENE_SOURCE_PROTOCOL_VERSION,
                "request": asdict(request),
            }
        )
        payload, content_type = await asyncio.to_thread(
            self._request,
            "slice",
            body=request_body,
            accept=SCENE_SLICE_MEDIA_TYPE,
        )
        if SCENE_SLICE_MEDIA_TYPE not in content_type.lower():
            raise RemoteSceneSourceError(f"Scene slice has unsupported content type: {content_type or 'missing'}")
        rendered = decode_scene_slice_payload(payload)
        expected_target = request.component_id if request.target == "component" else "combined"
        if rendered.scene_id != descriptor.scene_id:
            raise RemoteSceneSourceError("rendered slice Scene identity does not match the descriptor")
        if rendered.recipe_id != request.recipe_id:
            raise RemoteSceneSourceError("rendered slice recipe does not match the request")
        if rendered.target_kind != request.target or rendered.target_id != expected_target:
            raise RemoteSceneSourceError("rendered slice target does not match the request")
        if rendered.plane_axes != request.plane_axes:
            raise RemoteSceneSourceError("rendered slice plane axes do not match the request")
        descriptor_axes = {axis.axis_id: axis for axis in descriptor.axes}
        expected_units = {axis: descriptor_axes[axis].unit for axis in request.plane_axes}
        if rendered.plane_units != expected_units:
            raise RemoteSceneSourceError("rendered slice plane units do not match the descriptor")
        if request.max_pixels is not None and rendered.values.size > request.max_pixels:
            raise RemoteSceneSourceError("rendered Scene slice exceeds the requested pixel bound")
        return rendered
