from __future__ import annotations

import io
import json
from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.api_compute import _extract_2d_slice, _extract_3d_volume
from mobula.service.api_models import RangeMode, SampleMode
from mobula.service.api_utils import _clamp_dim_bounds, _dim_size, _downsample_2d, _index_or_mid, _relative_uncertainty


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
    project_dims: tuple[str, ...] = (),
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
        project_dims=project_dims,
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
        arr_dims = [d for d in arr_dims if d != "sample"]

    for dim in projected:
        if dim not in arr_dims:
            continue
        axis = arr_dims.index(dim)
        arr = arr.mean(axis=axis, dtype=np.float64)
        arr_dims.pop(axis)
        selected_indices.pop(dim, None)

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
    project_dims: tuple[str, ...] = (),
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
        project_dims=project_dims,
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
        project_dims=project_dims,
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
        project_dims=project_dims,
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
    project_dims: tuple[str, ...] = (),
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
    projected = {dim for dim in project_dims}
    for dim in projected:
        if dim not in ds.dims:
            raise HTTPException(status_code=400, detail=f"project dim '{dim}' not in dataset")
        if dim in {plane_x, plane_y, "nu"}:
            raise HTTPException(status_code=400, detail=f"cannot project multispectral dim '{dim}'")

    requested = {"sample": sample, "pol": pol, "t": t, "x": x, "y": y, "z": z}

    slicer: list[int | slice] = []
    arr_dims: list[str] = []
    selected_indices: dict[str, int] = {}
    for dim in ds.dims:
        if dim == "nu" or dim in (plane_x, plane_y):
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

    for dim in projected:
        if dim not in arr_dims:
            continue
        axis = arr_dims.index(dim)
        arr = arr.mean(axis=axis, dtype=np.float64).astype(np.float32)
        arr_dims.pop(axis)
        selected_indices.pop(dim, None)

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


def _finite_float(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(out):
        return None
    return out


def _coord_step(coords: np.ndarray) -> float:
    if coords.size >= 2:
        step = _finite_float(coords[1] - coords[0])
        if step is not None and abs(step) > 0:
            return step
    return 1.0


def _healpix_nside_from_npix(npix: int) -> int | None:
    if npix <= 0 or npix % 12 != 0:
        return None
    nside_sq = npix // 12
    nside = int(round(nside_sq**0.5))
    if nside * nside != nside_sq:
        return None
    return nside


def _parse_healpix_ordering(ds: CubeDataset) -> str:
    candidates: list[Any] = []
    if isinstance(ds.wcs, dict):
        candidates.extend([ds.wcs.get("healpix_ordering"), ds.wcs.get("healpix_order")])
    if isinstance(ds.provenance, dict):
        candidates.extend([ds.provenance.get("healpix_ordering"), ds.provenance.get("healpix_order")])
    for value in candidates:
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"ring", "nested"}:
                return lowered
    return "ring"


