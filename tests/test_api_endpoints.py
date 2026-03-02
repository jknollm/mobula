from __future__ import annotations

from pathlib import Path
import subprocess

import numpy as np
import pytest

from ncube.data.schema import CubeDataset
from ncube.service import api_routes_core


def _data_id(base_dataset) -> str:
    return base_dataset.data_id


def _make_low_pol_dataset(base_dataset, data_id: str, pol_count: int) -> CubeDataset:
    values = np.asarray(base_dataset.values[:, :pol_count, ...], dtype=np.float32)
    coords = {dim: np.asarray(base_dataset.coords[dim]).copy() for dim in base_dataset.dims}
    coords["pol"] = coords["pol"][:pol_count]
    dataset = CubeDataset(
        data_id=data_id,
        dims=base_dataset.dims,
        coords=coords,
        values=values,
        units=dict(base_dataset.units),
        intensity_unit=base_dataset.intensity_unit,
        wcs=dict(base_dataset.wcs),
        provenance={"source": "test-low-pol", "base": base_dataset.data_id},
        uncertainty=None,
    )
    dataset.validate()
    return dataset


def test_health_endpoint(client) -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_datasets_lists_registered_dataset(client, base_dataset) -> None:
    res = client.get("/api/datasets")
    assert res.status_code == 200
    datasets = res.json()["datasets"]
    assert any(d["data_id"] == _data_id(base_dataset) for d in datasets)


