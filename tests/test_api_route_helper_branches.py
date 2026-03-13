from __future__ import annotations

from pathlib import Path
import subprocess

import pytest
from fastapi import HTTPException

from mobula.service import api_routes_core, api_routes_views


_TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W7QkW8AAAAASUVORK5CYII="


def test_parse_project_dims_normalizes_and_deduplicates() -> None:
    assert api_routes_views._parse_project_dims(None) == ()
    assert api_routes_views._parse_project_dims(" t,NU, t ,, x , nu ") == ("t", "nu", "x")


def test_ffmpeg_executable_uses_imageio_binary_when_available(monkeypatch) -> None:
    class _FakeImageio:
        @staticmethod
        def get_ffmpeg_exe() -> str:
            return "/opt/custom/ffmpeg"

    monkeypatch.setattr(api_routes_views, "imageio_ffmpeg", _FakeImageio)
    assert api_routes_views._ffmpeg_executable() == "/opt/custom/ffmpeg"


def test_ffmpeg_executable_falls_back_to_system_binary_on_error(monkeypatch) -> None:
    class _BrokenImageio:
        @staticmethod
        def get_ffmpeg_exe() -> str:
            raise RuntimeError("broken")

    monkeypatch.setattr(api_routes_views, "imageio_ffmpeg", _BrokenImageio)
    assert api_routes_views._ffmpeg_executable() == "ffmpeg"


def test_run_ffmpeg_raises_http_exception_when_binary_is_missing(monkeypatch) -> None:
    def fake_run(*_args, **_kwargs):
        raise OSError("ffmpeg missing")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)
    with pytest.raises(HTTPException, match="ffmpeg not available or failed to execute"):
        api_routes_views._run_ffmpeg(["ffmpeg", "-version"], "ffmpeg failed")


def test_run_ffmpeg_reports_stdout_when_stderr_is_empty(monkeypatch) -> None:
    def fake_run(cmd, capture_output, text, check):
        return subprocess.CompletedProcess(cmd, 1, stdout="stdout failure", stderr="")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)
    with pytest.raises(HTTPException, match="stdout failure"):
        api_routes_views._run_ffmpeg(["ffmpeg", "-version"], "ffmpeg failed")


def test_is_loadable_local_dataset_requires_zarr_directory(tmp_path: Path) -> None:
    h5_path = tmp_path / "cube.h5"
    npz_path = tmp_path / "cube.npz"
    zarr_dir = tmp_path / "cube.zarr"
    zarr_file = tmp_path / "not_a_dir.zarr"
    txt_path = tmp_path / "cube.txt"
    h5_path.write_bytes(b"test")
    npz_path.write_bytes(b"test")
    zarr_dir.mkdir()
    zarr_file.write_bytes(b"test")
    txt_path.write_bytes(b"test")

    assert api_routes_core._is_loadable_local_dataset(h5_path) is True
    assert api_routes_core._is_loadable_local_dataset(npz_path) is True
    assert api_routes_core._is_loadable_local_dataset(zarr_dir) is True
    assert api_routes_core._is_loadable_local_dataset(zarr_file) is False
    assert api_routes_core._is_loadable_local_dataset(txt_path) is False


def test_pick_local_path_native_linux_returns_file_selection(monkeypatch, tmp_path: Path) -> None:
    picked = tmp_path / "picked.h5"
    picked.write_bytes(b"cube")
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout=f"{picked}\n", stderr="")

    monkeypatch.setattr(api_routes_core.platform, "system", lambda: "Linux")
    monkeypatch.setattr(api_routes_core.subprocess, "run", fake_run)

    assert api_routes_core._pick_local_path_native("dataset") == str(picked)
    assert len(calls) == 1
    assert calls[0][:2] == ["zenity", "--file-selection"]


def test_pick_local_path_native_linux_falls_back_to_folder(monkeypatch, tmp_path: Path) -> None:
    picked = tmp_path / "picked.zarr"
    picked.mkdir()
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        if "--directory" in cmd:
            return subprocess.CompletedProcess(cmd, 0, stdout=f"{picked}\n", stderr="")
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="")

    monkeypatch.setattr(api_routes_core.platform, "system", lambda: "Linux")
    monkeypatch.setattr(api_routes_core.subprocess, "run", fake_run)

    assert api_routes_core._pick_local_path_native("dataset") == str(picked)
    assert len(calls) == 2
    assert "--directory" in calls[1]


