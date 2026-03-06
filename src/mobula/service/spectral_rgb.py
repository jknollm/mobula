from __future__ import annotations

from typing import Any

import numpy as np


_XYZ_CMF = np.array(
    [[
        0.000160, 0.000662, 0.002362, 0.007242, 0.019110, 0.043400,
        0.084736, 0.140638, 0.204492, 0.264737, 0.314679, 0.357719,
        0.383734, 0.386726, 0.370702, 0.342957, 0.302273, 0.254085,
        0.195618, 0.132349, 0.080507, 0.041072, 0.016172, 0.005132,
        0.003816, 0.015444, 0.037465, 0.071358, 0.117749, 0.172953,
        0.236491, 0.304213, 0.376772, 0.451584, 0.529826, 0.616053,
        0.705224, 0.793832, 0.878655, 0.951162, 1.014160, 1.074300,
        1.118520, 1.134300, 1.123990, 1.089100, 1.030480, 0.950740,
        0.856297, 0.754930, 0.647467, 0.535110, 0.431567, 0.343690,
        0.268329, 0.204300, 0.152568, 0.112210, 0.081261, 0.057930,
        0.040851, 0.028623, 0.019941, 0.013842, 0.009577, 0.006605,
        0.004553, 0.003145, 0.002175, 0.001506, 0.001045, 0.000727,
        0.000508, 0.000356, 0.000251, 0.000178, 0.000126, 0.000090,
        0.000065, 0.000046, 0.000033,
    ],
     [
         0.000017, 0.000072, 0.000253, 0.000769, 0.002004, 0.004509,
         0.008756, 0.014456, 0.021391, 0.029497, 0.038676, 0.049602,
         0.062077, 0.074704, 0.089456, 0.106256, 0.128201, 0.152761,
         0.185190, 0.219940, 0.253589, 0.297665, 0.339133, 0.395379,
         0.460777, 0.531360, 0.606741, 0.685660, 0.761757, 0.823330,
         0.875211, 0.923810, 0.961988, 0.982200, 0.991761, 0.999110,
         0.997340, 0.982380, 0.955552, 0.915175, 0.868934, 0.825623,
         0.777405, 0.720353, 0.658341, 0.593878, 0.527963, 0.461834,
         0.398057, 0.339554, 0.283493, 0.228254, 0.179828, 0.140211,
         0.107633, 0.081187, 0.060281, 0.044096, 0.031800, 0.022602,
         0.015905, 0.011130, 0.007749, 0.005375, 0.003718, 0.002565,
         0.001768, 0.001222, 0.000846, 0.000586, 0.000407, 0.000284,
         0.000199, 0.000140, 0.000098, 0.000070, 0.000050, 0.000036,
         0.000025, 0.000018, 0.000013,
     ],
     [
         0.000705, 0.002928, 0.010482, 0.032344, 0.086011, 0.197120,
         0.389366, 0.656760, 0.972542, 1.282500, 1.553480, 1.798500,
         1.967280, 2.027300, 1.994800, 1.900700, 1.745370, 1.554900,
         1.317560, 1.030200, 0.772125, 0.570060, 0.415254, 0.302356,
         0.218502, 0.159249, 0.112044, 0.082248, 0.060709, 0.043050,
         0.030451, 0.020584, 0.013676, 0.007918, 0.003988, 0.001091,
         0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
         0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
         0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
         0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
         0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
         0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
         0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
         0.000000, 0.000000, 0.000000,
     ]],
    dtype=np.float64,
)

_MATRIX_SRGB_D65 = np.array(
    [
        [3.2404542, -1.5371385, -0.4985314],
        [-0.9692660, 1.8760108, 0.0415560],
        [0.0556434, -0.2040259, 1.0572252],
    ],
    dtype=np.float64,
)

_CMF_WAVELENGTHS_NM = np.linspace(380.0, 780.0, _XYZ_CMF.shape[1], dtype=np.float64)


def _gamma_corr(inp: np.ndarray) -> np.ndarray:
    mask = np.zeros(inp.shape, dtype=np.float64)
    mask[inp <= 0.0031308] = 1.0
    r1 = 12.92 * inp
    a = 0.055
    r2 = (1 + a) * (np.maximum(inp, 0.0031308) ** (1 / 2.4)) - a
    return r1 * mask + r2 * (1.0 - mask)


def _gamma_corr_xp(inp: np.ndarray, xp: Any) -> np.ndarray:
    mask = xp.zeros(inp.shape, dtype=xp.float64)
    mask[inp <= 0.0031308] = 1.0
    r1 = 12.92 * inp
    a = 0.055
    r2 = (1 + a) * (xp.maximum(inp, 0.0031308) ** (1 / 2.4)) - a
    return r1 * mask + r2 * (1.0 - mask)


