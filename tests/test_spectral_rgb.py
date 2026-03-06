from __future__ import annotations

import numpy as np

from mobula.service.spectral_rgb import convert_mf_to_rgb_new


def test_channel_relative_clip_keeps_zero_pixel_black_with_negative_outlier() -> None:
    cube = np.array(
        [
            [[0.0, 0.0, 0.0, 0.0, 0.0]],
            [[1.0, 1.0, 1.0, 1.0, 1.0]],
            [[-100.0, 0.0, 0.0, 0.0, 0.0]],
        ],
        dtype=np.float64,
    )
    wavelengths = np.linspace(420.0, 680.0, cube.shape[-1], dtype=np.float64)

    rgb, _ = convert_mf_to_rgb_new(
        cube,
        wavelength_axis_nm=wavelengths,
        intensity_scale="linear",
        clip_min=0.0,
        clip_max=1.0,
        channel_relative_clip=True,
    )

    # A negative outlier in another pixel/channel should not tint zero-valued pixels.
    assert float(np.max(rgb[0, 0])) <= 1.0e-12
    assert float(np.max(rgb[1, 0])) > 0.1
