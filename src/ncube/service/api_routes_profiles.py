from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException

from ncube.service.api_compute import _profile_series, _profile_series_for_region
from ncube.service.api_models import PlaneProfilesRequest, ProfilesRequest, RoiStatsRequest
from ncube.service.api_utils import _clamp_dim_bounds, _clamp_roi_bounds, _index_or_mid, _safe_dataset
from ncube.service.registry import DatasetRegistry

def _register_profile_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.post("/datasets/{data_id}/profiles")
    def profiles(data_id: str, req: ProfilesRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        for required in ("x", "y", "t", "nu"):
            if required not in ds.dims:
                raise HTTPException(status_code=400, detail=f"dataset missing '{required}' dimension")
        x0, x1, y0, y1 = _clamp_roi_bounds(ds, req.x0, req.x1, req.y0, req.y1)

        return {
            "data_id": ds.data_id,
            "selection": {"x0": x0, "x1": x1, "y0": y0, "y1": y1},
            "pixel_count": int((x1 - x0) * (y1 - y0)),
            "intensity_unit": ds.intensity_unit,
            "time_profile": _profile_series(
                ds=ds,
                vary_dim="t",
                x0=x0,
                x1=x1,
                y0=y0,
                y1=y1,
                pol=req.pol,
                t=req.t,
                nu=req.nu,
                z=req.z,
            ),
            "spectrum_profile": _profile_series(
                ds=ds,
                vary_dim="nu",
                x0=x0,
                x1=x1,
                y0=y0,
                y1=y1,
                pol=req.pol,
                t=req.t,
                nu=req.nu,
                z=req.z,
            ),
        }

    @router.post("/datasets/{data_id}/profiles-plane")
    def profiles_plane(data_id: str, req: PlaneProfilesRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        if req.plane_x == req.plane_y:
            raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
        for dim in (req.plane_x, req.plane_y, "t", "nu"):
            if dim not in ds.dims:
                raise HTTPException(status_code=400, detail=f"dataset missing '{dim}' dimension")

        u0, u1 = _clamp_dim_bounds(ds, req.plane_x, req.u0, req.u1)
        v0, v1 = _clamp_dim_bounds(ds, req.plane_y, req.v0, req.v1)
        region = {req.plane_x: (u0, u1), req.plane_y: (v0, v1)}
        fixed = {
            "sample": req.sample,
            "pol": req.pol,
            "t": req.t,
            "nu": req.nu,
            "x": req.x,
            "y": req.y,
            "z": req.z,
        }
        spatial_dims = [dim for dim in ("x", "y", "z") if dim in ds.dims and dim not in (req.plane_x, req.plane_y)]
        remaining_spatial = spatial_dims[0] if spatial_dims else None

        out: dict[str, Any] = {
            "data_id": ds.data_id,
            "plane": [req.plane_x, req.plane_y],
            "selection": {req.plane_x: [u0, u1], req.plane_y: [v0, v1]},
            "pixel_count": int((u1 - u0) * (v1 - v0)),
            "intensity_unit": ds.intensity_unit,
            "time_profile": _profile_series_for_region(ds, "t", region, fixed),
            "spectrum_profile": _profile_series_for_region(ds, "nu", region, fixed),
        }
        if remaining_spatial is not None:
            out["spatial_axis"] = remaining_spatial
            out["spatial_profile"] = _profile_series_for_region(ds, remaining_spatial, region, fixed)
        return out

    @router.post("/datasets/{data_id}/roi-stats")
    def roi_stats(data_id: str, req: RoiStatsRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        for required in ("x", "y"):
            if required not in ds.dims:
                raise HTTPException(status_code=400, detail=f"dataset missing '{required}' dimension")

        x0, x1, y0, y1 = _clamp_roi_bounds(ds, req.x0, req.x1, req.y0, req.y1)

        requested = {"pol": req.pol, "t": req.t, "nu": req.nu, "z": req.z}
        slicer: list[int | slice] = []
        kept_dims: list[str] = []
        for dim in ds.dims:
            if dim == "sample":
                slicer.append(slice(None))
                kept_dims.append(dim)
            elif dim == "x":
                slicer.append(slice(x0, x1))
                kept_dims.append(dim)
            elif dim == "y":
                slicer.append(slice(y0, y1))
                kept_dims.append(dim)
            else:
                idx = _index_or_mid(ds, dim, requested.get(dim))
                slicer.append(idx)

        roi = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)

        if "sample" not in kept_dims:
            roi = roi[None, ...]
            kept_dims = ["sample"] + kept_dims

        axis_map = {dim: i for i, dim in enumerate(kept_dims)}
        roi = np.moveaxis(roi, [axis_map["sample"], axis_map["x"], axis_map["y"]], [0, 1, 2])
        per_sample_mean = roi.mean(axis=(1, 2), dtype=np.float64)

        q16, q50, q84 = np.quantile(per_sample_mean, [0.16, 0.5, 0.84]).tolist()
        return {
            "data_id": ds.data_id,
            "roi_bounds": {"x0": x0, "x1": x1, "y0": y0, "y1": y1},
            "sample_count": int(per_sample_mean.shape[0]),
            "pixel_count": int((x1 - x0) * (y1 - y0)),
            "intensity_unit": ds.intensity_unit,
            "stats": {
                "mean": float(np.mean(per_sample_mean)),
                "std": float(np.std(per_sample_mean)),
                "q16": float(q16),
                "q50": float(q50),
                "q84": float(q84),
            },
            "per_sample_means": per_sample_mean.tolist(),
        }

