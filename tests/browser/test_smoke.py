from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest

from mobula.data.scene import SceneProfilesRequest, SceneSliceRequest
from mobula.data.scene_remote import (
    SCENE_SOURCE_PROTOCOL_VERSION,
    SCENE_SLICE_MEDIA_TYPE,
    encode_scene_profiles_payload,
    encode_scene_slice_payload,
)
from mobula.data.synthetic_scene import SyntheticHybridSceneSource

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
BROWSER_TESTS = ROOT / "tests" / "browser"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="session")
def app_url() -> Iterator[str]:
    pytest.importorskip("playwright.sync_api")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(SRC) if not env.get("PYTHONPATH") else f"{SRC}{os.pathsep}{env['PYTHONPATH']}"
    port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "mobula.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 30.0
    try:
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"uvicorn exited early with code {proc.returncode}")
            try:
                with httpx.Client(timeout=1.0) as client:
                    response = client.get(f"{url}/api/health")
                if response.status_code == 200:
                    yield url
                    return
            except httpx.HTTPError:
                time.sleep(0.2)
        raise RuntimeError("timed out waiting for local mobula server")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5.0)


@pytest.fixture(scope="session")
def base_path_app_url() -> Iterator[str]:
    pytest.importorskip("playwright.sync_api")

    env = os.environ.copy()
    python_paths = [str(SRC), str(BROWSER_TESTS)]
    if env.get("PYTHONPATH"):
        python_paths.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(python_paths)
    port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "base_path_app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    origin = f"http://127.0.0.1:{port}"
    base_url = f"{origin}/mobula/opaque-job-id"
    deadline = time.time() + 30.0
    try:
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"base-path uvicorn exited early with code {proc.returncode}")
            try:
                if httpx.get(f"{base_url}/api/health", timeout=1.0).status_code == 200:
                    yield base_url
                    return
            except httpx.HTTPError:
                time.sleep(0.2)
        raise RuntimeError("timed out waiting for base-path Mobula service")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5.0)


@pytest.fixture(scope="session")
def sparse_scene_app_url() -> Iterator[str]:
    pytest.importorskip("playwright.sync_api")
    source = SyntheticHybridSceneSource("browser-sparse")
    token = "browser-profile-secret"

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self) -> bool:
            return self.headers.get("Authorization") == f"Bearer {token}"

        def do_GET(self) -> None:  # noqa: N802
            if not self._authorized():
                self._send(401, b"unauthorized", "text/plain")
                return
            if self.path != "/descriptor":
                self._send(404, b"not found", "text/plain")
                return
            descriptor = asyncio.run(source.describe_scene())
            body = json.dumps(
                {"protocol_version": SCENE_SOURCE_PROTOCOL_VERSION, "descriptor": descriptor.to_dict()}
            ).encode("utf-8")
            self._send(200, body, "application/json")

        def do_POST(self) -> None:  # noqa: N802
            if not self._authorized():
                self._send(401, b"unauthorized", "text/plain")
                return
            length = int(self.headers.get("Content-Length", "0"))
            envelope = json.loads(self.rfile.read(length).decode("utf-8"))
            raw = envelope["request"]
            if self.path == "/slice":
                request = SceneSliceRequest(
                    **{
                        **raw,
                        "plane_axes": tuple(raw["plane_axes"]),
                        "project_dims": tuple(raw["project_dims"]),
                    }
                )
                rendered = asyncio.run(source.render_slice(request))
                self._send(200, encode_scene_slice_payload(rendered), SCENE_SLICE_MEDIA_TYPE)
                return
            if self.path == "/profiles":
                request = SceneProfilesRequest(
                    **{
                        **raw,
                        "profile_axes": tuple(raw["profile_axes"]),
                        "plane_axes": tuple(raw["plane_axes"]),
                        "spatial_window": {
                            axis: tuple(bounds) for axis, bounds in raw["spatial_window"].items()
                        },
                    }
                )
                rendered = asyncio.run(source.render_profiles(request))
                self._send(200, encode_scene_profiles_payload(rendered), "application/json")
                return
            self._send(404, b"not found", "text/plain")

        def log_message(self, format: str, *args: object) -> None:
            return

    runtime = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    runtime_thread = threading.Thread(target=runtime.serve_forever, daemon=True)
    runtime_thread.start()

    env = os.environ.copy()
    env["PYTHONPATH"] = str(SRC) if not env.get("PYTHONPATH") else f"{SRC}{os.pathsep}{env['PYTHONPATH']}"
    port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "mobula.cli",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-browser",
            "--scene-source-url",
            f"http://127.0.0.1:{runtime.server_port}",
            "--scene-source-token",
            token,
            "--initial-scene",
            source.scene_id,
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 30.0
    try:
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"sparse Scene uvicorn exited early with code {proc.returncode}")
            try:
                if httpx.get(f"{url}/api/health", timeout=1.0).status_code == 200:
                    yield f"{url}/?scene_id=browser-sparse"
                    return
            except httpx.HTTPError:
                time.sleep(0.2)
        raise RuntimeError("timed out waiting for sparse Scene Mobula service")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5.0)
        runtime.shutdown()
        runtime.server_close()
        runtime_thread.join(timeout=5.0)