def _xyz_from_wavelengths(wavelengths_nm: np.ndarray) -> np.ndarray:
    lam = np.clip(wavelengths_nm, _CMF_WAVELENGTHS_NM[0], _CMF_WAVELENGTHS_NM[-1])
    x = np.interp(lam, _CMF_WAVELENGTHS_NM, _XYZ_CMF[0])
    y = np.interp(lam, _CMF_WAVELENGTHS_NM, _XYZ_CMF[1])
    z = np.interp(lam, _CMF_WAVELENGTHS_NM, _XYZ_CMF[2])
    return np.stack([x, y, z], axis=0)


def _integration_weights(axis_values: np.ndarray) -> np.ndarray:
    if axis_values.ndim != 1:
        raise ValueError("axis_values must be one-dimensional")
    if axis_values.size == 1:
        return np.ones(1, dtype=np.float64)
    delta = np.abs(np.diff(axis_values))
    weights = np.empty(axis_values.size, dtype=np.float64)
    weights[0] = 0.5 * delta[0]
    weights[-1] = 0.5 * delta[-1]
    if axis_values.size > 2:
        weights[1:-1] = 0.5 * (delta[:-1] + delta[1:])
    normalizer = weights.sum()
    if normalizer > 0:
        weights /= normalizer
    return weights


def _to_logscale(arr: np.ndarray, lo: np.ndarray | float, hi: np.ndarray | float) -> np.ndarray:
    arr = np.asarray(arr, dtype=np.float64)
    lo = np.asarray(lo, dtype=np.float64)
    hi = np.asarray(hi, dtype=np.float64)
    eps = np.finfo(np.float64).tiny
    lo = np.maximum(lo, eps)
    hi = np.maximum(hi, lo * (1.0 + 1e-12))
    clipped = arr.clip(lo, hi)
    return np.log(clipped / lo) / np.log(hi / lo)


def _to_logscale_xp(arr: np.ndarray, lo: np.ndarray | float, hi: np.ndarray | float, xp: Any) -> np.ndarray:
    arr = xp.asarray(arr, dtype=xp.float64)
    lo = xp.asarray(lo, dtype=xp.float64)
    hi = xp.asarray(hi, dtype=xp.float64)
    eps = np.finfo(np.float64).tiny
    lo = xp.maximum(lo, eps)
    hi = xp.maximum(hi, lo * (1.0 + 1e-12))
    clipped = xp.clip(arr, lo, hi)
    return xp.log(clipped / lo) / xp.log(hi / lo)


def _xyz_to_srgb(xyz_data: np.ndarray) -> np.ndarray:
    rgb_linear = xyz_data @ _MATRIX_SRGB_D65.T
    return _gamma_corr(rgb_linear).clip(0.0, 1.0)


def _xyz_to_srgb_xp(xyz_data: np.ndarray, xp: Any) -> np.ndarray:
    matrix = xp.asarray(_MATRIX_SRGB_D65, dtype=xp.float64)
    rgb_linear = xyz_data @ matrix.T
    return xp.clip(_gamma_corr_xp(rgb_linear, xp), 0.0, 1.0)


def _cupy_module_or_none(*, require_gpu: bool) -> Any | None:
    try:
        import cupy as cp
    except Exception as exc:
        if require_gpu:
            raise RuntimeError("GPU backend requires CuPy, but it is not available") from exc
        return None
    try:
        if int(cp.cuda.runtime.getDeviceCount()) < 1:
            if require_gpu:
                raise RuntimeError("GPU backend requested but no CUDA device is available")
            return None
    except Exception as exc:
        if require_gpu:
            raise RuntimeError("GPU backend requested but CUDA runtime is unavailable") from exc
        return None
    return cp


