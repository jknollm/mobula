from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import numpy as np

from mobula.data.schema import CubeDataset
from mobula.service.api_utils import _coordinate_values


@dataclass(slots=True)
class ScalarArrayPayload:
    metadata: dict[str, Any]
    values: np.ndarray


@dataclass(slots=True)
class RgbArrayPayload:
    metadata: dict[str, Any]
    red: np.ndarray
    green: np.ndarray
    blue: np.ndarray


def summarize_array(arr: np.ndarray) -> dict[str, float]:
    return {
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr)),
    }


def serialize_axis_coords(ds: CubeDataset, dims: list[str]) -> dict[str, Any]:
    key = tuple(dims)
    cached = ds._serialized_axis_coords_cache.get(key)
    if cached is not None:
        return cached

    payload: dict[str, Any] = {}
    for dim in key:
        coord_list = ds._coord_list_cache.get(dim)
        if coord_list is None:
            coord_list = _coordinate_values(ds, dim)
            ds._coord_list_cache[dim] = coord_list
        payload[dim] = coord_list
        payload[f"{dim}_unit"] = ds.units[dim]
    ds._serialized_axis_coords_cache[key] = payload
    return payload


def serialize_flat_values(arr: np.ndarray) -> list[float]:
    return np.asarray(arr).ravel().tolist()


def serialize_rgb_values(red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> dict[str, list[float]]:
    return {
        "r": serialize_flat_values(red),
        "g": serialize_flat_values(green),
        "b": serialize_flat_values(blue),
    }


def serialize_scalar_payload_json(payload: ScalarArrayPayload) -> dict[str, Any]:
    return {
        **payload.metadata,
        "values": serialize_flat_values(payload.values),
    }


def serialize_rgb_payload_json(payload: RgbArrayPayload) -> dict[str, Any]:
    return {
        **payload.metadata,
        "values": serialize_rgb_values(payload.red, payload.green, payload.blue),
    }


def encode_scalar_payload_binary(payload: ScalarArrayPayload) -> tuple[bytes, dict[str, str]]:
    values = np.asarray(payload.values, dtype=np.float32)
    metadata = {
        **payload.metadata,
        "transport": "binary-v1",
        "values_dtype": "float32",
        "values_length": int(values.size),
    }
    metadata_bytes = json.dumps(metadata, separators=(",", ":"), allow_nan=False).encode("utf-8")
    padded_len = (len(metadata_bytes) + 3) & ~3
    padding = b"\x00" * (padded_len - len(metadata_bytes))
    header = int(len(metadata_bytes)).to_bytes(4, byteorder="little", signed=False)
    body = header + metadata_bytes + padding + np.ascontiguousarray(values).ravel().tobytes()
    return body, {
        "X-Mobula-Transport": "binary-v1",
        "X-Mobula-Values-Dtype": "float32",
    }


def encode_rgb_payload_binary(payload: RgbArrayPayload) -> tuple[bytes, dict[str, str]]:
    red = np.asarray(payload.red, dtype=np.float32)
    green = np.asarray(payload.green, dtype=np.float32)
    blue = np.asarray(payload.blue, dtype=np.float32)
    if red.shape != green.shape or red.shape != blue.shape:
        raise ValueError("RGB payload channels must have matching shapes")
    metadata = {
        **payload.metadata,
        "transport": "binary-rgb-v1",
        "values_dtype": "float32",
        "values_length": int(red.size),
        "values_channels": 3,
    }
    metadata_bytes = json.dumps(metadata, separators=(",", ":"), allow_nan=False).encode("utf-8")
    padded_len = (len(metadata_bytes) + 3) & ~3
    padding = b"\x00" * (padded_len - len(metadata_bytes))
    header = int(len(metadata_bytes)).to_bytes(4, byteorder="little", signed=False)
    body = (
        header
        + metadata_bytes
        + padding
        + np.ascontiguousarray(red).ravel().tobytes()
        + np.ascontiguousarray(green).ravel().tobytes()
        + np.ascontiguousarray(blue).ravel().tobytes()
    )
    return body, {
        "X-Mobula-Transport": "binary-rgb-v1",
        "X-Mobula-Values-Dtype": "float32",
    }