@pytest.fixture()
def page(app_url: str) -> Iterator[object]:
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runner:
        try:
            browser = runner.chromium.launch(headless=True)
        except Exception as exc:  # pragma: no cover - environment dependent
            pytest.skip(f"Chromium is unavailable for Playwright smoke tests: {exc}")
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        try:
            yield page
        finally:
            browser.close()


def _wait_ui_ready(page: object, app_url: str) -> None:
    page.goto(app_url, wait_until="networkidle")
    page.wait_for_selector("#datasetSelect:visible")
    page.wait_for_function(
        "() => {"
        "  const select = document.querySelector('#datasetSelect');"
        "  return !!select && select.options.length > 1;"
        "}"
    )
    page.wait_for_function(
        "() => !!window.__mobulaDebug && typeof window.__mobulaDebug.getStateSnapshot === 'function'"
    )
    page.wait_for_timeout(1200)


def _choose_dataset(page: object, dataset_id: str) -> None:
    page.locator("#datasetSelect").first.select_option(dataset_id)
    page.wait_for_function(
        "(expected) => document.querySelector('#datasetSelect')?.value === expected",
        arg=dataset_id,
    )
    page.wait_for_timeout(1500)


def _drag_roi(page: object, rel_start: tuple[float, float], rel_end: tuple[float, float]) -> None:
    canvas = page.locator("#sliceCanvas:visible").first
    box = canvas.bounding_box()
    assert box is not None
    page.locator("#modeInspectBtn:visible").first.click()
    page.mouse.move(box["x"] + box["width"] * rel_start[0], box["y"] + box["height"] * rel_start[1])
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * rel_end[0], box["y"] + box["height"] * rel_end[1], steps=12)
    page.mouse.up()


def _debug_state(page: object) -> dict[str, object]:
    return page.evaluate("() => window.__mobulaDebug.getStateSnapshot()")


def _canvas_box(page: object, selector: str) -> dict[str, float]:
    box = page.locator(f"{selector}:visible").first.bounding_box()
    assert box is not None
    return box


def _click_canvas_relative(page: object, selector: str, x_frac: float, y_frac: float = 0.5) -> None:
    box = _canvas_box(page, selector)
    page.mouse.click(box["x"] + box["width"] * x_frac, box["y"] + box["height"] * y_frac)


def _drag_canvas_relative(page: object, selector: str, start_x: float, end_x: float, y_frac: float = 0.5) -> None:
    box = _canvas_box(page, selector)
    y = box["y"] + box["height"] * y_frac
    page.mouse.move(box["x"] + box["width"] * start_x, y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * end_x, y, steps=12)
    page.mouse.up()


def _zoom_canvas_relative(page: object, selector: str, start_x: float, end_x: float, y_frac: float = 0.5) -> None:
    page.locator("#modeZoomBtn:visible").first.click()
    _drag_canvas_relative(page, selector, start_x, end_x, y_frac)


