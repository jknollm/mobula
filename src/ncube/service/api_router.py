from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ncube.service.api_compute import _extract_2d_slice, _extract_3d_volume, _profile_series, _profile_series_for_region
from ncube.service.api_models import LoadLocalRequest, PlaneProfilesRequest, ProfilesRequest, RoiStatsRequest
from ncube.service.api_utils import (
    _clamp_dim_bounds,
    _clamp_roi_bounds,
    _coords_summary,
    _dim_size,
    _downsample_2d,
    _index_or_mid,
    _parse_range_mode,
    _parse_sample_mode,
    _relative_uncertainty,
    _safe_dataset,
)
from ncube.service.registry import DatasetRegistry


def _register_core_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/datasets")
    def list_datasets() -> dict[str, Any]:
        return {
            "datasets": [
                {
                    "data_id": s.data_id,
                    "dims": list(s.dims),
                    "shape": list(s.shape),
                    "intensity_unit": s.intensity_unit,
                    "source": s.source,
                }
                for s in registry.list()
            ]
        }

    @router.post("/load-local")
    def load_local(req: LoadLocalRequest) -> dict[str, Any]:
        p = Path(req.path).expanduser().resolve()
        if not p.exists():
            raise HTTPException(status_code=404, detail=f"path does not exist: {p}")
        try:
            ds = registry.load_local(str(p), data_id=req.data_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"failed to load {p.name}: {exc}") from exc
        return {
            "loaded": ds.data_id,
            "dims": list(ds.dims),
            "shape": list(ds.shape),
            "path": str(p),
        }

    @router.get("/datasets/{data_id}/meta")
    def dataset_meta(data_id: str) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        pol_labels = ds.provenance.get("pol_labels")
        if pol_labels is None and "pol" in ds.dims and _dim_size(ds, "pol") == 4:
            pol_labels = ["I", "Q", "U", "V"]
        return {
            "data_id": ds.data_id,
            "dims": list(ds.dims),
            "shape": list(ds.shape),
            "coords": _coords_summary(ds),
            "intensity_unit": ds.intensity_unit,
            "wcs": ds.wcs,
            "provenance": ds.provenance,
            "uncertainty": ds.uncertainty,
            "pol_labels": pol_labels,
        }


