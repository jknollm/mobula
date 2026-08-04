from __future__ import annotations

import numpy as np
import pytest
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.acceleration.multispectral_common import normalize_total_flux_brightness_xp
from mobula.service.views.multispectral import (
    _apply_spectral_artifact_control,
    _spectral_index_map,
    _spectral_index_rgb,
    build_multispectral_response,
)


def _power_law_cube(amplitudes: np.ndarray, alphas: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    nu = np.asarray([1.0, 2.0, 4.0, 8.0], dtype=np.float64)
    reference = 2.0
    cube = amplitudes[np.newaxis, :, :] * (nu[:, np.newaxis, np.newaxis] / reference) ** alphas
    return cube, nu


def test_spectral_index_map_recovers_pixel_power_law_slopes() -> None:
    expected = np.asarray([[0.0, -1.25, 3.5]], dtype=np.float64)
    cube, nu = _power_law_cube(np.ones_like(expected), expected)

    alpha, valid = _spectral_index_map(cube, nu)

    assert np.all(valid)
    np.testing.assert_allclose(alpha, expected, rtol=1.0e-12, atol=1.0e-12)


def test_spectral_index_rgb_clips_endpoints_and_uses_constant_lightness() -> None:
    alpha = np.asarray([[-5.0, 0.0, 5.0]], dtype=np.float64)
    target_luma = np.asarray([[0.2, 0.5, 0.8]], dtype=np.float64)

    red, green, blue = _spectral_index_rgb(
        alpha,
        np.ones_like(alpha, dtype=bool),
        target_luma,
        spectral_index_min=-2.0,
        spectral_index_max=2.0,
    )

    actual_luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    np.testing.assert_allclose(actual_luma, 0.4 * target_luma, atol=2.0e-7)
    assert blue[0, 0] > red[0, 0]
    assert red[0, 2] > blue[0, 2]
    endpoint_red, endpoint_green, endpoint_blue = _spectral_index_rgb(
        np.asarray([[-2.0, 2.0]]),
        np.ones((1, 2), dtype=bool),
        np.asarray([[0.2, 0.8]]),
        spectral_index_min=-2.0,
        spectral_index_max=2.0,
    )
    np.testing.assert_allclose(
        [red[0, 0], green[0, 0], blue[0, 0]],
        [endpoint_red[0, 0], endpoint_green[0, 0], endpoint_blue[0, 0]],
    )
    np.testing.assert_allclose(
        [red[0, 2], green[0, 2], blue[0, 2]],
        [endpoint_red[0, 1], endpoint_green[0, 1], endpoint_blue[0, 1]],
    )


def test_spectral_index_rgb_marks_invalid_fit_as_gray() -> None:
    red, green, blue = _spectral_index_rgb(
        np.asarray([[0.0]]),
        np.asarray([[False]]),
        np.asarray([[0.4]]),
        spectral_index_min=-2.0,
        spectral_index_max=2.0,
    )

    np.testing.assert_allclose([red[0, 0], green[0, 0], blue[0, 0]], 0.16)


def test_log_brightness_uses_robust_reference_instead_of_isolated_peak() -> None:
    field = np.linspace(1.0, 100.0, 10_000, dtype=np.float64).reshape(100, 100)
    with_peak = field.copy()
    with_peak[-1, -1] = 1.0e12

    baseline = normalize_total_flux_brightness_xp(
        field,
        intensity_mode="log",
        clip_min=0.0,
        clip_max=1.0,
        xp=np,
    )
    peaked = normalize_total_flux_brightness_xp(
        with_peak,
        intensity_mode="log",
        clip_min=0.0,
        clip_max=1.0,
        xp=np,
    )

    np.testing.assert_allclose(peaked[:-1], baseline[:-1], atol=2.0e-4)
    np.testing.assert_allclose(peaked[-1, :-1], baseline[-1, :-1], atol=2.0e-4)
    assert np.count_nonzero(peaked > 0.1) > 9_000
    assert peaked[-1, -1] == pytest.approx(1.0)


def test_direct_spectral_index_coloring_depends_only_on_alpha_and_total_flux() -> None:
    nu = np.asarray([1.0, 2.0, 4.0, 8.0], dtype=np.float64)
    alpha = np.asarray([-3.0, 3.0], dtype=np.float64)
    spectra = (nu[:, np.newaxis] / 2.0) ** alpha[np.newaxis, :]
    spectra /= np.sum(spectra, axis=0, keepdims=True)
    dataset = CubeDataset(
        data_id="spectral-index-invariance",
        dims=("nu", "x", "y"),
        coords={"nu": nu, "x": np.asarray([0.0]), "y": np.asarray([0.0, 1.0])},
        values=spectra[:, np.newaxis, :].astype(np.float32),
        units={"nu": "Hz", "x": "rad", "y": "rad"},
        intensity_unit="Jy/sr",
        wcs={},
        provenance={},
    )
    dataset.validate()

    def render(*, deslope: float, normalize_spectrum: bool, normalize_boost: float) -> np.ndarray:
        payload = build_multispectral_response(
            dataset,
            sample=None,
            pol=None,
            t=None,
            x=None,
            y=None,
            z=None,
            nu0=None,
            nu1=None,
            max_pixels=None,
            sample_mode="single",
            plane_x="x",
            plane_y="y",
            deslope=deslope,
            normalize_spectrum=normalize_spectrum,
            normalize_spectrum_boost=normalize_boost,
            compute_backend="cpu",
            artifact_mode="off",
            spectral_color_mode="spectral_index",
        )
        return np.stack([payload["values"][key] for key in ("r", "g", "b")], axis=-1)

    baseline = render(deslope=0.0, normalize_spectrum=False, normalize_boost=1.0)
    hidden_controls_changed = render(deslope=4.0, normalize_spectrum=True, normalize_boost=8.0)

    np.testing.assert_allclose(hidden_controls_changed, baseline, atol=1.0e-12)
    assert baseline[0, 2] > baseline[0, 0]
    assert baseline[1, 0] > baseline[1, 2]
    luma = baseline @ np.asarray([0.2126, 0.7152, 0.0722])
    np.testing.assert_allclose(luma[0], luma[1], atol=1.0e-6)


def test_direct_spectral_index_coloring_rejects_missing_physical_coordinates() -> None:
    dataset = CubeDataset(
        data_id="coordinate-less-spectral-index",
        dims=("nu", "x", "y"),
        coords={"nu": np.asarray([1.0, 2.0, 3.0]), "x": np.asarray([0.0]), "y": np.asarray([0.0])},
        values=np.ones((3, 1, 1), dtype=np.float32),
        units={"nu": "", "x": "rad", "y": "rad"},
        intensity_unit="Jy/sr",
        wcs={},
        provenance={},
    )
    dataset.validate()

    with pytest.raises(HTTPException, match="physical frequency coordinates"):
        build_multispectral_response(
            dataset,
            sample=None,
            pol=None,
            t=None,
            x=None,
            y=None,
            z=None,
            nu0=None,
            nu1=None,
            max_pixels=None,
            sample_mode="single",
            plane_x="x",
            plane_y="y",
            spectral_color_mode="spectral_index",
            spectral_index_available=False,
        )


def test_direct_spectral_index_invalid_fit_is_inspectable_or_hidden() -> None:
    nu = np.asarray([1.0, 2.0, 4.0, 8.0], dtype=np.float64)
    values = np.asarray(
        [
            [[1.0, 1.0]],
            [[2.0, 1.0]],
            [[4.0, 0.0]],
            [[8.0, 0.0]],
        ],
        dtype=np.float32,
    )
    dataset = CubeDataset(
        data_id="spectral-index-invalid-fit",
        dims=("nu", "x", "y"),
        coords={"nu": nu, "x": np.asarray([0.0]), "y": np.asarray([0.0, 1.0])},
        values=values,
        units={"nu": "Hz", "x": "rad", "y": "rad"},
        intensity_unit="Jy/sr",
        wcs={},
        provenance={},
    )
    dataset.validate()

    def render(artifact_mode: str, faint_behavior: str) -> dict[str, object]:
        return build_multispectral_response(
            dataset,
            sample=None,
            pol=None,
            t=None,
            x=None,
            y=None,
            z=None,
            nu0=None,
            nu1=None,
            max_pixels=None,
            sample_mode="single",
            plane_x="x",
            plane_y="y",
            artifact_mode=artifact_mode,
            artifact_confidence_floor=0.0,
            faint_behavior=faint_behavior,
            spectral_color_mode="spectral_index",
        )

    unsuppressed = render("off", "desaturate")
    hidden = render("manual", "hide")
    assert unsuppressed["values"]["spectral_index"][0] == pytest.approx(1.0)
    assert unsuppressed["values"]["spectral_index"][1] is None
    assert unsuppressed["bands"]["spectral_index_valid_fraction"] == pytest.approx(0.5)
    assert unsuppressed["values"]["r"][1] > 0.0
    assert unsuppressed["values"]["r"][1] == pytest.approx(unsuppressed["values"]["g"][1])
    assert hidden["values"]["r"][1] == pytest.approx(0.0)
    assert hidden["values"]["g"][1] == pytest.approx(0.0)
    assert hidden["values"]["b"][1] == pytest.approx(0.0)


def test_manual_artifact_control_desaturates_faint_and_extreme_index_pixels() -> None:
    alphas = np.asarray([[0.0, 0.0, 7.0]], dtype=np.float64)
    extreme_amplitude = 4.0 / np.sum(np.asarray([0.5, 1.0, 2.0, 4.0]) ** 7.0)
    amplitudes = np.asarray([[1.0, 1.0e-4, extreme_amplitude]], dtype=np.float64)
    cube, nu = _power_law_cube(amplitudes, alphas)
    red = np.ones((1, 3), dtype=np.float64)
    green = np.zeros((1, 3), dtype=np.float64)
    blue = np.zeros((1, 3), dtype=np.float64)

    out_r, out_g, out_b, diagnostics = _apply_spectral_artifact_control(
        red,
        green,
        blue,
        cube,
        nu,
        artifact_mode="manual",
        confidence_floor=0.01,
        spectral_index_min=-2.0,
        spectral_index_max=2.0,
        faint_behavior="desaturate",
    )

    assert out_r[0, 0] == 1.0
    assert out_g[0, 0] == 0.0
    assert out_b[0, 0] == 0.0
    np.testing.assert_allclose([out_r[0, 1], out_g[0, 1], out_b[0, 1]], 0.2126, atol=1.0e-12)
    np.testing.assert_allclose([out_r[0, 2], out_g[0, 2], out_b[0, 2]], 0.2126, atol=1.0e-12)
    assert diagnostics["artifact_mode"] == "manual"
    assert diagnostics["artifact_affected_fraction"] == 2.0 / 3.0


def test_manual_hide_mode_removes_unreliable_pixels_without_touching_reliable_pixel() -> None:
    alphas = np.asarray([[0.0, 0.0, 7.0]], dtype=np.float64)
    extreme_amplitude = 4.0 / np.sum(np.asarray([0.5, 1.0, 2.0, 4.0]) ** 7.0)
    amplitudes = np.asarray([[1.0, 1.0e-4, extreme_amplitude]], dtype=np.float64)
    cube, nu = _power_law_cube(amplitudes, alphas)

    out_r, out_g, out_b, diagnostics = _apply_spectral_artifact_control(
        np.ones((1, 3)),
        np.full((1, 3), 0.5),
        np.full((1, 3), 0.25),
        cube,
        nu,
        artifact_mode="manual",
        confidence_floor=0.01,
        spectral_index_min=-2.0,
        spectral_index_max=2.0,
        faint_behavior="hide",
    )

    np.testing.assert_allclose([out_r[0, 0], out_g[0, 0], out_b[0, 0]], [1.0, 0.5, 0.25])
    np.testing.assert_allclose([out_r[0, 1:], out_g[0, 1:], out_b[0, 1:]], 0.0, atol=1.0e-12)
    assert diagnostics["artifact_affected_fraction"] == 2.0 / 3.0


def test_explicit_brightness_reference_stays_fixed_across_frames() -> None:
    alphas = np.zeros((1, 2), dtype=np.float64)
    first_cube, nu = _power_law_cube(np.asarray([[1.0, 0.02]]), alphas)
    brighter_cube, _ = _power_law_cube(np.asarray([[100.0, 0.02]]), alphas)
    rgb = np.asarray([[1.0, 1.0]], dtype=np.float64)

    first_r, first_g, first_b, first_diagnostics = _apply_spectral_artifact_control(
        rgb,
        np.zeros_like(rgb),
        np.zeros_like(rgb),
        first_cube,
        nu,
        artifact_mode="manual",
        confidence_floor=0.05,
        spectral_index_min=-2.0,
        spectral_index_max=2.0,
        faint_behavior="desaturate",
        brightness_reference=4.08,
    )
    brighter_r, brighter_g, brighter_b, brighter_diagnostics = _apply_spectral_artifact_control(
        rgb,
        np.zeros_like(rgb),
        np.zeros_like(rgb),
        brighter_cube,
        nu,
        artifact_mode="manual",
        confidence_floor=0.05,
        spectral_index_min=-2.0,
        spectral_index_max=2.0,
        faint_behavior="desaturate",
        brightness_reference=4.08,
    )

    assert first_diagnostics["brightness_reference"] == 4.08
    assert brighter_diagnostics["brightness_reference"] == 4.08
    np.testing.assert_allclose(
        [brighter_r[0, 1], brighter_g[0, 1], brighter_b[0, 1]],
        [first_r[0, 1], first_g[0, 1], first_b[0, 1]],
    )


def test_unknown_spectral_coordinates_skip_index_gating() -> None:
    cube = np.ones((3, 1, 1), dtype=np.float64)

    out_r, out_g, out_b, diagnostics = _apply_spectral_artifact_control(
        np.ones((1, 1)),
        np.zeros((1, 1)),
        np.zeros((1, 1)),
        cube,
        np.asarray([1.0, 2.0, 3.0]),
        artifact_mode="robust",
        confidence_floor=0.015,
        spectral_index_min=-4.0,
        spectral_index_max=4.0,
        faint_behavior="desaturate",
        spectral_index_available=False,
    )

    np.testing.assert_allclose([out_r[0, 0], out_g[0, 0], out_b[0, 0]], [1.0, 0.0, 0.0])
    assert diagnostics["spectral_index_available"] is False
    assert diagnostics["spectral_index_valid_fraction"] == 0.0
