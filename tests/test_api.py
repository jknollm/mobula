from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from mobula.main import app


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_mock_dataset_slice_and_roi() -> None:
    client = TestClient(app)

    datasets = client.get("/api/datasets")
    assert datasets.status_code == 200
    body = datasets.json()
    assert body["datasets"]
    data_ids = {d["data_id"] for d in body["datasets"]}
    assert "demo-quicklook-7d-pol-samples" in data_ids
    ds0 = body["datasets"][0]
    data_id = ds0["data_id"]
    shape = ds0["shape"]

    slice_res = client.get(
        f"/api/datasets/{data_id}/slice",
        params={"sample": 0, "pol": 0, "t": 0, "nu": 0, "z": 0, "sample_mode": "single"},
    )
    assert slice_res.status_code == 200
    slice_body = slice_res.json()
    assert slice_body["shape"] == [shape[4], shape[5]]
    assert len(slice_body["values"]) == shape[4] * shape[5]
    assert slice_body["sample_mode"] == "single"
    assert slice_body["full_shape"] == [shape[4], shape[5]]
    assert slice_body["sampling_step"] == [1, 1]

    lod_slice_res = client.get(
        f"/api/datasets/{data_id}/slice",
        params={"sample": 0, "pol": 0, "t": 0, "nu": 0, "z": 0, "sample_mode": "single", "max_pixels": 256},
    )
    assert lod_slice_res.status_code == 200
    lod_slice = lod_slice_res.json()
    assert lod_slice["full_shape"] == [shape[4], shape[5]]
    assert lod_slice["shape"][0] * lod_slice["shape"][1] <= 256
    assert lod_slice["sampling_step"][0] >= 1
    assert lod_slice["sampling_step"][1] >= 1

    mean_slice_res = client.get(
        f"/api/datasets/{data_id}/slice",
        params={"pol": 0, "t": 0, "nu": 0, "z": 0, "sample_mode": "mean"},
    )
    assert mean_slice_res.status_code == 200
    assert mean_slice_res.json()["sample_mode"] == "mean"

    std_slice_res = client.get(
        f"/api/datasets/{data_id}/slice",
        params={"pol": 0, "t": 0, "nu": 0, "z": 0, "sample_mode": "std"},
    )
    assert std_slice_res.status_code == 200
    assert std_slice_res.json()["sample_mode"] == "std"

    rel_slice_res = client.get(
        f"/api/datasets/{data_id}/slice",
        params={"pol": 0, "t": 0, "nu": 0, "z": 0, "sample_mode": "rel_uncert"},
    )
    assert rel_slice_res.status_code == 200
    assert rel_slice_res.json()["sample_mode"] == "rel_uncert"
    mean_vals = np.asarray(mean_slice_res.json()["values"], dtype=np.float64)
    std_vals = np.asarray(std_slice_res.json()["values"], dtype=np.float64)
    rel_vals = np.asarray(rel_slice_res.json()["values"], dtype=np.float64)
    expected_rel = std_vals / np.maximum(np.abs(mean_vals), 1.0e-8)
    np.testing.assert_allclose(rel_vals, expected_rel, rtol=1e-5, atol=1e-6)

    volume_res = client.get(
        f"/api/datasets/{data_id}/volume",
        params={"sample": 0, "pol": 0, "t": 0, "nu": 0, "sample_mode": "single"},
    )
    assert volume_res.status_code == 200
    volume = volume_res.json()
    assert volume["volume_dims"] == ["x", "y", "z"]
    assert volume["shape"] == [shape[4], shape[5], shape[6]]
    assert len(volume["values"]) == shape[4] * shape[5] * shape[6]
    assert volume["sample_mode"] == "single"

    volume_mean_res = client.get(
        f"/api/datasets/{data_id}/volume",
        params={"pol": 0, "t": 0, "nu": 0, "sample_mode": "mean"},
    )
    assert volume_mean_res.status_code == 200
    assert volume_mean_res.json()["sample_mode"] == "mean"

    time_range_res = client.get(
        f"/api/datasets/{data_id}/intensity-range",
        params={
            "sample": 0,
            "pol": 0,
            "nu": 0,
            "z": 0,
            "sample_mode": "single",
            "range_mode": "time",
            "plane_x": "x",
            "plane_y": "y",
        },
    )
    assert time_range_res.status_code == 200
    time_range = time_range_res.json()
    assert time_range["range_mode"] == "time"
    assert "t" in time_range["vary_dims"]
    assert "x" in time_range["vary_dims"]
    assert "y" in time_range["vary_dims"]
    assert time_range["max"] > time_range["min"]

    time_windowed_range_res = client.get(
        f"/api/datasets/{data_id}/intensity-range",
        params={
            "sample": 0,
            "pol": 0,
            "nu": 0,
            "z": 0,
            "sample_mode": "single",
            "range_mode": "time",
            "plane_x": "x",
            "plane_y": "y",
            "t0": 2,
            "t1": 10,
        },
    )
    assert time_windowed_range_res.status_code == 200
    assert time_windowed_range_res.json()["windowed_dims"]["t"] == [2, 10]

    rel_range_res = client.get(
        f"/api/datasets/{data_id}/intensity-range",
        params={
            "pol": 0,
            "t": 0,
            "nu": 0,
            "z": 0,
            "sample_mode": "rel_uncert",
            "range_mode": "none",
            "plane_x": "x",
            "plane_y": "y",
        },
    )
    assert rel_range_res.status_code == 200
    assert rel_range_res.json()["sample_mode"] == "rel_uncert"

    roi_res = client.post(
        f"/api/datasets/{data_id}/roi-stats",
        json={"x0": 10, "x1": 20, "y0": 12, "y1": 22, "pol": 0, "t": 0, "nu": 0, "z": 0},
    )
    assert roi_res.status_code == 200
    roi = roi_res.json()
    assert roi["sample_count"] == shape[0]
    assert "q50" in roi["stats"]

    evpa_res = client.get(
        f"/api/datasets/{data_id}/evpa",
        params={"sample_mode": "mean", "t": 0, "nu": 0, "z": 0},
    )
    assert evpa_res.status_code == 200
    evpa = evpa_res.json()
    assert evpa["tick_count"] >= 1

    evpa_high_i_thresh_res = client.get(
        f"/api/datasets/{data_id}/evpa",
        params={"sample_mode": "mean", "t": 0, "nu": 0, "z": 0, "i_min_fraction": 0.9},
    )
    assert evpa_high_i_thresh_res.status_code == 200
    evpa_high_i_thresh = evpa_high_i_thresh_res.json()
    assert evpa_high_i_thresh["tick_count"] <= evpa["tick_count"]

    profiles_res = client.post(
        f"/api/datasets/{data_id}/profiles",
        json={"x0": 8, "x1": 14, "y0": 9, "y1": 15, "pol": 0, "t": 0, "nu": 0, "z": 0},
    )
    assert profiles_res.status_code == 200
    profiles = profiles_res.json()
    assert profiles["pixel_count"] == 36
    assert profiles["time_profile"]["sample_count"] == shape[0]
    assert len(profiles["time_profile"]["coords"]) == shape[2]
    assert len(profiles["spectrum_profile"]["coords"]) == shape[3]

    yz_slice_res = client.get(
        f"/api/datasets/{data_id}/slice",
        params={
            "sample": 0,
            "pol": 0,
            "t": 0,
            "nu": 0,
            "x": 10,
            "sample_mode": "single",
            "plane_x": "y",
            "plane_y": "z",
        },
    )
    assert yz_slice_res.status_code == 200
    yz_slice = yz_slice_res.json()
    assert yz_slice["plane_dims"] == ["y", "z"]
    assert yz_slice["shape"] == [shape[5], shape[6]]

    plane_profiles_res = client.post(
        f"/api/datasets/{data_id}/profiles-plane",
        json={
            "plane_x": "y",
            "plane_y": "z",
            "u0": 4,
            "u1": 10,
            "v0": 0,
            "v1": 2,
            "sample": 0,
            "pol": 0,
            "t": 0,
            "nu": 0,
            "x": 12,
        },
    )
    assert plane_profiles_res.status_code == 200
    plane_profiles = plane_profiles_res.json()
    assert plane_profiles["plane"] == ["y", "z"]
    assert plane_profiles["pixel_count"] == 12
    assert len(plane_profiles["time_profile"]["coords"]) == shape[2]
    assert len(plane_profiles["spectrum_profile"]["coords"]) == shape[3]
    assert plane_profiles["spatial_axis"] == "x"
    assert len(plane_profiles["spatial_profile"]["coords"]) == shape[4]

    multispectral_res = client.get(
        f"/api/datasets/{data_id}/multispectral",
        params={"sample": 0, "pol": 0, "t": 0, "z": 0, "sample_mode": "single", "plane_x": "x", "plane_y": "y"},
    )
    assert multispectral_res.status_code == 200
    multispectral = multispectral_res.json()
    assert multispectral["plane_dims"] == ["x", "y"]
    assert multispectral["shape"] == [shape[4], shape[5]]
    assert multispectral["full_shape"] == [shape[4], shape[5]]
    assert multispectral["sampling_step"] == [1, 1]
    assert len(multispectral["values"]["r"]) == shape[4] * shape[5]
    assert len(multispectral["values"]["g"]) == shape[4] * shape[5]
    assert len(multispectral["values"]["b"]) == shape[4] * shape[5]

    multispectral_lod_res = client.get(
        f"/api/datasets/{data_id}/multispectral",
        params={
            "sample": 0,
            "pol": 0,
            "t": 0,
            "z": 0,
            "sample_mode": "single",
            "plane_x": "x",
            "plane_y": "y",
            "max_pixels": 256,
        },
    )
    assert multispectral_lod_res.status_code == 200
    multispectral_lod = multispectral_lod_res.json()
    assert multispectral_lod["full_shape"] == [shape[4], shape[5]]
    assert multispectral_lod["shape"][0] * multispectral_lod["shape"][1] <= 256

    multispectral_windowed_res = client.get(
        f"/api/datasets/{data_id}/multispectral",
        params={
            "sample": 0,
            "pol": 0,
            "t": 0,
            "z": 0,
            "sample_mode": "single",
            "plane_x": "x",
            "plane_y": "y",
            "nu0": 2,
            "nu1": 12,
        },
    )
    assert multispectral_windowed_res.status_code == 200
    multispectral_windowed = multispectral_windowed_res.json()
    assert multispectral_windowed["shape"] == [shape[4], shape[5]]
    assert len(multispectral_windowed["values"]["r"]) == shape[4] * shape[5]
    assert len(multispectral_windowed["values"]["g"]) == shape[4] * shape[5]
    assert len(multispectral_windowed["values"]["b"]) == shape[4] * shape[5]

    nu_meta = client.get(f"/api/datasets/{data_id}/meta")
    assert nu_meta.status_code == 200
    nu_min = nu_meta.json()["coords"]["nu"]["min"]
    nu_max = nu_meta.json()["coords"]["nu"]["max"]
    full_band = multispectral["bands"]
    win_band = multispectral_windowed["bands"]

    assert full_band["unit"] == "Hz"
    assert win_band["unit"] == "Hz"
    assert nu_min <= win_band["blue"][0] <= win_band["blue"][1] <= nu_max
    assert nu_min <= win_band["green"][0] <= win_band["green"][1] <= nu_max
    assert nu_min <= win_band["red"][0] <= win_band["red"][1] <= nu_max

    # Windowed RGB bands should shift compared to the full-range RGB mapping.
    assert win_band["blue"][0] > full_band["blue"][0]
    assert win_band["red"][1] < full_band["red"][1]

    multispectral_too_narrow = client.get(
        f"/api/datasets/{data_id}/multispectral",
        params={
            "sample": 0,
            "pol": 0,
            "t": 0,
            "z": 0,
            "sample_mode": "single",
            "plane_x": "x",
            "plane_y": "y",
            "nu0": 0,
            "nu1": 2,
        },
    )
    assert multispectral_too_narrow.status_code == 400
    assert "at least 3 spectral channels" in multispectral_too_narrow.json()["detail"]
