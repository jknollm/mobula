from __future__ import annotations

from typing import Any, Callable

import numpy as np

from mobula.data.loaders import _normalize_stokes_iqu_to_iquv, load_by_extension
from mobula.data.schema import CANONICAL_DIMS, CubeDataset, reorder_to_canonical
from mobula.service.api_models import FileMappingDecision
from mobula.service.ingest.mappings import mapping_hdf5_dataset_paths, mapping_hdf5_key_stack_axis
from mobula.service.ingest.models import _InputRecord


def combine_datasets(
    datasets: list[CubeDataset],
    *,
    combined_data_id: str,
    combine_axis: str,
    inspection_id: str,
    plan_id: str,
    source_ids: list[str],
) -> CubeDataset:
    if not datasets:
        raise ValueError("no datasets provided for combine")

    axis_idx = CANONICAL_DIMS.index(combine_axis)
    base = datasets[0]
    for ds in datasets:
        if ds.shape[axis_idx] != 1:
            raise ValueError(f"axis '{combine_axis}' must be singleton across files for strict combine")

    values = np.concatenate([np.asarray(ds.values, dtype=np.float32) for ds in datasets], axis=axis_idx)

    masks = [np.asarray(ds.mask) for ds in datasets if ds.mask is not None]
    mask = np.concatenate(masks, axis=axis_idx) if masks else None

    coords = {dim: np.asarray(base.coords[dim]).copy() for dim in base.dims}
    coords[combine_axis] = np.arange(values.shape[axis_idx], dtype=np.float64)
    units = dict(base.units)
    units[combine_axis] = "index"

    provenance = dict(base.provenance)
    synthetic_coordinate_dims = set(provenance.get("synthetic_coordinate_dims", ()))
    synthetic_coordinate_dims.add(combine_axis)
    provenance["synthetic_coordinate_dims"] = sorted(synthetic_coordinate_dims)
    provenance["ingest"] = {
        "inspection_id": inspection_id,
        "plan_id": plan_id,
        "mode": f"files_as_{combine_axis}",
        "source_input_ids": source_ids,
    }

    combined = CubeDataset(
        data_id=combined_data_id,
        dims=tuple(base.dims),
        coords=coords,
        values=values,
        units=units,
        intensity_unit=base.intensity_unit,
        wcs=dict(base.wcs),
        provenance=provenance,
        mask=mask,
        uncertainty=None,
    )
    combined.validate()
    return combined


def default_coords_from_shape(dims: tuple[str, ...], shape: tuple[int, ...]) -> dict[str, np.ndarray]:
    return {dim: np.arange(shape[axis], dtype=np.float64) for axis, dim in enumerate(dims)}


def default_units(dims: tuple[str, ...]) -> dict[str, str]:
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


def load_hdf5_stokes_stack(
    rec: _InputRecord,
    mapping: FileMappingDecision,
    data_id: str,
    dataset_path: str,
    *,
    parse_stokes_stack_token: Callable[[str], list[str] | None],
) -> CubeDataset:
    member_paths = parse_stokes_stack_token(dataset_path)
    if not member_paths:
        raise ValueError("invalid stokes stack dataset_path token")
    return load_hdf5_dataset_stack(
        rec=rec,
        mapping=mapping,
        data_id=data_id,
        member_paths=member_paths,
        stack_kind="stokes_iquv",
        dataset_path_repr=dataset_path,
    )


def _axis_types_for_dims(dims: tuple[str, ...]) -> dict[str, str]:
    axis_types: dict[str, str] = {}
    for dim in dims:
        if dim == "nu":
            axis_types[dim] = "spectral"
        elif dim == "t":
            axis_types[dim] = "time"
        elif dim == "pol":
            axis_types[dim] = "polarization"
        elif dim == "sample":
            axis_types[dim] = "sample"
        else:
            axis_types[dim] = "spatial"
    return axis_types


