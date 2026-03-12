from __future__ import annotations

import io
import json
from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.api_models import SampleMode
from mobula.service.api_utils import (
    _apply_sample_mode_reduction,
    _clamp_dim_bounds,
    _dim_size,
    _healpix_nside_from_npix,
    _index_or_mid,
    _parse_healpix_ordering,
    _uses_sample_reduction,
)


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
            if not isinstance(key, str) or not key or value is None:
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
            finite_value = _finite_float(value)
            if finite_value is not None:
                hdr[key] = finite_value

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
) -> tuple[
    np.ndarray, list[str], dict[str, tuple[int, int]], dict[str, np.ndarray], dict[str, int], dict[str, np.ndarray]
]:
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
        if dim == "sample" and _uses_sample_reduction(sample_mode):
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
    arr, out_dims = _apply_sample_mode_reduction(arr, out_dims, sample_mode, cast_float32=True)
    if "sample" not in out_dims:
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
        values = f.create_dataset(
            "values", data=np.asarray(arr, dtype=np.float32), compression="gzip", compression_opts=4
        )
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
        f.attrs["selected_indices_json"] = json.dumps({key: int(value) for key, value in selected_indices.items()})
        f.attrs["bounds_json"] = json.dumps(bounds_dict)
        if explicit_indices_by_dim:
            f.attrs["explicit_indices_json"] = json.dumps(
                {dim: np.asarray(idx, dtype=np.int64).tolist() for dim, idx in explicit_indices_by_dim.items()}
            )

    buf.seek(0)
    filename = f"{ds.data_id}_cutout_{plane_x}{plane_y}_{sample_mode}.h5"
    return buf.getvalue(), filename
