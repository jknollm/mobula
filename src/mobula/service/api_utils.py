from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.api_models import RangeMode, SampleMode
from mobula.service.registry import DatasetRegistry


def _safe_dataset(registry: DatasetRegistry, data_id: str) -> CubeDataset:
    try:
        return registry.get(data_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _dim_size(ds: CubeDataset, dim: str) -> int:
    return ds.shape[ds.dim_index(dim)]


def _index_or_mid(ds: CubeDataset, dim: str, candidate: int | None) -> int:
    size = _dim_size(ds, dim)
    if size < 1:
        raise HTTPException(status_code=400, detail=f"dimension '{dim}' has zero length")
    idx = size // 2 if candidate is None else candidate
    if idx < 0 or idx >= size:
        raise HTTPException(
            status_code=400,
            detail=f"index for dim '{dim}' out of bounds: {idx} (size={size})",
        )
    return idx


def _coords_summary(ds: CubeDataset) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for dim in ds.dims:
        c = np.asarray(ds.coords[dim])
        out[dim] = {
            "size": int(c.shape[0]),
            "unit": ds.units[dim],
            "min": float(c.min()) if c.size else None,
            "max": float(c.max()) if c.size else None,
        }
    return out


def _parse_sample_mode(mode: str) -> SampleMode:
    lowered = mode.strip().lower()
    if lowered not in {"single", "mean", "std", "rel_uncert"}:
        raise HTTPException(status_code=400, detail=f"invalid sample_mode: {mode}")
    return lowered  # type: ignore[return-value]


def _parse_range_mode(mode: str) -> RangeMode:
    lowered = mode.strip().lower()
    if lowered not in {"none", "time", "spectral", "time_spectral", "space", "full"}:
        raise HTTPException(status_code=400, detail=f"invalid range_mode: {mode}")
    return lowered  # type: ignore[return-value]


def _relative_uncertainty(mean_arr: np.ndarray, std_arr: np.ndarray) -> np.ndarray:
    # Relative uncertainty is sigma / |mu| with a small floor to avoid divide-by-zero blowups.
    return std_arr / np.maximum(np.abs(mean_arr), 1.0e-8)


def _downsample_2d(arr: np.ndarray, max_pixels: int | None) -> tuple[np.ndarray, tuple[int, int]]:
    if max_pixels is None or max_pixels < 1:
        return arr, (1, 1)
    if arr.ndim != 2:
        raise ValueError(f"_downsample_2d expects 2D input, got rank {arr.ndim}")
    h0, h1 = int(arr.shape[0]), int(arr.shape[1])
    total = h0 * h1
    if total <= max_pixels:
        return arr, (1, 1)
    step = max(1, int(np.ceil(np.sqrt(total / float(max_pixels)))))
    step0 = min(step, h0)
    step1 = min(step, h1)
    return arr[::step0, ::step1], (step0, step1)


def _clamp_roi_bounds(ds: CubeDataset, x0: int, x1: int, y0: int, y1: int) -> tuple[int, int, int, int]:
    x_size = _dim_size(ds, "x")
    y_size = _dim_size(ds, "y")
    cx0 = max(0, min(x0, x_size))
    cx1 = max(0, min(x1, x_size))
    cy0 = max(0, min(y0, y_size))
    cy1 = max(0, min(y1, y_size))
    if cx1 <= cx0 or cy1 <= cy0:
        raise HTTPException(status_code=400, detail="invalid ROI bounds")
    return cx0, cx1, cy0, cy1


def _clamp_dim_bounds(ds: CubeDataset, dim: str, a0: int, a1: int) -> tuple[int, int]:
    size = _dim_size(ds, dim)
    c0 = max(0, min(a0, size))
    c1 = max(0, min(a1, size))
    if c1 <= c0:
        raise HTTPException(status_code=400, detail=f"invalid bounds for dim '{dim}'")
    return c0, c1

