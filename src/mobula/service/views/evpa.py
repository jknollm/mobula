from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import HTTPException

from mobula.data.schema import CubeDataset
from mobula.service.api_compute import _extract_2d_slice
from mobula.service.api_models import SampleMode
from mobula.service.api_utils import _dim_size


def build_evpa_response(
    ds: CubeDataset,
    *,
    sample: int | None,
    t: int | None,
    nu: int | None,
    z: int | None,
    sample_mode: SampleMode,
    step: int,
    min_fraction: float,
    i_min_fraction: float,
    project_dims: tuple[str, ...] = (),
) -> dict[str, Any]:
    if "pol" not in ds.dims:
        raise HTTPException(status_code=400, detail="dataset has no polarization axis")
    if _dim_size(ds, "pol") < 3:
        raise HTTPException(status_code=400, detail="dataset needs at least I,Q,U polarization channels")

    i_arr, _, _ = _extract_2d_slice(
        ds=ds,
        plane_x="x",
        plane_y="y",
        sample_mode=sample_mode,
        sample=sample,
        pol=0,
        t=t,
        nu=nu,
        x=None,
        y=None,
        z=z,
        pol_override=0,
        project_dims=project_dims,
    )
    q_arr, _, _ = _extract_2d_slice(
        ds=ds,
        plane_x="x",
        plane_y="y",
        sample_mode=sample_mode,
        sample=sample,
        pol=1,
        t=t,
        nu=nu,
        x=None,
        y=None,
        z=z,
        pol_override=1,
        project_dims=project_dims,
    )
    u_arr, _, _ = _extract_2d_slice(
        ds=ds,
        plane_x="x",
        plane_y="y",
        sample_mode=sample_mode,
        sample=sample,
        pol=2,
        t=t,
        nu=nu,
        x=None,
        y=None,
        z=z,
        pol_override=2,
        project_dims=project_dims,
    )

    p_arr = np.sqrt(q_arr * q_arr + u_arr * u_arr).astype(np.float32)
    i_abs_raw = np.abs(i_arr).astype(np.float32)
    i_abs = np.maximum(i_abs_raw, 1.0e-6).astype(np.float32)
    frac = p_arr / i_abs
    i_peak = float(np.max(i_abs_raw)) if i_abs_raw.size else 0.0
    i_threshold = max(0.0, i_min_fraction) * i_peak
    valid_for_scale = i_abs_raw >= i_threshold
    if np.any(valid_for_scale):
        frac_ref = float(np.quantile(frac[valid_for_scale], 0.95))
    else:
        frac_ref = 1.0
    frac_ref = max(frac_ref, min_fraction, 1.0e-6)

    ticks: list[dict[str, float]] = []
    offset = max(1, step // 2)
    x_max, y_max = p_arr.shape
    for ix in range(offset, x_max, step):
        for iy in range(offset, y_max, step):
            if float(i_abs_raw[ix, iy]) < i_threshold:
                continue
            frac_value = float(frac[ix, iy])
            if frac_value < min_fraction:
                continue
            psi = 0.5 * float(np.arctan2(float(u_arr[ix, iy]), float(q_arr[ix, iy])))
            amp = min(1.0, max(0.25, frac_value / frac_ref))
            length = 0.45 * step * amp
            ticks.append(
                {
                    "x": float(ix),
                    "y": float(iy),
                    "dx": float(length * np.cos(psi)),
                    "dy": float(length * np.sin(psi)),
                }
            )

    return {
        "data_id": ds.data_id,
        "sample_mode": sample_mode,
        "step": step,
        "min_fraction": min_fraction,
        "i_min_fraction": i_min_fraction,
        "tick_count": len(ticks),
        "ticks": ticks,
    }