def _register_slice_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.get("/datasets/{data_id}/slice")
    def dataset_slice(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        max_pixels: int | None = Query(default=None, ge=1),
        sample_mode: str = Query(default="single"),
        plane_x: str = Query(default="x"),
        plane_y: str = Query(default="y"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        arr, selected_indices, selected_coords = _extract_2d_slice(
            ds=ds,
            plane_x=plane_x,
            plane_y=plane_y,
            sample_mode=mode,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
        )
        full_shape = [int(arr.shape[0]), int(arr.shape[1])]
        arr, sampling_step = _downsample_2d(arr, max_pixels)

        coords_x = np.asarray(ds.coords[plane_x], dtype=np.float64)
        coords_y = np.asarray(ds.coords[plane_y], dtype=np.float64)

        return {
            "data_id": ds.data_id,
            "plane_dims": [plane_x, plane_y],
            "shape": [int(arr.shape[0]), int(arr.shape[1])],
            "full_shape": full_shape,
            "sampling_step": [int(sampling_step[0]), int(sampling_step[1])],
            "intensity_unit": ds.intensity_unit,
            "sample_mode": mode,
            "selected_indices": selected_indices,
            "selected_coords": selected_coords,
            "coords": {
                plane_x: coords_x.tolist(),
                plane_y: coords_y.tolist(),
                f"{plane_x}_unit": ds.units[plane_x],
                f"{plane_y}_unit": ds.units[plane_y],
            },
            "stats": {
                "min": float(np.min(arr)),
                "max": float(np.max(arr)),
                "mean": float(np.mean(arr)),
                "std": float(np.std(arr)),
            },
            "values": arr.ravel().tolist(),
        }

    @router.get("/datasets/{data_id}/volume")
    def dataset_volume(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        sample_mode: str = Query(default="single"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        arr, selected_indices, selected_coords = _extract_3d_volume(
            ds=ds,
            sample_mode=mode,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
        )

        coords_x = np.asarray(ds.coords["x"], dtype=np.float64)
        coords_y = np.asarray(ds.coords["y"], dtype=np.float64)
        coords_z = np.asarray(ds.coords["z"], dtype=np.float64)
        return {
            "data_id": ds.data_id,
            "volume_dims": ["x", "y", "z"],
            "shape": [int(arr.shape[0]), int(arr.shape[1]), int(arr.shape[2])],
            "intensity_unit": ds.intensity_unit,
            "sample_mode": mode,
            "selected_indices": selected_indices,
            "selected_coords": selected_coords,
            "coords": {
                "x": coords_x.tolist(),
                "y": coords_y.tolist(),
                "z": coords_z.tolist(),
                "x_unit": ds.units["x"],
                "y_unit": ds.units["y"],
                "z_unit": ds.units["z"],
            },
            "stats": {
                "min": float(np.min(arr)),
                "max": float(np.max(arr)),
                "mean": float(np.mean(arr)),
                "std": float(np.std(arr)),
            },
            "values": arr.ravel().tolist(),
        }

    @router.get("/datasets/{data_id}/intensity-range")
    def intensity_range(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        t0: int | None = Query(default=None),
        t1: int | None = Query(default=None),
        nu0: int | None = Query(default=None),
        nu1: int | None = Query(default=None),
        sample_mode: str = Query(default="single"),
        range_mode: str = Query(default="none"),
        plane_x: str = Query(default="x"),
        plane_y: str = Query(default="y"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        rmode = _parse_range_mode(range_mode)

        spatial_dims = [d for d in ("x", "y", "z") if d in ds.dims]
        if plane_x == plane_y:
            raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
        for plane_dim in (plane_x, plane_y):
            if plane_dim not in ds.dims:
                raise HTTPException(status_code=400, detail=f"plane dim '{plane_dim}' not in dataset")

        vary_dims: set[str]
        if rmode == "none":
            vary_dims = {plane_x, plane_y}
        elif rmode == "time":
            vary_dims = {plane_x, plane_y, "t"}
        elif rmode == "spectral":
            vary_dims = {plane_x, plane_y, "nu"}
        elif rmode == "time_spectral":
            vary_dims = {plane_x, plane_y, "t", "nu"}
        elif rmode == "space":
            vary_dims = set(spatial_dims)
        else:  # full
            vary_dims = set(spatial_dims)
            for d in ("t", "nu"):
                if d in ds.dims:
                    vary_dims.add(d)

        requested = {"sample": sample, "pol": pol, "t": t, "nu": nu, "x": x, "y": y, "z": z}

        slicer: list[int | slice] = []
        arr_dims: list[str] = []
        selected_indices: dict[str, int] = {}
        windows_applied: dict[str, list[int]] = {}

        for dim in ds.dims:
            if dim == "sample" and mode in {"mean", "std", "rel_uncert"}:
                slicer.append(slice(None))
                arr_dims.append(dim)
                continue

            if dim in vary_dims:
                if dim == "t" and "t" in ds.dims and (t0 is not None or t1 is not None):
                    lo = 0 if t0 is None else t0
                    hi = _dim_size(ds, "t") if t1 is None else t1
                    lo, hi = _clamp_dim_bounds(ds, "t", lo, hi)
                    slicer.append(slice(lo, hi))
                    arr_dims.append(dim)
                    windows_applied["t"] = [lo, hi]
                    continue
                if dim == "nu" and "nu" in ds.dims and (nu0 is not None or nu1 is not None):
                    lo = 0 if nu0 is None else nu0
                    hi = _dim_size(ds, "nu") if nu1 is None else nu1
                    lo, hi = _clamp_dim_bounds(ds, "nu", lo, hi)
                    slicer.append(slice(lo, hi))
                    arr_dims.append(dim)
                    windows_applied["nu"] = [lo, hi]
                    continue
                slicer.append(slice(None))
                arr_dims.append(dim)
                continue

            idx = _index_or_mid(ds, dim, requested.get(dim))
            selected_indices[dim] = idx
            slicer.append(idx)

        arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
        if mode in {"mean", "std", "rel_uncert"} and "sample" in arr_dims:
            s_axis = arr_dims.index("sample")
            if mode == "mean":
                arr = arr.mean(axis=s_axis, dtype=np.float64)
            elif mode == "std":
                arr = arr.std(axis=s_axis, dtype=np.float64)
            else:
                mean_arr = arr.mean(axis=s_axis, dtype=np.float64)
                std_arr = arr.std(axis=s_axis, dtype=np.float64)
                arr = _relative_uncertainty(mean_arr, std_arr)

        return {
            "data_id": ds.data_id,
            "sample_mode": mode,
            "range_mode": rmode,
            "vary_dims": [d for d in ds.dims if d in vary_dims],
            "selected_indices": selected_indices,
            "windowed_dims": windows_applied,
            "min": float(np.min(arr)),
            "max": float(np.max(arr)),
            "mean": float(np.mean(arr)),
            "std": float(np.std(arr)),
        }

    @router.get("/datasets/{data_id}/evpa")
    def evpa_ticks(
        data_id: str,
        sample: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        z: int | None = Query(default=None),
        sample_mode: str = Query(default="mean"),
        step: int = Query(default=8, ge=4, le=32),
        min_fraction: float = Query(default=0.05, ge=0.0, le=1.0),
        i_min_fraction: float = Query(default=0.0, ge=0.0, le=1.0),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        if "pol" not in ds.dims:
            raise HTTPException(status_code=400, detail="dataset has no polarization axis")
        if _dim_size(ds, "pol") < 3:
            raise HTTPException(status_code=400, detail="dataset needs at least I,Q,U polarization channels")

        mode = _parse_sample_mode(sample_mode)
        i_arr, _, _ = _extract_2d_slice(
            ds=ds,
            plane_x="x",
            plane_y="y",
            sample_mode=mode,
            sample=sample,
            pol=0,
            t=t,
            nu=nu,
            x=None,
            y=None,
            z=z,
            pol_override=0,
        )
        q_arr, _, _ = _extract_2d_slice(
            ds=ds,
            plane_x="x",
            plane_y="y",
            sample_mode=mode,
            sample=sample,
            pol=1,
            t=t,
            nu=nu,
            x=None,
            y=None,
            z=z,
            pol_override=1,
        )
        u_arr, _, _ = _extract_2d_slice(
            ds=ds,
            plane_x="x",
            plane_y="y",
            sample_mode=mode,
            sample=sample,
            pol=2,
            t=t,
            nu=nu,
            x=None,
            y=None,
            z=z,
            pol_override=2,
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
                f = float(frac[ix, iy])
                if f < min_fraction:
                    continue
                psi = 0.5 * float(np.arctan2(float(u_arr[ix, iy]), float(q_arr[ix, iy])))
                amp = min(1.0, max(0.25, f / frac_ref))
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
            "sample_mode": mode,
            "step": step,
            "min_fraction": min_fraction,
            "i_min_fraction": i_min_fraction,
            "tick_count": len(ticks),
            "ticks": ticks,
        }

    @router.get("/datasets/{data_id}/multispectral")
    def multispectral_slice(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        nu0: int | None = Query(default=None),
        nu1: int | None = Query(default=None),
        max_pixels: int | None = Query(default=None, ge=1),
        sample_mode: str = Query(default="single"),
        plane_x: str = Query(default="x"),
        plane_y: str = Query(default="y"),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        if "nu" not in ds.dims:
            raise HTTPException(status_code=400, detail="dataset has no 'nu' axis")
        if plane_x == plane_y:
            raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
        if "nu" in (plane_x, plane_y):
            raise HTTPException(status_code=400, detail="multispectral view requires plane without 'nu'")
        for plane_dim in (plane_x, plane_y):
            if plane_dim not in ds.dims:
                raise HTTPException(status_code=400, detail=f"plane dim '{plane_dim}' not in dataset")

        mode = _parse_sample_mode(sample_mode)
        requested = {"sample": sample, "pol": pol, "t": t, "x": x, "y": y, "z": z}

        slicer: list[int | slice] = []
        arr_dims: list[str] = []
        selected_indices: dict[str, int] = {}
        for dim in ds.dims:
            if dim == "nu" or dim in (plane_x, plane_y):
                slicer.append(slice(None))
                arr_dims.append(dim)
                continue
            if dim == "sample" and mode in {"mean", "std", "rel_uncert"}:
                slicer.append(slice(None))
                arr_dims.append(dim)
                continue
            idx = _index_or_mid(ds, dim, requested.get(dim))
            selected_indices[dim] = idx
            slicer.append(idx)

        arr = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)
        if mode in {"mean", "std", "rel_uncert"} and "sample" in arr_dims:
            s_axis = arr_dims.index("sample")
            if mode == "mean":
                arr = arr.mean(axis=s_axis, dtype=np.float64).astype(np.float32)
            elif mode == "std":
                arr = arr.std(axis=s_axis, dtype=np.float64).astype(np.float32)
            else:
                mean_arr = arr.mean(axis=s_axis, dtype=np.float64)
                std_arr = arr.std(axis=s_axis, dtype=np.float64)
                arr = _relative_uncertainty(mean_arr, std_arr).astype(np.float32)
            arr_dims = [d for d in arr_dims if d != "sample"]

        expected = ["nu", plane_x, plane_y]
        if sorted(arr_dims) != sorted(expected):
            raise HTTPException(status_code=500, detail=f"multispectral dims mismatch: {arr_dims}")
        if arr_dims != expected:
            perm = [arr_dims.index(d) for d in expected]
            arr = np.transpose(arr, perm)
            arr_dims = expected

        full_nu = arr.shape[0]
        lo = 0 if nu0 is None else nu0
        hi = full_nu if nu1 is None else nu1
        lo, hi = _clamp_dim_bounds(ds, "nu", lo, hi)
        arr = arr[lo:hi]

        n_nu = arr.shape[0]
        if n_nu < 3:
            raise HTTPException(status_code=400, detail="need at least 3 spectral channels for multispectral RGB")

        edges = np.linspace(0, n_nu, 4, dtype=int)
        edges[1] = max(edges[1], 1)
        edges[2] = max(edges[2], edges[1] + 1)
        edges[3] = n_nu
        b = arr[edges[0] : edges[1]].mean(axis=0, dtype=np.float64)
        g = arr[edges[1] : edges[2]].mean(axis=0, dtype=np.float64)
        r = arr[edges[2] : edges[3]].mean(axis=0, dtype=np.float64)
        full_shape = [int(r.shape[0]), int(r.shape[1])]
        r, sampling_step = _downsample_2d(r, max_pixels)
        g = g[:: sampling_step[0], :: sampling_step[1]]
        b = b[:: sampling_step[0], :: sampling_step[1]]

        nu_coords = np.asarray(ds.coords["nu"], dtype=np.float64).reshape(-1)[lo:hi]
        return {
            "data_id": ds.data_id,
            "plane_dims": [plane_x, plane_y],
            "shape": [int(r.shape[0]), int(r.shape[1])],
            "full_shape": full_shape,
            "sampling_step": [int(sampling_step[0]), int(sampling_step[1])],
            "sample_mode": mode,
            "selected_indices": selected_indices,
            "bands": {
                "blue": [float(nu_coords[edges[0]]), float(nu_coords[max(edges[1] - 1, edges[0])])],
                "green": [float(nu_coords[edges[1]]), float(nu_coords[max(edges[2] - 1, edges[1])])],
                "red": [float(nu_coords[edges[2]]), float(nu_coords[max(edges[3] - 1, edges[2])])],
                "unit": ds.units.get("nu", "Hz"),
            },
            "values": {"r": r.ravel().tolist(), "g": g.ravel().tolist(), "b": b.ravel().tolist()},
        }


def _register_profile_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.post("/datasets/{data_id}/profiles")
    def profiles(data_id: str, req: ProfilesRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        for required in ("x", "y", "t", "nu"):
            if required not in ds.dims:
                raise HTTPException(status_code=400, detail=f"dataset missing '{required}' dimension")
        x0, x1, y0, y1 = _clamp_roi_bounds(ds, req.x0, req.x1, req.y0, req.y1)

        return {
            "data_id": ds.data_id,
            "selection": {"x0": x0, "x1": x1, "y0": y0, "y1": y1},
            "pixel_count": int((x1 - x0) * (y1 - y0)),
            "intensity_unit": ds.intensity_unit,
            "time_profile": _profile_series(
                ds=ds,
                vary_dim="t",
                x0=x0,
                x1=x1,
                y0=y0,
                y1=y1,
                pol=req.pol,
                t=req.t,
                nu=req.nu,
                z=req.z,
            ),
            "spectrum_profile": _profile_series(
                ds=ds,
                vary_dim="nu",
                x0=x0,
                x1=x1,
                y0=y0,
                y1=y1,
                pol=req.pol,
                t=req.t,
                nu=req.nu,
                z=req.z,
            ),
        }

    @router.post("/datasets/{data_id}/profiles-plane")
    def profiles_plane(data_id: str, req: PlaneProfilesRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        if req.plane_x == req.plane_y:
            raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
        for dim in (req.plane_x, req.plane_y, "t", "nu"):
            if dim not in ds.dims:
                raise HTTPException(status_code=400, detail=f"dataset missing '{dim}' dimension")

        u0, u1 = _clamp_dim_bounds(ds, req.plane_x, req.u0, req.u1)
        v0, v1 = _clamp_dim_bounds(ds, req.plane_y, req.v0, req.v1)
        region = {req.plane_x: (u0, u1), req.plane_y: (v0, v1)}
        fixed = {
            "sample": req.sample,
            "pol": req.pol,
            "t": req.t,
            "nu": req.nu,
            "x": req.x,
            "y": req.y,
            "z": req.z,
        }
        spatial_dims = [dim for dim in ("x", "y", "z") if dim in ds.dims and dim not in (req.plane_x, req.plane_y)]
        remaining_spatial = spatial_dims[0] if spatial_dims else None

        out: dict[str, Any] = {
            "data_id": ds.data_id,
            "plane": [req.plane_x, req.plane_y],
            "selection": {req.plane_x: [u0, u1], req.plane_y: [v0, v1]},
            "pixel_count": int((u1 - u0) * (v1 - v0)),
            "intensity_unit": ds.intensity_unit,
            "time_profile": _profile_series_for_region(ds, "t", region, fixed),
            "spectrum_profile": _profile_series_for_region(ds, "nu", region, fixed),
        }
        if remaining_spatial is not None:
            out["spatial_axis"] = remaining_spatial
            out["spatial_profile"] = _profile_series_for_region(ds, remaining_spatial, region, fixed)
        return out

    @router.post("/datasets/{data_id}/roi-stats")
    def roi_stats(data_id: str, req: RoiStatsRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        for required in ("x", "y"):
            if required not in ds.dims:
                raise HTTPException(status_code=400, detail=f"dataset missing '{required}' dimension")

        x0, x1, y0, y1 = _clamp_roi_bounds(ds, req.x0, req.x1, req.y0, req.y1)

        requested = {"pol": req.pol, "t": req.t, "nu": req.nu, "z": req.z}
        slicer: list[int | slice] = []
        kept_dims: list[str] = []
        for dim in ds.dims:
            if dim == "sample":
                slicer.append(slice(None))
                kept_dims.append(dim)
            elif dim == "x":
                slicer.append(slice(x0, x1))
                kept_dims.append(dim)
            elif dim == "y":
                slicer.append(slice(y0, y1))
                kept_dims.append(dim)
            else:
                idx = _index_or_mid(ds, dim, requested.get(dim))
                slicer.append(idx)

        roi = np.asarray(ds.values[tuple(slicer)], dtype=np.float32)

        if "sample" not in kept_dims:
            roi = roi[None, ...]
            kept_dims = ["sample"] + kept_dims

        axis_map = {dim: i for i, dim in enumerate(kept_dims)}
        roi = np.moveaxis(roi, [axis_map["sample"], axis_map["x"], axis_map["y"]], [0, 1, 2])
        per_sample_mean = roi.mean(axis=(1, 2), dtype=np.float64)

        q16, q50, q84 = np.quantile(per_sample_mean, [0.16, 0.5, 0.84]).tolist()
        return {
            "data_id": ds.data_id,
            "roi_bounds": {"x0": x0, "x1": x1, "y0": y0, "y1": y1},
            "sample_count": int(per_sample_mean.shape[0]),
            "pixel_count": int((x1 - x0) * (y1 - y0)),
            "intensity_unit": ds.intensity_unit,
            "stats": {
                "mean": float(np.mean(per_sample_mean)),
                "std": float(np.std(per_sample_mean)),
                "q16": float(q16),
                "q50": float(q50),
                "q84": float(q84),
            },
            "per_sample_means": per_sample_mean.tolist(),
        }


def build_router(registry: DatasetRegistry) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["ncube"])
    _register_core_routes(router, registry)
    _register_slice_routes(router, registry)
    _register_profile_routes(router, registry)
    return router

