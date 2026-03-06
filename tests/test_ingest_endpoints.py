from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest


def _write_h5(path: Path, values: np.ndarray, dims: str) -> None:
    h5py = pytest.importorskip("h5py")
    with h5py.File(path, "w") as f:
        ds = f.create_dataset("values", data=values)
        ds.attrs["dims"] = dims
        ds.attrs["intensity_unit"] = "Jy"


def _write_h5_at_path(path: Path, dataset_path: str, values: np.ndarray, dims: str) -> None:
    h5py = pytest.importorskip("h5py")
    with h5py.File(path, "w") as f:
        ds = f.create_dataset(dataset_path, data=values)
        ds.attrs["dims"] = dims
        ds.attrs["intensity_unit"] = "Jy"


def test_ingest_inspect_plan_commit_separate(client, tmp_path: Path) -> None:
    p = tmp_path / "single.h5"
    _write_h5(p, np.arange(12, dtype=np.float32).reshape(3, 4), "x,y")

    before_ids = {item["data_id"] for item in client.get("/api/datasets").json()["datasets"]}

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    inspection = inspect_res.json()
    assert inspection["inspection_id"]
    assert len(inspection["files"]) == 1
    raw_input_id = inspection["files"][0]["raw_input"]["id"]

    mid_ids = {item["data_id"] for item in client.get("/api/datasets").json()["datasets"]}
    assert mid_ids == before_ids

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": inspection["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dims": ["x", "y"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert len(plan["datasets"]) == 1

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    commit = commit_res.json()
    assert len(commit["created_data_ids"]) == 1

    after_ids = {item["data_id"] for item in client.get("/api/datasets").json()["datasets"]}
    assert commit["created_data_ids"][0] in after_ids


def test_ingest_plan_strict_error_for_non_singleton_group_axis(client, tmp_path: Path) -> None:
    p1 = tmp_path / "sample_a.h5"
    p2 = tmp_path / "sample_b.h5"
    _write_h5(p1, np.ones((2, 4), dtype=np.float32), "sample,x")
    _write_h5(p2, np.ones((2, 4), dtype=np.float32), "sample,x")

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p1), str(p2)])})
    assert inspect_res.status_code == 200
    inspection = inspect_res.json()

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": inspection["inspection_id"],
            "decision": {
                "grouping_mode": "files_as_sample",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": item["raw_input"]["id"],
                        "dims": ["sample", "x"],
                    }
                    for item in inspection["files"]
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is False
    assert any("must be singleton" in err for err in plan["errors"])


