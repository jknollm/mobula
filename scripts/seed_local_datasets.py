#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

import h5py
import numpy as np
from astropy.io import fits
import zarr

from ncube.data.mock_cube import MockCubeConfig, generate_mock_dataset


SEED_CONFIG = MockCubeConfig(sample=3, pol=4, t=6, nu=8, x=32, y=32, z=3, seed=2026, model="dynamic")


def _remove_path(path: Path, overwrite: bool) -> bool:
    if not path.exists():
        return True
    if not overwrite:
        return False
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
    return True


def export_hdf5(values: np.ndarray, coords: dict[str, np.ndarray], units: dict[str, str], out_path: Path, overwrite: bool) -> None:
    if not _remove_path(out_path, overwrite):
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(out_path, "w") as f:
        ds = f.create_dataset("values", data=values, compression="gzip", compression_opts=4)
        ds.attrs["dims"] = "sample,pol,t,nu,x,y,z"
        ds.attrs["intensity_unit"] = "arb"
        for dim, unit in units.items():
            ds.attrs[f"unit_{dim}"] = unit
            f.create_dataset(f"coords/{dim}", data=np.asarray(coords[dim], dtype=np.float64))


def export_fits(values: np.ndarray, out_path: Path, overwrite: bool) -> None:
    if not _remove_path(out_path, overwrite):
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    hdu = fits.PrimaryHDU(data=values.astype(np.float32))
    hdr = hdu.header
    hdr["BUNIT"] = "arb"
    hdr["RADESYS"] = "ICRS"
    hdr["CTYPE1"] = "Z"
    hdr["CTYPE2"] = "Y"
    hdr["CTYPE3"] = "X"
    hdr["CTYPE4"] = "FREQ"
    hdr["CTYPE5"] = "TIME"
    hdr["CTYPE6"] = "STOKES"
    hdr["CTYPE7"] = "SAMPLE"
    hdr["CUNIT1"] = "channel"
    hdr["CUNIT2"] = "arcsec"
    hdr["CUNIT3"] = "arcsec"
    hdr["CUNIT4"] = "Hz"
    hdr["CUNIT5"] = "s"
    hdr["CUNIT6"] = "stokes-index"
    hdr["CUNIT7"] = "index"
    hdu.writeto(out_path, overwrite=overwrite)


def export_zarr(values: np.ndarray, coords: dict[str, np.ndarray], units: dict[str, str], out_path: Path, overwrite: bool) -> None:
    if not _remove_path(out_path, overwrite):
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    root = zarr.open_group(str(out_path), mode="w")
    arr = root.create_dataset("values", data=values, shape=values.shape, dtype="f4")
    arr.attrs["dims"] = ["sample", "pol", "t", "nu", "x", "y", "z"]
    arr.attrs["intensity_unit"] = "arb"
    arr.attrs["frame"] = "ICRS"
    for dim, unit in units.items():
        arr.attrs[f"unit_{dim}"] = unit
    cg = root.create_group("coords")
    for dim in ("sample", "pol", "t", "nu", "x", "y", "z"):
        cg.create_dataset(dim, data=np.asarray(coords[dim], dtype=np.float64))


def export_xarray_style_zarr(
    values: np.ndarray, coords: dict[str, np.ndarray], units: dict[str, str], out_path: Path, overwrite: bool
) -> None:
    if not _remove_path(out_path, overwrite):
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    root = zarr.open_group(str(out_path), mode="w")
    arr = root.create_dataset("values", data=values, shape=values.shape, dtype="f4")
    dims = ["sample", "pol", "t", "nu", "x", "y", "z"]
    arr.attrs["_ARRAY_DIMENSIONS"] = dims
    arr.attrs["units"] = "arb"
    root.attrs["frame"] = "ICRS"
    for dim in dims:
        coord = root.create_dataset(dim, data=np.asarray(coords[dim], dtype=np.float64))
        coord.attrs["_ARRAY_DIMENSIONS"] = [dim]
        coord.attrs["units"] = units[dim]


def write_manifest(out_dir: Path, dims: tuple[str, ...], shape: tuple[int, ...], overwrite: bool) -> Path:
    manifest = out_dir / "manifest.json"
    if manifest.exists() and not overwrite:
        return manifest

    entries: list[dict[str, Any]] = [
        {
            "data_id": "seed-local-hdf5",
            "path": "seed_7d_cube.h5",
            "dims": list(dims),
            "shape": list(shape),
            "intensity_unit": "arb",
            "source": "seeded-local-hdf5",
        },
        {
            "data_id": "seed-local-fits",
            "path": "seed_7d_cube.fits",
            "dims": list(dims),
            "shape": list(shape),
            "intensity_unit": "arb",
            "source": "seeded-local-fits",
        },
        {
            "data_id": "seed-local-zarr",
            "path": "seed_7d_cube.zarr",
            "dims": list(dims),
            "shape": list(shape),
            "intensity_unit": "arb",
            "source": "seeded-local-zarr",
        },
        {
            "data_id": "seed-local-xarray-zarr",
            "path": "seed_7d_cube_xarray.zarr",
            "dims": list(dims),
            "shape": list(shape),
            "intensity_unit": "arb",
            "source": "seeded-local-xarray-zarr",
        },
    ]
    payload = {"version": 1, "datasets": entries}
    manifest.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed local test datasets and manifest for nCube.")
    parser.add_argument(
        "--out-dir",
        default="data/seeded",
        help="output directory for seeded dataset files and manifest (default: data/seeded)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="overwrite existing files/directories and manifest",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    dataset = generate_mock_dataset("seed-local", SEED_CONFIG)
    values = dataset.values
    coords = dataset.coords
    units = dataset.units

    h5_path = out_dir / "seed_7d_cube.h5"
    fits_path = out_dir / "seed_7d_cube.fits"
    zarr_path = out_dir / "seed_7d_cube.zarr"
    xarr_zarr_path = out_dir / "seed_7d_cube_xarray.zarr"

    export_hdf5(values, coords, units, h5_path, overwrite=args.overwrite)
    export_fits(values, fits_path, overwrite=args.overwrite)
    export_zarr(values, coords, units, zarr_path, overwrite=args.overwrite)
    export_xarray_style_zarr(values, coords, units, xarr_zarr_path, overwrite=args.overwrite)

    manifest = write_manifest(out_dir, dataset.dims, dataset.shape, overwrite=args.overwrite)
    print(f"seeded: {h5_path}")
    print(f"seeded: {fits_path}")
    print(f"seeded: {zarr_path}")
    print(f"seeded: {xarr_zarr_path}")
    print(f"manifest: {manifest}")


if __name__ == "__main__":
    main()
