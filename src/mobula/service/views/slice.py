from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.api_compute import _extract_2d_slice
from mobula.service.api_models import RangeMode, SampleMode
from mobula.service.api_utils import (
    _apply_sample_mode_reduction,
    _clamp_dim_bounds,
    _dim_size,
    _downsample_2d,
    _index_or_mid,
    _project_dims_by_mean,
    _uses_sample_reduction,
)
from mobula.service.views.serialization import (
    ScalarArrayPayload,
    serialize_axis_coords,
    serialize_scalar_payload_json,
    summarize_array,
)


def build_slice_payload(
    ds: CubeDataset,
    *,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    max_pixels: int | None,
    sample_mode: SampleMode,
    plane_x: str,
    plane_y: str,
    project_dims: tuple[str, ...] = (),
) -> ScalarArrayPayload:
    arr, selected_indices, selected_coords = _extract_2d_slice(
        ds=ds,
        plane_x=plane_x,
        plane_y=plane_y,
        sample_mode=sample_mode,
        sample=sample,
        pol=pol,
        t=t,
        nu=nu,
        x=x,
        y=y,
        z=z,
        project_dims=project_dims,
    )
    full_shape = [int(arr.shape[0]), int(arr.shape[1])]
    arr, sampling_step = _downsample_2d(arr, max_pixels)
    arr = np.asarray(arr, dtype=np.float32)

    return ScalarArrayPayload(
        metadata={
            "data_id": ds.data_id,
            "plane_dims": [plane_x, plane_y],
            "shape": [int(arr.shape[0]), int(arr.shape[1])],
            "full_shape": full_shape,
            "sampling_step": [int(sampling_step[0]), int(sampling_step[1])],
            "intensity_unit": ds.intensity_unit,
            "sample_mode": sample_mode,
            "selected_indices": selected_indices,
            "selected_coords": selected_coords,
            "coords": serialize_axis_coords(ds, [plane_x, plane_y]),
            "stats": summarize_array(arr),
        },
        values=arr,
    )


def build_slice_response(
    ds: CubeDataset,
    *,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    max_pixels: int | None,
    sample_mode: SampleMode,
    plane_x: str,
    plane_y: str,
    project_dims: tuple[str, ...] = (),
) -> dict[str, Any]:
    return serialize_scalar_payload_json(
        build_slice_payload(
            ds,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
            max_pixels=max_pixels,
            sample_mode=sample_mode,
            plane_x=plane_x,
            plane_y=plane_y,
            project_dims=project_dims,
        )
    )


def build_intensity_range_response(
    ds: CubeDataset,
    *,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    t0: int | None,
    t1: int | None,
    nu0: int | None,
    nu1: int | None,
    sample_mode: SampleMode,
    range_mode: RangeMode,
    plane_x: str,
    plane_y: str,
    project_dims: tuple[str, ...] = (),
) -> dict[str, Any]:
    spatial_dims = [d for d in ("x", "y", "z") if d in ds.dims]
    if plane_x == plane_y:
        raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
    for plane_dim in (plane_x, plane_y):
        if plane_dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"plane dim '{plane_dim}' not in dataset")
    projected = {dim for dim in project_dims}
    for dim in projected:
        if dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"project dim '{dim}' not in dataset")
        if dim in {plane_x, plane_y}:
            raise HTTPException(status_code=400, detail=f"cannot project visible plane dim '{dim}'")

    vary_dims: set[str]
    if range_mode == "none":
        vary_dims = {plane_x, plane_y}
    elif range_mode == "time":
        vary_dims = {plane_x, plane_y, "t"}
    elif range_mode == "spectral":
        vary_dims = {plane_x, plane_y, "nu"}
    elif range_mode == "time_spectral":
        vary_dims = {plane_x, plane_y, "t", "nu"}
    elif range_mode == "space":
        vary_dims = set(spatial_dims)
    else:
        vary_dims = set(spatial_dims)
        for dim in ("t", "nu"):
            if dim in ds.dims:
                vary_dims.add(dim)

    requested = {"sample": sample, "pol": pol, "t": t, "nu": nu, "x": x, "y": y, "z": z}

    slicer: list[int | slice] = []
    arr_dims: list[str] = []
    selected_indices: dict[str, int] = {}
    windows_applied: dict[str, list[int]] = {}

    for dim in ds.dims:
        if dim == "sample" and _uses_sample_reduction(sample_mode):
            slicer.append(slice(None))
            arr_dims.append(dim)
            continue

        if dim in vary_dims or dim in projected:
            if dim == "t" and "t" in ds.dims and (t0 is not None or t1 is not None):
                lo = 0 if t0 is None else t0
                hi = _dim_size(ds, "t") if t1 is None else t1
                lo, hi = _clamp_dim_bounds(ds, "t", lo, hi)
                slicer.append(slice(lo, hi))
                arr_dims.append(dim)
                windows_applied["t"] = [lo, hi]
                continue
            if dim == "nu" and "nu" in ds.dims and (nu0 is not None or nu1 is not None):
                lo = 0 if nu0 is None else nu0
                hi = _dim_size(ds, "nu") if nu1 is None else nu1
                lo, hi = _clamp_dim_bounds(ds, "nu", lo, hi)
                slicer.append(slice(lo, hi))
                arr_dims.append(dim)
                windows_applied["nu"] = [lo, hi]
                continue
            slicer.append(slice(None))
            arr_dims.append(dim)
            continue

        idx = _index_or_mid(ds, dim, requested.get(dim))
        selected_indices[dim] = idx
        slicer.append(idx)

    arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
    arr, arr_dims = _apply_sample_mode_reduction(arr, arr_dims, sample_mode, cast_float32=False)
    arr, arr_dims = _project_dims_by_mean(arr, arr_dims, projected, selected_indices, cast_float32=False)

    return {
        "data_id": ds.data_id,
        "sample_mode": sample_mode,
        "range_mode": range_mode,
        "vary_dims": [dim for dim in ds.dims if dim in vary_dims],
        "selected_indices": selected_indices,
        "windowed_dims": windows_applied,
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr)),
    }
