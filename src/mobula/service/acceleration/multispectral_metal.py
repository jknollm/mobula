from __future__ import annotations

from functools import lru_cache
from typing import Any

import numpy as np

from mobula.service.acceleration.compute_base import (
    ComputeBackendUnavailableError,
    MultispectralComputeBackend,
    MultispectralComputeRequest,
    MultispectralComputeResult,
)
from mobula.service.acceleration.multispectral_common import BRIGHTNESS_SCALE_QUANTILE
from mobula.service.perf import StageTimings
from mobula.service.spectral_rgb import _MATRIX_SRGB_D65, _integration_weights, _xyz_from_wavelengths


def _torch_mps_or_none() -> Any | None:
    try:
        import torch
    except Exception:
        return None
    try:
        mps = getattr(torch.backends, "mps", None)
        if mps is None or not bool(mps.is_built()) or not bool(mps.is_available()):
            return None
    except Exception:
        return None
    return torch


def _normalize_total_flux_brightness_torch(
    total_flux: Any,
    *,
    intensity_mode: str,
    clip_min: float,
    clip_max: float,
    torch: Any,
    dynamic_range: float = 2.5e3,
) -> Any:
    finite = torch.isfinite(total_flux)
    positive = total_flux[finite & (total_flux > 0.0)]
    if int(positive.numel()) < 1:
        return torch.zeros_like(total_flux, dtype=torch.float32)
    reference = (
        torch.quantile(positive, BRIGHTNESS_SCALE_QUANTILE)
        if int(positive.numel()) >= 16
        else positive.amax()
    )

    hi = reference * float(clip_max)
    if intensity_mode == "log":
        if clip_min > 0.0:
            lo = reference * clip_min
        else:
            lo = hi / max(dynamic_range, 1.0 + 1.0e-12)
        lo = torch.clamp(lo, min=np.finfo(np.float32).tiny)
        hi = torch.maximum(hi, lo * (1.0 + 1.0e-12))
        clipped = torch.clamp(total_flux, min=lo, max=hi)
        return torch.log(clipped / lo) / torch.log(hi / lo)

    lo = torch.clamp(reference * float(clip_min), min=0.0)
    hi = torch.maximum(hi, lo + 1.0e-12)
    norm = torch.clamp((total_flux - lo) / (hi - lo), min=0.0, max=1.0)
    if intensity_mode == "sqrt":
        norm = torch.sqrt(norm)
    return norm


@lru_cache(maxsize=16)
def _weighted_response_tensor_cached(wavelength_axis_key: bytes) -> Any:
    torch = _torch_mps_or_none()
    if torch is None:
        raise ComputeBackendUnavailableError("metal", "PyTorch MPS is unavailable")
    axis = np.frombuffer(wavelength_axis_key, dtype=np.float32)
    response = _xyz_from_wavelengths(axis.astype(np.float64, copy=False))
    weights = _integration_weights(axis.astype(np.float64, copy=False))
    return torch.as_tensor(
        (response * weights[np.newaxis, :]).astype(np.float32),
        dtype=torch.float32,
        device=torch.device("mps"),
    )


@lru_cache(maxsize=1)
def _srgb_matrix_tensor() -> Any:
    torch = _torch_mps_or_none()
    if torch is None:
        raise ComputeBackendUnavailableError("metal", "PyTorch MPS is unavailable")
    return torch.as_tensor(_MATRIX_SRGB_D65.astype(np.float32), dtype=torch.float32, device=torch.device("mps"))


@lru_cache(maxsize=1)
def _luma_vector_tensor() -> Any:
    torch = _torch_mps_or_none()
    if torch is None:
        raise ComputeBackendUnavailableError("metal", "PyTorch MPS is unavailable")
    return torch.as_tensor([0.2126, 0.7152, 0.0722], dtype=torch.float32, device=torch.device("mps"))


