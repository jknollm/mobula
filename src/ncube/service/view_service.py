from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from ncube.data.schema import CubeDataset
from ncube.service.api_compute import _extract_2d_slice, _extract_3d_volume
from ncube.service.api_models import RangeMode, SampleMode
from ncube.service.api_utils import _clamp_dim_bounds, _dim_size, _downsample_2d, _index_or_mid, _relative_uncertainty


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
) -> dict[str, Any]:
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
    )
    full_shape = [int(arr.shape[0]), int(arr.shape[1])]
    arr, sampling_step = _downsample_2d(arr, max_pixels)

    coords_x = np.asarray(ds.coords[plane_x], dtype=np.float64)
    coords_y = np.asarray(ds.coords[plane_y], dtype=np.float64)

    return {
        "data_id": ds.data_id,
        "plane_dims": [plane_x, plane_y],
        "shape": [int(arr.shape[0]), int(arr.shape[1])],
        "full_shape": full_shape,
        "sampling_step": [int(sampling_step[0]), int(sampling_step[1])],
        "intensity_unit": ds.intensity_unit,
        "sample_mode": sample_mode,
        "selected_indices": selected_indices,
        "selected_coords": selected_coords,
        "coords": {
            plane_x: coords_x.tolist(),
            plane_y: coords_y.tolist(),
            f"{plane_x}_unit": ds.units[plane_x],
            f"{plane_y}_unit": ds.units[plane_y],
        },
        "stats": {
            "min": float(np.min(arr)),
            "max": float(np.max(arr)),
            "mean": float(np.mean(arr)),
            "std": float(np.std(arr)),
        },
        "values": arr.ravel().tolist(),
    }


def build_volume_response(
    ds: CubeDataset,
    *,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    sample_mode: SampleMode,
) -> dict[str, Any]:
    arr, selected_indices, selected_coords = _extract_3d_volume(
        ds=ds,
        sample_mode=sample_mode,
        sample=sample,
        pol=pol,
        t=t,
        nu=nu,
        x=x,
        y=y,
        z=z,
    )

    coords_x = np.asarray(ds.coords["x"], dtype=np.float64)
    coords_y = np.asarray(ds.coords["y"], dtype=np.float64)
    coords_z = np.asarray(ds.coords["z"], dtype=np.float64)
    return {
        "data_id": ds.data_id,
        "volume_dims": ["x", "y", "z"],
        "shape": [int(arr.shape[0]), int(arr.shape[1]), int(arr.shape[2])],
        "intensity_unit": ds.intensity_unit,
        "sample_mode": sample_mode,
        "selected_indices": selected_indices,
        "selected_coords": selected_coords,
        "coords": {
            "x": coords_x.tolist(),
            "y": coords_y.tolist(),
            "z": coords_z.tolist(),
            "x_unit": ds.units["x"],
            "y_unit": ds.units["y"],
            "z_unit": ds.units["z"],
        },
        "stats": {
            "min": float(np.min(arr)),
            "max": float(np.max(arr)),
            "mean": float(np.mean(arr)),
            "std": float(np.std(arr)),
        },
        "values": arr.ravel().tolist(),
    }


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
) -> dict[str, Any]:
    spatial_dims = [d for d in ("x", "y", "z") if d in ds.dims]
    if plane_x == plane_y:
        raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
    for plane_dim in (plane_x, plane_y):
        if plane_dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"plane dim '{plane_dim}' not in dataset")

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
    else:  # full
        vary_dims = set(spatial_dims)
        for d in ("t", "nu"):
            if d in ds.dims:
                vary_dims.add(d)

    requested = {"sample": sample, "pol": pol, "t": t, "nu": nu, "x": x, "y": y, "z": z}

    slicer: list[int | slice] = []
    arr_dims: list[str] = []
    selected_indices: dict[str, int] = {}
    windows_applied: dict[str, list[int]] = {}

    for dim in ds.dims:
        if dim == "sample" and sample_mode in {"mean", "std", "rel_uncert"}:
            slicer.append(slice(None))
            arr_dims.append(dim)
            continue

        if dim in vary_dims:
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
    if sample_mode in {"mean", "std", "rel_uncert"} and "sample" in arr_dims:
        s_axis = arr_dims.index("sample")
        if sample_mode == "mean":
            arr = arr.mean(axis=s_axis, dtype=np.float64)
        elif sample_mode == "std":
            arr = arr.std(axis=s_axis, dtype=np.float64)
        else:
            mean_arr = arr.mean(axis=s_axis, dtype=np.float64)
            std_arr = arr.std(axis=s_axis, dtype=np.float64)
            arr = _relative_uncertainty(mean_arr, std_arr)

    return {
        "data_id": ds.data_id,
        "sample_mode": sample_mode,
        "range_mode": range_mode,
        "vary_dims": [d for d in ds.dims if d in vary_dims],
        "selected_indices": selected_indices,
        "windowed_dims": windows_applied,
        "min": float(np.min(arr)),
        "max": float(np.max(arr)),
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr)),
    }