def load_hdf5_dataset_stack(
    *,
    rec: _InputRecord,
    mapping: FileMappingDecision,
    data_id: str,
    member_paths: list[str],
    stack_kind: str,
    dataset_path_repr: str,
) -> CubeDataset:
    import h5py

    with h5py.File(rec.path, "r") as f:
        arrays: list[np.ndarray] = []
        first_ds: Any = None
        for member in member_paths:
            if member not in f:
                raise ValueError(f"stack member dataset '{member}' not found")
            ds = f[member]
            if not np.issubdtype(ds.dtype, np.number):
                raise ValueError(f"stack member dataset '{member}' is not numeric")
            arr = np.asarray(ds, dtype=np.float32)
            if arr.ndim < 1 or arr.size < 1:
                raise ValueError(f"stack member dataset '{member}' is empty")
            if arrays and arr.shape != arrays[0].shape:
                raise ValueError("stack member datasets have incompatible shapes")
            if first_ds is None:
                first_ds = ds
            arrays.append(arr)
        values = np.stack(arrays, axis=0).astype(np.float32, copy=False)

        dims = tuple(str(dim) for dim in mapping.dims)
        values, dims = reorder_to_canonical(values, dims)
        coords = default_coords_from_shape(dims, tuple(int(x) for x in values.shape))
        units = default_units(dims)

        intensity_unit = "arb"
        if first_ds is not None and hasattr(first_ds, "attrs"):
            raw_unit = first_ds.attrs.get("intensity_unit")
            if isinstance(raw_unit, bytes):
                raw_unit = raw_unit.decode("utf-8", errors="ignore")
            if raw_unit is not None:
                intensity_unit = str(raw_unit)

    provenance = {
        "source": "hdf5",
        "path": str(rec.path),
        "dataset_path": dataset_path_repr,
        "stacked_member_paths": member_paths,
        "stacked_kind": stack_kind,
        "key_stack_axis": str(mapping.key_stack_axis or ""),
        "synthetic_coordinate_dims": sorted(dims),
    }
    values, coords, provenance = _normalize_stokes_iqu_to_iquv(values, dims, coords, provenance)

    out = CubeDataset(
        data_id=data_id,
        dims=dims,
        coords=coords,
        values=values,
        units=units,
        intensity_unit=str(intensity_unit),
        wcs={"frame": "unknown", "source": "hdf5", "axis_types": _axis_types_for_dims(dims)},
        provenance=provenance,
    )
    out.validate()
    return out


def load_dataset_for_input(
    rec: _InputRecord,
    mapping: FileMappingDecision,
    data_id: str,
    *,
    parse_stokes_stack_token: Callable[[str], list[str] | None],
) -> CubeDataset:
    kwargs: dict[str, Any] = {
        "data_id": data_id,
        "dims": tuple(str(dim) for dim in mapping.dims),
    }
    if rec.format_name == "hdf5":
        selected_paths = mapping_hdf5_dataset_paths(rec, mapping)
        if len(selected_paths) > 1:
            stack_axis = mapping_hdf5_key_stack_axis(mapping)
            if stack_axis is None:
                raise ValueError("key_stack_axis is required when multiple dataset_paths are selected")
            if stack_axis not in CANONICAL_DIMS:
                raise ValueError(f"unknown key_stack_axis '{stack_axis}'")
            mapped_dims = [str(dim) for dim in mapping.dims]
            if not mapped_dims or mapped_dims[0] != stack_axis:
                raise ValueError(f"key_stack_axis '{stack_axis}' must be assigned to axis 0 for stacked keys")
            return load_hdf5_dataset_stack(
                rec=rec,
                mapping=mapping,
                data_id=data_id,
                member_paths=selected_paths,
                stack_kind="selected_keys",
                dataset_path_repr=f"stack({', '.join(selected_paths)})",
            )
        dataset_path = str(
            selected_paths[0] if selected_paths else rec.parsed.format_metadata.get("dataset_path", "values")
        ).strip()
        if parse_stokes_stack_token(dataset_path):
            return load_hdf5_stokes_stack(
                rec,
                mapping,
                data_id,
                dataset_path,
                parse_stokes_stack_token=parse_stokes_stack_token,
            )
        kwargs["dataset_path"] = dataset_path or "values"
    if rec.format_name == "zarr":
        data_key = str(rec.parsed.format_metadata.get("data_key", "values")).strip()
        kwargs["data_key"] = data_key or "values"
    return load_by_extension(rec.path, **kwargs)