def _canvas_foreground_bounds(page: object, selector: str) -> dict[str, int]:
    return page.locator(f"{selector}:visible").first.evaluate(
        """(canvas) => {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const { width, height } = canvas;
          const img = ctx.getImageData(0, 0, width, height);
          let minX = width;
          let maxX = -1;
          let minY = height;
          let maxY = -1;
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const idx = (y * width + x) * 4;
              const r = img.data[idx + 0];
              const g = img.data[idx + 1];
              const b = img.data[idx + 2];
              if (r <= 16 && g <= 20 && b <= 28) continue;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
          if (maxX < minX || maxY < minY) return { width: 0, height: 0 };
          return {
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          };
        }"""
    )


def _wait_for_canvas_foreground(page: object, selector: str, timeout_ms: int = 8000) -> None:
    page.wait_for_function(
        """(selector) => {
          const canvas = document.querySelector(selector);
          if (!canvas) return false;
          const style = window.getComputedStyle(canvas);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return false;
          const { width, height } = canvas;
          if (!width || !height) return false;
          const img = ctx.getImageData(0, 0, width, height);
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const idx = (y * width + x) * 4;
              const r = img.data[idx + 0];
              const g = img.data[idx + 1];
              const b = img.data[idx + 2];
              if (r > 16 || g > 20 || b > 28) return true;
            }
          }
          return false;
        }""",
        arg=selector,
        timeout=timeout_ms,
    )


@pytest.mark.browser
def test_app_loads(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    assert page.locator("#sliceCanvas:visible").first.is_visible()
    option_count = page.locator("#datasetSelect option").count()
    assert option_count > 1


@pytest.mark.browser
def test_app_loads_assets_and_binary_data_under_a_path_prefix(
    page: object,
    base_path_app_url: str,
) -> None:
    requested_urls: list[str] = []
    failed_urls: list[str] = []
    page.on("request", lambda request: requested_urls.append(request.url))
    page.on("requestfailed", lambda request: failed_urls.append(request.url))

    _wait_ui_ready(page, f"{base_path_app_url}/?scene_id=cube%3Amovie-2d-pol-hd")
    _wait_for_canvas_foreground(page, "#sliceCanvas")

    same_origin_urls = [url for url in requested_urls if url.startswith(base_path_app_url.split("/mobula/")[0])]
    assert same_origin_urls
    assert all("/mobula/opaque-job-id/" in url for url in same_origin_urls)
    assert any("/mobula/opaque-job-id/static/app.js" in url for url in requested_urls)
    assert any("/mobula/opaque-job-id/api/datasets/" in url and "/slice?" in url for url in requested_urls)
    assert failed_urls == []


@pytest.mark.browser
def test_initial_scene_query_loads_its_default_dataset(
    page: object,
    app_url: str,
) -> None:
    data_id = "movie-2d-pol-hd"
    requested_urls: list[str] = []
    page.on("request", lambda request: requested_urls.append(request.url))
    page.goto(
        f"{app_url}/?scene_id=cube%3A{data_id}",
        wait_until="networkidle",
    )
    page.wait_for_selector("#datasetSelect:visible")
    page.wait_for_function(
        "() => {"
        "  const selected = document.querySelector('#datasetSelect')?.value;"
        "  const active = window.__mobulaDebug?.getStateSnapshot().dataId;"
        "  return !!active && selected === active;"
        "}",
    )
    assert page.locator("#datasetSelect").first.input_value() == data_id
    _wait_for_canvas_foreground(page, "#sliceCanvas")
    assert any(f"/api/scenes/cube%3A{data_id}/views" in url for url in requested_urls)
    assert any(f"/api/datasets/{data_id}/slice" in url for url in requested_urls)
    assert not any("/render" in url for url in requested_urls)


@pytest.mark.browser
def test_sparse_scene_profiles_keep_roi_and_axis_navigation_in_flow(
    page: object,
    sparse_scene_app_url: str,
) -> None:
    requested_urls: list[str] = []
    page.on("request", lambda request: requested_urls.append(request.url))
    page.add_init_script(
        """(() => {
          window.__mobulaProfileLabels = [];
          const original = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
            if (String(text).startsWith('Flux [')) window.__mobulaProfileLabels.push(String(text));
            return original.call(this, text, ...args);
          };
        })()"""
    )
    page.goto(sparse_scene_app_url, wait_until="networkidle")
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug?.getStateSnapshot?.();"
        "  return !!s?.dataId && s.viewProfilesActive;"
        "}"
    )
    assert page.locator("#timeProfileBlock:visible").count() == 1
    assert page.locator("#spectrumProfileBlock:visible").count() == 1
    assert page.locator("#spatialVolumeBtn:visible").count() == 0
    assert any("/profiles-plane" in url for url in requested_urls)
    assert not any("/render" in url for url in requested_urls)

    _drag_roi(page, (0.2, 0.2), (0.7, 0.7))
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return !!s.selection && s.profilesActive;"
        "}"
    )
    page.wait_for_function("() => window.__mobulaProfileLabels.includes('Flux [Jy]')")
    selection_before = _debug_state(page)["selection"]

    _wait_for_canvas_foreground(page, "#timeNavCanvas")
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().values.t > 0")
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().profilesActive")
    assert _debug_state(page)["selection"] == selection_before