class MetalMultispectralBackend(MultispectralComputeBackend):
    backend_name = "metal"

    def compute(self, request: MultispectralComputeRequest) -> MultispectralComputeResult:
        torch = _torch_mps_or_none()
        if torch is None:
            raise ComputeBackendUnavailableError(self.backend_name, "PyTorch MPS is unavailable")

        timings = StageTimings(
            [
                "spectrum_normalization",
                "deslope_weighting",
                "chroma_preparation",
                "spectral_to_rgb_conversion",
                "brightness_scaling",
            ]
        )

        device = torch.device("mps")
        arr = torch.as_tensor(np.asarray(request.spectral_cube, dtype=np.float32), dtype=torch.float32, device=device)
        deslope_ref: float | None = None
        weighted_response = _weighted_response_tensor_cached(
            np.ascontiguousarray(request.wavelength_axis_nm, dtype=np.float32).tobytes()
        )
        srgb_matrix = _srgb_matrix_tensor()
        luma_vector = _luma_vector_tensor()

        with torch.inference_mode():
            total_flux = torch.clamp(arr, min=0.0).sum(dim=0)

            with timings.stage("spectrum_normalization"):
                if request.normalize_spectrum:
                    mean_spectrum = arr.mean(dim=(1, 2))
                    finite = torch.isfinite(mean_spectrum)
                    median_input = torch.where(finite, torch.abs(mean_spectrum), torch.zeros_like(mean_spectrum))
                    median_abs = torch.median(median_input)
                    floor = torch.clamp(median_abs * 1.0e-12, min=np.finfo(np.float32).tiny)
                    scale = torch.where(finite & (torch.abs(mean_spectrum) >= floor), mean_spectrum, torch.ones_like(mean_spectrum))
                    normalized = arr / scale.view(-1, 1, 1)
                    if request.normalize_boost != 1.0:
                        positive = normalized > 0.0
                        arr = torch.where(
                            positive,
                            torch.pow(torch.clamp(normalized, min=floor), request.normalize_boost),
                            normalized * request.normalize_boost,
                        )
                    else:
                        arr = normalized

            with timings.stage("deslope_weighting"):
                if float(request.deslope) != 0.0:
                    nu_abs = np.abs(np.asarray(request.nu_coords, dtype=np.float64))
                    valid = np.isfinite(nu_abs) & (nu_abs > 0)
                    if np.any(valid):
                        deslope_ref = float(np.median(nu_abs[valid]))
                        weights = np.ones(arr.shape[0], dtype=np.float32)
                        weights[valid] = np.power(nu_abs[valid] / deslope_ref, float(request.deslope)).astype(np.float32)
                        arr = arr * torch.as_tensor(weights, dtype=torch.float32, device=device).view(-1, 1, 1)

            with timings.stage("chroma_preparation"):
                arr_chroma = torch.clamp(arr.permute(1, 2, 0), min=0.0)
                denom = torch.clamp(arr_chroma.sum(dim=-1, keepdim=True), min=np.finfo(np.float32).tiny)
                arr_chroma = arr_chroma / denom

            with timings.stage("spectral_to_rgb_conversion"):
                xyz_data = torch.einsum("hwc,kc->hwk", arr_chroma, weighted_response)
                rgb_linear = torch.einsum("hwc,kc->hwk", xyz_data, srgb_matrix)
                low_mask = rgb_linear <= 0.0031308
                gamma_hi = (1.0 + 0.055) * torch.pow(torch.clamp(rgb_linear, min=0.0031308), 1.0 / 2.4) - 0.055
                rgb_cube = torch.where(low_mask, 12.92 * rgb_linear, gamma_hi)
                rgb_cube = torch.clamp(rgb_cube, min=0.0, max=1.0)

            with timings.stage("brightness_scaling"):
                brightness = _normalize_total_flux_brightness_torch(
                    total_flux,
                    intensity_mode=request.intensity_mode,
                    clip_min=request.clip_min,
                    clip_max=request.clip_max,
                    torch=torch,
                )
                luma = torch.einsum("hwc,c->hw", rgb_cube, luma_vector)
                scale = brightness / torch.clamp(luma, min=1.0e-6)
                rgb_cube = torch.clamp(rgb_cube * scale.unsqueeze(-1), min=0.0, max=1.0)

            rgb_cpu = rgb_cube.detach().cpu().numpy()
        return MultispectralComputeResult(
            backend=self.backend_name,
            red=np.asarray(rgb_cpu[:, :, 0]),
            green=np.asarray(rgb_cpu[:, :, 1]),
            blue=np.asarray(rgb_cpu[:, :, 2]),
            deslope_ref=deslope_ref,
            stage_timings_ms=timings.snapshot(),
        )
