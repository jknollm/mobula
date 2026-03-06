from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from mobula.data.loaders import load_by_extension, load_fits, load_hdf5, load_zarr, pad_dataset_to_canonical


def test_load_hdf5_reads_dims_units_and_coords(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "cube.h5"
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    with h5py.File(p, "w") as f:
        ds = f.create_dataset("values", data=values)
        ds.attrs["dims"] = "sample,t,x"
        ds.attrs["unit_sample"] = "index"
        ds.attrs["unit_t"] = "s"
        ds.attrs["unit_x"] = "arcsec"
        ds.attrs["intensity_unit"] = "Jy/beam"
        f.create_dataset("coords/t", data=np.array([0.0, 5.0, 10.0], dtype=np.float64))

    out = load_hdf5(p, data_id="h5-ds")
    assert out.data_id == "h5-ds"
    assert out.dims == ("sample", "t", "x")
    assert out.shape == (2, 3, 4)
    assert out.units["x"] == "arcsec"
    assert out.intensity_unit == "Jy/beam"
    np.testing.assert_allclose(out.coords["t"], np.array([0.0, 5.0, 10.0], dtype=np.float64))


def test_load_hdf5_rejects_missing_dataset(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "missing_values.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("other", data=np.zeros((2, 2), dtype=np.float32))
    with pytest.raises(KeyError, match="dataset 'values' not found"):
        load_hdf5(p)


def test_load_hdf5_requires_dims_when_attr_missing(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "no_dims.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("values", data=np.zeros((2, 2), dtype=np.float32))
    with pytest.raises(ValueError, match="missing 'dims' attribute"):
        load_hdf5(p)


def test_load_hdf5_accepts_explicit_dims_argument(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "explicit_dims.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("values", data=np.zeros((3, 2), dtype=np.float32))
    out = load_hdf5(p, dims=("t", "x"))
    assert out.dims == ("t", "x")
    assert out.shape == (3, 2)


def test_load_hdf5_expands_pol_size_three_with_zero_v(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "iqu_only.h5"
    values = np.array(
        [
            [1.0, 2.0, 3.0],
            [10.0, 20.0, 30.0],
            [100.0, 200.0, 300.0],
        ],
        dtype=np.float32,
    )
    with h5py.File(p, "w") as f:
        ds = f.create_dataset("values", data=values)
        ds.attrs["dims"] = "pol,x"

    out = load_hdf5(p)
    assert out.dims == ("pol", "x")
    assert out.shape == (4, 3)
    np.testing.assert_allclose(out.values[:3], values)
    np.testing.assert_allclose(out.values[3], 0.0)
    np.testing.assert_allclose(out.coords["pol"], np.array([0.0, 1.0, 2.0, 3.0], dtype=np.float32))
    assert out.provenance["stokes_assumed_v_zero"] is True
    assert out.provenance["pol_labels"] == ["I", "Q", "U", "V"]


def test_load_fits_with_explicit_dims(tmp_path: Path) -> None:
    fits = pytest.importorskip("astropy.io.fits")
    p = tmp_path / "explicit.fits"
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    hdu = fits.PrimaryHDU(data=values)
    hdu.header["BUNIT"] = "K"
    hdu.header["RADESYS"] = "ICRS"
    hdu.writeto(p)

    out = load_fits(p, dims=("sample", "t", "x"), data_id="fits-ds")
    assert out.data_id == "fits-ds"
    assert out.dims == ("sample", "t", "x")
    assert out.shape == (2, 3, 4)
    assert out.intensity_unit == "K"
    assert out.wcs["frame"] == "ICRS"


def test_load_fits_infers_dims_from_header_ctype(tmp_path: Path) -> None:
    fits = pytest.importorskip("astropy.io.fits")
    p = tmp_path / "inferred.fits"
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    hdu = fits.PrimaryHDU(data=values)
    hdu.header["CTYPE1"] = "RA---TAN"
    hdu.header["CTYPE2"] = "TIME"
    hdu.header["CTYPE3"] = "SAMPLE"
    hdu.header["CUNIT1"] = "deg"
    hdu.header["CUNIT2"] = "s"
    hdu.header["CUNIT3"] = "index"
    hdu.writeto(p)

    out = load_fits(p)
    assert out.dims == ("sample", "t", "x")
    assert out.units["x"] == "deg"
    assert out.units["t"] == "s"


def test_load_fits_expands_pol_size_three_with_zero_v(tmp_path: Path) -> None:
    fits = pytest.importorskip("astropy.io.fits")
    p = tmp_path / "iqu_only.fits"
    values = np.array(
        [
            [4.0, 5.0],
            [6.0, 7.0],
            [8.0, 9.0],
        ],
        dtype=np.float32,
    )
    fits.PrimaryHDU(data=values).writeto(p)

    out = load_fits(p, dims=("pol", "x"))
    assert out.dims == ("pol", "x")
    assert out.shape == (4, 2)
    np.testing.assert_allclose(out.values[:3], values)
    np.testing.assert_allclose(out.values[3], 0.0)
    assert out.provenance["stokes_assumed_v_zero"] is True


def test_load_fits_rejects_scalar_hdu(tmp_path: Path) -> None:
    fits = pytest.importorskip("astropy.io.fits")
    p = tmp_path / "scalar.fits"
    fits.PrimaryHDU().writeto(p)
    with pytest.raises(ValueError, match="scalar data"):
        load_fits(p)


def test_load_zarr_reads_dims_units_and_coords(tmp_path: Path) -> None:
    zarr = pytest.importorskip("zarr")
    p = tmp_path / "cube.zarr"
    root = zarr.open_group(str(p), mode="w")
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    arr = root.create_dataset("values", data=values, shape=values.shape, dtype="f4")
    arr.attrs["dims"] = ["sample", "t", "x"]
    arr.attrs["intensity_unit"] = "Jy"
    arr.attrs["unit_x"] = "arcsec"
    arr.attrs["frame"] = "ICRS"
    cg = root.create_group("coords")
    cg.create_dataset("x", data=np.array([-1.0, -0.2, 0.2, 1.0], dtype=np.float64))

    out = load_zarr(p, data_id="zarr-ds")
    assert out.data_id == "zarr-ds"
    assert out.dims == ("sample", "t", "x")
    assert out.shape == (2, 3, 4)
    assert out.units["x"] == "arcsec"
    assert out.intensity_unit == "Jy"
    assert out.wcs["frame"] == "ICRS"
    np.testing.assert_allclose(out.coords["x"], np.array([-1.0, -0.2, 0.2, 1.0], dtype=np.float64))


def test_load_zarr_supports_xarray_style_array_dimensions(tmp_path: Path) -> None:
    zarr = pytest.importorskip("zarr")
    p = tmp_path / "cube_xarray_style.zarr"
    root = zarr.open_group(str(p), mode="w")
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    arr = root.create_dataset("values", data=values, shape=values.shape, dtype="f4")
    arr.attrs["_ARRAY_DIMENSIONS"] = ["sample", "t", "x"]
    arr.attrs["units"] = "mJy"
    root.attrs["frame"] = "FK5"
    t = root.create_dataset("t", data=np.array([0.0, 5.0, 10.0], dtype=np.float64))
    t.attrs["units"] = "s"
    x = root.create_dataset("x", data=np.array([-1.0, -0.2, 0.2, 1.0], dtype=np.float64))
    x.attrs["units"] = "arcsec"

    out = load_zarr(p, data_id="zarr-xarray-ds")
    assert out.data_id == "zarr-xarray-ds"
    assert out.dims == ("sample", "t", "x")
    assert out.shape == (2, 3, 4)
    assert out.intensity_unit == "mJy"
    assert out.units["t"] == "s"
    assert out.units["x"] == "arcsec"
    assert out.wcs["frame"] == "FK5"
    np.testing.assert_allclose(out.coords["t"], np.array([0.0, 5.0, 10.0], dtype=np.float64))
    np.testing.assert_allclose(out.coords["x"], np.array([-1.0, -0.2, 0.2, 1.0], dtype=np.float64))


def test_load_zarr_requires_dims_attr(tmp_path: Path) -> None:
    zarr = pytest.importorskip("zarr")
    p = tmp_path / "no_dims.zarr"
    root = zarr.open_group(str(p), mode="w")
    root.create_dataset("values", data=np.zeros((2, 2), dtype=np.float32), shape=(2, 2), dtype="f4")
    with pytest.raises(ValueError, match="attrs missing 'dims'"):
        load_zarr(p)


def test_load_zarr_accepts_explicit_dims_argument(tmp_path: Path) -> None:
    zarr = pytest.importorskip("zarr")
    p = tmp_path / "zarr_manual_dims.zarr"
    root = zarr.open_group(str(p), mode="w")
    root.create_dataset("values", data=np.zeros((3, 5), dtype=np.float32), shape=(3, 5), dtype="f4")
    out = load_zarr(p, dims=("t", "x"))
    assert out.dims == ("t", "x")
    assert out.shape == (3, 5)


def test_load_zarr_requires_requested_data_key(tmp_path: Path) -> None:
    zarr = pytest.importorskip("zarr")
    p = tmp_path / "missing_data_key.zarr"
    zarr.open_group(str(p), mode="w")
    with pytest.raises(KeyError, match="not found"):
        load_zarr(p)


@pytest.mark.parametrize(
    "suffix",
    [
        ".h5",
        ".fits",
        ".zarr",
    ],
)
def test_load_by_extension_dispatches(tmp_path: Path, suffix: str) -> None:
    if suffix == ".h5":
        h5py = pytest.importorskip("h5py")
        p = tmp_path / "dispatch.h5"
        with h5py.File(p, "w") as f:
            ds = f.create_dataset("values", data=np.zeros((2, 2), dtype=np.float32))
            ds.attrs["dims"] = "t,x"
    elif suffix == ".fits":
        fits = pytest.importorskip("astropy.io.fits")
        p = tmp_path / "dispatch.fits"
        fits.PrimaryHDU(data=np.zeros((2, 2), dtype=np.float32)).writeto(p)
    else:
        zarr = pytest.importorskip("zarr")
        p = tmp_path / "dispatch.zarr"
        root = zarr.open_group(str(p), mode="w")
        arr = root.create_dataset("values", data=np.zeros((2, 2), dtype=np.float32), shape=(2, 2), dtype="f4")
        arr.attrs["dims"] = ["t", "x"]

    if suffix == ".fits":
        out = load_by_extension(p, dims=("t", "x"))
    else:
        out = load_by_extension(p)
    assert out.values.shape == (2, 2)


def test_load_by_extension_rejects_unknown_suffix(tmp_path: Path) -> None:
    p = tmp_path / "data.bin"
    p.write_bytes(b"\x00\x01")
    with pytest.raises(ValueError, match="unsupported file extension"):
        load_by_extension(p)


def test_pad_dataset_to_canonical_adds_singleton_axes(tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "pad_base.h5"
    with h5py.File(p, "w") as f:
        ds = f.create_dataset("values", data=np.zeros((4, 6), dtype=np.float32))
        ds.attrs["dims"] = "x,y"

    base = load_hdf5(p)
    padded, missing = pad_dataset_to_canonical(base)
    assert missing == ("sample", "pol", "t", "nu", "z")
    assert padded.dims == ("sample", "pol", "t", "nu", "x", "y", "z")
    assert padded.shape == (1, 1, 1, 1, 4, 6, 1)
    assert padded.provenance["padded_dims"] == list(missing)
