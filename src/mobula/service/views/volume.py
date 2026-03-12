from __future__ import annotations

from typing import Any

import numpy as np

from mobula.data.schema import CubeDataset
from mobula.service.api_compute import _extract_3d_volume
from mobula.service.api_models import SampleMode
from mobula.service.views.serialization import (
    ScalarArrayPayload,
    serialize_axis_coords,
    serialize_scalar_payload_json,
    summarize_array,
)


def build_volume_payload(
    ds: CubeDataset,
    *,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    sample_mode: SampleMode,
    project_dims: tuple[str, ...] = (),
) -> ScalarArrayPayload:
    arr, selected_indices, selected_coords = _extract_3d_volume(
        ds=ds,
        sample_mode=sample_mode,
        sample=sample,
        pol=pol,
        t=t,
        nu=nu,
        x=x,
        y=y,
        z=z,
        project_dims=project_dims,
    )
    arr = np.asarray(arr, dtype=np.float32)

    return ScalarArrayPayload(
        metadata={
            "data_id": ds.data_id,
            "volume_dims": ["x", "y", "z"],
            "shape": [int(arr.shape[0]), int(arr.shape[1]), int(arr.shape[2])],
            "intensity_unit": ds.intensity_unit,
            "sample_mode": sample_mode,
            "selected_indices": selected_indices,
            "selected_coords": selected_coords,
            "coords": serialize_axis_coords(ds, ["x", "y", "z"]),
            "stats": summarize_array(arr),
        },
        values=arr,
    )


def build_volume_response(
    ds: CubeDataset,
    *,
    sample: int | None,
    pol: int | None,
    t: int | None,
    nu: int | None,
    x: int | None,
    y: int | None,
    z: int | None,
    sample_mode: SampleMode,
    project_dims: tuple[str, ...] = (),
) -> dict[str, Any]:
    return serialize_scalar_payload_json(
        build_volume_payload(
            ds,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
            sample_mode=sample_mode,
            project_dims=project_dims,
        )
    )
