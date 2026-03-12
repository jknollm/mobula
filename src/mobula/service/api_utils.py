from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.api_models import RangeMode, SampleMode
from mobula.service.registry import DatasetRegistry

_SAMPLE_REDUCTION_MODES = frozenset({"mean", "std", "rel_uncert"})


def _safe_dataset(registry: DatasetRegistry, data_id: str) -> CubeDataset:
    dataset, _ = _safe_dataset_with_perf(registry, data_id)
    return dataset


def _safe_dataset_with_perf(registry: DatasetRegistry, data_id: str) -> tuple[CubeDataset, dict[str, object]]:
    try:
        return registry.get_with_stats(data_id)
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


def _is_power_of_two(v: int) -> bool:
    return v > 0 and (v & (v - 1)) == 0


def _healpix_nside_from_npix(npix: int) -> int | None:
    if npix < 12 or npix % 12 != 0:
        return None
    nside_f = np.sqrt(npix / 12.0)
    nside = int(round(float(nside_f)))
    if nside * nside * 12 != npix:
        return None
    if not _is_power_of_two(nside):
        return None
    return nside


def _parse_healpix_ordering(ds: CubeDataset) -> str:
    candidates = [
        ds.wcs.get("healpix_ordering"),
        ds.wcs.get("healpix_order"),
        ds.wcs.get("ordering"),
        ds.wcs.get("order"),
        ds.provenance.get("healpix_ordering"),
        ds.provenance.get("healpix_order"),
        ds.provenance.get("ordering"),
        ds.provenance.get("order"),
    ]
    for raw in candidates:
        if raw is None:
            continue
        txt = str(raw).strip().lower()
        if "nest" in txt:
            return "nested"
        if "ring" in txt:
            return "ring"
    return "ring"


def _sphere_summary(ds: CubeDataset) -> dict[str, Any] | None:
    if "x" not in ds.dims or "y" not in ds.dims:
        return None
    x_size = int(_dim_size(ds, "x"))
    y_size = int(_dim_size(ds, "y"))
    if y_size != 1:
        return None
    nside = _healpix_nside_from_npix(x_size)
    if nside is None:
        return None
    return {
        "kind": "healpix",
        "active": True,
        "npix": x_size,
        "nside": nside,
        "ordering": _parse_healpix_ordering(ds),
    }


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


def _uses_sample_reduction(sample_mode: SampleMode) -> bool:
    return sample_mode in _SAMPLE_REDUCTION_MODES


def _relative_uncertainty(mean_arr: np.ndarray, std_arr: np.ndarray) -> np.ndarray:
    # Relative uncertainty is sigma / |mu| with a small floor to avoid divide-by-zero blowups.
    return std_arr / np.maximum(np.abs(mean_arr), 1.0e-8)


def _apply_sample_mode_reduction(
    arr: np.ndarray,
    arr_dims: list[str],
    sample_mode: SampleMode,
    *,
    cast_float32: bool = True,
) -> tuple[np.ndarray, list[str]]:
    """Apply sample-axis reduction for mean/std/rel_uncert modes."""
    if not _uses_sample_reduction(sample_mode) or "sample" not in arr_dims:
        return arr, arr_dims

    sample_axis = arr_dims.index("sample")
    if sample_mode == "mean":
        arr = arr.mean(axis=sample_axis, dtype=np.float64)
    elif sample_mode == "std":
        arr = arr.std(axis=sample_axis, dtype=np.float64)
    else:
        mean_arr = arr.mean(axis=sample_axis, dtype=np.float64)
        std_arr = arr.std(axis=sample_axis, dtype=np.float64)
        arr = _relative_uncertainty(mean_arr, std_arr)

    if cast_float32:
        arr = arr.astype(np.float32)
    return arr, [dim for dim in arr_dims if dim != "sample"]


def _project_dims_by_mean(
    arr: np.ndarray,
    arr_dims: list[str],
    projected: set[str],
    selected_indices: dict[str, int],
    *,
    cast_float32: bool = True,
) -> tuple[np.ndarray, list[str]]:
    """Project requested dimensions by mean-reduction, preserving output dim order."""
    reduce_axes = tuple(axis for axis, dim in enumerate(arr_dims) if dim in projected)
    if not reduce_axes:
        return arr, arr_dims

    arr = arr.mean(axis=reduce_axes, dtype=np.float64)
    if cast_float32:
        arr = arr.astype(np.float32)

    for dim in projected:
        selected_indices.pop(dim, None)
    return arr, [dim for dim in arr_dims if dim not in projected]


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