def _convert_mf_to_rgb_gpu(
    spectral_cube: np.ndarray,
    *,
    wavelength_axis_nm: np.ndarray,
    intensity_scale: str = "log",
    clip_min: float = 0.0,
    clip_max: float = 1.0,
    dynamic_range: float = 2.5e3,
    after_log_gammacorr: float | None = None,
    reuse_brightness_scale: float | bool = False,
    channel_relative_clip: bool = False,
    channel_clip_reference: np.ndarray | None = None,
    require_gpu: bool,
    return_device_array: bool = False,
) -> tuple[Any, float]:
    cp = _cupy_module_or_none(require_gpu=require_gpu)
    if cp is None:
        raise RuntimeError("GPU backend is unavailable")

    shp = spectral_cube.shape[:-1] + (3,)
    n_freqs = spectral_cube.shape[-1]
    spectral_gpu = cp.asarray(spectral_cube, dtype=cp.float64).reshape((-1, n_freqs))

    wavelength_axis_nm = np.asarray(wavelength_axis_nm, dtype=np.float64).reshape(-1)
    if wavelength_axis_nm.size != n_freqs:
        raise ValueError("wavelength_axis_nm must have shape (n_freqs,)")

    if reuse_brightness_scale:
        maxval = float(reuse_brightness_scale)
    else:
        finite = cp.isfinite(spectral_gpu)
        if bool(cp.any(finite)):
            maxval = float(cp.max(spectral_gpu[finite]).item())
        else:
            maxval = 1.0
    if not np.isfinite(maxval) or maxval <= 0:
        maxval = 1.0

    clip_min = float(np.clip(clip_min, 0.0, 1.0))
    clip_max = float(np.clip(clip_max, 0.0, 1.0))
    if clip_max <= clip_min:
        clip_max = min(1.0, clip_min + 1.0e-3)

    if channel_relative_clip:
        if channel_clip_reference is not None:
            ref = cp.asarray(channel_clip_reference, dtype=cp.float64).reshape((-1, n_freqs))
            if ref.shape != spectral_gpu.shape:
                raise ValueError("channel_clip_reference must have the same shape as spectral_cube")
        else:
            ref = spectral_gpu
        finite = cp.isfinite(ref)
        mostly_nonnegative = False
        if bool(cp.any(finite)):
            negative_fraction = float(cp.mean((ref[finite] < 0.0).astype(cp.float64)).item())
            mostly_nonnegative = negative_fraction <= 0.25
        valid = cp.any(finite, axis=0)
        mins = cp.where(finite, ref, cp.inf).min(axis=0)
        maxs = cp.where(finite, ref, -cp.inf).max(axis=0)
        mins = cp.where(valid, mins, 0.0)
        maxs = cp.where(valid, maxs, mins + 1.0)
        span = cp.maximum(maxs - mins, 1.0e-12)
        lo = mins + clip_min * span
        hi = mins + clip_max * span
        hi = cp.maximum(hi, lo + 1.0e-12)
        lo = lo[cp.newaxis, :]
        hi = hi[cp.newaxis, :]
        if mostly_nonnegative:
            lo = cp.maximum(lo, 0.0)
            hi = cp.maximum(hi, lo + 1.0e-12)

        finite_cur = cp.isfinite(spectral_gpu)
        cur_mins = cp.where(finite_cur, spectral_gpu, cp.inf).min(axis=0, keepdims=True)
        cur_maxs = cp.where(finite_cur, spectral_gpu, -cp.inf).max(axis=0, keepdims=True)
        valid_cur = cp.any(finite_cur, axis=0, keepdims=True)
        if clip_min <= 0.0:
            if mostly_nonnegative:
                cur_floor = cp.maximum(cur_mins, 0.0)
                lo = cp.where(valid_cur, cp.minimum(lo, cur_floor), lo)
                lo = cp.maximum(lo, 0.0)
            else:
                lo = cp.where(valid_cur, cp.minimum(lo, cur_mins), lo)
        if clip_max >= 1.0:
            hi = cp.where(valid_cur, cp.maximum(hi, cur_maxs), hi)
        hi = cp.maximum(hi, lo + 1.0e-12)

        clipped = cp.clip(spectral_gpu, lo, hi)
        rel = cp.maximum(clipped - lo, 0.0)
        span = cp.maximum(hi - lo, 1.0e-12)
        span_global = float(cp.max(span).item())
        if not np.isfinite(span_global) or span_global <= 0.0:
            span_global = 1.0
        channel_gain = span / span_global

        if intensity_scale == "log":
            floor = cp.maximum(span / max(dynamic_range, 1.0 + 1.0e-12), np.finfo(np.float64).tiny)
            denom = cp.log1p(span / floor)
            spectral_norm = cp.log1p(rel / floor) / cp.maximum(denom, 1.0e-12)
            spectral_norm = spectral_norm * channel_gain
        elif intensity_scale == "sqrt":
            spectral_norm = cp.sqrt(rel / span) * channel_gain
        else:
            spectral_norm = rel / span_global
    else:
        hi = maxval * clip_max
        if intensity_scale == "log":
            if clip_min > 0.0:
                lo = maxval * clip_min
            else:
                lo = hi / max(dynamic_range, 1.0 + 1e-12)
            spectral_norm = _to_logscale_xp(spectral_gpu, hi=hi, lo=lo, xp=cp)
        else:
            lo = maxval * clip_min
            lo = max(lo, 0.0)
            hi = max(hi, lo + 1.0e-12)
            spectral_norm = cp.clip((spectral_gpu - lo) / (hi - lo), 0.0, 1.0)
            if intensity_scale == "sqrt":
                spectral_norm = cp.sqrt(spectral_norm)
    if after_log_gammacorr is not None:
        spectral_norm = cp.float_power(spectral_norm, after_log_gammacorr)

    xyz_response = _xyz_from_wavelengths(wavelength_axis_nm)
    weights = _integration_weights(wavelength_axis_nm)
    weighted_response = cp.asarray(xyz_response * weights[np.newaxis, :], dtype=cp.float64)
    xyz_data = cp.tensordot(spectral_norm, weighted_response, axes=[-1, -1])
    rgb_data = _xyz_to_srgb_xp(xyz_data, cp)
    if return_device_array:
        return rgb_data.reshape(shp), maxval
    return cp.asnumpy(rgb_data.reshape(shp)), maxval


