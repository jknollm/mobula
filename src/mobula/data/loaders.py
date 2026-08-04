from __future__ import annotations

import math
from pathlib import Path
import re
from typing import Any

import numpy as np

from .schema import CANONICAL_DIMS, CubeDataset, reorder_to_canonical

_COORD_LIKE_TOKENS = (
    "coord",
    "axis",
    "header",
    "meta",
    "wcs",
    "unit",
    "mask",
    "flag",
    "quality",
    "weight",
    "variance",
    "uncertainty",
    "error",
    "index",
    "indices",
)

_NPZ_COORD_KEYS = {
    "nu": ("selected_frequency_hz", "frequency_hz", "frequencies_hz", "frequency", "frequencies", "freq_hz", "freq", "nu"),
    "t": ("selected_time_s", "time_s", "times_s", "time", "times", "t"),
}


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


def _normalize_stokes_iqu_to_iquv(
    values: np.ndarray,
    dims: tuple[str, ...],
    coords: dict[str, np.ndarray],
    provenance: dict[str, Any] | None = None,
) -> tuple[np.ndarray, dict[str, np.ndarray], dict[str, Any]]:
    """Expand 3-channel polarization axes to I,Q,U,V by assuming V=0."""
    if "pol" not in dims:
        return values, coords, dict(provenance or {})

    pol_axis = dims.index("pol")
    if int(values.shape[pol_axis]) != 3:
        return values, coords, dict(provenance or {})

    pad_shape = list(values.shape)
    pad_shape[pol_axis] = 1
    values = np.concatenate(
        [values, np.zeros(tuple(pad_shape), dtype=values.dtype)],
        axis=pol_axis,
    )

    out_coords = dict(coords)
    pol_coords = np.asarray(out_coords.get("pol", np.arange(3, dtype=np.float64))).reshape(-1)
    if pol_coords.shape[0] == 3:
        if np.issubdtype(pol_coords.dtype, np.number):
            step = pol_coords[-1] - pol_coords[-2] if pol_coords.shape[0] >= 2 else 1
            try:
                step_f = float(step)
            except (TypeError, ValueError):
                step_f = 1.0
            if not np.isfinite(step_f) or step_f == 0:
                step_f = 1.0
            next_val: Any = pol_coords[-1] + step_f
            if isinstance(next_val, np.generic):
                next_val = next_val.item()
            try:
                out_coords["pol"] = np.concatenate([pol_coords, np.asarray([next_val], dtype=pol_coords.dtype)])
            except (TypeError, ValueError):
                out_coords["pol"] = np.arange(4, dtype=np.float64)
        else:
            out_coords["pol"] = np.arange(4, dtype=np.float64)
    else:
        out_coords["pol"] = np.arange(4, dtype=np.float64)

    out_provenance = dict(provenance or {})
    out_provenance["stokes_assumed_v_zero"] = True
    out_provenance["pol_labels"] = ["I", "Q", "U", "V"]
    return values, out_coords, out_provenance


def _as_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


def _as_float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(out):
        return None
    return out


def _dim_from_ctype(ctype: str) -> str | None:
    upper = ctype.upper()
    if "FREQ" in upper or "VELO" in upper or "WAVE" in upper:
        return "nu"
    if "TIME" in upper:
        return "t"
    if "STOKES" in upper or "POL" in upper:
        return "pol"
    if "SAMPLE" in upper:
        return "sample"
    if "RA" in upper or "GLON" in upper:
        return "x"
    if "DEC" in upper or "GLAT" in upper:
        return "y"
    if "X" in upper:
        return "x"
    if "Y" in upper:
        return "y"
    if "Z" in upper:
        return "z"
    return None