def _build_export_header(
    ds: CubeDataset,
    out_dims: list[str],
    bounds_by_dim: dict[str, tuple[int, int]],
    coords_by_dim: dict[str, np.ndarray],
    sample_mode: SampleMode,
    plane_x: str,
    plane_y: str,
    selected_indices: dict[str, int],
    explicit_indices_by_dim: dict[str, np.ndarray] | None = None,
) -> Any:
    from astropy.io import fits

    explicit_indices_by_dim = explicit_indices_by_dim or {}
    hdr = fits.Header()
    if ds.intensity_unit:
        hdr["BUNIT"] = str(ds.intensity_unit)
    hdr["MBMODE"] = str(sample_mode)
    hdr["MBPLNX"] = str(plane_x)
    hdr["MBPLNY"] = str(plane_y)
    for dim, idx in selected_indices.items():
        if dim in {"sample", "pol", "t", "nu", "x", "y", "z"}:
            hdr[f"MB{dim.upper()}"] = int(idx)

    fits_global = ds.wcs.get("fits_global", {}) if isinstance(ds.wcs, dict) else {}
    if isinstance(fits_global, dict):
        for key, value in fits_global.items():
            if not isinstance(key, str) or not key:
                continue
            if value is None:
                continue
            try:
                hdr[key[:8]] = value
            except Exception:
                continue

    fits_axes = ds.wcs.get("fits_axes", {}) if isinstance(ds.wcs, dict) else {}
    if not isinstance(fits_axes, dict):
        fits_axes = {}

    fits_matrix = ds.wcs.get("fits_matrix", {}) if isinstance(ds.wcs, dict) else {}
    if isinstance(fits_matrix, dict) and len(out_dims) == len(ds.dims):
        for key, value in fits_matrix.items():
            if not isinstance(key, str):
                continue
            fv = _finite_float(value)
            if fv is None:
                continue
            hdr[key] = fv

    if "x" in explicit_indices_by_dim:
        ordering = _parse_healpix_ordering(ds)
        nside = _healpix_nside_from_npix(_dim_size(ds, "x"))
        hdr["PIXTYPE"] = "HEALPIX"
        hdr["INDXSCHM"] = "EXPLICIT"
        hdr["ORDERING"] = "NESTED" if ordering == "nested" else "RING"
        if nside is not None:
            hdr["NSIDE"] = int(nside)
        hdr["MBXEXPL"] = 1

    for axis, dim in enumerate(reversed(out_dims), start=1):
        axis_meta = fits_axes.get(dim, {}) if isinstance(fits_axes.get(dim), dict) else {}
        explicit_idx = explicit_indices_by_dim.get(dim)
        lo = bounds_by_dim.get(dim, (0, _dim_size(ds, dim)))[0]
        if explicit_idx is not None and explicit_idx.size:
            lo = int(explicit_idx[0])
        coords = coords_by_dim[dim]
        ctype = str(axis_meta.get("ctype", dim.upper()))
        cunit = str(axis_meta.get("cunit", ds.units.get(dim, "")))

        crval = _finite_float(axis_meta.get("crval"))
        cdelt = _finite_float(axis_meta.get("cdelt"))
        crpix = _finite_float(axis_meta.get("crpix"))

        if explicit_idx is not None:
            crpix = 1.0
            cdelt = 1.0
            crval = float(coords[0]) if coords.size else 0.0
        elif crpix is not None:
            crpix = crpix - float(lo)
        else:
            crpix = 1.0
        if cdelt is None:
            cdelt = _coord_step(coords)
        if crval is None:
            crval = float(coords[0]) if coords.size else 0.0

        hdr[f"CTYPE{axis}"] = ctype
        if cunit:
            hdr[f"CUNIT{axis}"] = cunit
        hdr[f"CRPIX{axis}"] = float(crpix)
        hdr[f"CRVAL{axis}"] = float(crval)
        hdr[f"CDELT{axis}"] = float(cdelt)

    return hdr


