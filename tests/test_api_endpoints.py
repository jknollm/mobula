from __future__ import annotations

import io
from pathlib import Path
import subprocess

import numpy as np
import pytest
from astropy.io import fits

from mobula.data.mock_cube import MockCubeConfig, generate_mock_dataset
from mobula.data.schema import CubeDataset
from mobula.service import api_routes_core, api_routes_views, view_service


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
    assert body["sphere"] is None


def test_meta_reports_healpix_summary(client_factory) -> None:
    ds = generate_mock_dataset(
        "healpix-meta",
        MockCubeConfig(sample=1, pol=1, t=2, nu=3, x=12, y=1, z=1, seed=99, model="dynamic"),
    )
    ds.wcs["healpix_ordering"] = "NESTED"
    with client_factory(ds) as client:
        res = client.get("/api/datasets/healpix-meta/meta")
        assert res.status_code == 200
        assert res.json()["sphere"] == {
            "kind": "healpix",
            "active": True,
            "npix": 12,
            "nside": 1,
            "ordering": "nested",
        }


def test_healpix_sky_model_meta_detected(client_factory) -> None:
    ds = generate_mock_dataset(
        "healpix-sky-meta",
        MockCubeConfig(sample=3, pol=1, t=6, nu=7, x=192, y=1, z=1, seed=19, model="healpix_sky"),
    )
    with client_factory(ds) as client:
        res = client.get("/api/datasets/healpix-sky-meta/meta")
        assert res.status_code == 200
        body = res.json()
        assert body["wcs"]["projection"] == "HEALPIX"
        assert body["sphere"] == {
            "kind": "healpix",
            "active": True,
            "npix": 192,
            "nside": 4,
            "ordering": "ring",
        }


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


def test_slice_projects_along_time_axis(client, base_dataset) -> None:
    params = {
        "sample": 1,
        "pol": 2,
        "nu": 3,
        "z": 1,
        "plane_x": "x",
        "plane_y": "y",
        "project_dims": "t",
    }
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params=params)
    assert res.status_code == 200
    body = res.json()
    actual = np.asarray(body["values"], dtype=np.float32).reshape(body["shape"])
    expected = np.asarray(base_dataset.values[1, 2, :, 3, :, :, 1], dtype=np.float32).mean(axis=0)
    np.testing.assert_allclose(actual, expected, rtol=1e-5, atol=1e-6)
    assert "t" not in body["selected_indices"]


def test_slice_rejects_projection_of_plane_dimension(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/slice",
        params={"plane_x": "x", "plane_y": "y", "project_dims": "x"},
    )
    assert res.status_code == 400
    assert "cannot project visible plane dim" in res.json()["detail"]


def test_slice_query_validation_for_max_pixels(client, base_dataset) -> None:
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/slice", params={"max_pixels": 0})
    assert res.status_code == 422


