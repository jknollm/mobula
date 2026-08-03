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
    RenderedSceneProfileSeries,
    RenderedSceneProfiles,
    RenderedSceneSlice,
    RenderTargetKind,
    SceneDescriptor,
    SceneProfilesRequest,
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


def encode_scene_profiles_payload(rendered: RenderedSceneProfiles) -> bytes:
    """Encode one bounded batched profile result as strict v2 JSON."""
    rendered.validate()
    result = {
        "scene_id": rendered.scene_id,
        "recipe_id": rendered.recipe_id,
        "target_kind": rendered.target_kind,
        "target_id": rendered.target_id,
        "spatial_window": rendered.spatial_window,
        "spatial_reduction": rendered.spatial_reduction,
        "pixel_count": rendered.pixel_count,
        "value_quantity": rendered.value_quantity,
        "value_unit": rendered.value_unit,
        "profiles": {
            axis: {
                "axis": series.axis,
                "axis_unit": series.axis_unit,
                "coords": np.asarray(series.coords).tolist(),
                "series_mean": np.asarray(series.series_mean).tolist(),
                "series_std": np.asarray(series.series_std).tolist(),
                "per_sample": np.asarray(series.per_sample).tolist(),
                "fixed_indices": series.fixed_indices,
            }
            for axis, series in rendered.profiles.items()
        },
    }
    return _json_bytes({"protocol_version": SCENE_SOURCE_PROTOCOL_VERSION, "result": result})