def _axis_type_for_dim(dim: str, ctype: str | None = None) -> str:
    upper = (ctype or "").upper()
    if "RA" in upper:
        return "ra"
    if "DEC" in upper:
        return "dec"
    if "GLON" in upper:
        return "glon"
    if "GLAT" in upper:
        return "glat"
    if "FREQ" in upper or "VELO" in upper or "WAVE" in upper:
        return "spectral"
    if "TIME" in upper:
        return "time"
    if "STOKES" in upper or "POL" in upper:
        return "polarization"
    if "SAMPLE" in upper:
        return "sample"
    if dim == "nu":
        return "spectral"
    if dim == "t":
        return "time"
    if dim == "pol":
        return "polarization"
    if dim == "sample":
        return "sample"
    return "spatial"


def _npz_coord_like_name(name: str) -> bool:
    lower = str(name).lower()
    base = lower.rsplit("/", 1)[-1]
    if any(token in lower for token in _COORD_LIKE_TOKENS):
        return True
    if any(base == candidate for keys in _NPZ_COORD_KEYS.values() for candidate in keys):
        return True
    return False


def _npz_match_coord_axis(npz: Any, dim: str, shape: tuple[int, ...], used_axes: set[int]) -> int | None:
    candidates = _NPZ_COORD_KEYS.get(dim, ())
    preferred_axes = {
        "nu": [max(0, len(shape) - 3), max(0, len(shape) - 1)],
        "t": [max(0, len(shape) - 4), max(0, len(shape) - 2)],
    }.get(dim, [])
    for key in candidates:
        if key not in npz:
            continue
        arr = np.asarray(npz[key])
        if arr.ndim != 1 or arr.size < 1 or np.issubdtype(arr.dtype, np.complexfloating):
            continue
        matches = [axis for axis, size in enumerate(shape) if axis not in used_axes and int(size) == int(arr.shape[0])]
        if not matches:
            continue
        for axis in preferred_axes:
            if axis in matches:
                return axis
        return matches[0]
    return None


def infer_npz_dims(npz: Any, array_key: str, shape: tuple[int, ...]) -> tuple[str, ...]:
    ndim = len(shape)
    if ndim < 1:
        raise ValueError("NPZ array rank must be >= 1")

    dims: list[str | None] = [None] * ndim
    used_axes: set[int] = set()
    used_dims: set[str] = set()
    lower = str(array_key or "").lower()

    def assign(axis: int, dim: str) -> None:
        if axis < 0 or axis >= ndim:
            return
        if dims[axis] is not None or dim in used_dims:
            return
        dims[axis] = dim
        used_axes.add(axis)
        used_dims.add(dim)

    image_like_tokens = (
        "sky",
        "image",
        "cube",
        "dirty",
        "model",
        "residual",
        "brightness",
        "spectral_index",
        "uncertainty",
        "final",
        "mean",
        "std",
    )
    if ndim >= 2 and any(token in lower for token in image_like_tokens):
        assign(ndim - 2, "x")
        assign(ndim - 1, "y")

    for dim in ("nu", "t"):
        axis = _npz_match_coord_axis(npz, dim, shape, used_axes)
        if axis is not None:
            assign(axis, dim)

    if ndim >= 1 and shape[0] == 1:
        assign(0, "sample")
    if ndim >= 2 and int(shape[1]) in {1, 3, 4}:
        assign(1, "pol")
    elif ndim >= 1 and int(shape[0]) in {1, 3, 4}:
        assign(0, "pol")

    if "vis" in lower and ndim >= 2:
        assign(max(0, ndim - 1), "nu")

    fill_order = ("sample", "pol", "t", "nu", "x", "y", "z")
    for axis in range(ndim):
        if dims[axis] is not None:
            continue
        for dim in fill_order:
            if dim in used_dims:
                continue
            assign(axis, dim)
            break

    return tuple(str(dim) for dim in dims if dim is not None)


