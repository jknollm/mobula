from __future__ import annotations

from typing import Any

from mobula.data.schema import CubeDataset
from mobula.service.api_models import SampleMode
from mobula.service.spectral_rgb import convert_mf_to_rgb_new
from mobula.service.views.evpa import build_evpa_response
from mobula.service.views.export import build_export_cutout_fits, build_export_cutout_hdf5
from mobula.service.views.multispectral import (
    _normalize_total_flux_brightness,
    _normalize_total_flux_brightness_xp,
)
from mobula.service.views.multispectral import build_multispectral_response as _build_multispectral_response
from mobula.service.views.slice import (
    build_intensity_range_response,
    build_scene_slice_payload,
    build_slice_payload,
    build_slice_response,
)
from mobula.service.views.volume import build_volume_payload, build_volume_response


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
    return _build_multispectral_response(
        ds,
        sample=sample,
        pol=pol,
        t=t,
        x=x,
        y=y,
        z=z,
        nu0=nu0,
        nu1=nu1,
        max_pixels=max_pixels,
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
        project_dims=project_dims,
    )


__all__ = [
    "_normalize_total_flux_brightness",
    "_normalize_total_flux_brightness_xp",
    "build_evpa_response",
    "build_export_cutout_fits",
    "build_export_cutout_hdf5",
    "build_intensity_range_response",
    "build_multispectral_response",
    "build_scene_slice_payload",
    "build_slice_payload",
    "build_slice_response",
    "build_volume_payload",
    "build_volume_response",
    "convert_mf_to_rgb_new",
]