@pytest.mark.browser
def test_dataset_change_and_roi_updates_profiles(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "movie-2d-pol-hd")

    before = page.locator("#timeProfileCanvas").evaluate("(canvas) => canvas.toDataURL()")
    _drag_roi(page, (0.25, 0.28), (0.64, 0.63))
    page.wait_for_function(
        "(previous) => document.querySelector('#timeProfileCanvas')?.toDataURL() !== previous",
        arg=before,
    )

    after = page.locator("#timeProfileCanvas").evaluate("(canvas) => canvas.toDataURL()")
    assert after != before


@pytest.mark.browser
def test_dataset_change_resets_dataset_state_and_keeps_preferences(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "time-5d-volume-samples-hd")

    page.locator("#colorMapSelect").first.select_option("inferno")
    page.locator("#fluxScaleLogBtn:visible").first.click()
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().values.t > 0")
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")
    _zoom_canvas_relative(page, "#timeNavCanvas", 0.15, 0.7)
    page.wait_for_function("() => !!window.__mobulaDebug.getStateSnapshot().axisWindow.t")
    _drag_roi(page, (0.22, 0.24), (0.62, 0.58))
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.values.t > 0"
        "    && !!s.selection"
        "    && !!s.axisWindow.t"
        "    && s.profilesActive"
        "    && s.colorMap === 'inferno'"
        "    && s.fluxScale === 'log';"
        "}"
    )
    _zoom_canvas_relative(page, "#timeProfileCanvas", 0.18, 0.74)
    page.wait_for_function(
        "() => {"
        "  const keys = window.__mobulaDebug.getStateSnapshot().profileZoomKeys || [];"
        "  return keys.includes('t');"
        "}"
    )

    _choose_dataset(page, "movie-2d-pol-hd")
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.dataId === 'movie-2d-pol-hd'"
        "    && !s.selection"
        "    && s.values.sample === 0"
        "    && s.values.pol === 0"
        "    && s.values.t === 0"
        "    && s.values.nu === 0"
        "    && s.values.x === 0"
        "    && s.values.y === 0"
        "    && s.values.z === 0"
        "    && !s.axisWindow.t"
        "    && s.profileZoomKeys.length === 0"
        "    && s.colorMap === 'inferno'"
        "    && s.fluxScale === 'log';"
        "}"
    )


