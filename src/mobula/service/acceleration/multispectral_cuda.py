from __future__ import annotations

from typing import Any

import numpy as np

from mobula.service.acceleration.compute_base import (
    ComputeBackendUnavailableError,
    MultispectralComputeBackend,
    MultispectralComputeRequest,
    MultispectralComputeResult,
)
from mobula.service.acceleration.multispectral_common import (
    apply_brightness_scale_xp,
    apply_deslope_xp,
    normalize_spectrum_xp,
    prepare_chroma_xp,
)
from mobula.service.perf import StageTimings
from mobula.service.spectral_rgb import convert_mf_to_rgb_new


def _cupy_module_or_none() -> Any | None:
    try:
        import cupy as cp
    except Exception:
        return None
    try:
        if int(cp.cuda.runtime.getDeviceCount()) < 1:
            return None
    except Exception:
        return None
    return cp


class CudaMultispectralBackend(MultispectralComputeBackend):
    backend_name = "cuda"

    def compute(self, request: MultispectralComputeRequest) -> MultispectralComputeResult:
        cp = _cupy_module_or_none()
        if cp is None:
            raise ComputeBackendUnavailableError(self.backend_name, "CuPy/CUDA is unavailable")

        timings = StageTimings(
            [
                "spectrum_normalization",
                "deslope_weighting",
                "chroma_preparation",
                "spectral_to_rgb_conversion",
                "brightness_scaling",
            ]
        )
        arr = cp.asarray(request.spectral_cube, dtype=cp.float32)
        brightness_source = cp.asarray(arr, dtype=cp.float64)

        with timings.stage("spectrum_normalization"):
            if request.normalize_spectrum:
                arr = normalize_spectrum_xp(arr, normalize_boost=request.normalize_boost, xp=cp)

        with timings.stage("deslope_weighting"):
            arr, deslope_ref = apply_deslope_xp(arr, request.nu_coords, deslope=request.deslope, xp=cp)

        with timings.stage("chroma_preparation"):
            arr_chroma = prepare_chroma_xp(arr, cp)

        with timings.stage("spectral_to_rgb_conversion"):
            try:
                rgb_cube, _ = convert_mf_to_rgb_new(
                    arr_chroma,
                    wavelength_axis_nm=request.wavelength_axis_nm,
                    intensity_scale="linear",
                    clip_min=0.0,
                    clip_max=1.0,
                    channel_relative_clip=False,
                    backend="gpu",
                    return_device_array=True,
                )
            except RuntimeError as exc:
                raise ComputeBackendUnavailableError(self.backend_name, str(exc)) from exc

        with timings.stage("brightness_scaling"):
            rgb_cube = apply_brightness_scale_xp(
                rgb_cube,
                brightness_source,
                intensity_mode=request.intensity_mode,
                clip_min=request.clip_min,
                clip_max=request.clip_max,
                xp=cp,
            )

        return MultispectralComputeResult(
            backend=self.backend_name,
            red=cp.asnumpy(rgb_cube[:, :, 0]),
            green=cp.asnumpy(rgb_cube[:, :, 1]),
            blue=cp.asnumpy(rgb_cube[:, :, 2]),
            deslope_ref=deslope_ref,
            stage_timings_ms=timings.snapshot(),
        )