def test_export_cutout_returns_fits_with_metadata(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/export-cutout",
        params={
            "sample_mode": "single",
            "sample": 0,
            "pol": 0,
            "z": 0,
            "u0": 3,
            "u1": 8,
            "v0": 4,
            "v1": 10,
            "t0": 1,
            "t1": 5,
            "nu0": 2,
            "nu1": 7,
            "plane_x": "x",
            "plane_y": "y",
        },
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/fits")
    assert "attachment;" in res.headers.get("content-disposition", "")

    with fits.open(io.BytesIO(res.content), mode="readonly", memmap=False) as hdul:
        data = np.asarray(hdul[0].data)
        # sample, pol, t, nu, x, y, z in canonical numpy order.
        assert data.shape == (1, 1, 4, 4, 5, 3, 1)
        assert hdul[0].header["MBMODE"] == "single"
        assert hdul[0].header["MBPLNX"] == "x"
        assert hdul[0].header["MBPLNY"] == "y"
        ext_names = {hdu.name for hdu in hdul[1:]}
        assert {"COORD_SAMPLE", "COORD_POL", "COORD_T", "COORD_NU", "COORD_X", "COORD_Y", "COORD_Z"} <= ext_names


def test_export_cutout_rejects_invalid_zoom_bounds(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/export-cutout",
        params={"u0": 5, "u1": 5, "plane_x": "x", "plane_y": "y"},
    )
    assert res.status_code == 400
    assert "invalid bounds for dim 'x'" in res.json()["detail"]


def test_export_cutout_save_fits_to_selected_folder(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/export-cutout/save",
        json={
            "format": "fits",
            "output_dir": str(tmp_path),
            "filename": "saved_cutout.fits",
            "sample_mode": "single",
            "sample": 0,
            "pol": 0,
            "z": 0,
            "u0": 2,
            "u1": 6,
            "v0": 1,
            "v1": 5,
            "plane_x": "x",
            "plane_y": "y",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    out_path = Path(body["path"])
    assert out_path.exists()
    with fits.open(out_path, mode="readonly", memmap=False) as hdul:
        assert hdul[0].header["MBPLNX"] == "x"
        assert hdul[0].header["MBPLNY"] == "y"


def test_export_cutout_save_hdf5_to_selected_folder(client, base_dataset, tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/export-cutout/save",
        json={
            "format": "hdf5",
            "output_dir": str(tmp_path),
            "filename": "saved_cutout.h5",
            "sample_mode": "single",
            "sample": 0,
            "pol": 0,
            "z": 0,
            "u0": 2,
            "u1": 6,
            "v0": 1,
            "v1": 5,
            "plane_x": "x",
            "plane_y": "y",
        },
    )
    assert res.status_code == 200
    body = res.json()
    out_path = Path(body["path"])
    assert out_path.exists()
    with h5py.File(out_path, "r") as f:
        assert "values" in f
        assert "coords" in f
        assert f["values"].attrs["plane_x"] == "x"
        assert f["values"].attrs["plane_y"] == "y"


def test_export_cutout_save_rejects_missing_output_dir(client, base_dataset, tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist"
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/export-cutout/save",
        json={"format": "fits", "output_dir": str(missing)},
    )
    assert res.status_code == 400
    assert "output_dir is not a directory" in res.json()["detail"]


def test_save_images_writes_png_snapshots(client, base_dataset, tmp_path: Path) -> None:
    tiny_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W7QkW8AAAAASUVORK5CYII="
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-images",
        json={
            "output_dir": str(tmp_path),
            "overwrite": True,
            "images": [
                {"filename": "viewer.png", "data_url": f"data:image/png;base64,{tiny_png}"},
                {"filename": "viewer.png", "data_url": f"data:image/png;base64,{tiny_png}"},
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    assert body["count"] == 2
    paths = [Path(entry["path"]) for entry in body["files"]]
    assert paths[0].exists()
    assert paths[1].exists()
    assert paths[0].name == "viewer.png"
    assert paths[1].name == "viewer_2.png"
    for path in paths:
        payload = path.read_bytes()
        assert payload.startswith(b"\x89PNG\r\n\x1a\n")


def test_save_images_rejects_invalid_payload(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-images",
        json={
            "output_dir": str(tmp_path),
            "images": [{"filename": "broken.png", "data_url": "data:image/png;base64,not-base64"}],
        },
    )
    assert res.status_code == 400
    assert "invalid image payload" in res.json()["detail"]


def test_save_movie_writes_webm_file(client, base_dataset, tmp_path: Path) -> None:
    payload = "d2VibS10ZXN0LXBheWxvYWQ="
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-movie",
        json={
            "format": "webm",
            "output_dir": str(tmp_path),
            "filename": "session_capture.webm",
            "overwrite": True,
            "data_url": f"data:video/webm;base64,{payload}",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    out_path = Path(body["path"])
    assert out_path.exists()
    assert out_path.name == "session_capture.webm"
    assert out_path.read_bytes() == b"webm-test-payload"


def test_save_movie_rejects_invalid_payload(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-movie",
        json={
            "format": "webm",
            "output_dir": str(tmp_path),
            "filename": "broken.webm",
            "data_url": "data:video/webm;base64,not-base64",
        },
    )
    assert res.status_code == 400
    assert "invalid movie payload" in res.json()["detail"]


def test_save_movie_rejects_non_webm_payload(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-movie",
        json={
            "format": "webm",
            "output_dir": str(tmp_path),
            "filename": "movie.mp4",
            "data_url": "data:video/mp4;base64,AAECAwQ=",
        },
    )
    assert res.status_code == 400
    assert "unsupported movie format" in res.json()["detail"]


def test_save_movie_transcodes_webm_to_mp4(client, base_dataset, tmp_path: Path, monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        out_path = Path(cmd[-1])
        out_path.write_bytes(b"mp4-transcoded")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)

    payload = "d2VibS10ZXN0LXBheWxvYWQ="
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-movie",
        json={
            "format": "mp4",
            "output_dir": str(tmp_path),
            "filename": "session_capture.mp4",
            "overwrite": True,
            "data_url": f"data:video/webm;base64,{payload}",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    assert body["filename"] == "session_capture.mp4"
    assert body["mime_type"] == "video/mp4"
    assert body["format"] == "mp4"
    out_path = Path(body["path"])
    assert out_path.exists()
    assert out_path.read_bytes() == b"mp4-transcoded"
    assert calls
    assert Path(calls[0][0]).name.startswith("ffmpeg")
    assert "-vf" in calls[0]
    vf_idx = calls[0].index("-vf")
    assert calls[0][vf_idx + 1] == "pad=ceil(iw/2)*2:ceil(ih/2)*2"


def test_save_movie_mp4_transcode_failure_returns_500(client, base_dataset, tmp_path: Path, monkeypatch) -> None:
    def fake_run(cmd, capture_output, text, check):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="ffmpeg failed")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)

    payload = "d2VibS10ZXN0LXBheWxvYWQ="
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-movie",
        json={
            "format": "mp4",
            "output_dir": str(tmp_path),
            "filename": "session_capture.mp4",
            "overwrite": True,
            "data_url": f"data:video/webm;base64,{payload}",
        },
    )
    assert res.status_code == 500
    assert "ffmpeg transcode" in res.json()["detail"]


def test_save_movie_transcodes_webm_to_gif(client, base_dataset, tmp_path: Path, monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        out_path = Path(cmd[-1])
        out_path.write_bytes(b"gif-transcoded")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)

    payload = "d2VibS10ZXN0LXBheWxvYWQ="
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-movie",
        json={
            "format": "gif",
            "output_dir": str(tmp_path),
            "filename": "session_capture.gif",
            "overwrite": True,
            "data_url": f"data:video/webm;base64,{payload}",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    assert body["filename"] == "session_capture.gif"
    assert body["mime_type"] == "image/gif"
    assert body["format"] == "gif"
    out_path = Path(body["path"])
    assert out_path.exists()
    assert out_path.read_bytes() == b"gif-transcoded"
    assert calls
    assert Path(calls[0][0]).name.startswith("ffmpeg")


def test_save_movie_gif_transcode_failure_returns_500(client, base_dataset, tmp_path: Path, monkeypatch) -> None:
    def fake_run(cmd, capture_output, text, check):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="ffmpeg failed")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)

    payload = "d2VibS10ZXN0LXBheWxvYWQ="
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-movie",
        json={
            "format": "gif",
            "output_dir": str(tmp_path),
            "filename": "session_capture.gif",
            "overwrite": True,
            "data_url": f"data:video/webm;base64,{payload}",
        },
    )
    assert res.status_code == 500
    assert "ffmpeg transcode" in res.json()["detail"]


def test_save_render_movie_encodes_png_frame_sequence(client, base_dataset, tmp_path: Path, monkeypatch) -> None:
    tiny_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W7QkW8AAAAASUVORK5CYII="
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        out_path = Path(cmd[-1])
        out_path.write_bytes(b"rendered-mp4")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)

    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-render-movie",
        json={
            "format": "mp4",
            "quality": "high",
            "fps": 30,
            "output_dir": str(tmp_path),
            "filename": "axis_sweep.mp4",
            "overwrite": True,
            "frames": [
                {"data_url": f"data:image/png;base64,{tiny_png}"},
                {"data_url": f"data:image/png;base64,{tiny_png}"},
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    assert body["filename"] == "axis_sweep.mp4"
    assert body["format"] == "mp4"
    assert body["frame_count"] == 2
    assert body["fps"] == 30
    out_path = Path(body["path"])
    assert out_path.exists()
    assert out_path.read_bytes() == b"rendered-mp4"
    assert calls
    assert Path(calls[0][0]).name.startswith("ffmpeg")
    assert "-framerate" in calls[0]
    fps_idx = calls[0].index("-framerate")
    assert calls[0][fps_idx + 1] == "30"


def test_save_render_movie_rejects_invalid_frame_payload(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{_data_id(base_dataset)}/save-render-movie",
        json={
            "format": "mp4",
            "quality": "balanced",
            "fps": 30,
            "output_dir": str(tmp_path),
            "filename": "axis_sweep.mp4",
            "overwrite": True,
            "frames": [
                {"data_url": "data:image/png;base64,not-base64"},
            ],
        },
    )
    assert res.status_code == 400
    assert "invalid frame payload" in res.json()["detail"]


def test_export_cutout_save_healpix_pixel_indices_to_fits_is_temporarily_disabled(client_factory, tmp_path: Path) -> None:
    ds = generate_mock_dataset(
        "healpix-export-fits",
        MockCubeConfig(sample=2, pol=1, t=4, nu=5, x=192, y=1, z=1, seed=71, model="healpix_sky"),
    )
    with client_factory(ds) as custom_client:
        res = custom_client.post(
            "/api/datasets/healpix-export-fits/export-cutout/save",
            json={
                "format": "fits",
                "output_dir": str(tmp_path),
                "filename": "healpix_cutout.fits",
                "sample_mode": "single",
                "sample": 0,
                "pol": 0,
                "z": 0,
                "t0": 1,
                "t1": 3,
                "nu0": 1,
                "nu1": 4,
                "plane_x": "x",
                "plane_y": "y",
                "pixel_indices": [18, 5, 0, 17],
            },
        )

    assert res.status_code == 400
    assert "future feature" in res.json()["detail"].lower()


def test_export_cutout_save_healpix_pixel_indices_to_hdf5(client_factory, tmp_path: Path) -> None:
    h5py = pytest.importorskip("h5py")
    ds = generate_mock_dataset(
        "healpix-export-hdf5",
        MockCubeConfig(sample=2, pol=1, t=4, nu=5, x=192, y=1, z=1, seed=73, model="healpix_sky"),
    )
    with client_factory(ds) as custom_client:
        res = custom_client.post(
            "/api/datasets/healpix-export-hdf5/export-cutout/save",
            json={
                "format": "hdf5",
                "output_dir": str(tmp_path),
                "filename": "healpix_cutout.h5",
                "sample_mode": "single",
                "sample": 0,
                "pol": 0,
                "z": 0,
                "t0": 1,
                "t1": 3,
                "nu0": 1,
                "nu1": 4,
                "plane_x": "x",
                "plane_y": "y",
                "pixel_indices": [18, 5, 0, 17],
            },
        )

    assert res.status_code == 200
    out_path = Path(res.json()["path"])
    assert out_path.exists()
    with h5py.File(out_path, "r") as f:
        assert f["values"].attrs["x_index_scheme"] == "explicit"
        idx = np.asarray(f["coords"]["x_indices"][...], dtype=np.int64)
        np.testing.assert_array_equal(idx, np.asarray([0, 5, 17, 18], dtype=np.int64))


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


def test_volume_projects_along_time_axis(client, base_dataset) -> None:
    params = {"sample": 1, "pol": 2, "nu": 3, "project_dims": "t"}
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/volume", params=params)
    assert res.status_code == 200
    body = res.json()
    actual = np.asarray(body["values"], dtype=np.float32).reshape(body["shape"])
    expected = np.asarray(base_dataset.values[1, 2, :, 3, :, :, :], dtype=np.float32).mean(axis=0)
    np.testing.assert_allclose(actual, expected, rtol=1e-5, atol=1e-6)
    assert "t" not in body["selected_indices"]


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
    res = client.get(f"/api/datasets/{_data_id(base_dataset)}/evpa", params={"step": 0})
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
    assert body["bands"]["axis_scale"] in {"linear", "log"}
    assert body["bands"]["deslope"] == pytest.approx(0.0)
    assert body["bands"]["normalize_spectrum"] is False
    assert body["bands"]["brightness_mode"] == "total_flux"


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


def test_multispectral_accepts_log_nu_axis_and_deslope(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"nu_axis_scale": "log", "deslope": 1.5},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["bands"]["axis_scale"] in {"linear", "log"}
    assert body["bands"]["deslope"] == pytest.approx(1.5)
    assert len(body["values"]["r"]) == body["shape"][0] * body["shape"][1]


def test_multispectral_accepts_intensity_scale_and_range_window(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"intensity_scale": "log", "range_min": 5, "range_max": 90},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["bands"]["intensity_scale"] == "log"
    assert body["bands"]["range_min"] == pytest.approx(5.0)
    assert body["bands"]["range_max"] == pytest.approx(90.0)


def test_multispectral_accepts_compute_backend_cpu(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"compute_backend": "cpu"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["bands"]["compute_backend_requested"] == "cpu"
    assert body["bands"]["compute_backend"] == "cpu"


def test_multispectral_gpu_backend_unavailable_returns_400(client, base_dataset, monkeypatch) -> None:
    real_convert = view_service.convert_mf_to_rgb_new

    def fake_convert(*args, **kwargs):
        if kwargs.get("backend") == "gpu":
            raise RuntimeError("GPU unavailable")
        return real_convert(*args, **kwargs)

    monkeypatch.setattr(view_service, "convert_mf_to_rgb_new", fake_convert)

    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"compute_backend": "gpu"},
    )
    assert res.status_code == 400
    assert "gpu backend unavailable" in res.json()["detail"].lower()


def test_multispectral_accepts_normalize_spectrum(client, base_dataset) -> None:
    base = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"normalize_spectrum": False},
    )
    assert base.status_code == 200
    base_body = base.json()

    norm = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"normalize_spectrum": True},
    )
    assert norm.status_code == 200
    norm_body = norm.json()
    assert norm_body["bands"]["normalize_spectrum"] is True

    base_r = np.asarray(base_body["values"]["r"], dtype=np.float64)
    norm_r = np.asarray(norm_body["values"]["r"], dtype=np.float64)
    assert base_r.shape == norm_r.shape
    assert np.any(np.abs(base_r - norm_r) > 1.0e-6)