@pytest.mark.browser
def test_plane_change_clears_plane_state_but_preserves_axis_indices(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "time-5d-volume-samples-hd")

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().values.t > 0")
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")
    page.locator("#hiddenPlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().values.z > 0")
    page.locator("#hiddenPlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")
    _zoom_canvas_relative(page, "#timeNavCanvas", 0.12, 0.62)
    page.wait_for_function("() => !!window.__mobulaDebug.getStateSnapshot().axisWindow.t")
    _drag_roi(page, (0.28, 0.22), (0.66, 0.61))
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.values.t > 0"
        "    && s.values.z > 0"
        "    && !!s.selection"
        "    && !!s.axisWindow.t"
        "    && s.profilesActive;"
        "}"
    )
    _zoom_canvas_relative(page, "#timeProfileCanvas", 0.18, 0.7)
    page.wait_for_function(
        "() => {"
        "  const keys = window.__mobulaDebug.getStateSnapshot().profileZoomKeys || [];"
        "  return keys.includes('t');"
        "}"
    )
    before = _debug_state(page)

    page.locator("#planeSelect").first.select_option("yz")
    page.wait_for_function(
        "(expected) => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.plane === 'yz'"
        "    && !s.selection"
        "    && !s.axisWindow.t"
        "    && s.profileZoomKeys.length === 0"
        "    && s.values.t === expected.t"
        "    && s.values.z === expected.z;"
        "}",
        arg={"t": before["values"]["t"], "z": before["values"]["z"]},
    )


@pytest.mark.browser
def test_playback_stop_triggers_refine_pass(page: object, app_url: str) -> None:
    _wait_ui_ready(page, f"{app_url}?perf=1")
    _choose_dataset(page, "movie-2d-pol-hd")
    before_id = page.evaluate(
        "() => {"
        "  const updates = window.__mobulaPerf?.getSnapshot?.().visibleUpdates || [];"
        "  return updates.length ? updates[updates.length - 1].id : 0;"
        "}"
    )

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === true")
    page.wait_for_function(
        "(lastId) => {"
        "  const updates = window.__mobulaPerf?.getSnapshot?.().visibleUpdates || [];"
        "  return updates.some((entry) => entry.id > lastId && entry.label === 'playback-step');"
        "}",
        arg=before_id,
    )

    after_play_id = page.evaluate(
        "() => {"
        "  const updates = window.__mobulaPerf?.getSnapshot?.().visibleUpdates || [];"
        "  return updates.length ? updates[updates.length - 1].id : 0;"
        "}"
    )
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")
    page.wait_for_function(
        "(lastId) => {"
        "  const updates = window.__mobulaPerf?.getSnapshot?.().visibleUpdates || [];"
        "  return updates.some((entry) => entry.id > lastId && entry.label === 'slice-refresh');"
        "}",
        arg=after_play_id,
    )


def test_playback_axes_are_exclusive(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "time-5d-volume-samples-hd")

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.playback.active === true && s.playback.axis === 't' && s.values.t > 0;"
        "}"
    )

    page.locator("#hiddenPlayBtn:visible").first.click()
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.playback.active === true && s.playback.axis === 'z' && s.values.z > 0;"
        "}"
    )
    after_switch = _debug_state(page)
    page.wait_for_function(
        "(expected) => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.playback.active === true"
        "    && s.playback.axis === 'z'"
        "    && s.values.t === expected.t"
        "    && s.values.z !== expected.z;"
        "}",
        arg={"t": after_switch["values"]["t"], "z": after_switch["values"]["z"]},
    )
    page.locator("#hiddenPlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")


@pytest.mark.browser
def test_sample_morph_autoplay_pauses_for_axis_playback_and_resumes(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "time-5d-volume-samples-hd")

    page.locator("#sampleModeSamplesBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().sampleMode === 'single'")
    page.locator("#sampleViewMorphBtn:visible").first.click()
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.sampleSingleView === 'morph' && s.playback.sampleMorphActive === true;"
        "}"
    )

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.playback.active === true && s.playback.axis === 't' && s.playback.sampleMorphActive === false;"
        "}"
    )

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function(
        "() => {"
        "  const s = window.__mobulaDebug.getStateSnapshot();"
        "  return s.playback.active === false && s.playback.sampleMorphActive === true;"
        "}"
    )


