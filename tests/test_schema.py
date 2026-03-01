from __future__ import annotations

import numpy as np
import pytest

from ncube.data.schema import CANONICAL_DIMS, CubeDataset, is_canonical_order, reorder_to_canonical


def _valid_dataset() -> CubeDataset:
    dims = ("sample", "t", "x")
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    return CubeDataset(
        data_id="schema-ok",
        dims=dims,
        coords={
            "sample": np.arange(2, dtype=np.int32),
            "t": np.linspace(0.0, 2.0, 3, dtype=np.float32),
            "x": np.linspace(-1.0, 1.0, 4, dtype=np.float32),
        },
        values=values,
        units={"sample": "index", "t": "s", "x": "pix"},
        intensity_unit="arb",
        wcs={"frame": "test"},
        provenance={"source": "test"},
        uncertainty=None,
    )


def test_is_canonical_order_accepts_subsequence() -> None:
    assert is_canonical_order(("sample", "t", "x")) is True
    assert is_canonical_order(("t", "nu", "x", "z")) is True


def test_is_canonical_order_rejects_out_of_order_or_unknown() -> None:
    assert is_canonical_order(("x", "t")) is False
    assert is_canonical_order(("sample", "bad_dim")) is False


def test_reorder_to_canonical_reorders_axes() -> None:
    dims = ("x", "sample", "t")
    values = np.arange(4 * 2 * 3, dtype=np.float32).reshape(4, 2, 3)
    out, out_dims = reorder_to_canonical(values, dims)
    assert out_dims == ("sample", "t", "x")
    assert out.shape == (2, 3, 4)
    np.testing.assert_allclose(out[0, 0], values[:, 0, 0])


def test_reorder_to_canonical_validates_inputs() -> None:
    arr = np.zeros((2, 3), dtype=np.float32)
    with pytest.raises(ValueError, match="does not match array ndim"):
        reorder_to_canonical(arr, ("sample",))
    with pytest.raises(ValueError, match="duplicates"):
        reorder_to_canonical(arr, ("sample", "sample"))
    with pytest.raises(ValueError, match="unknown dimensions"):
        reorder_to_canonical(arr, ("sample", "foo"))


def test_cube_dataset_validate_success() -> None:
    ds = _valid_dataset()
    ds.validate()
    assert ds.shape == (2, 3, 4)
    assert ds.dim_index("x") == 2


def test_cube_dataset_validate_rejects_empty_dims() -> None:
    ds = _valid_dataset()
    ds.dims = ()
    with pytest.raises(ValueError, match="no dimensions"):
        ds.validate()


def test_cube_dataset_validate_rejects_rank_mismatch() -> None:
    ds = _valid_dataset()
    ds.values = np.zeros((2, 3, 4, 5), dtype=np.float32)
    with pytest.raises(ValueError, match="rank does not match"):
        ds.validate()


def test_cube_dataset_validate_rejects_noncanonical_order() -> None:
    ds = _valid_dataset()
    ds.dims = ("x", "t", "sample")
    with pytest.raises(ValueError, match="canonical order"):
        ds.validate()


def test_cube_dataset_validate_rejects_missing_coords() -> None:
    ds = _valid_dataset()
    del ds.coords["t"]
    with pytest.raises(ValueError, match="missing coordinates"):
        ds.validate()


def test_cube_dataset_validate_rejects_non_1d_coords() -> None:
    ds = _valid_dataset()
    ds.coords["x"] = np.zeros((2, 2), dtype=np.float32)
    with pytest.raises(ValueError, match="must be 1D"):
        ds.validate()


def test_cube_dataset_validate_rejects_coord_length_mismatch() -> None:
    ds = _valid_dataset()
    ds.coords["x"] = np.arange(3, dtype=np.float32)
    with pytest.raises(ValueError, match="coordinate length mismatch"):
        ds.validate()


def test_cube_dataset_validate_rejects_missing_unit() -> None:
    ds = _valid_dataset()
    del ds.units["x"]
    with pytest.raises(ValueError, match="missing unit"):
        ds.validate()


def test_cube_dataset_validate_rejects_bad_mask_shape() -> None:
    ds = _valid_dataset()
    ds.mask = np.zeros((2, 3), dtype=bool)
    with pytest.raises(ValueError, match="mask shape does not match"):
        ds.validate()


def test_cube_dataset_dim_index_missing_raises_key_error() -> None:
    ds = _valid_dataset()
    with pytest.raises(KeyError, match="dimension 'nu' not found"):
        ds.dim_index("nu")


def test_canonical_dims_constant_is_expected_order() -> None:
    assert CANONICAL_DIMS == ("sample", "pol", "t", "nu", "x", "y", "z")
