from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .schema import CANONICAL_DIMS, CubeDataset, reorder_to_canonical


def _default_coords_from_shape(dims: tuple[str, ...], shape: tuple[int, ...]) -> dict[str, np.ndarray]:
    return {dim: np.arange(shape[axis], dtype=np.float32) for axis, dim in enumerate(dims)}


def _default_units(dims: tuple[str, ...]) -> dict[str, str]:
    units = {
        "sample": "index",
        "pol": "index",
        "t": "s",
        "nu": "Hz",
        "x": "pix",
        "y": "pix",
        "z": "pix",
    }
    return {dim: units.get(dim, "unknown") for dim in dims}


def _as_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


def pad_dataset_to_canonical(dataset: CubeDataset) -> tuple[CubeDataset, tuple[str, ...]]:
    """Insert singleton axes for missing canonical dimensions."""
    missing = tuple(dim for dim in CANONICAL_DIMS if dim not in dataset.dims)
    if not missing:
        return dataset, ()

    values = np.asarray(dataset.values, dtype=np.float32)
    mask = None if dataset.mask is None else np.asarray(dataset.mask)
    dims = list(dataset.dims)
    coords = {k: np.asarray(v) for k, v in dataset.coords.items()}
    units = dict(dataset.units)
    canonical_index = {dim: idx for idx, dim in enumerate(CANONICAL_DIMS)}

    for dim in missing:
        idx = canonical_index[dim]
        insert_at = sum(1 for existing in dims if canonical_index[existing] < idx)
        values = np.expand_dims(values, axis=insert_at)
        if mask is not None:
            mask = np.expand_dims(mask, axis=insert_at)
        dims.insert(insert_at, dim)
        coords[dim] = np.array([0.0], dtype=np.float64)
        units[dim] = _default_units((dim,))[dim]

    provenance = dict(dataset.provenance)
    provenance["padded_dims"] = list(missing)
    out = CubeDataset(
        data_id=dataset.data_id,
        dims=tuple(dims),
        coords=coords,
        values=values,
        units=units,
        intensity_unit=dataset.intensity_unit,
        wcs=dict(dataset.wcs),
        provenance=provenance,
        mask=mask,
        uncertainty=dataset.uncertainty,
    )
    out.validate()
    return out, missing


def load_hdf5(
    path: str | Path,
    dataset_path: str = "values",
    dims: tuple[str, ...] | None = None,
    data_id: str | None = None,
) -> CubeDataset:
    import h5py

    path = Path(path).expanduser().resolve()
    with h5py.File(path, "r") as f:
        if dataset_path not in f:
            raise KeyError(f"dataset '{dataset_path}' not found in {path}")
        ds = f[dataset_path]
        values = np.asarray(ds, dtype=np.float32)

        if dims is None:
            dims_attr = ds.attrs.get("dims")
            if dims_attr is None:
                raise ValueError(
                    "HDF5 dataset missing 'dims' attribute. "
                    "Provide dims explicitly or add attrs['dims']='sample,pol,t,nu,x,y,z' subset."
                )
            if isinstance(dims_attr, bytes):
                dims_attr = dims_attr.decode("utf-8")
            if isinstance(dims_attr, str):
                dims = tuple(x.strip() for x in dims_attr.split(",") if x.strip())
            else:
                dims = tuple(str(x) for x in dims_attr)

        values, dims = reorder_to_canonical(values, dims)
        coords = _default_coords_from_shape(dims, values.shape)
        units = _default_units(dims)

        for dim in dims:
            coord_ds_name = f"coords/{dim}"
            if coord_ds_name in f:
                coords[dim] = np.asarray(f[coord_ds_name], dtype=np.float64).reshape(-1)

            unit_key = f"unit_{dim}"
            if unit_key in ds.attrs:
                unit_val = ds.attrs[unit_key]
                if isinstance(unit_val, bytes):
                    unit_val = unit_val.decode("utf-8")
                units[dim] = str(unit_val)

        intensity_unit = ds.attrs.get("intensity_unit", "arb")
        if isinstance(intensity_unit, bytes):
            intensity_unit = intensity_unit.decode("utf-8")

    dataset = CubeDataset(
        data_id=data_id or path.stem,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit=str(intensity_unit),
        wcs={"frame": "unknown", "source": "hdf5"},
        provenance={"source": "hdf5", "path": str(path), "dataset_path": dataset_path},
    )
    dataset.validate()
    return dataset


