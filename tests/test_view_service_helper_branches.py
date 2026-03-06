from __future__ import annotations

import io

import numpy as np
import pytest

from mobula.data.mock_cube import MockCubeConfig, generate_mock_dataset
from mobula.service import view_service


def test_normalize_total_flux_brightness_supports_linear_sqrt_and_log_modes() -> None:
    total_flux = np.asarray([0.0, 1.0, 10.0], dtype=np.float64)

    linear = view_service._normalize_total_flux_brightness(
        total_flux,
        intensity_mode="linear",
        clip_min=0.0,
        clip_max=1.0,
    )
    sqrt = view_service._normalize_total_flux_brightness(
        total_flux,
        intensity_mode="sqrt",
        clip_min=0.0,
        clip_max=1.0,
    )
    log = view_service._normalize_total_flux_brightness(
        total_flux,
        intensity_mode="log",
        clip_min=0.0,
        clip_max=1.0,
    )

    assert np.all((linear >= 0.0) & (linear <= 1.0))
    assert np.all((sqrt >= 0.0) & (sqrt <= 1.0))
    assert np.all((log >= 0.0) & (log <= 1.0))
    assert linear[-1] == pytest.approx(1.0)
    assert sqrt[-1] == pytest.approx(1.0)
    assert log[-1] == pytest.approx(1.0)
    assert sqrt[1] > linear[1]
    assert np.all(np.diff(log) >= 0.0)


def test_normalize_total_flux_brightness_returns_zeros_without_positive_finite_flux() -> None:
    total_flux = np.asarray([np.nan, -5.0, 0.0], dtype=np.float64)
    out = view_service._normalize_total_flux_brightness(
        total_flux,
        intensity_mode="linear",
        clip_min=0.0,
        clip_max=1.0,
    )
    np.testing.assert_allclose(out, np.zeros_like(total_flux))


def test_build_export_cutout_fits_writes_explicit_healpix_pixel_index_metadata() -> None:
    fits = pytest.importorskip("astropy.io.fits")
    ds = generate_mock_dataset(
        "healpix-cutout-fits",
        MockCubeConfig(sample=2, pol=1, t=4, nu=5, x=192, y=1, z=1, seed=71, model="healpix_sky"),
    )

    payload, filename = view_service.build_export_cutout_fits(
        ds,
        sample=0,
        pol=0,
        t=None,
        nu=None,
        x=None,
        y=None,
        z=0,
        sample_mode="single",
        plane_x="x",
        plane_y="y",
        u0=None,
        u1=None,
        v0=None,
        v1=None,
        t0=1,
        t1=3,
        nu0=1,
        nu1=4,
        pixel_indices=[18, 5, 0, 17, 18],
    )

    assert filename.endswith(".fits")
    with fits.open(io.BytesIO(payload), mode="readonly", memmap=False) as hdul:
        assert hdul[0].header["PIXTYPE"] == "HEALPIX"
        assert hdul[0].header["INDXSCHM"] == "EXPLICIT"
        assert hdul[0].header["MBXEXPL"] == 1
        np.testing.assert_array_equal(hdul["PIXEL_IDX"].data, np.asarray([0, 5, 17, 18], dtype=np.int64))


def test_build_export_cutout_hdf5_writes_explicit_healpix_pixel_indices() -> None:
    h5py = pytest.importorskip("h5py")
    ds = generate_mock_dataset(
        "healpix-cutout-hdf5",
        MockCubeConfig(sample=2, pol=1, t=4, nu=5, x=192, y=1, z=1, seed=71, model="healpix_sky"),
    )

    payload, filename = view_service.build_export_cutout_hdf5(
        ds,
        sample=0,
        pol=0,
        t=None,
        nu=None,
        x=None,
        y=None,
        z=0,
        sample_mode="single",
        plane_x="x",
        plane_y="y",
        u0=None,
        u1=None,
        v0=None,
        v1=None,
        t0=1,
        t1=3,
        nu0=1,
        nu1=4,
        pixel_indices=[18, 5, 0, 17, 18],
    )

    assert filename.endswith(".h5")
    with h5py.File(io.BytesIO(payload), "r") as f:
        np.testing.assert_array_equal(f["coords/x_indices"][:], np.asarray([0, 5, 17, 18], dtype=np.int64))
        assert f["values"].attrs["x_index_scheme"] == "explicit"