def _build_export_cutout_core(
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
    plane_x: str,
    plane_y: str,
    u0: int | None,
    u1: int | None,
    v0: int | None,
    v1: int | None,
    t0: int | None,
    t1: int | None,
    nu0: int | None,
    nu1: int | None,
    pixel_indices: list[int] | None,
) -> tuple[np.ndarray, list[str], dict[str, tuple[int, int]], dict[str, np.ndarray], dict[str, int], dict[str, np.ndarray]]:
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
    explicit_indices_by_dim: dict[str, np.ndarray] = {}
    if pixel_indices is not None:
        if plane_x != "x":
            raise HTTPException(status_code=400, detail="pixel_indices export requires plane_x='x'")
        if u0 is not None or u1 is not None or v0 is not None or v1 is not None:
            raise HTTPException(status_code=400, detail="pixel_indices cannot be combined with u/v bounds")
        if "x" not in ds.dims:
            raise HTTPException(status_code=400, detail="dataset missing 'x' dimension")
        raw_idx = np.asarray(pixel_indices, dtype=np.int64).reshape(-1)
        if raw_idx.size < 1:
            raise HTTPException(status_code=400, detail="pixel_indices cannot be empty")
        uniq_idx = np.unique(raw_idx)
        x_size = _dim_size(ds, "x")
        valid_idx = uniq_idx[(uniq_idx >= 0) & (uniq_idx < x_size)]
        if valid_idx.size < 1:
            raise HTTPException(status_code=400, detail=f"HEALPix pixel indices out of bounds for x (size={x_size})")
        explicit_indices_by_dim["x"] = valid_idx

    requested = {"sample": sample, "pol": pol, "t": t, "nu": nu, "x": x, "y": y, "z": z}
    slicer: list[slice] = []
    out_dims: list[str] = []
    bounds_by_dim: dict[str, tuple[int, int]] = {}
    selected_indices: dict[str, int] = {}

    for dim in ds.dims:
        size = _dim_size(ds, dim)
        if dim == "sample" and sample_mode in {"mean", "std", "rel_uncert"}:
            slicer.append(slice(0, size))
            out_dims.append(dim)
            bounds_by_dim[dim] = (0, size)
            continue

        if dim == plane_x:
            explicit_idx = explicit_indices_by_dim.get(dim)
            if explicit_idx is not None:
                lo, hi = 0, size
            else:
                lo = 0 if u0 is None else u0
                hi = size if u1 is None else u1
                lo, hi = _clamp_dim_bounds(ds, dim, lo, hi)
            slicer.append(slice(lo, hi))
            out_dims.append(dim)
            bounds_by_dim[dim] = (lo, hi)
            continue

        if dim == plane_y:
            lo = 0 if v0 is None else v0
            hi = size if v1 is None else v1
            lo, hi = _clamp_dim_bounds(ds, dim, lo, hi)
            slicer.append(slice(lo, hi))
            out_dims.append(dim)
            bounds_by_dim[dim] = (lo, hi)
            continue

        if dim == "t" and (t0 is not None or t1 is not None):
            lo = 0 if t0 is None else t0
            hi = size if t1 is None else t1
            lo, hi = _clamp_dim_bounds(ds, dim, lo, hi)
            slicer.append(slice(lo, hi))
            out_dims.append(dim)
            bounds_by_dim[dim] = (lo, hi)
            continue

        if dim == "nu" and (nu0 is not None or nu1 is not None):
            lo = 0 if nu0 is None else nu0
            hi = size if nu1 is None else nu1
            lo, hi = _clamp_dim_bounds(ds, dim, lo, hi)
            slicer.append(slice(lo, hi))
            out_dims.append(dim)
            bounds_by_dim[dim] = (lo, hi)
            continue

        idx = _index_or_mid(ds, dim, requested.get(dim))
        slicer.append(slice(idx, idx + 1))
        out_dims.append(dim)
        bounds_by_dim[dim] = (idx, idx + 1)
        selected_indices[dim] = idx

    arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
    if sample_mode in {"mean", "std", "rel_uncert"} and "sample" in out_dims:
        s_axis = out_dims.index("sample")
        if sample_mode == "mean":
            arr = arr.mean(axis=s_axis, dtype=np.float64).astype(np.float32)
        elif sample_mode == "std":
            arr = arr.std(axis=s_axis, dtype=np.float64).astype(np.float32)
        else:
            mean_arr = arr.mean(axis=s_axis, dtype=np.float64)
            std_arr = arr.std(axis=s_axis, dtype=np.float64)
            arr = _relative_uncertainty(mean_arr, std_arr).astype(np.float32)
        out_dims = [d for d in out_dims if d != "sample"]
        bounds_by_dim.pop("sample", None)

    if arr.ndim != len(out_dims):
        raise HTTPException(status_code=500, detail=f"export rank mismatch: {arr.ndim} vs dims {len(out_dims)}")

    for dim, indices in explicit_indices_by_dim.items():
        if dim not in out_dims:
            raise HTTPException(status_code=500, detail=f"explicit index dim '{dim}' missing from export dims")
        axis = out_dims.index(dim)
        arr = np.take(arr, indices, axis=axis)

    coords_by_dim: dict[str, np.ndarray] = {}
    for axis, dim in enumerate(out_dims):
        explicit_idx = explicit_indices_by_dim.get(dim)
        if explicit_idx is not None:
            coords = np.asarray(ds.coords[dim], dtype=np.float64).reshape(-1)[explicit_idx]
        else:
            lo, hi = bounds_by_dim[dim]
            coords = np.asarray(ds.coords[dim], dtype=np.float64).reshape(-1)[lo:hi]
        if coords.shape[0] != arr.shape[axis]:
            raise HTTPException(
                status_code=500,
                detail=f"export coordinate length mismatch for '{dim}': {coords.shape[0]} vs {arr.shape[axis]}",
            )
        coords_by_dim[dim] = coords

    return arr, out_dims, bounds_by_dim, coords_by_dim, selected_indices, explicit_indices_by_dim