def test_multispectral_accepts_normalize_spectrum_boost(client, base_dataset) -> None:
    base = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"normalize_spectrum": True, "normalize_spectrum_boost": 1.0},
    )
    assert base.status_code == 200
    base_body = base.json()
    assert base_body["bands"]["normalize_spectrum"] is True
    assert base_body["bands"]["normalize_spectrum_boost"] == pytest.approx(1.0)

    boosted = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"normalize_spectrum": True, "normalize_spectrum_boost": 2.0},
    )
    assert boosted.status_code == 200
    boosted_body = boosted.json()
    assert boosted_body["bands"]["normalize_spectrum"] is True
    assert boosted_body["bands"]["normalize_spectrum_boost"] == pytest.approx(2.0)

    base_r = np.asarray(base_body["values"]["r"], dtype=np.float64)
    boost_r = np.asarray(boosted_body["values"]["r"], dtype=np.float64)
    assert base_r.shape == boost_r.shape
    assert np.any(np.abs(base_r - boost_r) > 1.0e-6)


def test_multispectral_boost_with_clipping_is_finite(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={
            "normalize_spectrum": True,
            "normalize_spectrum_boost": 2.0,
            "intensity_scale": "log",
            "range_min": 5.0,
            "range_max": 95.0,
        },
    )
    assert res.status_code == 200
    body = res.json()
    r = np.asarray(body["values"]["r"], dtype=np.float64)
    g = np.asarray(body["values"]["g"], dtype=np.float64)
    b = np.asarray(body["values"]["b"], dtype=np.float64)
    assert np.all(np.isfinite(r))
    assert np.all(np.isfinite(g))
    assert np.all(np.isfinite(b))
    assert np.all((r >= 0.0) & (r <= 1.0))
    assert np.all((g >= 0.0) & (g <= 1.0))
    assert np.all((b >= 0.0) & (b <= 1.0))
    rgb = np.stack([r, g, b], axis=1)
    assert np.any(np.max(rgb, axis=1) > 1.0e-3)