def test_ingest_upload_combine_success(client, tmp_path: Path) -> None:
    p1 = tmp_path / "time_001.h5"
    p2 = tmp_path / "time_002.h5"
    _write_h5(p1, np.arange(12, dtype=np.float32).reshape(3, 4), "x,y")
    _write_h5(p2, np.arange(12, dtype=np.float32).reshape(3, 4), "x,y")

    with p1.open("rb") as fh1, p2.open("rb") as fh2:
        inspect_res = client.post(
            "/api/ingest/inspect",
            files=[
                ("files", ("time_001.h5", fh1, "application/octet-stream")),
                ("files", ("time_002.h5", fh2, "application/octet-stream")),
            ],
        )
    assert inspect_res.status_code == 200
    inspection = inspect_res.json()

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": inspection["inspection_id"],
            "decision": {
                "grouping_mode": "files_as_t",
                "tab_mode": "single_tab",
                "combined_data_id": "stacked-time",
                "file_mappings": [
                    {
                        "raw_input_id": item["raw_input"]["id"],
                        "dims": ["x", "y"],
                    }
                    for item in inspection["files"]
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert len(plan["datasets"]) == 1
    assert plan["datasets"][0]["projected_shape"] == [1, 1, 2, 1, 3, 4, 1]

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    commit = commit_res.json()
    assert commit["created_data_ids"]

    meta_res = client.get(f"/api/datasets/{commit['created_data_ids'][0]}/meta")
    assert meta_res.status_code == 200
    assert meta_res.json()["shape"] == [1, 1, 2, 1, 3, 4, 1]


def test_ingest_plan_pol_axis_size_3_is_loaded_as_iqu_with_zero_v(client, tmp_path: Path) -> None:
    p = tmp_path / "iqu-pol.h5"
    values = np.array(
        [
            [1.0, 2.0, 3.0],   # I
            [10.0, 20.0, 30.0],  # Q
            [100.0, 200.0, 300.0],  # U
        ],
        dtype=np.float32,
    )
    _write_h5(p, values, "pol,x")

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    inspection = inspect_res.json()

    raw_input_id = inspection["files"][0]["raw_input"]["id"]
    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": inspection["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dims": ["pol", "x"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert any("assuming I,Q,U and padding V=0" in warning for warning in plan["warnings"])

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    created_id = commit_res.json()["created_data_ids"][0]

    meta_res = client.get(f"/api/datasets/{created_id}/meta")
    assert meta_res.status_code == 200
    meta = meta_res.json()
    assert meta["shape"] == [1, 4, 1, 1, 3, 1, 1]
    assert meta["pol_labels"] == ["I", "Q", "U", "V"]

    u_slice = client.get(
        f"/api/datasets/{created_id}/slice",
        params={"sample": 0, "pol": 2, "t": 0, "nu": 0, "z": 0, "sample_mode": "single"},
    )
    assert u_slice.status_code == 200
    np.testing.assert_allclose(np.asarray(u_slice.json()["values"], dtype=np.float32), values[2])

    v_slice = client.get(
        f"/api/datasets/{created_id}/slice",
        params={"sample": 0, "pol": 3, "t": 0, "nu": 0, "z": 0, "sample_mode": "single"},
    )
    assert v_slice.status_code == 200
    np.testing.assert_allclose(np.asarray(v_slice.json()["values"], dtype=np.float32), 0.0)


def test_ingest_plan_sphere_axis_validates_healpix_nside(client, tmp_path: Path) -> None:
    valid = tmp_path / "healpix_ok.h5"
    invalid = tmp_path / "healpix_bad.h5"
    _write_h5(valid, np.arange(48, dtype=np.float32), "x")
    _write_h5(invalid, np.arange(50, dtype=np.float32), "x")

    valid_inspect = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(valid)])})
    assert valid_inspect.status_code == 200
    valid_payload = valid_inspect.json()
    valid_input_id = valid_payload["files"][0]["raw_input"]["id"]

    valid_plan = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": valid_payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": valid_input_id,
                        "dims": ["x"],
                        "sphere_axis": 0,
                    }
                ],
            },
        },
    )
    assert valid_plan.status_code == 200
    assert valid_plan.json()["is_valid"] is True

    bad_inspect = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(invalid)])})
    assert bad_inspect.status_code == 200
    bad_payload = bad_inspect.json()
    bad_input_id = bad_payload["files"][0]["raw_input"]["id"]

    bad_plan = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": bad_payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": bad_input_id,
                        "dims": ["x"],
                        "sphere_axis": 0,
                    }
                ],
            },
        },
    )
    assert bad_plan.status_code == 200
    plan = bad_plan.json()
    assert plan["is_valid"] is False
    assert any("HEALPix npix=12*nside^2" in err for err in plan["errors"])


def test_ingest_hdf5_inspect_uses_best_numeric_dataset_when_values_missing(client, tmp_path: Path) -> None:
    p = tmp_path / "fallback.h5"
    _write_h5_at_path(p, "science/image", np.arange(12, dtype=np.float32).reshape(3, 4), "x,y")

    # Add a coordinate-like dataset to confirm import prefers display-like arrays over axis vectors.
    h5py = pytest.importorskip("h5py")
    with h5py.File(p, "a") as f:
        f.create_dataset("coords/x", data=np.linspace(0.0, 1.0, 64, dtype=np.float32))

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    payload = inspect_res.json()
    file_info = payload["files"][0]

    assert file_info["parsed"]["format_metadata"]["dataset_path"] == "science/image"
    candidates = file_info["parsed"]["format_metadata"]["dataset_candidates"]
    assert any(row["path"] == "science/image" for row in candidates)
    assert any("using 'science/image'" in msg for msg in file_info["warnings"])


def test_ingest_hdf5_commit_reuses_inspected_dataset_path(client, tmp_path: Path) -> None:
    p = tmp_path / "fallback_commit.h5"
    _write_h5_at_path(p, "science/image", np.arange(20, dtype=np.float32).reshape(4, 5), "x,y")

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    inspection = inspect_res.json()
    raw_input_id = inspection["files"][0]["raw_input"]["id"]

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": inspection["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dims": ["x", "y"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    created = commit_res.json()["created_data_ids"][0]

    meta_res = client.get(f"/api/datasets/{created}/meta")
    assert meta_res.status_code == 200
    assert meta_res.json()["shape"] == [1, 1, 1, 1, 4, 5, 1]