def build_export_cutout_fits(
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
    plane_x: str,
    plane_y: str,
    u0: int | None,
    u1: int | None,
    v0: int | None,
    v1: int | None,
    t0: int | None,
    t1: int | None,
    nu0: int | None,
    nu1: int | None,
    pixel_indices: list[int] | None = None,
) -> tuple[bytes, str]:
    from astropy.io import fits

    arr, out_dims, bounds_by_dim, coords_by_dim, selected_indices, explicit_indices_by_dim = _build_export_cutout_core(
        ds,
        sample=sample,
        pol=pol,
        t=t,
        nu=nu,
        x=x,
        y=y,
        z=z,
        sample_mode=sample_mode,
        plane_x=plane_x,
        plane_y=plane_y,
        u0=u0,
        u1=u1,
        v0=v0,
        v1=v1,
        t0=t0,
        t1=t1,
        nu0=nu0,
        nu1=nu1,
        pixel_indices=pixel_indices,
    )

    hdr = _build_export_header(
        ds=ds,
        out_dims=out_dims,
        bounds_by_dim=bounds_by_dim,
        coords_by_dim=coords_by_dim,
        sample_mode=sample_mode,
        plane_x=plane_x,
        plane_y=plane_y,
        selected_indices=selected_indices,
        explicit_indices_by_dim=explicit_indices_by_dim,
    )
    primary = fits.PrimaryHDU(data=np.asarray(arr, dtype=np.float32), header=hdr)
    hdus: list[Any] = [primary]
    for dim in out_dims:
        ext = fits.ImageHDU(data=coords_by_dim[dim].astype(np.float64), name=f"COORD_{dim.upper()}")
        unit = ds.units.get(dim)
        if unit:
            ext.header["BUNIT"] = str(unit)
        hdus.append(ext)
    if "x" in explicit_indices_by_dim:
        # Use ImageHDU instead of BinTableHDU to avoid astropy.table import/runtime issues.
        hdus.append(fits.ImageHDU(data=explicit_indices_by_dim["x"].astype(np.int64, copy=False), name="PIXEL_IDX"))

    hdul = fits.HDUList(hdus)
    buf = io.BytesIO()
    hdul.writeto(buf, overwrite=True, checksum=True)
    buf.seek(0)
    filename = f"{ds.data_id}_cutout_{plane_x}{plane_y}_{sample_mode}.fits"
    return buf.getvalue(), filename


def build_export_cutout_hdf5(
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
    plane_x: str,
    plane_y: str,
    u0: int | None,
    u1: int | None,
    v0: int | None,
    v1: int | None,
    t0: int | None,
    t1: int | None,
    nu0: int | None,
    nu1: int | None,
    pixel_indices: list[int] | None = None,
) -> tuple[bytes, str]:
    import h5py

    arr, out_dims, bounds_by_dim, coords_by_dim, selected_indices, explicit_indices_by_dim = _build_export_cutout_core(
        ds,
        sample=sample,
        pol=pol,
        t=t,
        nu=nu,
        x=x,
        y=y,
        z=z,
        sample_mode=sample_mode,
        plane_x=plane_x,
        plane_y=plane_y,
        u0=u0,
        u1=u1,
        v0=v0,
        v1=v1,
        t0=t0,
        t1=t1,
        nu0=nu0,
        nu1=nu1,
        pixel_indices=pixel_indices,
    )

    buf = io.BytesIO()
    with h5py.File(buf, "w") as f:
        values = f.create_dataset("values", data=np.asarray(arr, dtype=np.float32), compression="gzip", compression_opts=4)
        values.attrs["dims"] = ",".join(out_dims)
        values.attrs["intensity_unit"] = str(ds.intensity_unit)
        values.attrs["sample_mode"] = str(sample_mode)
        values.attrs["plane_x"] = str(plane_x)
        values.attrs["plane_y"] = str(plane_y)
        for dim, idx in selected_indices.items():
            values.attrs[f"index_{dim}"] = int(idx)
        for dim in out_dims:
            values.attrs[f"unit_{dim}"] = str(ds.units.get(dim, ""))

        coords_group = f.create_group("coords")
        bounds_dict: dict[str, list[int]] = {}
        for dim in out_dims:
            coords_group.create_dataset(dim, data=np.asarray(coords_by_dim[dim], dtype=np.float64))
            lo, hi = bounds_by_dim[dim]
            bounds_dict[dim] = [int(lo), int(hi)]
        if "x" in explicit_indices_by_dim:
            coords_group.create_dataset("x_indices", data=np.asarray(explicit_indices_by_dim["x"], dtype=np.int64))
            values.attrs["x_index_scheme"] = "explicit"

        f.attrs["wcs_json"] = json.dumps(ds.wcs if isinstance(ds.wcs, dict) else {}, default=str)
        f.attrs["selected_indices_json"] = json.dumps({k: int(v) for k, v in selected_indices.items()})
        f.attrs["bounds_json"] = json.dumps(bounds_dict)
        if explicit_indices_by_dim:
            f.attrs["explicit_indices_json"] = json.dumps(
                {dim: np.asarray(idx, dtype=np.int64).tolist() for dim, idx in explicit_indices_by_dim.items()}
            )

    buf.seek(0)
    filename = f"{ds.data_id}_cutout_{plane_x}{plane_y}_{sample_mode}.h5"
    return buf.getvalue(), filename