def test_meta_contains_expected_fields(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/meta")
    assert res.status_code == 200
    body = res.json()
    assert body["data_id"] == _data_id(base_dataset)
    assert body["dims"] == list(base_dataset.dims)
    assert body["shape"] == list(base_dataset.shape)
    assert body["coords"]["x"]["unit"] == base_dataset.units["x"]
    assert body["coords"]["x"]["size"] == base_dataset.shape[4]
    assert body["pol_labels"] == ["I", "Q", "U", "V"]


@pytest.mark.parametrize(
    "method,path,json_body",
    [
        ("get", "/api/datasets/does-not-exist/meta", None),
        ("get", "/api/datasets/does-not-exist/slice", None),
        ("get", "/api/datasets/does-not-exist/volume", None),
        ("post", "/api/datasets/does-not-exist/roi-stats", {"x0": 0, "x1": 1, "y0": 0, "y1": 1}),
    ],
)
def test_unknown_dataset_returns_404(client, method: str, path: str, json_body: dict[str, int] | None) -> None:
    req = getattr(client, method)
    res = req(path, json=json_body) if json_body is not None else req(path)
    assert res.status_code == 404
    assert "not found" in res.json()["detail"]


def test_load_local_missing_path_returns_404(client, tmp_path: Path) -> None:
    missing = tmp_path / "missing.h5"
    res = client.post("/api/load-local", json={"path": str(missing), "data_id": "load-missing"})
    assert res.status_code == 404
    assert "path does not exist" in res.json()["detail"]


def test_load_local_unsupported_extension_returns_400(client, tmp_path: Path) -> None:
    p = tmp_path / "data.txt"
    p.write_text("not a cube", encoding="utf-8")
    res = client.post("/api/load-local", json={"path": str(p), "data_id": "bad-ext"})
    assert res.status_code == 400
    assert "unsupported file extension" in res.json()["detail"]


def test_load_local_hdf5_success(client, tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "tiny.h5"
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    with h5py.File(p, "w") as f:
        ds = f.create_dataset("values", data=values)
        ds.attrs["dims"] = "t,nu,x"
        ds.attrs["intensity_unit"] = "Jy"

    res = client.post("/api/load-local", json={"path": str(p), "data_id": "tiny-h5"})
    assert res.status_code == 200
    body = res.json()
    assert body["loaded"] == "tiny-h5"
    assert body["dims"] == ["t", "nu", "x"]
    assert body["shape"] == [2, 3, 4]

    list_res = client.get("/api/datasets")
    listed = {d["data_id"] for d in list_res.json()["datasets"]}
    assert "tiny-h5" in listed


def test_load_local_with_manual_dims_and_padding(client, tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "manual_axes.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("values", data=np.zeros((3, 4), dtype=np.float32))

    res = client.post(
        "/api/load-local",
        json={"path": str(p), "data_id": "manual-axes-h5", "dims": ["x", "y"], "pad_missing_dims": True},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["loaded"] == "manual-axes-h5"
    assert body["dims"] == ["sample", "pol", "t", "nu", "x", "y", "z"]
    assert body["shape"] == [1, 1, 1, 1, 3, 4, 1]
    assert body["padded_dims"] == ["sample", "pol", "t", "nu", "z"]


def test_upload_local_hdf5_success(client, tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "upload.h5"
    values = np.arange(2 * 3 * 4, dtype=np.float32).reshape(2, 3, 4)
    with h5py.File(p, "w") as f:
        ds = f.create_dataset("values", data=values)
        ds.attrs["dims"] = "t,nu,x"
        ds.attrs["intensity_unit"] = "Jy"

    with p.open("rb") as fh:
        res = client.post(
            "/api/upload-local",
            data={"data_id": "upload-h5"},
            files={"file": ("upload.h5", fh, "application/octet-stream")},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["loaded"] == "upload-h5"
    assert body["dims"] == ["t", "nu", "x"]
    assert body["shape"] == [2, 3, 4]
    assert body["path"] == "upload.h5"

    list_res = client.get("/api/datasets")
    listed = {d["data_id"] for d in list_res.json()["datasets"]}
    assert "upload-h5" in listed


def test_upload_local_uses_filename_stem_when_data_id_missing(client, tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "natural_name.h5"
    with h5py.File(p, "w") as f:
        ds = f.create_dataset("values", data=np.zeros((2, 2), dtype=np.float32))
        ds.attrs["dims"] = "x,y"

    with p.open("rb") as fh:
        res = client.post(
            "/api/upload-local",
            files={"file": ("natural_name.h5", fh, "application/octet-stream")},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["loaded"] == "natural_name"


def test_upload_local_with_manual_dims_and_padding(client, tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    p = tmp_path / "upload_manual_axes.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("values", data=np.zeros((3, 4), dtype=np.float32))

    with p.open("rb") as fh:
        res = client.post(
            "/api/upload-local",
            data={"data_id": "upload-manual-axes-h5", "dims": "x,y", "pad_missing_dims": "true"},
            files={"file": ("upload_manual_axes.h5", fh, "application/octet-stream")},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["loaded"] == "upload-manual-axes-h5"
    assert body["dims"] == ["sample", "pol", "t", "nu", "x", "y", "z"]
    assert body["shape"] == [1, 1, 1, 1, 3, 4, 1]
    assert body["padded_dims"] == ["sample", "pol", "t", "nu", "z"]


def test_upload_local_unsupported_extension_returns_400(client) -> None:
    res = client.post(
        "/api/upload-local",
        files={"file": ("data.txt", b"not a cube", "text/plain")},
    )
    assert res.status_code == 400
    assert "unsupported file extension" in res.json()["detail"]


def test_upload_local_rejects_zarr_extension(client) -> None:
    res = client.post(
        "/api/upload-local",
        files={"file": ("dataset.zarr", b"placeholder", "application/octet-stream")},
    )
    assert res.status_code == 400
    assert "zarr folder upload is not supported" in res.json()["detail"]


def test_fs_pick_reports_cancel(client, monkeypatch) -> None:
    monkeypatch.setattr(api_routes_core, "_pick_local_path_native", lambda _target="file": None)
    res = client.post("/api/fs/pick")
    assert res.status_code == 200
    assert res.json() == {"canceled": True}


def test_fs_pick_defaults_to_file_target(client, monkeypatch) -> None:
    seen: dict[str, str] = {}

    def fake_pick(target: str = "file") -> None:
        seen["target"] = target
        return None

    monkeypatch.setattr(api_routes_core, "_pick_local_path_native", fake_pick)
    res = client.post("/api/fs/pick")
    assert res.status_code == 200
    assert seen["target"] == "file"


def test_fs_pick_accepts_folder_target(client, monkeypatch) -> None:
    seen: dict[str, str] = {}

    def fake_pick(target: str = "file") -> None:
        seen["target"] = target
        return None

    monkeypatch.setattr(api_routes_core, "_pick_local_path_native", fake_pick)
    res = client.post("/api/fs/pick", json={"target": "folder"})
    assert res.status_code == 200
    assert seen["target"] == "folder"


def test_fs_pick_returns_selected_path(client, tmp_path: Path, monkeypatch) -> None:
    picked = tmp_path / "picked.fits"
    picked.write_text("x", encoding="utf-8")
    monkeypatch.setattr(api_routes_core, "_pick_local_path_native", lambda _target="file": str(picked))
    res = client.post("/api/fs/pick")
    assert res.status_code == 200
    body = res.json()
    assert body["canceled"] is False
    assert body["exists"] is True
    assert body["is_file"] is True
    assert body["loadable"] is True
    assert body["path"] == str(picked.resolve())


def test_native_picker_darwin_mode_dialog_includes_cancel_button(monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        if len(calls) == 1:
            return subprocess.CompletedProcess(cmd, 0, stdout="File\n", stderr="")
        return subprocess.CompletedProcess(cmd, 0, stdout="/tmp/test.h5\n", stderr="")

    monkeypatch.setattr(api_routes_core.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(api_routes_core.subprocess, "run", fake_run)

    picked = api_routes_core._pick_local_path_native("dataset")
    assert picked == "/tmp/test.h5"
    assert len(calls) == 2
    mode_script_lines = [calls[0][i] for i in range(1, len(calls[0])) if calls[0][i - 1] == "-e"]
    mode_dialog = mode_script_lines[1]
    assert 'buttons {"Cancel", "Folder (.zarr)", "File"}' in mode_dialog
    assert 'cancel button "Cancel"' in mode_dialog


def test_slice_default_shape_and_stats(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice")
    assert res.status_code == 200
    body = res.json()
    assert body["shape"] == [base_dataset.shape[4], base_dataset.shape[5]]
    assert body["full_shape"] == [base_dataset.shape[4], base_dataset.shape[5]]
    assert len(body["values"]) == base_dataset.shape[4] * base_dataset.shape[5]
    assert body["stats"]["max"] >= body["stats"]["min"]
    assert body["sampling_step"] == [1, 1]


def test_slice_rejects_invalid_sample_mode(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params={"sample_mode": "median"})
    assert res.status_code == 400
    assert "invalid sample_mode" in res.json()["detail"]


def test_slice_rejects_out_of_bounds_index(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params={"nu": 999})
    assert res.status_code == 400
    assert "out of bounds" in res.json()["detail"]


def test_slice_rejects_equal_plane_dims(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params={"plane_x": "x", "plane_y": "x"})
    assert res.status_code == 400
    assert "must be different" in res.json()["detail"]


def test_slice_rejects_unknown_plane_dim(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params={"plane_x": "foo", "plane_y": "x"})
    assert res.status_code == 400
    assert "not in dataset" in res.json()["detail"]


def test_slice_rejects_sample_aggregation_when_sample_is_plane_axis(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/slice",
        params={"plane_x": "sample", "plane_y": "x", "sample_mode": "mean"},
    )
    assert res.status_code == 400
    assert "incompatible when sample is used as a plane dimension" in res.json()["detail"]


def test_slice_downsamples_with_max_pixels(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params={"max_pixels": 12})
    assert res.status_code == 200
    body = res.json()
    assert body["shape"][0] * body["shape"][1] <= 12
    assert body["full_shape"] == [base_dataset.shape[4], base_dataset.shape[5]]


def test_slice_query_validation_for_max_pixels(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params={"max_pixels": 0})
    assert res.status_code == 422


@pytest.mark.parametrize("mode", ["single", "mean", "std", "rel_uncert"])
def test_volume_supports_all_sample_modes(client, base_dataset, mode: str) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/volume", params={"sample_mode": mode})
    assert res.status_code == 200
    body = res.json()
    assert body["sample_mode"] == mode
    assert body["shape"] == [base_dataset.shape[4], base_dataset.shape[5], base_dataset.shape[6]]
    assert len(body["values"]) == base_dataset.shape[4] * base_dataset.shape[5] * base_dataset.shape[6]


def test_volume_rejects_invalid_sample_mode(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/volume", params={"sample_mode": "median"})
    assert res.status_code == 400
    assert "invalid sample_mode" in res.json()["detail"]


def test_volume_rejects_out_of_bounds_index(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/volume", params={"sample": 999})
    assert res.status_code == 400
    assert "out of bounds" in res.json()["detail"]


def test_volume_requires_xyz_dimensions(client_factory, base_dataset, subset_builder) -> None:
    no_z = subset_builder(base_dataset, ("sample", "pol", "t", "nu", "x", "y"), "no-z")
    with client_factory(no_z) as custom_client:
        res = custom_client.get("/api/datasets/no-z/volume")
    assert res.status_code == 400
    assert "dataset missing 'z'" in res.json()["detail"]


@pytest.mark.parametrize(
    ("range_mode", "must_contain"),
    [
        ("none", {"x", "y"}),
        ("time", {"x", "y", "t"}),
        ("spectral", {"x", "y", "nu"}),
        ("time_spectral", {"x", "y", "t", "nu"}),
        ("space", {"x", "y", "z"}),
        ("full", {"x", "y", "z", "t", "nu"}),
    ],
)
def test_intensity_range_modes(client, base_dataset, range_mode: str, must_contain: set[str]) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/intensity-range", params={"range_mode": range_mode})
    assert res.status_code == 200
    body = res.json()
    assert body["range_mode"] == range_mode
    assert must_contain.issubset(set(body["vary_dims"]))


def test_intensity_range_rejects_invalid_mode(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/intensity-range", params={"range_mode": "bad"})
    assert res.status_code == 400
    assert "invalid range_mode" in res.json()["detail"]


def test_intensity_range_rejects_equal_plane_dims(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/intensity-range",
        params={"plane_x": "x", "plane_y": "x"},
    )
    assert res.status_code == 400
    assert "must be different" in res.json()["detail"]


def test_intensity_range_applies_windows(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/intensity-range",
        params={"range_mode": "time_spectral", "t0": 1, "t1": 4, "nu0": 2, "nu1": 5},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["windowed_dims"]["t"] == [1, 4]
    assert body["windowed_dims"]["nu"] == [2, 5]


def test_intensity_range_rejects_invalid_t_window(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/intensity-range",
        params={"range_mode": "time", "t0": 3, "t1": 3},
    )
    assert res.status_code == 400
    assert "invalid bounds for dim 't'" in res.json()["detail"]


def test_intensity_range_rejects_invalid_nu_window(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/intensity-range",
        params={"range_mode": "spectral", "nu0": 5, "nu1": 5},
    )
    assert res.status_code == 400
    assert "invalid bounds for dim 'nu'" in res.json()["detail"]


def test_evpa_success_and_tick_count_consistent(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/evpa", params={"sample_mode": "mean", "z": 0})
    assert res.status_code == 200
    body = res.json()
    assert body["tick_count"] == len(body["ticks"])
    if body["ticks"]:
        first = body["ticks"][0]
        assert {"x", "y", "dx", "dy"} <= set(first.keys())


def test_evpa_higher_i_threshold_reduces_tick_count(client, base_dataset) -> None:
    low = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/evpa",
        params={"sample_mode": "mean", "i_min_fraction": 0.0},
    )
    high = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/evpa",
        params={"sample_mode": "mean", "i_min_fraction": 0.9},
    )
    assert low.status_code == 200
    assert high.status_code == 200
    assert high.json()["tick_count"] <= low.json()["tick_count"]


def test_evpa_rejects_invalid_sample_mode(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/evpa", params={"sample_mode": "median"})
    assert res.status_code == 400
    assert "invalid sample_mode" in res.json()["detail"]


def test_evpa_query_validation_for_step(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/evpa", params={"step": 2})
    assert res.status_code == 422


def test_evpa_requires_pol_dimension(client_factory, base_dataset, subset_builder) -> None:
    no_pol = subset_builder(base_dataset, ("sample", "t", "nu", "x", "y", "z"), "no-pol")
    with client_factory(no_pol) as custom_client:
        res = custom_client.get("/api/datasets/no-pol/evpa")
    assert res.status_code == 400
    assert "no polarization axis" in res.json()["detail"]


def test_evpa_requires_at_least_three_polarization_channels(client_factory, base_dataset) -> None:
    low_pol = _make_low_pol_dataset(base_dataset, "low-pol", pol_count=2)
    with client_factory(low_pol) as custom_client:
        res = custom_client.get("/api/datasets/low-pol/evpa")
    assert res.status_code == 400
    assert "at least I,Q,U" in res.json()["detail"]


def test_profiles_returns_time_and_spectral_series(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/profiles",
        json={"x0": 1, "x1": 4, "y0": 2, "y1": 6, "pol": 0, "t": 0, "nu": 0, "z": 0},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["pixel_count"] == (4 - 1) * (6 - 2)
    assert body["time_profile"]["axis"] == "t"
    assert body["spectrum_profile"]["axis"] == "nu"
    assert len(body["time_profile"]["coords"]) == base_dataset.shape[2]
    assert len(body["spectrum_profile"]["coords"]) == base_dataset.shape[3]


def test_profiles_rejects_invalid_roi_bounds(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/profiles",
        json={"x0": 2, "x1": 2, "y0": 0, "y1": 1, "pol": 0, "t": 0, "nu": 0, "z": 0},
    )
    assert res.status_code == 400
    assert "invalid ROI bounds" in res.json()["detail"]


def test_profiles_require_nu_dimension(client_factory, base_dataset, subset_builder) -> None:
    no_nu = subset_builder(base_dataset, ("sample", "pol", "t", "x", "y", "z"), "no-nu")
    with client_factory(no_nu) as custom_client:
        res = custom_client.post(
            "/api/datasets/no-nu/profiles",
            json={"x0": 0, "x1": 2, "y0": 0, "y1": 2},
        )
    assert res.status_code == 400
    assert "dataset missing 'nu'" in res.json()["detail"]


def test_profiles_plane_returns_spatial_profile(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/profiles-plane",
        json={
            "plane_x": "y",
            "plane_y": "z",
            "u0": 1,
            "u1": 4,
            "v0": 0,
            "v1": 2,
            "sample": 0,
            "pol": 0,
            "t": 0,
            "nu": 0,
            "x": 3,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["plane"] == ["y", "z"]
    assert body["spatial_axis"] == "x"
    assert body["pixel_count"] == (4 - 1) * (2 - 0)
    assert len(body["spatial_profile"]["coords"]) == base_dataset.shape[4]


def test_profiles_plane_rejects_equal_axes(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/profiles-plane",
        json={"plane_x": "x", "plane_y": "x", "u0": 0, "u1": 2, "v0": 0, "v1": 2},
    )
    assert res.status_code == 400
    assert "must be different" in res.json()["detail"]


def test_profiles_plane_rejects_invalid_bounds(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/profiles-plane",
        json={"plane_x": "x", "plane_y": "y", "u0": 3, "u1": 3, "v0": 0, "v1": 1},
    )
    assert res.status_code == 400
    assert "invalid bounds for dim 'x'" in res.json()["detail"]


def test_profiles_plane_rejects_missing_dimension(client_factory, base_dataset, subset_builder) -> None:
    no_t = subset_builder(base_dataset, ("sample", "pol", "nu", "x", "y", "z"), "no-t")
    with client_factory(no_t) as custom_client:
        res = custom_client.post(
            "/api/datasets/no-t/profiles-plane",
            json={"plane_x": "x", "plane_y": "y", "u0": 0, "u1": 2, "v0": 0, "v1": 2},
        )
    assert res.status_code == 400
    assert "dataset missing 't'" in res.json()["detail"]


def test_roi_stats_success_and_clamping(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/roi-stats",
        json={"x0": 2, "x1": 999, "y0": 3, "y1": 999, "pol": 0, "t": 0, "nu": 0, "z": 0},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["roi_bounds"]["x1"] == base_dataset.shape[4]
    assert body["roi_bounds"]["y1"] == base_dataset.shape[5]
    assert body["sample_count"] == base_dataset.shape[0]
    assert len(body["per_sample_means"]) == base_dataset.shape[0]


def test_roi_stats_rejects_invalid_bounds(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/roi-stats",
        json={"x0": 5, "x1": 5, "y0": 0, "y1": 1, "pol": 0, "t": 0, "nu": 0, "z": 0},
    )
    assert res.status_code == 400
    assert "invalid ROI bounds" in res.json()["detail"]


def test_roi_stats_query_validation_rejects_negative_indices(client, base_dataset) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/roi-stats",
        json={"x0": -1, "x1": 2, "y0": 0, "y1": 2},
    )
    assert res.status_code == 422


def test_roi_stats_requires_xy_dimensions(client_factory, base_dataset, subset_builder) -> None:
    no_y = subset_builder(base_dataset, ("sample", "pol", "t", "nu", "x", "z"), "no-y")
    with client_factory(no_y) as custom_client:
        res = custom_client.post(
            "/api/datasets/no-y/roi-stats",
            json={"x0": 0, "x1": 2, "y0": 0, "y1": 1},
        )
    assert res.status_code == 400
    assert "dataset missing 'y'" in res.json()["detail"]


def test_multispectral_success(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/multispectral", params={"sample_mode": "single"})
    assert res.status_code == 200
    body = res.json()
    assert body["shape"] == [base_dataset.shape[4], base_dataset.shape[5]]
    assert len(body["values"]["r"]) == base_dataset.shape[4] * base_dataset.shape[5]
    assert len(body["values"]["g"]) == base_dataset.shape[4] * base_dataset.shape[5]
    assert len(body["values"]["b"]) == base_dataset.shape[4] * base_dataset.shape[5]
    assert body["bands"]["unit"] == base_dataset.units["nu"]


def test_multispectral_downsamples(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/multispectral", params={"max_pixels": 12})
    assert res.status_code == 200
    body = res.json()
    assert body["shape"][0] * body["shape"][1] <= 12
    assert body["sampling_step"][0] >= 1
    assert body["sampling_step"][1] >= 1


def test_multispectral_windowed_nu_range(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"nu0": 1, "nu1": 5},
    )
    assert res.status_code == 200
    body = res.json()
    bands = body["bands"]
    assert bands["blue"][0] <= bands["blue"][1]
    assert bands["green"][0] <= bands["green"][1]
    assert bands["red"][0] <= bands["red"][1]


def test_multispectral_rejects_too_narrow_nu_window(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"nu0": 0, "nu1": 2},
    )
    assert res.status_code == 400
    assert "at least 3 spectral channels" in res.json()["detail"]


def test_multispectral_rejects_plane_with_nu_axis(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"plane_x": "nu", "plane_y": "x"},
    )
    assert res.status_code == 400
    assert "requires plane without 'nu'" in res.json()["detail"]


def test_multispectral_rejects_equal_plane_dims(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"plane_x": "x", "plane_y": "x"},
    )
    assert res.status_code == 400
    assert "must be different" in res.json()["detail"]


def test_multispectral_requires_nu_dimension(client_factory, base_dataset, subset_builder) -> None:
    no_nu = subset_builder(base_dataset, ("sample", "pol", "t", "x", "y", "z"), "no-nu")
    with client_factory(no_nu) as custom_client:
        res = custom_client.get("/api/datasets/no-nu/multispectral")
    assert res.status_code == 400
    assert "has no 'nu' axis" in res.json()["detail"]


def test_multispectral_rejects_invalid_sample_mode(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/multispectral", params={"sample_mode": "median"})
    assert res.status_code == 400
    assert "invalid sample_mode" in res.json()["detail"]


def test_multispectral_accepts_sample_mean_mode(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/multispectral", params={"sample_mode": "mean"})
    assert res.status_code == 200
    assert res.json()["sample_mode"] == "mean"


def test_multispectral_query_validation_for_max_pixels(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/multispectral", params={"max_pixels": 0})
    assert res.status_code == 422
