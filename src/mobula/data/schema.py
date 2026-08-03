from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

CANONICAL_DIMS: tuple[str, ...] = ("sample", "pol", "t", "nu", "x", "y", "z")


def is_canonical_order(dims: tuple[str, ...]) -> bool:
    """Return True if dims are a subsequence of canonical order."""
    pos = {name: idx for idx, name in enumerate(CANONICAL_DIMS)}
    last = -1
    for dim in dims:
        idx = pos.get(dim)
        if idx is None or idx <= last:
            return False
        last = idx
    return True


def reorder_to_canonical(values: np.ndarray, dims: tuple[str, ...]) -> tuple[np.ndarray, tuple[str, ...]]:
    """Reorder an ndarray into canonical dimension order."""
    if len(dims) != values.ndim:
        raise ValueError(f"dims length ({len(dims)}) does not match array ndim ({values.ndim})")
    if len(set(dims)) != len(dims):
        raise ValueError("dims contain duplicates")

    invalid = [d for d in dims if d not in CANONICAL_DIMS]
    if invalid:
        raise ValueError(f"unknown dimensions: {invalid}")

    ordered = tuple(d for d in CANONICAL_DIMS if d in dims)
    if dims == ordered:
        return values, dims

    src_axis = {d: i for i, d in enumerate(dims)}
    permutation = [src_axis[d] for d in ordered]
    return np.transpose(values, permutation), ordered


@dataclass(slots=True)
class CubeDataset:
    data_id: str
    dims: tuple[str, ...]
    coords: dict[str, np.ndarray]
    values: np.ndarray
    units: dict[str, str]
    intensity_unit: str
    wcs: dict[str, Any]
    provenance: dict[str, Any]
    mask: np.ndarray | None = None
    uncertainty: dict[str, Any] | None = None
    _coord_list_cache: dict[str, list[float | str]] = field(default_factory=dict, init=False, repr=False, compare=False)
    _serialized_axis_coords_cache: dict[tuple[str, ...], dict[str, Any]] = field(
        default_factory=dict,
        init=False,
        repr=False,
        compare=False,
    )

    def validate(self) -> None:
        if not self.dims:
            raise ValueError("dataset has no dimensions")
        if self.values.ndim != len(self.dims):
            raise ValueError("values rank does not match dims")
        if not is_canonical_order(self.dims):
            raise ValueError(f"dims not in canonical order: {self.dims}")

        for axis, dim in enumerate(self.dims):
            if dim not in self.coords:
                raise ValueError(f"missing coordinates for dim '{dim}'")
            coord = np.asarray(self.coords[dim])
            if coord.ndim != 1:
                raise ValueError(f"coordinates for '{dim}' must be 1D")
            if coord.shape[0] != self.values.shape[axis]:
                raise ValueError(
                    f"coordinate length mismatch for '{dim}': "
                    f"{coord.shape[0]} vs {self.values.shape[axis]}"
                )
            if dim not in self.units:
                raise ValueError(f"missing unit for dim '{dim}'")

        if self.mask is not None and self.mask.shape != self.values.shape:
            raise ValueError("mask shape does not match values")

    @property
    def shape(self) -> tuple[int, ...]:
        return self.values.shape

    def dim_index(self, name: str) -> int:
        try:
            return self.dims.index(name)
        except ValueError as exc:
            raise KeyError(f"dimension '{name}' not found") from exc