def _npz_key_score(name: str, arr: np.ndarray, dims_attr: tuple[str, ...]) -> tuple[int, int, int, str]:
    full = str(name).lower()
    base = full.rsplit("/", 1)[-1]
    ndim = int(arr.ndim)
    size = int(arr.size)
    score = 0

    preferred = (
        ("values", 240),
        ("posterior_mean", 150),
        ("posterior", 70),
        ("mean_sky", 90),
        ("sky", 75),
        ("cube", 42),
        ("image", 42),
        ("science", 36),
        ("data", 20),
    )
    for token, bonus in preferred:
        if token == base:
            score += bonus
        elif token in full:
            score += bonus
            break

    penalties = (
        ("std", 55),
        ("uncertainty", 70),
        ("residual", 55),
        ("dirty", 35),
        ("reference", 45),
        ("predictive", 35),
        ("prior", 35),
        ("vis", 140),
    )
    for token, penalty in penalties:
        if token in full:
            score -= penalty

    if ndim >= 2:
        score += 48
    if ndim >= 3:
        score += 42
    if ndim >= 4:
        score += 28
    if ndim == 1:
        score -= 45

    if size > 0:
        score += int(min(36, round(math.log10(float(size + 1)) * 8)))

    if len(dims_attr) == ndim and len(set(dims_attr)) == ndim and all(dim in CANONICAL_DIMS for dim in dims_attr):
        score += 30

    if _npz_coord_like_name(name):
        score -= 120 if ndim == 1 else 70

    return score, ndim, size, name


def list_npz_array_candidates(npz: Any) -> list[dict[str, Any]]:
    ranked: list[tuple[tuple[int, int, int, str], dict[str, Any]]] = []
    for name in getattr(npz, "files", []):
        arr = np.asarray(npz[name])
        if arr.ndim < 1 or int(arr.size) < 1:
            continue
        if not np.issubdtype(arr.dtype, np.number) or np.issubdtype(arr.dtype, np.complexfloating):
            continue
        dims_attr = infer_npz_dims(npz, name, tuple(int(x) for x in arr.shape))
        rank = _npz_key_score(name, arr, dims_attr)
        ranked.append(
            (
                rank,
                {
                    "path": str(name),
                    "shape": [int(x) for x in arr.shape],
                    "dtype": str(arr.dtype),
                    "ndim": int(arr.ndim),
                    "size": int(arr.size),
                    "dims_attr": list(dims_attr),
                    "score": int(rank[0]),
                    "coordinate_like": _npz_coord_like_name(name),
                    "kind": "dataset",
                    "member_paths": [],
                },
            )
        )
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in ranked]


def _default_npz_array_key(npz: Any) -> str:
    candidates = list_npz_array_candidates(npz)
    if not candidates:
        raise ValueError("NPZ file does not contain any real numeric arrays that can be displayed")
    return str(candidates[0]["path"])


