from __future__ import annotations

import numpy as np
import pytest
from fastapi import HTTPException

from ncube.service.api import (
    _clamp_dim_bounds,
    _clamp_roi_bounds,
    _downsample_2d,
    _extract_2d_slice,
    _extract_3d_volume,
    _index_or_mid,
    _parse_range_mode,
    _parse_sample_mode,
    _profile_series_for_region,
    _relative_uncertainty,
)


def test_parse_sample_mode_normalizes() -> None:
    assert _parse_sample_mode(" Mean ") == "mean"
    assert _parse_sample_mode("SINGLE") == "single"
    assert _parse_sample_mode("rel_uncert") == "rel_uncert"


def test_parse_sample_mode_rejects_invalid() -> None:
    with pytest.raises(HTTPException, match="invalid sample_mode"):
        _parse_sample_mode("median")


def test_parse_range_mode_normalizes() -> None:
    assert _parse_range_mode(" Time ") == "time"
    assert _parse_range_mode("FULL") == "full"


def test_parse_range_mode_rejects_invalid() -> None:
    with pytest.raises(HTTPException, match="invalid range_mode"):
        _parse_range_mode("polar")


def test_relative_uncertainty_avoids_divide_by_zero() -> None:
    mean = np.array([0.0, 2.0, -4.0], dtype=np.float32)
    std = np.array([1.0, 2.0, 2.0], dtype=np.float32)
    rel = _relative_uncertainty(mean, std)
    assert np.isfinite(rel).all()
    np.testing.assert_allclose(rel[1:], np.array([1.0, 0.5], dtype=np.float32), rtol=1e-6, atol=1e-6)


def test_downsample_2d_respects_limit() -> None:
    arr = np.arange(100, dtype=np.float32).reshape(10, 10)
    ds, step = _downsample_2d(arr, max_pixels=16)
    assert ds.shape[0] * ds.shape[1] <= 16
    assert step[0] >= 1
    assert step[1] >= 1


def test_downsample_2d_noop_for_none_or_under_limit() -> None:
    arr = np.arange(25, dtype=np.float32).reshape(5, 5)
    ds1, step1 = _downsample_2d(arr, max_pixels=None)
    ds2, step2 = _downsample_2d(arr, max_pixels=25)
    assert ds1.shape == arr.shape
    assert ds2.shape == arr.shape
    assert step1 == (1, 1)
    assert step2 == (1, 1)


def test_downsample_2d_rejects_non_2d() -> None:
    arr = np.zeros((2, 2, 2), dtype=np.float32)
    with pytest.raises(ValueError, match="expects 2D input"):
        _downsample_2d(arr, max_pixels=2)


def test_index_or_mid_uses_midpoint_and_candidate(base_dataset) -> None:
    assert _index_or_mid(base_dataset, "t", None) == base_dataset.shape[2] // 2
    assert _index_or_mid(base_dataset, "nu", 1) == 1


def test_index_or_mid_rejects_out_of_bounds(base_dataset) -> None:
    with pytest.raises(HTTPException, match="out of bounds"):
        _index_or_mid(base_dataset, "nu", 999)


def test_clamp_dim_bounds_clamps_and_rejects_empty(base_dataset) -> None:
    lo, hi = _clamp_dim_bounds(base_dataset, "t", -5, 999)
    assert lo == 0
    assert hi == base_dataset.shape[2]
    with pytest.raises(HTTPException, match="invalid bounds"):
        _clamp_dim_bounds(base_dataset, "t", 2, 2)


def test_clamp_roi_bounds_clamps_and_rejects_empty(base_dataset) -> None:
    x0, x1, y0, y1 = _clamp_roi_bounds(base_dataset, -9, 999, -2, 999)
    assert x0 == 0
    assert x1 == base_dataset.shape[4]
    assert y0 == 0
    assert y1 == base_dataset.shape[5]
    with pytest.raises(HTTPException, match="invalid ROI bounds"):
        _clamp_roi_bounds(base_dataset, 5, 5, 1, 2)


def test_extract_2d_slice_transposes_for_reverse_plane_order(base_dataset) -> None:
    out, selected, coords = _extract_2d_slice(
        ds=base_dataset,
        plane_x="y",
        plane_y="x",
        sample_mode="single",
        sample=0,
        pol=0,
        t=0,
        nu=0,
        x=None,
        y=None,
        z=0,
    )
    assert out.shape == (base_dataset.shape[5], base_dataset.shape[4])
    assert selected["sample"] == 0
    assert "z" in coords


def test_extract_2d_slice_rejects_sample_aggregation_with_sample_plane(base_dataset) -> None:
    with pytest.raises(HTTPException, match="incompatible when sample is used as a plane"):
        _extract_2d_slice(
            ds=base_dataset,
            plane_x="sample",
            plane_y="x",
            sample_mode="mean",
            sample=None,
            pol=0,
            t=0,
            nu=0,
            x=None,
            y=0,
            z=0,
        )


def test_extract_3d_volume_rejects_dataset_without_spatial_dimension(base_dataset, subset_builder) -> None:
    no_z = subset_builder(base_dataset, ("sample", "pol", "t", "nu", "x", "y"), "no-z")
    with pytest.raises(HTTPException, match="dataset missing 'z'"):
        _extract_3d_volume(
            ds=no_z,
            sample_mode="single",
            sample=0,
            pol=0,
            t=0,
            nu=0,
            x=0,
            y=0,
            z=None,
        )


def test_profile_series_for_region_requires_vary_dimension(base_dataset, subset_builder) -> None:
    no_time = subset_builder(base_dataset, ("sample", "pol", "nu", "x", "y", "z"), "no-time")
    with pytest.raises(HTTPException, match="dataset missing 't'"):
        _profile_series_for_region(
            ds=no_time,
            vary_dim="t",
            region_bounds={"x": (0, 2), "y": (0, 2)},
            fixed_requested={"pol": 0, "nu": 0, "z": 0},
        )
