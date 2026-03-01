#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
from astropy.io import fits

from ncube.data.mock_cube import MockCubeConfig, generate_mock_dataset


def export_hdf5(ds_values: np.ndarray, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(out_path, "w") as f:
        values = f.create_dataset("values", data=ds_values, compression="gzip", compression_opts=4)
        values.attrs["dims"] = "sample,pol,t,nu,x,y,z"
        values.attrs["intensity_unit"] = "arb"
        values.attrs["unit_t"] = "s"
        values.attrs["unit_nu"] = "Hz"
        values.attrs["unit_x"] = "arcsec"
        values.attrs["unit_y"] = "arcsec"
        values.attrs["unit_z"] = "channel"


def export_fits(ds_values: np.ndarray, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    hdu = fits.PrimaryHDU(data=ds_values.astype(np.float32))
    hdr = hdu.header
    hdr["BUNIT"] = "arb"
    hdr["CTYPE1"] = "Z"
    hdr["CTYPE2"] = "Y"
    hdr["CTYPE3"] = "X"
    hdr["CTYPE4"] = "FREQ"
    hdr["CTYPE5"] = "TIME"
    hdr["CTYPE6"] = "STOKES"
    hdr["CTYPE7"] = "SAMPLE"
    hdr["CUNIT4"] = "Hz"
    hdr["CUNIT5"] = "s"
    hdr["CUNIT3"] = "arcsec"
    hdr["CUNIT2"] = "arcsec"
    hdu.writeto(out_path, overwrite=True)


def main() -> None:
    dataset = generate_mock_dataset("mock-export", MockCubeConfig())
    values = dataset.values

    out_dir = Path("data/mock").resolve()
    h5_path = out_dir / "mock_7d_cube.h5"
    fits_path = out_dir / "mock_7d_cube.fits"

    export_hdf5(values, h5_path)
    export_fits(values, fits_path)
    print(f"exported: {h5_path}")
    print(f"exported: {fits_path}")


if __name__ == "__main__":
    main()