def _apply_npz_coords(
    npz: Any,
    dims: tuple[str, ...],
    shape: tuple[int, ...],
    coords: dict[str, np.ndarray],
    units: dict[str, str],
) -> set[str]:
    explicit_dims: set[str] = set()
    for axis, dim in enumerate(dims):
        for key in _NPZ_COORD_KEYS.get(dim, ()):
            if key not in npz:
                continue
            arr = np.asarray(npz[key])
            if arr.ndim != 1 or int(arr.shape[0]) != int(shape[axis]) or np.issubdtype(arr.dtype, np.complexfloating):
                continue
            coords[dim] = np.asarray(arr, dtype=np.float64).reshape(-1)
            if dim == "nu":
                units[dim] = "Hz"
            elif dim == "t":
                units[dim] = "s"
            explicit_dims.add(dim)
            break
    return explicit_dims


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
                dims = tuple(_as_text(x) for x in dims_attr)

        values, dims = reorder_to_canonical(values, dims)
        coords = _default_coords_from_shape(dims, values.shape)
        units = _default_units(dims)
        synthetic_coordinate_dims = set(dims)

        for dim in dims:
            coord_ds_name = f"coords/{dim}"
            if coord_ds_name in f:
                coords[dim] = np.asarray(f[coord_ds_name], dtype=np.float64).reshape(-1)
                synthetic_coordinate_dims.discard(dim)

            unit_key = f"unit_{dim}"
            if unit_key in ds.attrs:
                unit_val = ds.attrs[unit_key]
                if isinstance(unit_val, bytes):
                    unit_val = unit_val.decode("utf-8")
                units[dim] = str(unit_val)

        intensity_unit = ds.attrs.get("intensity_unit", "arb")
        if isinstance(intensity_unit, bytes):
            intensity_unit = intensity_unit.decode("utf-8")

    provenance = {
        "source": "hdf5",
        "path": str(path),
        "dataset_path": dataset_path,
        "synthetic_coordinate_dims": sorted(synthetic_coordinate_dims),
    }
    values, coords, provenance = _normalize_stokes_iqu_to_iquv(values, dims, coords, provenance)

    dataset = CubeDataset(
        data_id=data_id or path.stem,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit=str(intensity_unit),
        wcs={
            "frame": "unknown",
            "source": "hdf5",
            "axis_types": {dim: _axis_type_for_dim(dim) for dim in dims},
        },
        provenance=provenance,
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
                inferred = _dim_from_ctype(ctype)
                parsed.append("" if inferred is None else inferred)

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
        synthetic_coordinate_dims = set(dims)
        axis_types = {dim: _axis_type_for_dim(dim) for dim in dims}
        fits_axes: dict[str, dict[str, Any]] = {}

        for axis, dim in enumerate(reversed(dims), start=1):
            ctype = _as_text(header.get(f"CTYPE{axis}", dim.upper()))
            cunit = header.get(f"CUNIT{axis}")
            if cunit:
                units[dim] = str(cunit)
            crval = header.get(f"CRVAL{axis}")
            cdelt = header.get(f"CDELT{axis}")
            crpix = header.get(f"CRPIX{axis}")
            axis_types[dim] = _axis_type_for_dim(dim, ctype)
            fits_axes[dim] = {
                "axis": int(axis),
                "ctype": ctype,
                "cunit": units.get(dim, ""),
                "crval": _as_float_or_none(crval),
                "cdelt": _as_float_or_none(cdelt),
                "crpix": _as_float_or_none(crpix),
            }
            if crval is not None and cdelt is not None and crpix is not None:
                n = values.shape[dims.index(dim)]
                pix = np.arange(1, n + 1, dtype=np.float64)
                coords[dim] = (crval + (pix - crpix) * cdelt).astype(np.float64)
                synthetic_coordinate_dims.discard(dim)

        bunit = header.get("BUNIT", "arb")
        frame = header.get("RADESYS", header.get("WCSNAME", "unknown"))
        wcs_global = {
            "RADESYS": _as_text(header.get("RADESYS")) if header.get("RADESYS") is not None else None,
            "WCSNAME": _as_text(header.get("WCSNAME")) if header.get("WCSNAME") is not None else None,
            "EQUINOX": _as_float_or_none(header.get("EQUINOX")),
            "SPECSYS": _as_text(header.get("SPECSYS")) if header.get("SPECSYS") is not None else None,
            "SSYSOBS": _as_text(header.get("SSYSOBS")) if header.get("SSYSOBS") is not None else None,
            "MJDREF": _as_float_or_none(header.get("MJDREF")),
        }
        wcs_global = {k: v for k, v in wcs_global.items() if v is not None}
        fits_matrix: dict[str, float] = {}
        for key, value in header.items():
            if re.match(r"^(PC|CD)\d+_\d+$", key) or re.match(r"^CROTA\d+$", key):
                fv = _as_float_or_none(value)
                if fv is not None:
                    fits_matrix[key] = fv

    provenance = {
        "source": "fits",
        "path": str(path),
        "hdu_index": hdu_index,
        "synthetic_coordinate_dims": sorted(synthetic_coordinate_dims),
    }
    values, coords, provenance = _normalize_stokes_iqu_to_iquv(values, dims, coords, provenance)

    dataset = CubeDataset(
        data_id=data_id or path.stem,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit=str(bunit),
        wcs={
            "frame": str(frame),
            "source": "fits",
            "axis_types": axis_types,
            "fits_axes": fits_axes,
            "fits_global": wcs_global,
            "fits_matrix": fits_matrix,
        },
        provenance=provenance,
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
    synthetic_coordinate_dims = set(dims)
    if "coords" in root:
        cg = root["coords"]
        for dim in dims:
            if dim in cg:
                coords[dim] = np.asarray(cg[dim], dtype=np.float64).reshape(-1)
                synthetic_coordinate_dims.discard(dim)
    for dim in dims:
        # xarray-style zarr stores coordinate variables at root with _ARRAY_DIMENSIONS.
        if dim in root:
            coord_arr = root[dim]
            if getattr(coord_arr, "ndim", 0) == 1:
                coords[dim] = np.asarray(coord_arr, dtype=np.float64).reshape(-1)
                synthetic_coordinate_dims.discard(dim)
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

    provenance = {
        "source": "zarr",
        "path": str(path),
        "data_key": data_key,
        "synthetic_coordinate_dims": sorted(synthetic_coordinate_dims),
    }
    values, coords, provenance = _normalize_stokes_iqu_to_iquv(values, dims, coords, provenance)

    dataset = CubeDataset(
        data_id=data_id or path.stem,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit=intensity_unit,
        wcs={
            "frame": _as_text(frame),
            "source": "zarr",
            "axis_types": {dim: _axis_type_for_dim(dim) for dim in dims},
        },
        provenance=provenance,
    )
    dataset.validate()
    return dataset


def load_npz(
    path: str | Path,
    array_key: str | None = None,
    dims: tuple[str, ...] | None = None,
    data_id: str | None = None,
) -> CubeDataset:
    path = Path(path).expanduser().resolve()
    with np.load(path, allow_pickle=False) as npz:
        selected_key = str(array_key or "").strip() or _default_npz_array_key(npz)
        if selected_key not in npz:
            raise KeyError(f"array '{selected_key}' not found in {path}")
        raw = np.asarray(npz[selected_key])
        if raw.ndim < 1:
            raise ValueError(f"array '{selected_key}' contains scalar data, expected n-D array")
        if not np.issubdtype(raw.dtype, np.number) or np.issubdtype(raw.dtype, np.complexfloating):
            raise ValueError(f"array '{selected_key}' is not a supported real numeric array")

        if dims is None:
            dims = infer_npz_dims(npz, selected_key, tuple(int(x) for x in raw.shape))

        values = np.asarray(raw, dtype=np.float32)
        values, dims = reorder_to_canonical(values, dims)
        coords = _default_coords_from_shape(dims, values.shape)
        units = _default_units(dims)
        explicit_coordinate_dims = _apply_npz_coords(
            npz,
            dims,
            tuple(int(x) for x in values.shape),
            coords,
            units,
        )

    provenance = {
        "source": "npz",
        "path": str(path),
        "array_key": selected_key,
        "synthetic_coordinate_dims": sorted(set(dims) - explicit_coordinate_dims),
    }
    values, coords, provenance = _normalize_stokes_iqu_to_iquv(values, dims, coords, provenance)

    dataset = CubeDataset(
        data_id=data_id or path.stem,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit="arb",
        wcs={
            "frame": "unknown",
            "source": "npz",
            "axis_types": {dim: _axis_type_for_dim(dim) for dim in dims},
        },
        provenance=provenance,
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
    if suffix in {".npz"}:
        return load_npz(path, **kwargs)
    if suffix in {".zarr"}:
        return load_zarr(path, **kwargs)
    raise ValueError(f"unsupported file extension: {suffix}")
