from __future__ import annotations

from typing import Any

import numpy as np

BRIGHTNESS_SCALE_QUANTILE = 0.995
_MIN_ROBUST_REFERENCE_VALUES = 16


def robust_positive_reference_xp(
    values: Any,
    *,
    xp: Any,
    quantile: float = BRIGHTNESS_SCALE_QUANTILE,
) -> float:
    """Return a high positive quantile without letting isolated peaks set display scale."""
    arr = xp.asarray(values, dtype=xp.float64)
    positive = xp.isfinite(arr) & (arr > 0.0)
    count = int(xp.sum(positive).item())
    if count < 1:
        return 0.0
    selected = arr[positive]
    if count >= _MIN_ROBUST_REFERENCE_VALUES:
        reference = float(xp.quantile(selected, quantile).item())
    else:
        reference = float(xp.max(selected).item())
    return reference if np.isfinite(reference) and reference > 0.0 else 0.0


def normalize_total_flux_brightness_xp(
    total_flux: Any,
    *,
    intensity_mode: str,
    clip_min: float,
    clip_max: float,
    xp: Any,
    dynamic_range: float = 2.5e3,
) -> Any:
    arr = xp.asarray(total_flux, dtype=xp.float64)
    finite = xp.isfinite(arr)
    if not bool(xp.any(finite)):
        return xp.zeros_like(arr, dtype=xp.float64)

    reference = robust_positive_reference_xp(arr, xp=xp)
    if reference <= 0.0:
        return xp.zeros_like(arr, dtype=xp.float64)

    hi = reference * clip_max
    if intensity_mode == "log":
        if clip_min > 0.0:
            lo = reference * clip_min
        else:
            lo = hi / max(dynamic_range, 1.0 + 1e-12)
        lo = max(lo, np.finfo(np.float64).tiny)
        hi = max(hi, lo * (1.0 + 1e-12))
        clipped = xp.clip(arr, lo, hi)
        return xp.log(clipped / lo) / xp.log(hi / lo)

    lo = max(reference * clip_min, 0.0)
    hi = max(hi, lo + 1.0e-12)
    norm = xp.clip((arr - lo) / (hi - lo), 0.0, 1.0)
    if intensity_mode == "sqrt":
        norm = xp.sqrt(norm)
    return norm


def normalize_spectrum_xp(arr: Any, *, normalize_boost: float, xp: Any) -> Any:
    arr64 = xp.asarray(arr, dtype=xp.float64)
    mean_spectrum = xp.mean(arr64, axis=(1, 2), dtype=xp.float64)
    finite = xp.isfinite(mean_spectrum)
    if bool(xp.any(finite)):
        median_abs = float(xp.median(xp.abs(mean_spectrum[finite])).item())
    else:
        median_abs = 1.0
    if not np.isfinite(median_abs) or median_abs <= 0.0:
        median_abs = 1.0
    floor = max(np.finfo(np.float64).tiny, median_abs * 1.0e-12)
    scale = xp.where(finite & (xp.abs(mean_spectrum) >= floor), mean_spectrum, 1.0)
    normalized = arr64 / scale[:, xp.newaxis, xp.newaxis]
    if normalize_boost != 1.0:
        positive = normalized > 0.0
        boosted = xp.empty_like(normalized, dtype=xp.float64)
        boosted[positive] = xp.float_power(xp.maximum(normalized[positive], floor), normalize_boost)
        boosted[~positive] = normalized[~positive] * normalize_boost
        return boosted.astype(xp.float32)
    return normalized.astype(xp.float32)


def apply_deslope_xp(arr: Any, nu_coords: np.ndarray, *, deslope: float, xp: Any) -> tuple[Any, float | None]:
    if float(deslope) == 0.0:
        return arr, None

    nu_abs = xp.abs(xp.asarray(nu_coords, dtype=xp.float64))
    valid = xp.isfinite(nu_abs) & (nu_abs > 0)
    if not bool(xp.any(valid)):
        return arr, None

    deslope_ref = float(xp.median(nu_abs[valid]).item())
    weights = xp.ones(arr.shape[0], dtype=xp.float64)
    weights[valid] = xp.power(nu_abs[valid] / deslope_ref, float(deslope))
    return arr * weights[:, xp.newaxis, xp.newaxis].astype(xp.float32), deslope_ref


def prepare_chroma_xp(arr: Any, xp: Any) -> Any:
    arr_rgb = xp.moveaxis(arr, 0, -1).astype(xp.float64)
    arr_chroma = xp.maximum(arr_rgb, 0.0)
    denom = xp.sum(arr_chroma, axis=-1, keepdims=True, dtype=xp.float64)
    denom = xp.maximum(denom, np.finfo(np.float64).tiny)
    return arr_chroma / denom


def apply_brightness_scale_xp(
    rgb_cube: Any,
    brightness_source: Any,
    *,
    intensity_mode: str,
    clip_min: float,
    clip_max: float,
    xp: Any,
) -> Any:
    total_flux = xp.sum(xp.maximum(brightness_source, 0.0), axis=0, dtype=xp.float64)
    brightness = normalize_total_flux_brightness_xp(
        total_flux,
        intensity_mode=intensity_mode,
        clip_min=clip_min,
        clip_max=clip_max,
        xp=xp,
    )
    luma = 0.2126 * rgb_cube[:, :, 0] + 0.7152 * rgb_cube[:, :, 1] + 0.0722 * rgb_cube[:, :, 2]
    scale = brightness / xp.maximum(luma, 1.0e-6)
    return xp.clip(rgb_cube * scale[:, :, xp.newaxis], 0.0, 1.0)
