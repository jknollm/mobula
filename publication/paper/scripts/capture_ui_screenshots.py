#!/usr/bin/env python3
"""
Capture publication screenshots from a running mobula service.

Usage:
  source .venv/bin/activate
  python publication/paper/scripts/capture_ui_screenshots.py
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from playwright.sync_api import Page, sync_playwright


BASE_URL = "http://127.0.0.1:8000"
OUT_DIR = Path(__file__).resolve().parents[1] / "figures" / "ui"


def wait_ui_ready(page: Page) -> None:
    page.goto(BASE_URL, wait_until="networkidle")
    page.wait_for_selector("#datasetSelect:visible")
    page.wait_for_function(
        "() => {"
        " const nodes = Array.from(document.querySelectorAll('#datasetSelect'));"
        " const visible = nodes.find((n) => n.offsetParent !== null);"
        " return !!visible && visible.options.length > 1;"
        " }"
    )
    page.wait_for_timeout(1200)


def choose_dataset(page: Page, dataset_id: str) -> None:
    page.locator("#datasetSelect:visible").select_option(dataset_id)
    page.wait_for_timeout(2000)


def click_control(page: Page, selector: str, delay_ms: int = 250) -> None:
    locator = page.locator(f"{selector}:visible").first
    try:
        locator.click(force=True, timeout=2000)
    except Exception:
        page.evaluate(
            "(sel) => { const el = document.querySelector(sel); if (el) el.click(); }",
            selector,
        )
    page.wait_for_timeout(delay_ms)


def drag_roi(page: Page, rel_start: tuple[float, float], rel_end: tuple[float, float]) -> None:
    canvas = page.locator("#sliceCanvas:visible")
    box = canvas.bounding_box()
    if not box:
        return
    x0 = box["x"] + box["width"] * rel_start[0]
    y0 = box["y"] + box["height"] * rel_start[1]
    x1 = box["x"] + box["width"] * rel_end[0]
    y1 = box["y"] + box["height"] * rel_end[1]
    click_control(page, "#modeInspectBtn")
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=12)
    page.mouse.up()
    page.wait_for_timeout(800)


def snap(page: Page, filename: str, setup: Callable[[Page], None] | None = None) -> None:
    if setup:
        setup(page)
    page.wait_for_timeout(700)
    page.screenshot(path=str(OUT_DIR / filename), full_page=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1860, "height": 1150})
        wait_ui_ready(page)

        # 1) Baseline full UI in slice mode.
        snap(
            page,
            "01_ui_overview_slice.png",
            lambda pg: choose_dataset(pg, "movie-2d-pol-hd"),
        )

        # 2) Linked profiles from ROI drag.
        def roi_state(pg: Page) -> None:
            choose_dataset(pg, "movie-2d-pol-hd")
            drag_roi(pg, (0.28, 0.33), (0.63, 0.63))

        snap(page, "02_ui_roi_profiles.png", roi_state)

        # 3) Volume mode.
        def volume_state(pg: Page) -> None:
            choose_dataset(pg, "time-5d-volume-samples-hd")
            click_control(pg, "#spatialVolumeBtn")
            pg.wait_for_timeout(1400)

        snap(page, "03_ui_volume_mode.png", volume_state)

        # 4) Sphere mode with HEALPix dataset.
        def sphere_state(pg: Page) -> None:
            choose_dataset(pg, "healpix-sky-time-nu-hd")
            click_control(pg, "#spatialSphereBtn")
            pg.wait_for_timeout(1200)
            click_control(pg, "#sphereProjOutsideBtn")
            pg.wait_for_timeout(600)

        snap(page, "04_ui_sphere_mode.png", sphere_state)

        # 5) Color and time semantics.
        def color_time_state(pg: Page) -> None:
            choose_dataset(pg, "movie-2d-pol-hd")
            pg.locator("#colorMapSelect").first.select_option("diverging")
            pg.locator("#colorRangeModeSelect").first.select_option("time")
            click_control(pg, "#fluxScaleLogBtn")
            click_control(pg, "#timePlayBtn")
            pg.wait_for_timeout(1200)
            click_control(pg, "#timePlayBtn")

        snap(page, "05_ui_color_time.png", color_time_state)

        # 6) Polarization and sample modes.
        def pol_sample_state(pg: Page) -> None:
            choose_dataset(pg, "movie-2d-pol-hd")
            click_control(pg, "#polBtn1")  # Q
            click_control(pg, "#sampleModeStdBtn")
            pg.wait_for_timeout(800)
            click_control(pg, "#sampleModeSamplesBtn")
            click_control(pg, "#sampleViewMosaicBtn")
            pg.locator("#sampleGridCountSelect").first.select_option("9")
            pg.wait_for_timeout(800)

        snap(page, "06_ui_polarization_samples.png", pol_sample_state)

        browser.close()

    print(f"Saved screenshots to: {OUT_DIR}")


if __name__ == "__main__":
    main()
