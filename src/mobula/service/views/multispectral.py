from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.acceleration import (
    MultispectralComputeRequest,
    execute_multispectral_compute,
    normalize_compute_backend_mode,
)
from mobula.service.acceleration.multispectral_common import normalize_total_flux_brightness_xp
from mobula.service.api_models import SampleMode
from mobula.service.api_utils import (
    _apply_sample_mode_reduction,
    _clamp_dim_bounds,
    _downsample_2d,
    _index_or_mid,
    _project_dims_by_mean,
    _uses_sample_reduction,
)
from mobula.service.perf import StageTimings
from mobula.service.spectral_rgb import build_visible_wavelength_axis, convert_mf_to_rgb_new
from mobula.service.views.serialization import serialize_rgb_values


def _normalize_total_flux_brightness(
    total_flux: np.ndarray,
    *,
    intensity_mode: str,
    clip_min: float,
    clip_max: float,
    dynamic_range: float = 2.5e3,
) -> np.ndarray:
    return np.asarray(
        normalize_total_flux_brightness_xp(
            total_flux,
            intensity_mode=intensity_mode,
            clip_min=clip_min,
            clip_max=clip_max,
            xp=np,
            dynamic_range=dynamic_range,
        ),
        dtype=np.float64,
    )


def _normalize_total_flux_brightness_xp(
    total_flux: Any,
    *,
    intensity_mode: str,
    clip_min: float,
    clip_max: float,
    xp: Any,
    dynamic_range: float = 2.5e3,
) -> Any:
    return normalize_total_flux_brightness_xp(
        total_flux,
        intensity_mode=intensity_mode,
        clip_min=clip_min,
        clip_max=clip_max,
        xp=xp,
        dynamic_range=dynamic_range,
    )