@pytest.mark.browser
def test_offline_render_runs_and_restores_state(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "movie-2d-pol-hd")

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().values.t > 0")
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")
    before = _debug_state(page)
    captured: dict[str, object] = {}

    def handle_render(route: object) -> None:
        request = route.request
        captured["payload"] = json.loads(request.post_data or "{}")
        time.sleep(0.2)
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"saved": True, "path": "/tmp/rendered.mp4"}),
        )

    page.route("**/api/datasets/*/save-render-movie", handle_render)

    page.locator("#renderMovieBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().render.dialogOpen === true")
    page.locator("#renderMovieConfirmBtn:visible").first.click()

    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().render.active === true")
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().render.active === false")
    page.wait_for_function("() => document.querySelector('#renderProgressOverlay')?.hidden === true")

    after = _debug_state(page)
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["format"] == "mp4"
    assert payload["quality"] == "balanced"
    assert payload["fps"] == 30
    assert payload["output_dir"]
    assert payload["frames"]
    assert payload["frames"][0]["data_url"].startswith("data:image/png;base64,")
    assert after["values"]["t"] == before["values"]["t"]
    assert after["render"]["dialogOpen"] is False
    assert after["render"]["active"] is False
    assert after["render"]["encoding"] is False


@pytest.mark.browser
def test_volume_mode_on_compatible_dataset(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "time-5d-volume-samples-hd")

    page.locator("#spatialVolumeBtn:visible").first.click()
    page.wait_for_selector("#volumeRenderControls:visible")
    assert page.locator("#volumeRenderControls").first.is_visible()


@pytest.mark.browser
def test_volume_rotate_rebase_preserves_pose_and_updates_spin_axis(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "time-5d-volume-samples-hd")

    page.locator("#spatialVolumeBtn:visible").first.click()
    page.wait_for_selector("#viewRotateRebaseBtn:visible")
    assert page.locator("#viewRotateRebaseBtn:visible").first.inner_text() == "Rebase"

    box = page.locator("#sliceCanvas:visible").first.bounding_box()
    assert box is not None
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.76, box["y"] + box["height"] * 0.32, steps=12)
    page.mouse.up()
    page.wait_for_function(
        "() => {"
        "  const volume = window.__mobulaDebug.getStateSnapshot().volume;"
        "  return Array.isArray(volume.rotationMatrix)"
        "    && volume.rotationMatrix.length === 9"
        "    && (Math.abs(volume.rotationMatrix[0] - 0.7960837985490559) > 0.01"
        "      || Math.abs(volume.rotationMatrix[4] - 0.9004471023526769) > 0.01);"
        "}"
    )
    before = page.evaluate("() => window.__mobulaDebug.getStateSnapshot().volume")
    assert isinstance(before["rotationMatrix"], list)
    assert len(before["rotationMatrix"]) == 9

    page.locator("#viewRotateRebaseBtn:visible").first.click()
    after = page.evaluate("() => window.__mobulaDebug.getStateSnapshot().volume")
    assert isinstance(after["rotationMatrix"], list)
    assert isinstance(after["rotateAxisObject"], list)
    assert after["rotationMatrix"] == pytest.approx(before["rotationMatrix"], abs=1.0e-6)

    expected_axis = before["rotationMatrix"][3:6]
    axis_norm = sum(component * component for component in expected_axis) ** 0.5
    assert axis_norm > 0
    expected_axis = [component / axis_norm for component in expected_axis]
    assert after["rotateAxisObject"] == pytest.approx(expected_axis, abs=1.0e-6)


@pytest.mark.browser
def test_playback_defaults_and_prefetch_cache_are_exposed(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "movie-2d-pol-hd")

    assert page.locator("#playSpeedSelect").input_value() == "10"
    option_values = page.locator("#playSpeedSelect option").evaluate_all("(nodes) => nodes.map((node) => node.value)")
    assert "30" in option_values
    assert "45" in option_values

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function(
        "() => {"
        "  const playback = window.__mobulaDebug.getStateSnapshot().playback;"
        "  return playback.active === true && playback.prefetchCacheSize > 1;"
        "}"
    )
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")


