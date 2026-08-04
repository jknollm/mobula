from __future__ import annotations

import numpy as np

from mobula.service.views.multispectral import _apply_spectral_artifact_control, _spectral_index_map


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
