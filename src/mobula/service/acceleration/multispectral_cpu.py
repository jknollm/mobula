from __future__ import annotations

from mobula.service.acceleration.compute_base import MultispectralComputeBackend, MultispectralComputeRequest, MultispectralComputeResult
from mobula.service.acceleration.multispectral_common import (
    apply_brightness_scale_xp,
    apply_deslope_xp,
    normalize_spectrum_xp,
    prepare_chroma_xp,
)
from mobula.service.perf import StageTimings
from mobula.service.spectral_rgb import convert_mf_to_rgb_new
import numpy as np


class CpuMultispectralBackend(MultispectralComputeBackend):
    backend_name = "cpu"

    def compute(self, request: MultispectralComputeRequest) -> MultispectralComputeResult:
        timings = StageTimings(
            [
                "spectrum_normalization",
                "deslope_weighting",
                "chroma_preparation",
                "spectral_to_rgb_conversion",
                "brightness_scaling",
            ]
        )
        arr = np.asarray(request.spectral_cube, dtype=np.float32)
        brightness_source = np.asarray(arr, dtype=np.float64).copy()

        with timings.stage("spectrum_normalization"):
            if request.normalize_spectrum:
                arr = normalize_spectrum_xp(arr, normalize_boost=request.normalize_boost, xp=np)

        with timings.stage("deslope_weighting"):
            arr, deslope_ref = apply_deslope_xp(arr, request.nu_coords, deslope=request.deslope, xp=np)

        with timings.stage("chroma_preparation"):
            arr_chroma = prepare_chroma_xp(arr, np)

        with timings.stage("spectral_to_rgb_conversion"):
            rgb_cube, _ = convert_mf_to_rgb_new(
                arr_chroma,
                wavelength_axis_nm=request.wavelength_axis_nm,
                intensity_scale="linear",
                clip_min=0.0,
                clip_max=1.0,
                channel_relative_clip=False,
                backend="cpu",
            )

        with timings.stage("brightness_scaling"):
            rgb_cube = apply_brightness_scale_xp(
                rgb_cube,
                brightness_source,
                intensity_mode=request.intensity_mode,
                clip_min=request.clip_min,
                clip_max=request.clip_max,
                xp=np,
            )

        return MultispectralComputeResult(
            backend=self.backend_name,
            red=np.asarray(rgb_cube[:, :, 0]),
            green=np.asarray(rgb_cube[:, :, 1]),
            blue=np.asarray(rgb_cube[:, :, 2]),
            deslope_ref=deslope_ref,
            stage_timings_ms=timings.snapshot(),
        )