def decode_scene_profiles_payload(payload: bytes) -> RenderedSceneProfiles:
    """Decode a bounded profile response while rejecting higher-dimensional values."""
    try:
        envelope = json.loads(payload.decode("utf-8"))
        if envelope.get("protocol_version") != SCENE_SOURCE_PROTOCOL_VERSION:
            raise RemoteSceneSourceError(f"unsupported Scene source protocol: {envelope.get('protocol_version')}")
        result = dict(envelope["result"])
        profiles: dict[str, RenderedSceneProfileSeries] = {}
        for raw_axis, raw_series in dict(result["profiles"]).items():
            axis = str(raw_axis)
            item = dict(raw_series)
            coords = np.asarray(item["coords"])
            members = np.asarray(item["per_sample"], dtype=np.float64)
            if members.size == 0:
                members = np.empty((0, int(coords.size)), dtype=np.float64)
            series = RenderedSceneProfileSeries(
                axis=str(item["axis"]),
                axis_unit=str(item["axis_unit"]),
                coords=coords,
                series_mean=np.asarray(item["series_mean"], dtype=np.float64),
                series_std=np.asarray(item["series_std"], dtype=np.float64),
                per_sample=members,
                fixed_indices={str(key): int(value) for key, value in dict(item["fixed_indices"]).items()},
            )
            profiles[axis] = series
        target_kind = str(result["target_kind"])
        if target_kind not in {"combined", "component"}:
            raise RemoteSceneSourceError(f"invalid rendered profile target kind: {target_kind}")
        rendered = RenderedSceneProfiles(
            scene_id=str(result["scene_id"]),
            recipe_id=str(result["recipe_id"]),
            target_kind=cast(RenderTargetKind, target_kind),
            target_id=str(result["target_id"]),
            spatial_window={
                str(axis): cast(tuple[int, int], tuple(int(value) for value in bounds))
                for axis, bounds in dict(result["spatial_window"]).items()
            },
            spatial_reduction=str(result["spatial_reduction"]),
            pixel_count=int(result["pixel_count"]),
            value_quantity=str(result["value_quantity"]),
            value_unit=str(result["value_unit"]),
            profiles=profiles,
        )
        rendered.validate()
    except RemoteSceneSourceError:
        raise
    except SceneValidationError as exc:
        raise RemoteSceneSourceError(f"invalid Scene profiles payload: {exc}") from exc
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RemoteSceneSourceError(f"invalid Scene profiles payload: {exc}") from exc
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
        max_profile_bytes: int = 16 * 1024**2,
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
        if max_profile_bytes <= 0:
            raise ValueError("Scene source maximum profile size must be positive")
        self.timeout_seconds = float(timeout_seconds)
        self.max_layer_bytes = int(max_layer_bytes)
        self.max_profile_bytes = int(max_profile_bytes)
        self._descriptor: SceneDescriptor | None = None

    def _request(
        self,
        path: str,
        *,
        body: bytes | None = None,
        accept: str,
        max_bytes: int | None = None,
    ) -> tuple[bytes, str]:
        response_limit = self.max_layer_bytes if max_bytes is None else int(max_bytes)
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
                    if declared_length > response_limit:
                        raise RemoteSceneSourceError("Scene source response exceeds configured size limit")
                payload = response.read(response_limit + 1)
                if len(payload) > response_limit:
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

    async def render_profiles(self, request: SceneProfilesRequest) -> RenderedSceneProfiles:
        request.validate()
        descriptor = await self.describe_scene()
        if descriptor.access.profiles is None:
            raise RemoteSceneSourceError("remote Scene source does not advertise profile access")
        capability = descriptor.access.profiles
        if set(request.profile_axes) - set(capability.axes):
            raise RemoteSceneSourceError("remote Scene source does not advertise the requested profile axes")
        if request.plane_axes != capability.plane_axes:
            raise RemoteSceneSourceError("remote Scene source does not advertise the requested profile plane")
        if request.spatial_reduction not in {item.reduction_id for item in capability.reductions}:
            raise RemoteSceneSourceError("remote Scene source does not advertise the requested profile reduction")
        if request.include_members and not capability.include_members:
            raise RemoteSceneSourceError("remote Scene source does not advertise profile member series")
        if request.max_output_values > capability.max_output_values:
            raise RemoteSceneSourceError("Scene profile request exceeds the advertised output bound")
        recipe = next((item for item in descriptor.recipes if item.recipe_id == request.recipe_id), None)
        if recipe is None:
            raise RemoteSceneSourceError("Scene profile request uses an unknown recipe")
        expected_selections = set(recipe.presentation_axes) - set(request.plane_axes) - {"sample"}
        if set(request.selections) != expected_selections:
            raise RemoteSceneSourceError("Scene profile selections do not exactly cover non-spatial axes")
        request_body = _json_bytes(
            {
                "protocol_version": SCENE_SOURCE_PROTOCOL_VERSION,
                "request": asdict(request),
            }
        )
        payload, content_type = await asyncio.to_thread(
            self._request,
            "profiles",
            body=request_body,
            accept="application/json",
            max_bytes=self.max_profile_bytes,
        )
        if "application/json" not in content_type.lower():
            raise RemoteSceneSourceError(f"Scene profiles have unsupported content type: {content_type or 'missing'}")
        rendered = decode_scene_profiles_payload(payload)
        expected_target = request.component_id if request.target == "component" else "combined"
        if rendered.scene_id != descriptor.scene_id:
            raise RemoteSceneSourceError("rendered profiles Scene identity does not match the descriptor")
        if rendered.recipe_id != request.recipe_id:
            raise RemoteSceneSourceError("rendered profiles recipe does not match the request")
        if rendered.target_kind != request.target or rendered.target_id != expected_target:
            raise RemoteSceneSourceError("rendered profiles target does not match the request")
        reductions = {item.reduction_id: item for item in capability.reductions}
        reduction = reductions.get(request.spatial_reduction)
        if reduction is None:
            raise RemoteSceneSourceError("requested profile reduction is not advertised")
        if rendered.spatial_window != request.spatial_window:
            raise RemoteSceneSourceError("rendered profile spatial window does not match the request")
        if rendered.spatial_reduction != request.spatial_reduction:
            raise RemoteSceneSourceError("rendered profile reduction does not match the request")
        if rendered.value_quantity != reduction.value_quantity or rendered.value_unit != reduction.value_unit:
            raise RemoteSceneSourceError("rendered profile value semantics do not match the descriptor")
        if set(rendered.profiles) != set(request.profile_axes):
            raise RemoteSceneSourceError("Scene source did not return exactly the requested profile axes")
        descriptor_axes = {axis.axis_id: axis for axis in descriptor.axes}
        output_values = 0
        for axis_id, series in rendered.profiles.items():
            axis = descriptor_axes.get(axis_id)
            if axis is None or series.axis_unit != axis.unit or np.asarray(series.coords).size != axis.size:
                raise RemoteSceneSourceError(f"rendered profile axis '{axis_id}' does not match the descriptor")
            expected_fixed = {key: value for key, value in request.selections.items() if key != axis_id}
            if series.fixed_indices != expected_fixed:
                raise RemoteSceneSourceError(f"rendered profile fixed indices for '{axis_id}' do not match the request")
            if not request.include_members and np.asarray(series.per_sample).size:
                raise RemoteSceneSourceError("Scene source returned profile members that were not requested")
            output_values += int(
                np.asarray(series.series_mean).size
                + np.asarray(series.series_std).size
                + np.asarray(series.per_sample).size
            )
        if output_values > request.max_output_values:
            raise RemoteSceneSourceError("rendered Scene profiles exceed the requested output bound")
        return rendered