def build_visible_wavelength_axis(
    nu_coords: np.ndarray,
    *,
    axis_scale: str,
    lambda_min: float = 400.0,
    lambda_max: float = 700.0,
) -> tuple[np.ndarray, str]:
    nu_arr = np.asarray(nu_coords, dtype=np.float64).reshape(-1)
    if nu_arr.size < 1:
        raise ValueError("nu_coords must be non-empty")

    axis_scale_applied = axis_scale
    if axis_scale == "log":
        if np.any(nu_arr <= 0) or np.any(~np.isfinite(nu_arr)):
            scaled = nu_arr
            axis_scale_applied = "linear"
        else:
            scaled = np.log10(nu_arr)
    else:
        scaled = nu_arr

    finite = np.isfinite(scaled)
    if not np.any(finite):
        t = np.linspace(0.0, 1.0, nu_arr.size, dtype=np.float64)
    else:
        lo = float(np.min(scaled[finite]))
        hi = float(np.max(scaled[finite]))
        if hi <= lo:
            t = np.linspace(0.0, 1.0, nu_arr.size, dtype=np.float64)
        else:
            t = (scaled - lo) / (hi - lo)
            t = np.where(np.isfinite(t), t, 0.0)

    # Low frequency maps to red (longer wavelengths), high frequency to blue.
    wavelength_nm = lambda_max - t * (lambda_max - lambda_min)
    return wavelength_nm.astype(np.float64), axis_scale_applied


