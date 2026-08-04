from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.scene import RenderedSceneSlice
from mobula.data.schema import CubeDataset
from mobula.service.acceleration import (
    MultispectralComputeRequest,
    execute_multispectral_compute,
    normalize_compute_backend_mode,
    probe_compute_capabilities,
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

_ROBUST_CONFIDENCE_FLOOR = 0.015
_ROBUST_SPECTRAL_INDEX_RANGE = (-4.0, 4.0)
_BRIGHTNESS_REFERENCE_QUANTILE = 0.995
_SPECTRAL_INDEX_COLOR_STOPS = np.asarray(
    [
        [0.324840, 0.383664, 0.783141],
        [0.079839, 0.490539, 0.445883],
        [0.439739, 0.414254, 0.141791],
        [0.778867, 0.311719, 0.158882],
    ],
    dtype=np.float64,
)


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


def _smoothstep(values: np.ndarray, edge0: float, edge1: float) -> np.ndarray:
    if edge1 <= edge0:
        return (values >= edge1).astype(np.float64)
    t = np.clip((values - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _spectral_index_map(spectral_cube: np.ndarray, nu_coords: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fit ``I(nu) proportional to nu**alpha`` independently per pixel."""
    arr = np.asarray(spectral_cube, dtype=np.float64)
    nu = np.asarray(nu_coords, dtype=np.float64).reshape(-1)
    if arr.ndim != 3 or arr.shape[0] != nu.size:
        raise ValueError("spectral-index fit requires a (nu, x, y) cube")
    valid_nu = np.isfinite(nu) & (nu > 0.0)
    x = np.zeros_like(nu)
    if np.any(valid_nu):
        ref = float(np.median(nu[valid_nu]))
        x[valid_nu] = np.log(nu[valid_nu] / ref)

    valid = np.isfinite(arr) & (arr > 0.0) & valid_nu[:, np.newaxis, np.newaxis]
    y = np.zeros_like(arr)
    np.log(arr, out=y, where=valid)
    weights = valid.astype(np.float64)
    x3 = x[:, np.newaxis, np.newaxis]
    count = np.sum(weights, axis=0)
    sum_x = np.sum(weights * x3, axis=0)
    sum_y = np.sum(weights * y, axis=0)
    sum_xx = np.sum(weights * x3 * x3, axis=0)
    sum_xy = np.sum(weights * x3 * y, axis=0)
    denominator = count * sum_xx - sum_x * sum_x
    fit_valid = (count >= 3.0) & np.isfinite(denominator) & (denominator > 1.0e-14)
    alpha = np.zeros(arr.shape[1:], dtype=np.float64)
    numerator = count * sum_xy - sum_x * sum_y
    np.divide(numerator, denominator, out=alpha, where=fit_valid)
    fit_valid &= np.isfinite(alpha)
    return alpha, fit_valid


def _spectral_index_rgb(
    alpha: np.ndarray,
    valid: np.ndarray,
    brightness: np.ndarray,
    *,
    spectral_index_min: float,
    spectral_index_max: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Map clipped spectral index to a constant-lightness palette and brightness."""
    if spectral_index_max <= spectral_index_min:
        raise ValueError("spectral_index_max must be larger than spectral_index_min")
    alpha_arr = np.asarray(alpha, dtype=np.float64)
    valid_arr = np.asarray(valid, dtype=bool)
    brightness_arr = np.clip(np.asarray(brightness, dtype=np.float64), 0.0, 1.0)
    if alpha_arr.shape != brightness_arr.shape or valid_arr.shape != brightness_arr.shape:
        raise ValueError("spectral-index color inputs must have matching shapes")

    position = np.clip(
        (alpha_arr - float(spectral_index_min)) / (float(spectral_index_max) - float(spectral_index_min)),
        0.0,
        1.0,
    )
    scaled = position * (_SPECTRAL_INDEX_COLOR_STOPS.shape[0] - 1)
    lower = np.minimum(np.floor(scaled).astype(np.int64), _SPECTRAL_INDEX_COLOR_STOPS.shape[0] - 2)
    fraction = scaled - lower
    base = (
        _SPECTRAL_INDEX_COLOR_STOPS[lower] * (1.0 - fraction[:, :, np.newaxis])
        + _SPECTRAL_INDEX_COLOR_STOPS[lower + 1] * fraction[:, :, np.newaxis]
    )
    palette_luma = 0.4
    rgb = base * brightness_arr[:, :, np.newaxis]
    rgb[~valid_arr] = palette_luma * brightness_arr[~valid_arr, np.newaxis]
    rgb = np.clip(rgb, 0.0, 1.0)
    return rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]


def _apply_spectral_artifact_control(
    red: np.ndarray,
    green: np.ndarray,
    blue: np.ndarray,
    spectral_cube: np.ndarray,
    nu_coords: np.ndarray,
    *,
    artifact_mode: str,
    confidence_floor: float,
    spectral_index_min: float,
    spectral_index_max: float,
    faint_behavior: str,
    brightness_reference: float | None = None,
    spectral_index_available: bool = True,
    spectral_index_result: tuple[np.ndarray, np.ndarray] | None = None,
    spectral_range_role: str = "confidence",
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    mode = str(artifact_mode or "robust").strip().lower()
    behavior = str(faint_behavior or "desaturate").strip().lower()
    if mode not in {"robust", "manual", "off"}:
        raise HTTPException(status_code=400, detail="artifact_mode must be 'robust', 'manual', or 'off'")
    if behavior not in {"desaturate", "hide"}:
        raise HTTPException(status_code=400, detail="faint_behavior must be 'desaturate' or 'hide'")
    if spectral_range_role not in {"confidence", "color"}:
        raise HTTPException(status_code=400, detail="spectral_range_role must be 'confidence' or 'color'")
    if not np.isfinite(confidence_floor) or confidence_floor < 0.0 or confidence_floor > 1.0:
        raise HTTPException(status_code=400, detail="artifact_confidence_floor must be in [0, 1]")
    if not np.isfinite(spectral_index_min) or not np.isfinite(spectral_index_max):
        raise HTTPException(status_code=400, detail="spectral-index bounds must be finite")
    if spectral_index_max <= spectral_index_min:
        raise HTTPException(status_code=400, detail="spectral_index_max must be larger than spectral_index_min")
    if brightness_reference is not None and (
        not np.isfinite(brightness_reference) or brightness_reference <= 0.0
    ):
        raise HTTPException(status_code=400, detail="artifact_brightness_reference must be positive and finite")

    effective_floor = float(confidence_floor)
    effective_min = float(spectral_index_min)
    effective_max = float(spectral_index_max)
    effective_behavior = behavior
    if mode == "robust":
        effective_floor = _ROBUST_CONFIDENCE_FLOOR
        if spectral_range_role == "confidence":
            effective_min, effective_max = _ROBUST_SPECTRAL_INDEX_RANGE
        effective_behavior = "desaturate"

    diagnostics: dict[str, Any] = {
        "artifact_mode": mode,
        "artifact_confidence_floor": effective_floor,
        "spectral_index_min": effective_min,
        "spectral_index_max": effective_max,
        "faint_behavior": effective_behavior,
        "artifact_affected_fraction": 0.0,
        "spectral_index_available": bool(spectral_index_available),
        "spectral_index_range_role": spectral_range_role,
        "spectral_index_valid_fraction": 1.0 if spectral_index_available else 0.0,
        "brightness_reference_quantile": _BRIGHTNESS_REFERENCE_QUANTILE,
        "brightness_reference": float(brightness_reference) if brightness_reference is not None else None,
        "artifact_compute_backend": "numpy-cpu",
    }
    if spectral_index_available and spectral_index_result is not None:
        diagnostics["spectral_index_valid_fraction"] = float(np.mean(spectral_index_result[1]))
    if mode == "off":
        return red, green, blue, diagnostics

    if spectral_index_available:
        alpha, alpha_valid = (
            spectral_index_result
            if spectral_index_result is not None
            else _spectral_index_map(spectral_cube, nu_coords)
        )
    else:
        alpha = np.zeros(np.asarray(spectral_cube).shape[1:], dtype=np.float64)
        alpha_valid = np.ones_like(alpha, dtype=bool)
    total_flux = np.sum(np.maximum(np.asarray(spectral_cube, dtype=np.float64), 0.0), axis=0)
    finite_total = np.isfinite(total_flux)
    positive_total = total_flux[finite_total & (total_flux > 0.0)]
    reference = float(brightness_reference) if brightness_reference is not None else (
        float(np.quantile(positive_total, _BRIGHTNESS_REFERENCE_QUANTILE))
        if positive_total.size >= 16
        else (float(np.max(positive_total)) if positive_total.size else 0.0)
    )
    diagnostics["brightness_reference"] = reference if reference > 0.0 else None
    brightness_fraction = np.zeros_like(total_flux, dtype=np.float64)
    if np.isfinite(reference) and reference > 0.0:
        brightness_fraction[finite_total] = np.clip(total_flux[finite_total] / reference, 0.0, 1.0)

    if effective_floor <= 0.0:
        brightness_weight = np.ones_like(brightness_fraction)
    else:
        brightness_weight = _smoothstep(brightness_fraction, effective_floor, min(1.0, 2.0 * effective_floor))
    if spectral_index_available and spectral_range_role == "confidence":
        alpha_softness = max(0.1, min(0.5, 0.1 * (effective_max - effective_min)))
        lower_weight = _smoothstep(alpha, effective_min - alpha_softness, effective_min)
        upper_weight = 1.0 - _smoothstep(alpha, effective_max, effective_max + alpha_softness)
        spectral_weight = lower_weight * upper_weight * alpha_valid.astype(np.float64)
    elif spectral_index_available:
        spectral_weight = alpha_valid.astype(np.float64)
    else:
        spectral_weight = np.ones_like(brightness_weight)
    color_confidence = brightness_weight * spectral_weight
    color_confidence = np.clip(color_confidence, 0.0, 1.0)

    rgb = np.stack(
        [np.asarray(red, dtype=np.float64), np.asarray(green, dtype=np.float64), np.asarray(blue, dtype=np.float64)],
        axis=-1,
    )
    visible = np.max(rgb, axis=2) > 1.0e-6
    if effective_behavior == "hide":
        rgb *= color_confidence[:, :, np.newaxis]
    else:
        luma = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
        gray = np.repeat(luma[:, :, np.newaxis], 3, axis=2)
        rgb = gray + color_confidence[:, :, np.newaxis] * (rgb - gray)
    rgb = np.clip(rgb, 0.0, 1.0)
    diagnostics["artifact_affected_fraction"] = (
        float(np.mean(color_confidence[visible] < 0.999)) if np.any(visible) else 0.0
    )
    diagnostics["spectral_index_valid_fraction"] = (
        float(np.mean(alpha_valid)) if spectral_index_available else 0.0
    )
    return rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2], diagnostics


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
    artifact_mode: str = "robust",
    artifact_confidence_floor: float = _ROBUST_CONFIDENCE_FLOOR,
    spectral_index_min: float = _ROBUST_SPECTRAL_INDEX_RANGE[0],
    spectral_index_max: float = _ROBUST_SPECTRAL_INDEX_RANGE[1],
    faint_behavior: str = "desaturate",
    artifact_brightness_reference: float | None = None,
    spectral_index_available: bool = True,
    spectral_color_mode: str = "spectrum",
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
    color_mode = str(spectral_color_mode or "spectrum").strip().lower()
    if color_mode not in {"spectrum", "spectral_index"}:
        raise HTTPException(status_code=400, detail="spectral_color_mode must be 'spectrum' or 'spectral_index'")
    if color_mode == "spectral_index" and not spectral_index_available:
        raise HTTPException(status_code=400, detail="spectral-index coloring requires physical frequency coordinates")

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
            "spectral_index_fit",
            "brightness_scaling",
            "artifact_suppression",
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
    effective_deslope = 0.0 if color_mode == "spectral_index" else float(deslope)
    effective_normalize_spectrum = False if color_mode == "spectral_index" else bool(normalize_spectrum)
    effective_normalize_boost = 1.0 if color_mode == "spectral_index" else normalize_boost
    spectral_index_result = None
    spectral_range_role = "confidence"
    if color_mode == "spectral_index":
        with timings.stage("spectral_index_fit"):
            spectral_index_result = _spectral_index_map(arr, nu_coords)
        total_flux = np.sum(np.maximum(np.asarray(arr, dtype=np.float64), 0.0), axis=0)
        source_brightness = _normalize_total_flux_brightness(
            total_flux,
            intensity_mode=intensity_mode,
            clip_min=clip_min,
            clip_max=clip_max,
        )
        source_red, source_green, source_blue = _spectral_index_rgb(
            spectral_index_result[0],
            spectral_index_result[1],
            source_brightness,
            spectral_index_min=spectral_index_min,
            spectral_index_max=spectral_index_max,
        )
        spectral_range_role = "color"
        compute_backend_requested = compute_backend_mode
        compute_backend_used = "cpu"
        compute_fallback_reason = (
            None
            if compute_backend_mode == "cpu"
            else "spectral-index coloring uses the CPU spectral fit"
        )
        compute_capability_snapshot = probe_compute_capabilities()
        deslope_ref = None
    else:
        compute_request = MultispectralComputeRequest(
            spectral_cube=arr,
            wavelength_axis_nm=wavelength_axis_nm,
            nu_coords=nu_coords,
            intensity_mode=intensity_mode,
            clip_min=clip_min,
            clip_max=clip_max,
            deslope=effective_deslope,
            normalize_spectrum=effective_normalize_spectrum,
            normalize_boost=effective_normalize_boost,
        )
        execution = execute_multispectral_compute(compute_request, requested_mode=compute_backend_mode)
        timings.merge(execution.result.stage_timings_ms)
        source_red = execution.result.red
        source_green = execution.result.green
        source_blue = execution.result.blue
        compute_backend_requested = execution.requested_mode
        compute_backend_used = execution.backend_used
        compute_fallback_reason = execution.fallback_reason
        compute_capability_snapshot = execution.capability_snapshot
        deslope_ref = execution.result.deslope_ref
    with timings.stage("artifact_suppression"):
        red, green, blue, artifact_diagnostics = _apply_spectral_artifact_control(
            source_red,
            source_green,
            source_blue,
            arr,
            nu_coords,
            artifact_mode=artifact_mode,
            confidence_floor=artifact_confidence_floor,
            spectral_index_min=spectral_index_min,
            spectral_index_max=spectral_index_max,
            faint_behavior=faint_behavior,
            brightness_reference=artifact_brightness_reference,
            spectral_index_available=spectral_index_available,
            spectral_index_result=spectral_index_result,
            spectral_range_role=spectral_range_role,
        )

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
        values: dict[str, Any] = serialize_rgb_values(red, green, blue)
        if spectral_index_result is not None:
            alpha, alpha_valid = spectral_index_result
            values["spectral_index"] = [
                float(value) if valid else None
                for value, valid in zip(alpha.ravel(), alpha_valid.ravel(), strict=True)
            ]

    return {
        "data_id": ds.data_id,
        "plane_dims": [plane_x, plane_y],
        "shape": [int(red.shape[0]), int(red.shape[1])],
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
            "deslope": effective_deslope,
            "deslope_ref": deslope_ref,
            "normalize_spectrum": effective_normalize_spectrum,
            "normalize_spectrum_boost": float(effective_normalize_boost),
            "brightness_mode": "total_flux",
            "clip_mode": "brightness_only",
            "intensity_scale": intensity_mode,
            "range_min": float(range_min),
            "range_max": float(range_max),
            "compute_backend_requested": compute_backend_requested,
            "compute_backend_used": compute_backend_used,
            "compute_backend": compute_backend_used,
            "fallback_reason": compute_fallback_reason,
            "capability_snapshot": compute_capability_snapshot,
            "preview_active": preview_active,
            "spectral_color_mode": color_mode,
            **artifact_diagnostics,
            "stage_timings_ms": timings.snapshot(),
        },
        "values": values,
    }


def build_multispectral_response_from_scene_slices(
    data_id: str,
    rendered_slices: list[RenderedSceneSlice],
    *,
    nu_coords: np.ndarray,
    nu_unit: str,
    sample_mode: SampleMode,
    nu_axis_scale: str = "linear",
    deslope: float = 0.0,
    normalize_spectrum: bool = False,
    normalize_spectrum_boost: float = 1.0,
    intensity_scale: str = "linear",
    range_min: float = 0.0,
    range_max: float = 100.0,
    compute_backend: str = "auto",
    artifact_mode: str = "robust",
    artifact_confidence_floor: float = _ROBUST_CONFIDENCE_FLOOR,
    spectral_index_min: float = _ROBUST_SPECTRAL_INDEX_RANGE[0],
    spectral_index_max: float = _ROBUST_SPECTRAL_INDEX_RANGE[1],
    faint_behavior: str = "desaturate",
    artifact_brightness_reference: float | None = None,
    spectral_index_available: bool = True,
    spectral_color_mode: str = "spectrum",
) -> dict[str, Any]:
    """Combine a bounded stack of sparse Scene planes into multispectral RGB."""
    if len(rendered_slices) < 3:
        raise HTTPException(status_code=400, detail="need at least 3 spectral channels for multispectral RGB")
    if len(rendered_slices) != int(np.asarray(nu_coords).size):
        raise HTTPException(status_code=500, detail="sparse multispectral frequency coordinates do not match slices")

    reference = rendered_slices[0]
    fixed_indices = {axis: index for axis, index in reference.selected_indices.items() if axis != "nu"}
    for rendered in rendered_slices[1:]:
        if rendered.plane_axes != reference.plane_axes:
            raise HTTPException(status_code=502, detail="sparse multispectral slices use inconsistent plane axes")
        if np.asarray(rendered.values).shape != np.asarray(reference.values).shape:
            raise HTTPException(status_code=502, detail="sparse multispectral slices use inconsistent shapes")
        if rendered.full_shape != reference.full_shape or rendered.sampling_step != reference.sampling_step:
            raise HTTPException(status_code=502, detail="sparse multispectral slices use inconsistent sampling")
        if rendered.intensity_unit != reference.intensity_unit:
            raise HTTPException(status_code=502, detail="sparse multispectral slices use inconsistent units")
        if {axis: index for axis, index in rendered.selected_indices.items() if axis != "nu"} != fixed_indices:
            raise HTTPException(status_code=502, detail="sparse multispectral slices use inconsistent selections")

    plane_x, plane_y = reference.plane_axes
    bounded_stack = CubeDataset(
        data_id=data_id,
        dims=("nu", plane_x, plane_y),
        coords={
            "nu": np.asarray(nu_coords, dtype=np.float64),
            plane_x: np.asarray(reference.plane_coords[plane_x]),
            plane_y: np.asarray(reference.plane_coords[plane_y]),
        },
        values=np.stack([np.asarray(rendered.values, dtype=np.float32) for rendered in rendered_slices], axis=0),
        units={
            "nu": nu_unit,
            plane_x: reference.plane_units[plane_x],
            plane_y: reference.plane_units[plane_y],
        },
        intensity_unit=reference.intensity_unit,
        wcs=dict(reference.wcs),
        provenance={"source": "sparse-scene-multispectral-stack"},
    )
    bounded_stack.validate()
    payload = build_multispectral_response(
        bounded_stack,
        sample=None,
        pol=None,
        t=None,
        x=None,
        y=None,
        z=None,
        nu0=None,
        nu1=None,
        max_pixels=None,
        sample_mode=sample_mode,
        plane_x=plane_x,
        plane_y=plane_y,
        nu_axis_scale=nu_axis_scale,
        deslope=deslope,
        normalize_spectrum=normalize_spectrum,
        normalize_spectrum_boost=normalize_spectrum_boost,
        intensity_scale=intensity_scale,
        range_min=range_min,
        range_max=range_max,
        compute_backend=compute_backend,
        artifact_mode=artifact_mode,
        artifact_confidence_floor=artifact_confidence_floor,
        spectral_index_min=spectral_index_min,
        spectral_index_max=spectral_index_max,
        faint_behavior=faint_behavior,
        artifact_brightness_reference=artifact_brightness_reference,
        spectral_index_available=spectral_index_available,
        spectral_color_mode=spectral_color_mode,
    )
    payload["full_shape"] = [int(size) for size in reference.full_shape]
    payload["sampling_step"] = [int(step) for step in reference.sampling_step]
    payload["selected_indices"] = fixed_indices
    payload["bands"]["preview_active"] = reference.sampling_step != (1, 1)
    return payload


__all__ = [
    "_normalize_total_flux_brightness",
    "_normalize_total_flux_brightness_xp",
    "_apply_spectral_artifact_control",
    "_spectral_index_map",
    "_spectral_index_rgb",
    "build_multispectral_response",
    "build_multispectral_response_from_scene_slices",
    "convert_mf_to_rgb_new",
]
