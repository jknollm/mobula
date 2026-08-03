from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.scene import RenderedSceneProfiles
from mobula.data.schema import CubeDataset
from mobula.service.api_compute import _profile_series, _profile_series_for_region
from mobula.service.api_models import HealpixProfilesRequest, PlaneProfilesRequest, ProfilesRequest, RoiStatsRequest
from mobula.service.api_utils import _clamp_dim_bounds, _clamp_roi_bounds, _index_or_mid


def build_profiles_response(ds: CubeDataset, req: ProfilesRequest) -> dict[str, Any]:
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


def build_plane_profiles_response(ds: CubeDataset, req: PlaneProfilesRequest) -> dict[str, Any]:
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


def _profile_series_for_x_indices(
    ds: CubeDataset,
    vary_dim: str,
    x_indices: np.ndarray,
    fixed_requested: dict[str, int | None],
    y_index: int | None,
) -> dict[str, Any]:
    if vary_dim not in ds.dims:
        raise HTTPException(status_code=400, detail=f"dataset missing '{vary_dim}' dimension")
    if "x" not in ds.dims:
        raise HTTPException(status_code=400, detail="dataset missing 'x' dimension")

    uniq = np.unique(np.asarray(x_indices, dtype=np.int64).reshape(-1))
    if uniq.size < 1:
        raise HTTPException(status_code=400, detail="no valid HEALPix pixel indices provided")

    x_size = ds.shape[ds.dim_index("x")]
    valid = uniq[(uniq >= 0) & (uniq < x_size)]
    if valid.size < 1:
        raise HTTPException(status_code=400, detail=f"HEALPix pixel indices out of bounds for x (size={x_size})")

    slicer: list[Any] = []
    kept_dims: list[str] = []
    fixed_indices: dict[str, int] = {}
    for dim in ds.dims:
        if dim == "sample":
            slicer.append(slice(None))
            kept_dims.append(dim)
        elif dim == vary_dim:
            slicer.append(slice(None))
            kept_dims.append(dim)
        elif dim == "x":
            slicer.append(slice(None))
            kept_dims.append(dim)
        elif dim == "y":
            yi = _index_or_mid(ds, "y", y_index)
            fixed_indices["y"] = yi
            slicer.append(yi)
        else:
            idx = _index_or_mid(ds, dim, fixed_requested.get(dim))
            fixed_indices[dim] = idx
            slicer.append(idx)

    arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
    if "sample" not in kept_dims:
        arr = arr[None, ...]
        kept_dims = ["sample"] + kept_dims

    axis_map = {dim: i for i, dim in enumerate(kept_dims)}
    arr = np.take(arr, valid, axis=axis_map["x"])
    arr = np.moveaxis(arr, [axis_map["sample"], axis_map[vary_dim]], [0, 1])
    if arr.ndim > 2:
        arr = arr.mean(axis=tuple(range(2, arr.ndim)), dtype=np.float64)
    arr = np.asarray(arr, dtype=np.float64)

    coords = np.asarray(ds.coords[vary_dim], dtype=np.float64).reshape(-1)
    return {
        "axis": vary_dim,
        "axis_unit": ds.units.get(vary_dim, "index"),
        "coords": coords.tolist(),
        "sample_count": int(arr.shape[0]),
        "series_mean": arr.mean(axis=0).tolist(),
        "series_std": arr.std(axis=0).tolist(),
        "per_sample": arr.tolist(),
        "fixed_indices": fixed_indices,
    }


def build_healpix_profiles_response(ds: CubeDataset, req: HealpixProfilesRequest) -> dict[str, Any]:
    for dim in ("x", "y", "t", "nu"):
        if dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"dataset missing '{dim}' dimension")

    x_indices = np.asarray(req.pixel_indices, dtype=np.int64).reshape(-1)
    if x_indices.size < 1:
        raise HTTPException(status_code=400, detail="pixel_indices cannot be empty")

    x_size = ds.shape[ds.dim_index("x")]
    x_indices = x_indices[(x_indices >= 0) & (x_indices < x_size)]
    if x_indices.size < 1:
        raise HTTPException(status_code=400, detail=f"HEALPix pixel indices out of bounds for x (size={x_size})")

    uniq_indices = np.unique(x_indices)
    fixed = {
        "sample": req.sample,
        "pol": req.pol,
        "t": req.t,
        "nu": req.nu,
        "z": req.z,
    }

    spatial_dims = [dim for dim in ("x", "y", "z") if dim in ds.dims and dim not in ("x", "y")]
    remaining_spatial = spatial_dims[0] if spatial_dims else None

    out: dict[str, Any] = {
        "data_id": ds.data_id,
        "plane": ["x", "y"],
        "selection": {"x_indices": uniq_indices.tolist(), "y": req.y if req.y is not None else 0},
        "pixel_count": int(uniq_indices.shape[0]),
        "intensity_unit": ds.intensity_unit,
        "time_profile": _profile_series_for_x_indices(ds, "t", uniq_indices, fixed, req.y),
        "spectrum_profile": _profile_series_for_x_indices(ds, "nu", uniq_indices, fixed, req.y),
    }
    if remaining_spatial is not None:
        out["spatial_axis"] = remaining_spatial
        out["spatial_profile"] = _profile_series_for_x_indices(ds, remaining_spatial, uniq_indices, fixed, req.y)
    return out


def build_roi_stats_response(ds: CubeDataset, req: RoiStatsRequest) -> dict[str, Any]:
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


def build_scene_profiles_response(data_id: str, rendered: RenderedSceneProfiles) -> dict[str, Any]:
    """Adapt an axis-generic sparse result to the existing profile canvases."""
    rendered.validate()
    profiles: dict[str, dict[str, Any]] = {}
    for axis, series in rendered.profiles.items():
        mean = np.asarray(series.series_mean, dtype=np.float64).reshape(-1)
        members = np.asarray(series.per_sample, dtype=np.float64)
        profiles[axis] = {
            "axis": axis,
            "axis_unit": series.axis_unit,
            "coords": np.asarray(series.coords).tolist(),
            "sample_count": int(members.shape[0]) if members.shape[0] else 1,
            "series_mean": mean.tolist(),
            "series_std": np.asarray(series.series_std, dtype=np.float64).reshape(-1).tolist(),
            "per_sample": members.tolist() if members.shape[0] else [mean.tolist()],
            "fixed_indices": dict(series.fixed_indices),
            "value_quantity": rendered.value_quantity,
            "value_unit": rendered.value_unit,
        }
    out: dict[str, Any] = {
        "data_id": data_id,
        "plane": list(rendered.spatial_window),
        "selection": {axis: list(bounds) for axis, bounds in rendered.spatial_window.items()},
        "pixel_count": rendered.pixel_count,
        "intensity_unit": rendered.value_unit,
        "value_quantity": rendered.value_quantity,
        "value_unit": rendered.value_unit,
        "spatial_reduction": rendered.spatial_reduction,
        "profiles": profiles,
    }
    if "t" in profiles:
        out["time_profile"] = profiles["t"]
    if "nu" in profiles:
        out["spectrum_profile"] = profiles["nu"]
    spatial_axes = [axis for axis in profiles if axis in {"x", "y", "z"}]
    if spatial_axes:
        out["spatial_axis"] = spatial_axes[0]
        out["spatial_profile"] = profiles[spatial_axes[0]]
    return out