def test_ingest_hdf5_commit_respects_explicit_dataset_path_override(client, tmp_path: Path) -> None:
    p = tmp_path / "override_key.h5"
    h5py = pytest.importorskip("h5py")
    with h5py.File(p, "w") as f:
        ds_a = f.create_dataset("science/image", data=np.arange(12, dtype=np.float32).reshape(3, 4))
        ds_a.attrs["dims"] = "x,y"
        ds_b = f.create_dataset("science/cube", data=np.arange(24, dtype=np.float32).reshape(2, 3, 4))
        ds_b.attrs["dims"] = "t,x,y"

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    inspection = inspect_res.json()
    file_info = inspection["files"][0]
    raw_input_id = file_info["raw_input"]["id"]
    candidates = file_info["parsed"]["format_metadata"]["dataset_candidates"]
    assert len(candidates) >= 2
    selected_path = file_info["parsed"]["format_metadata"]["dataset_path"]
    override_path = next(row["path"] for row in candidates if row["path"] != selected_path)
    override_shape = next(row["shape"] for row in candidates if row["path"] == override_path)
    if len(override_shape) == 3:
        override_dims = ["t", "x", "y"]
        expected_projected_shape = [1, 1, override_shape[0], 1, override_shape[1], override_shape[2], 1]
    elif len(override_shape) == 2:
        override_dims = ["x", "y"]
        expected_projected_shape = [1, 1, 1, 1, override_shape[0], override_shape[1], 1]
    else:
        pytest.fail(f"unexpected override shape rank: {override_shape}")

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": inspection["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dataset_path": override_path,
                        "dims": override_dims,
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert plan["datasets"][0]["projected_shape"] == expected_projected_shape

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    created = commit_res.json()["created_data_ids"][0]

    meta_res = client.get(f"/api/datasets/{created}/meta")
    assert meta_res.status_code == 200
    assert meta_res.json()["shape"] == expected_projected_shape


