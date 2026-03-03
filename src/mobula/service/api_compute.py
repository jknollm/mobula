from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.api_models import SampleMode
from mobula.service.api_utils import _index_or_mid, _relative_uncertainty


def _profile_series_for_region(
    ds: CubeDataset,
    vary_dim: str,
    region_bounds: dict[str, tuple[int, int]],
    fixed_requested: dict[str, int | None],
) -> dict[str, Any]:
    if vary_dim not in ds.dims:
        raise HTTPException(status_code=400, detail=f"dataset missing '{vary_dim}' dimension")

    slicer: list[int | slice] = []
    kept_dims: list[str] = []
    fixed_indices: dict[str, int] = {}
    for dim in ds.dims:
        if dim == "sample":
            slicer.append(slice(None))
            kept_dims.append(dim)
        elif dim == vary_dim:
            slicer.append(slice(None))
            kept_dims.append(dim)
        elif dim in region_bounds:
            lo, hi = region_bounds[dim]
            slicer.append(slice(lo, hi))
            kept_dims.append(dim)
        else:
            idx = _index_or_mid(ds, dim, fixed_requested.get(dim))
            fixed_indices[dim] = idx
            slicer.append(idx)

    arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
    if "sample" not in kept_dims:
        arr = arr[None, ...]
        kept_dims = ["sample"] + kept_dims

    axis_map = {dim: i for i, dim in enumerate(kept_dims)}
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


def _profile_series(
    ds: CubeDataset,
    vary_dim: str,
    x0: int,
    x1: int,
    y0: int,
    y1: int,
    pol: int | None,
    t: int | None,
    nu: int | None,
    z: int | None,
) -> dict[str, Any]:
    return _profile_series_for_region(
        ds=ds,
        vary_dim=vary_dim,
        region_bounds={"x": (x0, x1), "y": (y0, y1)},
        fixed_requested={"pol": pol, "t": t, "nu": nu, "z": z},
    )


def _normalize_project_dims(project_dims: tuple[str, ...] | list[str] | None) -> set[str]:
    out: set[str] = set()
    if not project_dims:
        return out
    for raw in project_dims:
        dim = str(raw).strip().lower()
        if dim:
            out.add(dim)
    return out


def _extract_2d_slice(
    ds: CubeDataset,
    plane_x: str,
    plane_y: str,
    sample_mode: SampleMode,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    pol_override: int | None = None,
    project_dims: tuple[str, ...] | list[str] | None = None,
) -> tuple[np.ndarray, dict[str, int], dict[str, float]]:
    if plane_x == plane_y:
        raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
    for plane_dim in (plane_x, plane_y):
        if plane_dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"plane dim '{plane_dim}' not in dataset")
    if sample_mode != "single" and "sample" in (plane_x, plane_y):
        raise HTTPException(
            status_code=400,
            detail="sample_mode mean/std/rel_uncert is incompatible when sample is used as a plane dimension",
        )
    projected = _normalize_project_dims(project_dims)
    for dim in projected:
        if dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"project dim '{dim}' not in dataset")
        if dim in {plane_x, plane_y}:
            raise HTTPException(status_code=400, detail=f"cannot project visible plane dim '{dim}'")

    requested = {
        "sample": sample,
        "pol": pol_override if pol_override is not None else pol,
        "t": t,
        "nu": nu,
        "x": x,
        "y": y,
        "z": z,
    }

    slicer: list[int | slice] = []
    selected_indices: dict[str, int] = {}
    arr_dims: list[str] = []

    for dim in ds.dims:
        if dim in (plane_x, plane_y):
            slicer.append(slice(None))
            arr_dims.append(dim)
            continue

        if dim in projected:
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
        sample_axis = arr_dims.index("sample")
        if sample_mode == "mean":
            arr = arr.mean(axis=sample_axis, dtype=np.float64).astype(np.float32)
        elif sample_mode == "std":
            arr = arr.std(axis=sample_axis, dtype=np.float64).astype(np.float32)
        else:
            mean_arr = arr.mean(axis=sample_axis, dtype=np.float64)
            std_arr = arr.std(axis=sample_axis, dtype=np.float64)
            arr = _relative_uncertainty(mean_arr, std_arr).astype(np.float32)
        arr_dims = [d for d in arr_dims if d != "sample"]

    for dim in projected:
        if dim not in arr_dims:
            continue
        axis = arr_dims.index(dim)
        arr = arr.mean(axis=axis, dtype=np.float64).astype(np.float32)
        arr_dims.pop(axis)
        selected_indices.pop(dim, None)

    if arr.ndim != 2:
        raise HTTPException(
            status_code=500,
            detail=f"slice rank mismatch, expected 2D got {arr.ndim}",
        )

    if arr_dims == [plane_x, plane_y]:
        out = arr
    elif arr_dims == [plane_y, plane_x]:
        out = arr.T
    else:
        raise HTTPException(
            status_code=500,
            detail=f"slice dim mismatch, expected [{plane_x},{plane_y}] got {arr_dims}",
        )

    selected_coords = {dim: float(np.asarray(ds.coords[dim])[idx]) for dim, idx in selected_indices.items()}
    return out, selected_indices, selected_coords


