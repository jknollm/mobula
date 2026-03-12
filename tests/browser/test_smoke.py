from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"


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
def test_volume_rotate_reset_restores_default_orientation(page: object, app_url: str) -> None:
    _wait_ui_ready(page, app_url)
    _choose_dataset(page, "time-5d-volume-samples-hd")

    page.locator("#spatialVolumeBtn:visible").first.click()
    page.wait_for_selector("#viewRotateRebaseBtn:visible")
    assert page.locator("#viewRotateRebaseBtn:visible").first.inner_text() == "Reset"

    box = page.locator("#sliceCanvas:visible").first.bounding_box()
    assert box is not None
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.76, box["y"] + box["height"] * 0.32, steps=12)
    page.mouse.up()
    page.wait_for_function(
        "() => {"
        "  const volume = window.__mobulaDebug.getStateSnapshot().volume;"
        "  return Math.abs(volume.yaw - 0.65) > 0.01 || Math.abs(volume.pitch + 0.45) > 0.01;"
        "}"
    )

    page.locator("#viewRotateRebaseBtn:visible").first.click()
    page.wait_for_function(
        "() => {"
        "  const volume = window.__mobulaDebug.getStateSnapshot().volume;"
        "  return Math.abs(volume.yaw - 0.65) < 0.001 && Math.abs(volume.pitch + 0.45) < 0.001;"
        "}"
    )


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