def test_ingest_hdf5_detects_stokes_split_keys_and_commits_stack(client, tmp_path: Path) -> None:
    p = tmp_path / "stokes_split.h5"
    h5py = pytest.importorskip("h5py")
    shape = (99, 32, 48)
    with h5py.File(p, "w") as f:
        for idx, key in enumerate(("I", "Q", "U", "V")):
            f.create_dataset(key, data=np.full(shape, idx + 1, dtype=np.float32))
        f.create_dataset("times", data=np.linspace(0.0, 1.0, shape[0], dtype=np.float64))
        f.create_dataset("header", data=np.array([], dtype="S10"))

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    payload = inspect_res.json()
    file_info = payload["files"][0]
    raw_input_id = file_info["raw_input"]["id"]
    candidates = file_info["parsed"]["format_metadata"]["dataset_candidates"]

    stokes = next((row for row in candidates if row.get("kind") == "stokes_stack"), None)
    assert stokes is not None
    assert stokes["shape"] == [4, 99, 32, 48]
    assert stokes["dims_attr"] == ["pol", "t", "x", "y"]

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dataset_path": stokes["path"],
                        "dims": ["pol", "t", "x", "y"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert plan["datasets"][0]["projected_shape"] == [1, 4, 99, 1, 32, 48, 1]

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    created = commit_res.json()["created_data_ids"][0]

    meta_res = client.get(f"/api/datasets/{created}/meta")
    assert meta_res.status_code == 200
    meta = meta_res.json()
    assert meta["shape"] == [1, 4, 99, 1, 32, 48, 1]


def test_ingest_hdf5_manual_dataset_paths_stack_commit(client, tmp_path: Path) -> None:
    p = tmp_path / "manual_key_stack.h5"
    h5py = pytest.importorskip("h5py")
    shape = (8, 16, 24)
    with h5py.File(p, "w") as f:
        for idx, key in enumerate(("I", "Q", "U", "V")):
            ds = f.create_dataset(key, data=np.full(shape, idx + 1, dtype=np.float32))
            ds.attrs["dims"] = "t,x,y"
        f.create_dataset("times", data=np.linspace(0.0, 1.0, shape[0], dtype=np.float64))

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    payload = inspect_res.json()
    raw_input_id = payload["files"][0]["raw_input"]["id"]

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dataset_paths": ["I", "Q", "U", "V"],
                        "key_stack_axis": "pol",
                        "dims": ["pol", "t", "x", "y"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert plan["datasets"][0]["projected_shape"] == [1, 4, 8, 1, 16, 24, 1]

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    created = commit_res.json()["created_data_ids"][0]

    meta_res = client.get(f"/api/datasets/{created}/meta")
    assert meta_res.status_code == 200
    assert meta_res.json()["shape"] == [1, 4, 8, 1, 16, 24, 1]


def test_ingest_hdf5_manual_dataset_paths_stack_requires_axis0_mapping(client, tmp_path: Path) -> None:
    p = tmp_path / "manual_key_stack_axis_guard.h5"
    h5py = pytest.importorskip("h5py")
    shape = (6, 10, 14)
    with h5py.File(p, "w") as f:
        for key in ("I", "Q", "U", "V"):
            ds = f.create_dataset(key, data=np.ones(shape, dtype=np.float32))
            ds.attrs["dims"] = "t,x,y"

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    payload = inspect_res.json()
    raw_input_id = payload["files"][0]["raw_input"]["id"]

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dataset_paths": ["I", "Q", "U", "V"],
                        "key_stack_axis": "pol",
                        "dims": ["t", "pol", "x", "y"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is False
    assert any("must be assigned to axis 0" in err for err in plan["errors"])


def test_ingest_hdf5_dataset_path_overrides_stale_single_dataset_paths(client, tmp_path: Path) -> None:
    p = tmp_path / "stale_single_path_override.h5"
    h5py = pytest.importorskip("h5py")
    shape = (7, 12, 20)
    with h5py.File(p, "w") as f:
        for idx, key in enumerate(("I", "Q", "U", "V")):
            ds = f.create_dataset(key, data=np.full(shape, idx + 1, dtype=np.float32))
            ds.attrs["dims"] = "t,x,y"

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    payload = inspect_res.json()
    file_info = payload["files"][0]
    raw_input_id = file_info["raw_input"]["id"]
    stokes = next(row for row in file_info["parsed"]["format_metadata"]["dataset_candidates"] if row.get("kind") == "stokes_stack")

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dataset_path": stokes["path"],
                        # Simulate stale single-path payload from older client state.
                        "dataset_paths": ["I"],
                        "dims": ["pol", "t", "x", "y"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True


def test_ingest_hdf5_stack_token_recovers_stale_dataset_paths_single_entry(client, tmp_path: Path) -> None:
    p = tmp_path / "stale_single_with_stack_token.h5"
    h5py = pytest.importorskip("h5py")
    shape = (7, 12, 20)
    keys = ["I", "Q", "U", "V"]
    with h5py.File(p, "w") as f:
        for idx, key in enumerate(keys):
            ds = f.create_dataset(key, data=np.full(shape, idx + 1, dtype=np.float32))
            ds.attrs["dims"] = "t,x,y"

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    payload = inspect_res.json()
    raw_input_id = payload["files"][0]["raw_input"]["id"]
    stack_token = f"__stokes_stack__:{json.dumps(keys, separators=(',', ':'))}"

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dataset_path": stack_token,
                        # Simulate stale payload where the list path collapsed to one entry.
                        "dataset_paths": ["I"],
                        "key_stack_axis": "pol",
                        "dims": ["pol", "t", "x", "y"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert plan["datasets"][0]["projected_shape"] == [1, 4, 7, 1, 12, 20, 1]

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    created = commit_res.json()["created_data_ids"][0]

    meta_res = client.get(f"/api/datasets/{created}/meta")
    assert meta_res.status_code == 200
    assert meta_res.json()["shape"] == [1, 4, 7, 1, 12, 20, 1]


def test_ingest_hdf5_stack_token_resolves_member_shapes_from_file_when_not_in_top_candidates(client, tmp_path: Path) -> None:
    p = tmp_path / "stack_token_member_shape_fallback.h5"
    h5py = pytest.importorskip("h5py")
    shape = (11, 22)
    with h5py.File(p, "w") as f:
        for idx in range(80):
            key = f"samples/{idx:03d}"
            ds = f.create_dataset(key, data=np.full(shape, idx + 1, dtype=np.float32))
            ds.attrs["dims"] = "nu,x"

    inspect_res = client.post("/api/ingest/inspect", data={"paths_json": json.dumps([str(p)])})
    assert inspect_res.status_code == 200
    payload = inspect_res.json()
    raw_input_id = payload["files"][0]["raw_input"]["id"]

    selected = [f"samples/{idx:03d}" for idx in range(10, 20)]
    stack_token = f"__stokes_stack__:{json.dumps(selected, separators=(',', ':'))}"

    plan_res = client.post(
        "/api/ingest/plan",
        json={
            "inspection_id": payload["inspection_id"],
            "decision": {
                "grouping_mode": "separate",
                "tab_mode": "single_tab",
                "file_mappings": [
                    {
                        "raw_input_id": raw_input_id,
                        "dataset_path": stack_token,
                        # Simulate stale list payload from an earlier client-state transition.
                        "dataset_paths": ["samples/079"],
                        "key_stack_axis": "sample",
                        "dims": ["sample", "nu", "x"],
                    }
                ],
            },
        },
    )
    assert plan_res.status_code == 200
    plan = plan_res.json()
    assert plan["is_valid"] is True
    assert plan["datasets"][0]["projected_shape"] == [10, 1, 1, 11, 22, 1, 1]

    commit_res = client.post("/api/ingest/commit", json={"plan_id": plan["plan_id"]})
    assert commit_res.status_code == 200
    created = commit_res.json()["created_data_ids"][0]

    meta_res = client.get(f"/api/datasets/{created}/meta")
    assert meta_res.status_code == 200
    assert meta_res.json()["shape"] == [10, 1, 1, 11, 22, 1, 1]