def test_pick_local_path_native_rejects_unsupported_platform(monkeypatch) -> None:
    monkeypatch.setattr(api_routes_core.platform, "system", lambda: "Windows")
    with pytest.raises(RuntimeError, match="not implemented"):
        api_routes_core._pick_local_path_native()


def test_save_images_rejects_empty_images_payload(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-images",
        json={"output_dir": str(tmp_path), "images": []},
    )
    assert res.status_code == 400
    assert "images payload is empty" in res.json()["detail"]


def test_save_images_rejects_non_png_payload(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-images",
        json={
            "output_dir": str(tmp_path),
            "images": [{"filename": "frame.png", "data_url": "data:image/jpeg;base64,AAECAwQ="}],
        },
    )
    assert res.status_code == 400
    assert "unsupported image data" in res.json()["detail"]


def test_save_movie_rejects_missing_base64_marker(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-movie",
        json={
            "format": "webm",
            "output_dir": str(tmp_path),
            "filename": "broken.webm",
            "data_url": "data:video/webm,AAAA",
        },
    )
    assert res.status_code == 400
    assert "unsupported movie data" in res.json()["detail"]


def test_save_movie_rejects_empty_payload(client, base_dataset, tmp_path: Path) -> None:
    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-movie",
        json={
            "format": "webm",
            "output_dir": str(tmp_path),
            "filename": "broken.webm",
            "data_url": "data:video/webm;base64,",
        },
    )
    assert res.status_code == 400
    assert "movie payload is empty" in res.json()["detail"]


def test_save_movie_mp4_passthrough_writes_original_payload(client, base_dataset, tmp_path: Path) -> None:
    payload = "bXA0LXBheWxvYWQ="
    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-movie",
        json={
            "format": "mp4",
            "output_dir": str(tmp_path),
            "filename": "clip.mp4",
            "overwrite": True,
            "data_url": f"data:video/mp4;base64,{payload}",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert Path(body["path"]).read_bytes() == b"mp4-payload"
    assert body["mime_type"] == "video/mp4"


def test_save_movie_gif_passthrough_writes_original_payload(client, base_dataset, tmp_path: Path) -> None:
    payload = "Z2lmLXBheWxvYWQ="
    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-movie",
        json={
            "format": "gif",
            "output_dir": str(tmp_path),
            "filename": "clip.gif",
            "overwrite": True,
            "data_url": f"data:image/gif;base64,{payload}",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert Path(body["path"]).read_bytes() == b"gif-payload"
    assert body["mime_type"] == "image/gif"


def test_save_render_movie_encodes_webm_frame_sequence(client, base_dataset, tmp_path: Path, monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        Path(cmd[-1]).write_bytes(b"rendered-webm")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)

    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-render-movie",
        json={
            "format": "webm",
            "quality": "low",
            "fps": 12,
            "output_dir": str(tmp_path),
            "filename": "sequence.webm",
            "overwrite": True,
            "frames": [{"data_url": f"data:image/png;base64,{_TINY_PNG}"}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["mime_type"] == "video/webm"
    assert body["quality"] == "low"
    assert Path(body["path"]).read_bytes() == b"rendered-webm"
    assert calls
    assert "libvpx-vp9" in calls[0]


def test_save_render_movie_encodes_gif_frame_sequence(client, base_dataset, tmp_path: Path, monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, capture_output, text, check):
        calls.append(cmd)
        Path(cmd[-1]).write_bytes(b"palette" if str(cmd[-1]).endswith(".png") else b"rendered-gif")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(api_routes_views.subprocess, "run", fake_run)

    res = client.post(
        f"/api/datasets/{base_dataset.data_id}/save-render-movie",
        json={
            "format": "gif",
            "quality": "high",
            "fps": 24,
            "output_dir": str(tmp_path),
            "filename": "sequence.gif",
            "overwrite": True,
            "frames": [
                {"data_url": f"data:image/png;base64,{_TINY_PNG}"},
                {"data_url": f"data:image/png;base64,{_TINY_PNG}"},
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["mime_type"] == "image/gif"
    assert Path(body["path"]).read_bytes() == b"rendered-gif"
    assert len(calls) == 2
    assert "palettegen=stats_mode=diff" in calls[0][calls[0].index("-vf") + 1]
    assert "paletteuse" in calls[1][calls[1].index("-lavfi") + 1]