def build_evpa_response(
    ds: CubeDataset,
    *,
    sample: int | None,
    t: int | None,
    nu: int | None,
    z: int | None,
    sample_mode: SampleMode,
    step: int,
    min_fraction: float,
    i_min_fraction: float,
) -> dict[str, Any]:
    if "pol" not in ds.dims:
        raise HTTPException(status_code=400, detail="dataset has no polarization axis")
    if _dim_size(ds, "pol") < 3:
        raise HTTPException(status_code=400, detail="dataset needs at least I,Q,U polarization channels")

    i_arr, _, _ = _extract_2d_slice(
        ds=ds,
        plane_x="x",
        plane_y="y",
        sample_mode=sample_mode,
        sample=sample,
        pol=0,
        t=t,
        nu=nu,
        x=None,
        y=None,
        z=z,
        pol_override=0,
    )
    q_arr, _, _ = _extract_2d_slice(
        ds=ds,
        plane_x="x",
        plane_y="y",
        sample_mode=sample_mode,
        sample=sample,
        pol=1,
        t=t,
        nu=nu,
        x=None,
        y=None,
        z=z,
        pol_override=1,
    )
    u_arr, _, _ = _extract_2d_slice(
        ds=ds,
        plane_x="x",
        plane_y="y",
        sample_mode=sample_mode,
        sample=sample,
        pol=2,
        t=t,
        nu=nu,
        x=None,
        y=None,
        z=z,
        pol_override=2,
    )

    p_arr = np.sqrt(q_arr * q_arr + u_arr * u_arr).astype(np.float32)
    i_abs_raw = np.abs(i_arr).astype(np.float32)
    i_abs = np.maximum(i_abs_raw, 1.0e-6).astype(np.float32)
    frac = p_arr / i_abs
    i_peak = float(np.max(i_abs_raw)) if i_abs_raw.size else 0.0
    i_threshold = max(0.0, i_min_fraction) * i_peak
    valid_for_scale = i_abs_raw >= i_threshold
    if np.any(valid_for_scale):
        frac_ref = float(np.quantile(frac[valid_for_scale], 0.95))
    else:
        frac_ref = 1.0
    frac_ref = max(frac_ref, min_fraction, 1.0e-6)

    ticks: list[dict[str, float]] = []
    offset = max(1, step // 2)
    x_max, y_max = p_arr.shape
    for ix in range(offset, x_max, step):
        for iy in range(offset, y_max, step):
            if float(i_abs_raw[ix, iy]) < i_threshold:
                continue
            f = float(frac[ix, iy])
            if f < min_fraction:
                continue
            psi = 0.5 * float(np.arctan2(float(u_arr[ix, iy]), float(q_arr[ix, iy])))
            amp = min(1.0, max(0.25, f / frac_ref))
            length = 0.45 * step * amp
            ticks.append(
                {
                    "x": float(ix),
                    "y": float(iy),
                    "dx": float(length * np.cos(psi)),
                    "dy": float(length * np.sin(psi)),
                }
            )

    return {
        "data_id": ds.data_id,
        "sample_mode": sample_mode,
        "step": step,
        "min_fraction": min_fraction,
        "i_min_fraction": i_min_fraction,
        "tick_count": len(ticks),
        "ticks": ticks,
    }


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
) -> dict[str, Any]:
    if "nu" not in ds.dims:
        raise HTTPException(status_code=400, detail="dataset has no 'nu' axis")
    if plane_x == plane_y:
        raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
    if "nu" in (plane_x, plane_y):
        raise HTTPException(status_code=400, detail="multispectral view requires plane without 'nu'")
    for plane_dim in (plane_x, plane_y):
        if plane_dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"plane dim '{plane_dim}' not in dataset")

    requested = {"sample": sample, "pol": pol, "t": t, "x": x, "y": y, "z": z}

    slicer: list[int | slice] = []
    arr_dims: list[str] = []
    selected_indices: dict[str, int] = {}
    for dim in ds.dims:
        if dim == "nu" or dim in (plane_x, plane_y):
            slicer.append(slice(None))
            arr_dims.append(dim)
            continue
        if dim == "sample" and sample_mode in {"mean", "std", "rel_uncert"}:
            slicer.append(slice(None))
            arr_dims.append(dim)
            continue
        idx = _index_or_mid(ds, dim, requested.get(dim))
        selected_indices[dim] = idx
        slicer.append(idx)

    arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
    if sample_mode in {"mean", "std", "rel_uncert"} and "sample" in arr_dims:
        s_axis = arr_dims.index("sample")
        if sample_mode == "mean":
            arr = arr.mean(axis=s_axis, dtype=np.float64).astype(np.float32)
        elif sample_mode == "std":
            arr = arr.std(axis=s_axis, dtype=np.float64).astype(np.float32)
        else:
            mean_arr = arr.mean(axis=s_axis, dtype=np.float64)
            std_arr = arr.std(axis=s_axis, dtype=np.float64)
            arr = _relative_uncertainty(mean_arr, std_arr).astype(np.float32)
        arr_dims = [d for d in arr_dims if d != "sample"]

    expected = ["nu", plane_x, plane_y]
    if sorted(arr_dims) != sorted(expected):
        raise HTTPException(status_code=500, detail=f"multispectral dims mismatch: {arr_dims}")
    if arr_dims != expected:
        perm = [arr_dims.index(d) for d in expected]
        arr = np.transpose(arr, perm)

    full_nu = arr.shape[0]
    lo = 0 if nu0 is None else nu0
    hi = full_nu if nu1 is None else nu1
    lo, hi = _clamp_dim_bounds(ds, "nu", lo, hi)
    arr = arr[lo:hi]

    n_nu = arr.shape[0]
    if n_nu < 3:
        raise HTTPException(status_code=400, detail="need at least 3 spectral channels for multispectral RGB")

    edges = np.linspace(0, n_nu, 4, dtype=int)
    edges[1] = max(edges[1], 1)
    edges[2] = max(edges[2], edges[1] + 1)
    edges[3] = n_nu
    b = arr[edges[0] : edges[1]].mean(axis=0, dtype=np.float64)
    g = arr[edges[1] : edges[2]].mean(axis=0, dtype=np.float64)
    r = arr[edges[2] : edges[3]].mean(axis=0, dtype=np.float64)
    full_shape = [int(r.shape[0]), int(r.shape[1])]
    r, sampling_step = _downsample_2d(r, max_pixels)
    g = g[:: sampling_step[0], :: sampling_step[1]]
    b = b[:: sampling_step[0], :: sampling_step[1]]

    nu_coords = np.asarray(ds.coords["nu"], dtype=np.float64).reshape(-1)[lo:hi]
    return {
        "data_id": ds.data_id,
        "plane_dims": [plane_x, plane_y],
        "shape": [int(r.shape[0]), int(r.shape[1])],
        "full_shape": full_shape,
        "sampling_step": [int(sampling_step[0]), int(sampling_step[1])],
        "sample_mode": sample_mode,
        "selected_indices": selected_indices,
        "bands": {
            "blue": [float(nu_coords[edges[0]]), float(nu_coords[max(edges[1] - 1, edges[0])])],
            "green": [float(nu_coords[edges[1]]), float(nu_coords[max(edges[2] - 1, edges[1])])],
            "red": [float(nu_coords[edges[2]]), float(nu_coords[max(edges[3] - 1, edges[2])])],
            "unit": ds.units.get("nu", "Hz"),
        },
        "values": {"r": r.ravel().tolist(), "g": g.ravel().tolist(), "b": b.ravel().tolist()},
    }