def load_fits(
    path: str | Path,
    hdu_index: int = 0,
    dims: tuple[str, ...] | None = None,
    data_id: str | None = None,
) -> CubeDataset:
    from astropy.io import fits

    path = Path(path).expanduser().resolve()
    with fits.open(path) as hdul:
        hdu = hdul[hdu_index]
        values = np.asarray(hdu.data, dtype=np.float32)
        header = hdu.header

        if values.ndim == 0:
            raise ValueError(f"HDU {hdu_index} contains scalar data, expected n-D array")

        if dims is None:
            parsed: list[str] = []
            for i in range(values.ndim):
                ctype = str(header.get(f"CTYPE{i + 1}", "")).upper()
                if "FREQ" in ctype or "VELO" in ctype or "WAVE" in ctype:
                    parsed.append("nu")
                elif "TIME" in ctype:
                    parsed.append("t")
                elif "STOKES" in ctype or "POL" in ctype:
                    parsed.append("pol")
                elif "SAMPLE" in ctype:
                    parsed.append("sample")
                elif "X" in ctype or "RA" in ctype:
                    parsed.append("x")
                elif "Y" in ctype or "DEC" in ctype:
                    parsed.append("y")
                elif "Z" in ctype:
                    parsed.append("z")
                else:
                    parsed.append("")

            parsed = list(reversed(parsed))
            n = values.ndim
            known = [x for x in parsed if x]
            if len(known) == n and len(set(known)) == n:
                dims = tuple(known)
            else:
                dims = CANONICAL_DIMS[-n:]

        values, dims = reorder_to_canonical(values, dims)
        coords = _default_coords_from_shape(dims, values.shape)
        units = _default_units(dims)

        for axis, dim in enumerate(reversed(dims), start=1):
            cunit = header.get(f"CUNIT{axis}")
            if cunit:
                units[dim] = str(cunit)
            crval = header.get(f"CRVAL{axis}")
            cdelt = header.get(f"CDELT{axis}")
            crpix = header.get(f"CRPIX{axis}")
            if crval is not None and cdelt is not None and crpix is not None:
                n = values.shape[dims.index(dim)]
                pix = np.arange(1, n + 1, dtype=np.float64)
                coords[dim] = (crval + (pix - crpix) * cdelt).astype(np.float64)

        bunit = header.get("BUNIT", "arb")
        frame = header.get("RADESYS", header.get("WCSNAME", "unknown"))

    dataset = CubeDataset(
        data_id=data_id or path.stem,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit=str(bunit),
        wcs={"frame": str(frame), "source": "fits"},
        provenance={"source": "fits", "path": str(path), "hdu_index": hdu_index},
    )
    dataset.validate()
    return dataset


def load_zarr(
    path: str | Path,
    data_key: str = "values",
    dims: tuple[str, ...] | None = None,
    data_id: str | None = None,
) -> CubeDataset:
    import zarr

    path = Path(path).expanduser().resolve()
    root = zarr.open_group(path, mode="r")
    if data_key not in root:
        raise KeyError(f"zarr array '{data_key}' not found in {path}")

    arr = root[data_key]
    values = np.asarray(arr, dtype=np.float32)
    if dims is None:
        dims_attr = arr.attrs.get("dims")
        if dims_attr is None:
            dims_attr = arr.attrs.get("_ARRAY_DIMENSIONS")
        if dims_attr is None:
            raise ValueError("zarr array attrs missing 'dims' or '_ARRAY_DIMENSIONS' list")
        dims = tuple(str(x) for x in dims_attr)
    values, dims = reorder_to_canonical(values, dims)

    coords = _default_coords_from_shape(dims, values.shape)
    units = _default_units(dims)
    if "coords" in root:
        cg = root["coords"]
        for dim in dims:
            if dim in cg:
                coords[dim] = np.asarray(cg[dim], dtype=np.float64).reshape(-1)
    for dim in dims:
        # xarray-style zarr stores coordinate variables at root with _ARRAY_DIMENSIONS.
        if dim in root:
            coord_arr = root[dim]
            if getattr(coord_arr, "ndim", 0) == 1:
                coords[dim] = np.asarray(coord_arr, dtype=np.float64).reshape(-1)
            coord_units = root[dim].attrs.get("units")
            if coord_units is not None:
                units[dim] = _as_text(coord_units)

    intensity_unit = arr.attrs.get("intensity_unit")
    if intensity_unit is None:
        intensity_unit = arr.attrs.get("units", "arb")
    intensity_unit = _as_text(intensity_unit)
    for dim in dims:
        key = f"unit_{dim}"
        if key in arr.attrs:
            units[dim] = _as_text(arr.attrs[key])

    frame = arr.attrs.get("frame")
    if frame is None:
        frame = root.attrs.get("frame", "unknown")

    dataset = CubeDataset(
        data_id=data_id or path.stem,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit=intensity_unit,
        wcs={"frame": _as_text(frame), "source": "zarr"},
        provenance={"source": "zarr", "path": str(path), "data_key": data_key},
    )
    dataset.validate()
    return dataset


def load_by_extension(path: str | Path, **kwargs: Any) -> CubeDataset:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in {".h5", ".hdf5"}:
        return load_hdf5(path, **kwargs)
    if suffix in {".fits", ".fit", ".fts"}:
        return load_fits(path, **kwargs)
    if suffix in {".zarr"}:
        return load_zarr(path, **kwargs)
    raise ValueError(f"unsupported file extension: {suffix}")
