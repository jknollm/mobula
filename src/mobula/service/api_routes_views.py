from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from mobula.service.api_utils import _parse_range_mode, _parse_sample_mode, _safe_dataset
from mobula.service.registry import DatasetRegistry
from mobula.service.view_service import (
    build_evpa_response,
    build_intensity_range_response,
    build_multispectral_response,
    build_slice_response,
    build_volume_response,
)


def _register_slice_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.get("/datasets/{data_id}/slice")
    def dataset_slice(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        max_pixels: int | None = Query(default=None, ge=1),
        sample_mode: str = Query(default="single"),
        plane_x: str = Query(default="x"),
        plane_y: str = Query(default="y"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        return build_slice_response(
            ds,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
            max_pixels=max_pixels,
            sample_mode=mode,
            plane_x=plane_x,
            plane_y=plane_y,
        )

    @router.get("/datasets/{data_id}/volume")
    def dataset_volume(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        sample_mode: str = Query(default="single"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        return build_volume_response(
            ds,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
            sample_mode=mode,
        )

    @router.get("/datasets/{data_id}/intensity-range")
    def intensity_range(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        t0: int | None = Query(default=None),
        t1: int | None = Query(default=None),
        nu0: int | None = Query(default=None),
        nu1: int | None = Query(default=None),
        sample_mode: str = Query(default="single"),
        range_mode: str = Query(default="none"),
        plane_x: str = Query(default="x"),
        plane_y: str = Query(default="y"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        rmode = _parse_range_mode(range_mode)
        return build_intensity_range_response(
            ds,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
            t0=t0,
            t1=t1,
            nu0=nu0,
            nu1=nu1,
            sample_mode=mode,
            range_mode=rmode,
            plane_x=plane_x,
            plane_y=plane_y,
        )

    @router.get("/datasets/{data_id}/evpa")
    def evpa_ticks(
        data_id: str,
        sample: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        z: int | None = Query(default=None),
        sample_mode: str = Query(default="mean"),
        step: int = Query(default=8, ge=2, le=32),
        min_fraction: float = Query(default=0.05, ge=0.0, le=1.0),
        i_min_fraction: float = Query(default=0.0, ge=0.0, le=1.0),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        return build_evpa_response(
            ds,
            sample=sample,
            t=t,
            nu=nu,
            z=z,
            sample_mode=mode,
            step=step,
            min_fraction=min_fraction,
            i_min_fraction=i_min_fraction,
        )

    @router.get("/datasets/{data_id}/multispectral")
    def multispectral_slice(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        nu0: int | None = Query(default=None),
        nu1: int | None = Query(default=None),
        max_pixels: int | None = Query(default=None, ge=1),
        sample_mode: str = Query(default="single"),
        plane_x: str = Query(default="x"),
        plane_y: str = Query(default="y"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        return build_multispectral_response(
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
            sample_mode=mode,
            plane_x=plane_x,
            plane_y=plane_y,
        )