def test_multispectral_rejects_invalid_nu_axis_scale(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"nu_axis_scale": "weird"},
    )
    assert res.status_code == 400
    assert "nu_axis_scale" in res.json()["detail"]


def test_multispectral_rejects_invalid_intensity_scale(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"intensity_scale": "weird"},
    )
    assert res.status_code == 400
    assert "intensity_scale" in res.json()["detail"]


def test_multispectral_rejects_invalid_compute_backend(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"compute_backend": "weird"},
    )
    assert res.status_code == 400
    assert "compute_backend" in res.json()["detail"]


def test_multispectral_rejects_too_narrow_nu_window(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"nu0": 0, "nu1": 2},
    )
    assert res.status_code == 400
    assert "at least 3 spectral channels" in res.json()["detail"]


def test_multispectral_rejects_invalid_range_window(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"range_min": 80, "range_max": 20},
    )
    assert res.status_code == 400
    assert "range_max" in res.json()["detail"]


def test_multispectral_rejects_plane_with_nu_axis(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"plane_x": "nu", "plane_y": "x"},
    )
    assert res.status_code == 400
    assert "requires plane without 'nu'" in res.json()["detail"]


def test_multispectral_rejects_projecting_nu(client, base_dataset) -> None:
    res = client.get(
        f"/api/datasets/{_data_id(base_dataset)}/multispectral",
        params={"project_dims": "nu"},
    )
    assert res.status_code == 400
    assert "cannot project multispectral dim" in res.json()["detail"]


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
