from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from mobula.data import loaders


def test_normalize_stokes_iqu_to_iquv_falls_back_to_numeric_axis_for_label_coords() -> None:
    values = np.arange(6, dtype=np.float32).reshape(3, 2)
    coords = {
        "pol": np.asarray(["I", "Q", "U"], dtype=object),
        "x": np.asarray([0.0, 1.0], dtype=np.float64),
    }

    out_values, out_coords, provenance = loaders._normalize_stokes_iqu_to_iquv(values, ("pol", "x"), coords)

    assert out_values.shape == (4, 2)
    np.testing.assert_allclose(out_values[3], 0.0)
    np.testing.assert_allclose(out_coords["pol"], np.arange(4, dtype=np.float64))
    assert provenance["stokes_assumed_v_zero"] is True


def test_normalize_stokes_iqu_to_iquv_recovers_from_zero_coord_step() -> None:
    values = np.arange(6, dtype=np.float32).reshape(3, 2)
    coords = {
        "pol": np.asarray([0.0, 0.0, 0.0], dtype=np.float64),
        "x": np.asarray([0.0, 1.0], dtype=np.float64),
    }

    _, out_coords, _ = loaders._normalize_stokes_iqu_to_iquv(values, ("pol", "x"), coords)
    np.testing.assert_allclose(out_coords["pol"], np.asarray([0.0, 0.0, 0.0, 1.0], dtype=np.float64))


def test_load_hdf5_accepts_sequence_dims_attr_and_decodes_bytes_intensity_unit(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    path = tmp_path / "sequence_dims.h5"
    with h5py.File(path, "w") as f:
        ds = f.create_dataset("values", data=np.zeros((2, 3, 4), dtype=np.float32))
        ds.attrs["dims"] = np.asarray([b"sample", b"t", b"x"])
        ds.attrs["intensity_unit"] = b"Jy"

    out = loaders.load_hdf5(path)
    assert out.dims == ("sample", "t", "x")
    assert out.intensity_unit == "Jy"


def test_load_fits_preserves_wcs_matrix_and_computes_axis_coordinates(tmp_path: Path) -> None:
    fits = pytest.importorskip("astropy.io.fits")
    path = tmp_path / "wcs_matrix.fits"
    values = np.zeros((3, 4), dtype=np.float32)
    hdu = fits.PrimaryHDU(data=values)
    hdu.header["CTYPE1"] = "RA---TAN"
    hdu.header["CTYPE2"] = "TIME"
    hdu.header["CUNIT1"] = "deg"
    hdu.header["CUNIT2"] = "s"
    hdu.header["CRVAL1"] = 100.0
    hdu.header["CDELT1"] = 0.5
    hdu.header["CRPIX1"] = 2.0
    hdu.header["CRVAL2"] = 10.0
    hdu.header["CDELT2"] = 2.0
    hdu.header["CRPIX2"] = 1.0
    hdu.header["RADESYS"] = "ICRS"
    hdu.header["EQUINOX"] = 2000.0
    hdu.header["PC1_1"] = 1.0
    hdu.header["CROTA2"] = 12.5
    hdu.writeto(path)

    out = loaders.load_fits(path)

    assert out.dims == ("t", "x")
    np.testing.assert_allclose(out.coords["x"], np.asarray([99.5, 100.0, 100.5, 101.0], dtype=np.float64))
    np.testing.assert_allclose(out.coords["t"], np.asarray([10.0, 12.0, 14.0], dtype=np.float64))
    assert out.wcs["fits_global"]["RADESYS"] == "ICRS"
    assert out.wcs["fits_global"]["EQUINOX"] == 2000.0
    assert out.wcs["fits_matrix"] == {"PC1_1": 1.0, "CROTA2": 12.5}
    assert out.wcs["fits_axes"]["x"]["ctype"] == "RA---TAN"
    assert out.wcs["fits_axes"]["t"]["ctype"] == "TIME"