def convert_mf_to_rgb_new(
    spectral_cube: np.ndarray,
    *,
    wavelength_axis_nm: np.ndarray,
    intensity_scale: str = "log",
    clip_min: float = 0.0,
    clip_max: float = 1.0,
    dynamic_range: float = 2.5e3,
    after_log_gammacorr: float | None = None,
    reuse_brightness_scale: float | bool = False,
    channel_relative_clip: bool = False,
    channel_clip_reference: np.ndarray | None = None,
    backend: str = "cpu",
    return_device_array: bool = False,
) -> tuple[Any, float]:
    backend_mode = str(backend or "cpu").strip().lower()
    if backend_mode not in {"cpu", "gpu", "auto"}:
        raise ValueError("backend must be 'cpu', 'gpu', or 'auto'")
    if backend_mode in {"gpu", "auto"}:
        try:
            return _convert_mf_to_rgb_gpu(
                spectral_cube,
                wavelength_axis_nm=wavelength_axis_nm,
                intensity_scale=intensity_scale,
                clip_min=clip_min,
                clip_max=clip_max,
                dynamic_range=dynamic_range,
                after_log_gammacorr=after_log_gammacorr,
                reuse_brightness_scale=reuse_brightness_scale,
                channel_relative_clip=channel_relative_clip,
                channel_clip_reference=channel_clip_reference,
                require_gpu=backend_mode == "gpu",
                return_device_array=return_device_array,
            )
        except RuntimeError:
            if backend_mode == "gpu":
                raise

    shp = spectral_cube.shape[:-1] + (3,)
    n_freqs = spectral_cube.shape[-1]
    spectral_cube = np.asarray(spectral_cube, dtype=np.float64).reshape((-1, n_freqs))
    wavelength_axis_nm = np.asarray(wavelength_axis_nm, dtype=np.float64).reshape(-1)
    if wavelength_axis_nm.size != n_freqs:
        raise ValueError("wavelength_axis_nm must have shape (n_freqs,)")

    if reuse_brightness_scale:
        maxval = float(reuse_brightness_scale)
    else:
        finite = np.isfinite(spectral_cube)
        if np.any(finite):
            maxval = float(np.max(spectral_cube[finite]))
        else:
            maxval = 1.0
    if not np.isfinite(maxval) or maxval <= 0:
        maxval = 1.0

    clip_min = float(np.clip(clip_min, 0.0, 1.0))
    clip_max = float(np.clip(clip_max, 0.0, 1.0))
    if clip_max <= clip_min:
        clip_max = min(1.0, clip_min + 1.0e-3)

    if channel_relative_clip:
        if channel_clip_reference is not None:
            ref = np.asarray(channel_clip_reference, dtype=np.float64).reshape((-1, n_freqs))
            if ref.shape != spectral_cube.shape:
                raise ValueError("channel_clip_reference must have the same shape as spectral_cube")
        else:
            ref = spectral_cube
        finite = np.isfinite(ref)
        mostly_nonnegative = False
        if np.any(finite):
            negative_fraction = float(np.mean(ref[finite] < 0.0))
            mostly_nonnegative = negative_fraction <= 0.25
        valid = np.any(finite, axis=0)
        mins = np.where(finite, ref, np.inf).min(axis=0)
        maxs = np.where(finite, ref, -np.inf).max(axis=0)
        mins = np.where(valid, mins, 0.0)
        maxs = np.where(valid, maxs, mins + 1.0)
        span = np.maximum(maxs - mins, 1.0e-12)
        lo = mins + clip_min * span
        hi = mins + clip_max * span
        hi = np.maximum(hi, lo + 1.0e-12)
        lo = lo[np.newaxis, :]
        hi = hi[np.newaxis, :]
        if mostly_nonnegative:
            lo = np.maximum(lo, 0.0)
            hi = np.maximum(hi, lo + 1.0e-12)

        finite_cur = np.isfinite(spectral_cube)
        cur_mins = np.where(finite_cur, spectral_cube, np.inf).min(axis=0, keepdims=True)
        cur_maxs = np.where(finite_cur, spectral_cube, -np.inf).max(axis=0, keepdims=True)
        valid_cur = np.any(finite_cur, axis=0, keepdims=True)
        if clip_min <= 0.0:
            if mostly_nonnegative:
                cur_floor = np.maximum(cur_mins, 0.0)
                lo = np.where(valid_cur, np.minimum(lo, cur_floor), lo)
                lo = np.maximum(lo, 0.0)
            else:
                lo = np.where(valid_cur, np.minimum(lo, cur_mins), lo)
        if clip_max >= 1.0:
            hi = np.where(valid_cur, np.maximum(hi, cur_maxs), hi)
        hi = np.maximum(hi, lo + 1.0e-12)

        clipped = np.clip(spectral_cube, lo, hi)
        rel = np.maximum(clipped - lo, 0.0)
        span = np.maximum(hi - lo, 1.0e-12)
        span_global = float(np.max(span))
        if not np.isfinite(span_global) or span_global <= 0.0:
            span_global = 1.0
        channel_gain = span / span_global

        if intensity_scale == "log":
            floor = np.maximum(span / max(dynamic_range, 1.0 + 1.0e-12), np.finfo(np.float64).tiny)
            denom = np.log1p(span / floor)
            spectral_norm = np.log1p(rel / floor) / np.maximum(denom, 1.0e-12)
            spectral_norm = spectral_norm * channel_gain
        elif intensity_scale == "sqrt":
            spectral_norm = np.sqrt(rel / span) * channel_gain
        else:
            spectral_norm = rel / span_global
    else:
        hi = maxval * clip_max
        if intensity_scale == "log":
            if clip_min > 0.0:
                lo = maxval * clip_min
            else:
                lo = hi / max(dynamic_range, 1.0 + 1e-12)
            spectral_norm = _to_logscale(spectral_cube, hi=hi, lo=lo)
        else:
            lo = maxval * clip_min
            lo = max(lo, 0.0)
            hi = max(hi, lo + 1.0e-12)
            spectral_norm = np.clip((spectral_cube - lo) / (hi - lo), 0.0, 1.0)
            if intensity_scale == "sqrt":
                spectral_norm = np.sqrt(spectral_norm)
    if after_log_gammacorr is not None:
        spectral_norm = np.float_power(spectral_norm, after_log_gammacorr)

    xyz_response = _xyz_from_wavelengths(wavelength_axis_nm)
    weights = _integration_weights(wavelength_axis_nm)
    weighted_response = xyz_response * weights[np.newaxis, :]
    xyz_data = np.tensordot(spectral_norm, weighted_response, axes=[-1, -1])
    rgb_data = _xyz_to_srgb(xyz_data)
    return rgb_data.reshape(shp), maxval