def _extract_3d_volume(
    ds: CubeDataset,
    sample_mode: SampleMode,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    pol_override: int | None = None,
    project_dims: tuple[str, ...] | list[str] | None = None,
) -> tuple[np.ndarray, dict[str, int], dict[str, float]]:
    for dim in ("x", "y", "z"):
        if dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"dataset missing '{dim}' dimension")
    projected = _normalize_project_dims(project_dims)
    for dim in projected:
        if dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"project dim '{dim}' not in dataset")
        if dim in {"x", "y", "z"}:
            raise HTTPException(status_code=400, detail=f"cannot project visible volume dim '{dim}'")

    requested = {
        "sample": sample,
        "pol": pol_override if pol_override is not None else pol,
        "t": t,
        "nu": nu,
        "x": x,
        "y": y,
        "z": z,
    }

    slicer: list[int | slice] = []
    selected_indices: dict[str, int] = {}
    arr_dims: list[str] = []

    for dim in ds.dims:
        if dim in {"x", "y", "z"}:
            slicer.append(slice(None))
            arr_dims.append(dim)
            continue

        if dim in projected:
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
        sample_axis = arr_dims.index("sample")
        if sample_mode == "mean":
            arr = arr.mean(axis=sample_axis, dtype=np.float64).astype(np.float32)
        elif sample_mode == "std":
            arr = arr.std(axis=sample_axis, dtype=np.float64).astype(np.float32)
        else:
            mean_arr = arr.mean(axis=sample_axis, dtype=np.float64)
            std_arr = arr.std(axis=sample_axis, dtype=np.float64)
            arr = _relative_uncertainty(mean_arr, std_arr).astype(np.float32)
        arr_dims = [d for d in arr_dims if d != "sample"]

    for dim in projected:
        if dim not in arr_dims:
            continue
        axis = arr_dims.index(dim)
        arr = arr.mean(axis=axis, dtype=np.float64).astype(np.float32)
        arr_dims.pop(axis)
        selected_indices.pop(dim, None)

    if arr.ndim != 3:
        raise HTTPException(status_code=500, detail=f"volume rank mismatch, expected 3D got {arr.ndim}")

    expected = ["x", "y", "z"]
    if sorted(arr_dims) != sorted(expected):
        raise HTTPException(status_code=500, detail=f"volume dim mismatch, expected {expected} got {arr_dims}")
    if arr_dims != expected:
        perm = [arr_dims.index(d) for d in expected]
        arr = np.transpose(arr, perm)

    selected_coords = {dim: float(np.asarray(ds.coords[dim])[idx]) for dim, idx in selected_indices.items()}
    return arr, selected_indices, selected_coords