def build_multispectral_response(
    ds: CubeDataset,
    *,
    sample: int | None,
    pol: int | None,
    t: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    nu0: int | None,
    nu1: int | None,
    max_pixels: int | None,
    sample_mode: SampleMode,
    plane_x: str,
    plane_y: str,
    nu_axis_scale: str = "linear",
    deslope: float = 0.0,
    normalize_spectrum: bool = False,
    normalize_spectrum_boost: float = 1.0,
    intensity_scale: str = "linear",
    range_min: float = 0.0,
    range_max: float = 100.0,
    compute_backend: str = "auto",
    project_dims: tuple[str, ...] = (),
) -> dict[str, Any]:
    if "nu" not in ds.dims:
        raise HTTPException(status_code=400, detail="dataset has no 'nu' axis")
    if plane_x == plane_y:
        raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
    if "nu" in (plane_x, plane_y):
        raise HTTPException(status_code=400, detail="multispectral view requires plane without 'nu'")
    for plane_dim in (plane_x, plane_y):
        if plane_dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"plane dim '{plane_dim}' not in dataset")
    projected = {dim for dim in project_dims}
    for dim in projected:
        if dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"project dim '{dim}' not in dataset")
        if dim in {plane_x, plane_y, "nu"}:
            raise HTTPException(status_code=400, detail=f"cannot project multispectral dim '{dim}'")

    axis_scale = str(nu_axis_scale or "linear").strip().lower()
    if axis_scale not in {"linear", "log"}:
        raise HTTPException(status_code=400, detail="nu_axis_scale must be 'linear' or 'log'")
    if not np.isfinite(deslope):
        raise HTTPException(status_code=400, detail="deslope must be finite")
    if not np.isfinite(normalize_spectrum_boost):
        raise HTTPException(status_code=400, detail="normalize_spectrum_boost must be finite")
    normalize_boost = float(normalize_spectrum_boost)
    if normalize_boost < 0.25 or normalize_boost > 8.0:
        raise HTTPException(status_code=400, detail="normalize_spectrum_boost must be in [0.25, 8.0]")
    intensity_mode = str(intensity_scale or "linear").strip().lower()
    if intensity_mode not in {"linear", "sqrt", "log"}:
        raise HTTPException(status_code=400, detail="intensity_scale must be 'linear', 'sqrt', or 'log'")
    if not np.isfinite(range_min) or not np.isfinite(range_max):
        raise HTTPException(status_code=400, detail="range_min/range_max must be finite")
    if range_max <= range_min:
        raise HTTPException(status_code=400, detail="range_max must be larger than range_min")
    try:
        compute_backend_mode = normalize_compute_backend_mode(compute_backend)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    clip_min = float(np.clip(range_min / 100.0, 0.0, 1.0))
    clip_max = float(np.clip(range_max / 100.0, 0.0, 1.0))
    requested = {"sample": sample, "pol": pol, "t": t, "x": x, "y": y, "z": z}

    timings = StageTimings(
        [
            "extraction_and_axis_projection",
            "preview_downsampling",
            "spectrum_normalization",
            "deslope_weighting",
            "chroma_preparation",
            "spectral_to_rgb_conversion",
            "brightness_scaling",
            "serialization",
        ]
    )

    with timings.stage("extraction_and_axis_projection"):
        slicer: list[int | slice] = []
        arr_dims: list[str] = []
        selected_indices: dict[str, int] = {}
        for dim in ds.dims:
            if dim == "nu" or dim in (plane_x, plane_y):
                slicer.append(slice(None))
                arr_dims.append(dim)
                continue
            if dim in projected:
                slicer.append(slice(None))
                arr_dims.append(dim)
                continue
            if dim == "sample" and _uses_sample_reduction(sample_mode):
                slicer.append(slice(None))
                arr_dims.append(dim)
                continue
            idx = _index_or_mid(ds, dim, requested.get(dim))
            selected_indices[dim] = idx
            slicer.append(idx)

        arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
        arr, arr_dims = _apply_sample_mode_reduction(arr, arr_dims, sample_mode, cast_float32=True)
        arr, arr_dims = _project_dims_by_mean(arr, arr_dims, projected, selected_indices, cast_float32=True)

        expected = ["nu", plane_x, plane_y]
        if sorted(arr_dims) != sorted(expected):
            raise HTTPException(status_code=500, detail=f"multispectral dims mismatch: {arr_dims}")
        if arr_dims != expected:
            perm = [arr_dims.index(dim) for dim in expected]
            arr = np.transpose(arr, perm)

        full_nu = arr.shape[0]
        lo = 0 if nu0 is None else nu0
        hi = full_nu if nu1 is None else nu1
        lo, hi = _clamp_dim_bounds(ds, "nu", lo, hi)
        arr = arr[lo:hi]

        n_nu = arr.shape[0]
        if n_nu < 3:
            raise HTTPException(status_code=400, detail="need at least 3 spectral channels for multispectral RGB")
        nu_coords = np.asarray(ds.coords["nu"], dtype=np.float64).reshape(-1)[lo:hi]

    full_shape = [int(arr.shape[1]), int(arr.shape[2])]
    with timings.stage("preview_downsampling"):
        _, sampling_step = _downsample_2d(arr[0], max_pixels)
        if sampling_step != (1, 1):
            arr = arr[:, :: sampling_step[0], :: sampling_step[1]]
    preview_active = sampling_step != (1, 1)

    wavelength_axis_nm, axis_scale_applied = build_visible_wavelength_axis(nu_coords, axis_scale=axis_scale)
    compute_request = MultispectralComputeRequest(
        spectral_cube=arr,
        wavelength_axis_nm=wavelength_axis_nm,
        nu_coords=nu_coords,
        intensity_mode=intensity_mode,
        clip_min=clip_min,
        clip_max=clip_max,
        deslope=float(deslope),
        normalize_spectrum=bool(normalize_spectrum),
        normalize_boost=normalize_boost,
    )
    execution = execute_multispectral_compute(compute_request, requested_mode=compute_backend_mode)
    timings.merge(execution.result.stage_timings_ms)

    sort_idx = np.argsort(nu_coords)
    nu_sorted = nu_coords[sort_idx]
    if axis_scale_applied == "log":
        axis_sorted = np.log10(np.maximum(nu_sorted, np.finfo(np.float64).tiny))
    else:
        axis_sorted = nu_sorted
    finite_axis = np.isfinite(axis_sorted)
    if np.any(finite_axis):
        axis_min = float(np.min(axis_sorted[finite_axis]))
        axis_max = float(np.max(axis_sorted[finite_axis]))
    else:
        axis_min = 0.0
        axis_max = float(nu_coords.size - 1)
        axis_sorted = np.linspace(axis_min, axis_max, nu_coords.size, dtype=np.float64)

    if axis_max <= axis_min:
        edge_1 = max(1, nu_coords.size // 3)
        edge_2 = max(edge_1 + 1, (2 * nu_coords.size) // 3)
        edge_2 = min(edge_2, nu_coords.size - 1)
    else:
        edges_targets = np.linspace(axis_min, axis_max, 4, dtype=np.float64)
        edge_1 = int(np.searchsorted(axis_sorted, edges_targets[1], side="right"))
        edge_2 = int(np.searchsorted(axis_sorted, edges_targets[2], side="right"))
        edge_1 = max(1, min(edge_1, nu_coords.size - 2))
        edge_2 = max(edge_1 + 1, min(edge_2, nu_coords.size - 1))

    band_indices = [sort_idx[:edge_1], sort_idx[edge_1:edge_2], sort_idx[edge_2:]]
    band_chunks: list[dict[str, Any]] = []
    for idx in band_indices:
        band_nu = nu_coords[idx]
        nu_lo = float(np.min(band_nu))
        nu_hi = float(np.max(band_nu))
        band_chunks.append({"center": 0.5 * (nu_lo + nu_hi), "lo": nu_lo, "hi": nu_hi})
    band_chunks.sort(key=lambda item: float(item["center"]))
    red_band, green_band, blue_band = band_chunks

    with timings.stage("serialization"):
        values = serialize_rgb_values(execution.result.red, execution.result.green, execution.result.blue)

    return {
        "data_id": ds.data_id,
        "plane_dims": [plane_x, plane_y],
        "shape": [int(execution.result.red.shape[0]), int(execution.result.red.shape[1])],
        "full_shape": full_shape,
        "sampling_step": [int(sampling_step[0]), int(sampling_step[1])],
        "sample_mode": sample_mode,
        "selected_indices": selected_indices,
        "bands": {
            "red": [float(red_band["lo"]), float(red_band["hi"])],
            "green": [float(green_band["lo"]), float(green_band["hi"])],
            "blue": [float(blue_band["lo"]), float(blue_band["hi"])],
            "unit": ds.units.get("nu", "Hz"),
            "axis_scale": axis_scale_applied,
            "deslope": float(deslope),
            "deslope_ref": execution.result.deslope_ref,
            "normalize_spectrum": bool(normalize_spectrum),
            "normalize_spectrum_boost": float(normalize_boost),
            "brightness_mode": "total_flux",
            "clip_mode": "brightness_only",
            "intensity_scale": intensity_mode,
            "range_min": float(range_min),
            "range_max": float(range_max),
            "compute_backend_requested": execution.requested_mode,
            "compute_backend_used": execution.backend_used,
            "compute_backend": execution.backend_used,
            "fallback_reason": execution.fallback_reason,
            "capability_snapshot": execution.capability_snapshot,
            "preview_active": preview_active,
            "stage_timings_ms": timings.snapshot(),
        },
        "values": values,
    }


__all__ = [
    "_normalize_total_flux_brightness",
    "_normalize_total_flux_brightness_xp",
    "build_multispectral_response",
    "convert_mf_to_rgb_new",
]