@pytest.mark.browser
def test_sphere_mode_on_healpix_dataset(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "healpix-sky-time-nu-hd")

    page.wait_for_selector("#sphereControls:visible")
    assert page.locator("#sphereControls").first.is_visible()


@pytest.mark.browser
def test_sphere_playback_keeps_outside_projection_circular(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "healpix-sky-time-nu-hd")

    page.locator("#sphereProjOutsideBtn:visible").first.click()
    _wait_for_canvas_foreground(page, "#sliceCanvas")
    paused_bounds = _canvas_foreground_bounds(page, "#sliceCanvas")
    assert paused_bounds["width"] > 0
    assert paused_bounds["height"] > 0

    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === true")
    _wait_for_canvas_foreground(page, "#sliceCanvas")
    playing_bounds = _canvas_foreground_bounds(page, "#sliceCanvas")
    page.locator("#timePlayBtn:visible").first.click()
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().playback.active === false")

    paused_ratio = paused_bounds["width"] / max(1, paused_bounds["height"])
    playing_ratio = playing_bounds["width"] / max(1, playing_bounds["height"])
    assert abs(paused_ratio - 1.0) < 0.12
    assert abs(playing_ratio - 1.0) < 0.12


@pytest.mark.browser
def test_sphere_axis_settings_can_toggle_left_right_flip(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "healpix-sky-time-nu-hd")

    _wait_for_canvas_foreground(page, "#sliceCanvas")
    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().sphere.flipX === true")
    before = page.locator("#sliceCanvas").evaluate("(canvas) => canvas.toDataURL()")

    page.locator("#axisSettingsBtn:visible").first.click()
    page.locator("#axisSettingsDialog:visible").get_by_role("button", name="Flip left/right").click()

    page.wait_for_function("() => window.__mobulaDebug.getStateSnapshot().sphere.flipX === false")
    page.wait_for_function(
        "(previous) => document.querySelector('#sliceCanvas')?.toDataURL() !== previous",
        arg=before,
    )


@pytest.mark.browser
def test_resolve_tangent_plane_metadata_defaults_to_north_up(page: object, app_url: str) -> None:
    def add_resolve_orientation(route: object) -> None:
        response = route.fetch()
        payload = response.json()
        payload.setdefault("wcs", {})["axis_orientation"] = "resolve_tangent_plane_v1"
        route.fulfill(response=response, json=payload)

    page.route("**/api/datasets/*/meta", add_resolve_orientation)
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "movie-2d-pol-hd")

    page.wait_for_function(
        "() => document.querySelector('#axisSettingsBtn')?.textContent === 'Axis Settings (1)'"
    )


@pytest.mark.browser
def test_vertical_pan_tracks_pointer_with_north_up_axis(page: object, app_url: str) -> None:
    def add_resolve_orientation(route: object) -> None:
        response = route.fetch()
        payload = response.json()
        payload.setdefault("wcs", {})["axis_orientation"] = "resolve_tangent_plane_v1"
        route.fulfill(response=response, json=payload)

    page.route("**/api/datasets/*/meta", add_resolve_orientation)
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "movie-2d-pol-hd")

    canvas = page.locator("#sliceCanvas:visible").first
    box = canvas.bounding_box()
    assert box is not None
    center_x = box["x"] + box["width"] * 0.5
    center_y = box["y"] + box["height"] * 0.5
    page.mouse.move(center_x, center_y)
    page.mouse.wheel(0, -600)
    page.wait_for_function(
        "() => { const v = window.__mobulaDebug.getStateSnapshot().view; return v.h > 0 && v.h < 144; }"
    )
    view_before = _debug_state(page)["view"]

    page.mouse.move(center_x, center_y)
    page.mouse.down()
    page.mouse.move(center_x, center_y - box["height"] * 0.12, steps=12)
    page.mouse.up()
    view_after = _debug_state(page)["view"]

    assert view_after["v"] < view_before["v"]
