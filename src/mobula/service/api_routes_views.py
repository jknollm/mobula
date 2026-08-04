from __future__ import annotations

import base64
import binascii
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query, Response

from mobula.data.scene import SceneRenderRequest, SceneSliceRequest, SceneValidationError
from mobula.data.scene_remote import RemoteSceneSourceError
from mobula.service.api_models import (
    ExportCutoutSaveRequest,
    SaveImagesRequest,
    SaveMovieRequest,
    SaveRenderedMovieRequest,
)
from mobula.service.api_utils import _parse_range_mode, _parse_sample_mode, _safe_dataset, _safe_dataset_with_perf
from mobula.service.perf import timed_encoded_response, timed_json_response
from mobula.service.registry import DatasetRegistry
from mobula.service.view_service import (
    build_evpa_response,
    build_export_cutout_fits,
    build_export_cutout_hdf5,
    build_intensity_range_response,
    build_multispectral_response,
    build_multispectral_response_from_scene_slices,
    build_scene_slice_payload,
    build_slice_payload,
    build_volume_payload,
)
from mobula.service.views.serialization import (
    RgbArrayPayload,
    encode_rgb_payload_binary,
    encode_scalar_payload_binary,
    serialize_scalar_payload_json,
)

try:
    import imageio_ffmpeg
except ImportError:  # pragma: no cover - optional runtime dependency
    imageio_ffmpeg = None


_RENDER_MP4_CRF = {
    "low": "30",
    "balanced": "23",
    "high": "17",
}
_RENDER_WEBM_CRF = {
    "low": "41",
    "balanced": "33",
    "high": "25",
}


def _ffmpeg_executable() -> str:
    if imageio_ffmpeg is not None:
        try:
            exe = imageio_ffmpeg.get_ffmpeg_exe()
            if exe:
                return str(exe)
        except Exception:
            pass
    return "ffmpeg"


def _run_ffmpeg(cmd: list[str], error_prefix: str) -> None:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg not available or failed to execute: {exc}",
        ) from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip() or "unknown ffmpeg error"
        raise HTTPException(status_code=500, detail=f"{error_prefix}: {detail}")


def _parse_project_dims(project_dims: str | None) -> tuple[str, ...]:
    if project_dims is None:
        return ()
    out: list[str] = []
    for part in project_dims.split(","):
        dim = part.strip().lower()
        if not dim:
            continue
        if dim not in out:
            out.append(dim)
    return tuple(out)


def _parse_response_format(response_format: str) -> str:
    fmt = str(response_format or "json").strip().lower()
    if fmt not in {"json", "binary"}:
        raise HTTPException(status_code=400, detail="response_format must be 'json' or 'binary'")
    return fmt


def _encode_scalar_payload_json_bytes(payload: Any) -> bytes:
    return json.dumps(serialize_scalar_payload_json(payload), separators=(",", ":"), allow_nan=False).encode("utf-8")


def _register_slice_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.get("/datasets/{data_id}/slice")
    async def dataset_slice(
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
        project_dims: str | None = Query(default=None),
        response_format: str = Query(default="json"),
    ) -> Response:
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
        fmt = _parse_response_format(response_format)

        scene_view = registry.scene_view(data_id)
        if scene_view is not None and scene_view.descriptor.access.mode == "slice":
            selections = {
                axis: index
                for axis, index in {
                    "sample": sample,
                    "pol": pol,
                    "t": t,
                    "nu": nu,
                    "x": x,
                    "y": y,
                    "z": z,
                }.items()
                if index is not None
            }
            try:
                rendered = await registry.render_scene_slice(
                    data_id,
                    SceneSliceRequest(
                        recipe_id=scene_view.recipe_id,
                        target=scene_view.target_kind,
                        component_id=scene_view.target_id if scene_view.target_kind == "component" else None,
                        plane_axes=(plane_x, plane_y),
                        selections=selections,
                        project_dims=project,
                        sample_mode=mode,
                        max_pixels=max_pixels,
                    ),
                )
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except RemoteSceneSourceError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            except (SceneValidationError, TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            payload = build_scene_slice_payload(
                rendered,
                scene_view.descriptor,
                data_id=data_id,
                sample_mode=mode,
            )
            if fmt == "binary":
                return timed_encoded_response(
                    lambda: payload,
                    encode_scalar_payload_binary,
                    media_type="application/vnd.mobula.scalar-array",
                    dataset_metrics={"cache": "remote-slice", "load_ms": 0.0},
                )
            return timed_encoded_response(
                lambda: payload,
                _encode_scalar_payload_json_bytes,
                media_type="application/json",
                dataset_metrics={"cache": "remote-slice", "load_ms": 0.0},
            )

        if scene_view is not None:
            # Explicit compatibility path for legacy snapshot/cube Scene sources.
            rendered_layer = await registry.render_scene(
                scene_view.scene_id,
                SceneRenderRequest(
                    recipe_id=scene_view.recipe_id,
                    target=scene_view.target_kind,
                    component_id=scene_view.target_id if scene_view.target_kind == "component" else None,
                    exploration_indices={
                        axis: index
                        for axis, index in {
                            "sample": sample,
                            "pol": pol,
                            "t": t,
                            "nu": nu,
                            "x": x,
                            "y": y,
                            "z": z,
                        }.items()
                        if index is not None
                    },
                    sample_mode=mode,
                ),
            )
            ds = rendered_layer.dataset
            dataset_metrics = {"cache": "legacy-scene-layer", "load_ms": 0.0}
        else:
            ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)

        def build_payload() -> Any:
            return build_slice_payload(
                ds,
                sample=sample,
                pol=pol,
                t=t,
                nu=nu,
                x=x,
                y=y,
                z=z,
                max_pixels=max_pixels,
                sample_mode=mode,
                plane_x=plane_x,
                plane_y=plane_y,
                project_dims=project,
            )

        if fmt == "binary":
            return timed_encoded_response(
                build_payload,
                encode_scalar_payload_binary,
                media_type="application/vnd.mobula.scalar-array",
                dataset_metrics=dataset_metrics,
            )
        return timed_encoded_response(
            build_payload,
            _encode_scalar_payload_json_bytes,
            media_type="application/json",
            dataset_metrics=dataset_metrics,
        )

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
        project_dims: str | None = Query(default=None),
        response_format: str = Query(default="json"),
    ) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
        fmt = _parse_response_format(response_format)

        def build_payload() -> Any:
            return build_volume_payload(
                ds,
                sample=sample,
                pol=pol,
                t=t,
                nu=nu,
                x=x,
                y=y,
                z=z,
                sample_mode=mode,
                project_dims=project,
            )

        if fmt == "binary":
            return timed_encoded_response(
                build_payload,
                encode_scalar_payload_binary,
                media_type="application/vnd.mobula.scalar-array",
                dataset_metrics=dataset_metrics,
            )
        return timed_encoded_response(
            build_payload,
            _encode_scalar_payload_json_bytes,
            media_type="application/json",
            dataset_metrics=dataset_metrics,
        )

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
        project_dims: str | None = Query(default=None),
    ) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        rmode = _parse_range_mode(range_mode)
        project = _parse_project_dims(project_dims)
        return timed_json_response(
            lambda: build_intensity_range_response(
                ds,
                sample=sample,
                pol=pol,
                t=t,
                nu=nu,
                x=x,
                y=y,
                z=z,
                t0=t0,
                t1=t1,
                nu0=nu0,
                nu1=nu1,
                sample_mode=mode,
                range_mode=rmode,
                plane_x=plane_x,
                plane_y=plane_y,
                project_dims=project,
            ),
            dataset_metrics=dataset_metrics,
        )

    @router.get("/datasets/{data_id}/evpa")
    def evpa_ticks(
        data_id: str,
        sample: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        z: int | None = Query(default=None),
        sample_mode: str = Query(default="mean"),
        step: int = Query(default=8, ge=1, le=32),
        min_fraction: float = Query(default=0.05, ge=0.0, le=1.0),
        i_min_fraction: float = Query(default=0.0, ge=0.0, le=1.0),
        project_dims: str | None = Query(default=None),
    ) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
        return timed_json_response(
            lambda: build_evpa_response(
                ds,
                sample=sample,
                t=t,
                nu=nu,
                z=z,
                sample_mode=mode,
                step=step,
                min_fraction=min_fraction,
                i_min_fraction=i_min_fraction,
                project_dims=project,
            ),
            dataset_metrics=dataset_metrics,
        )

    @router.get("/datasets/{data_id}/multispectral")
    async def multispectral_slice(
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
        nu_axis_scale: str = Query(default="linear"),
        deslope: float = Query(default=0.0, ge=-8.0, le=8.0),
        normalize_spectrum: bool = Query(default=False),
        normalize_spectrum_boost: float = Query(default=1.0, ge=0.25, le=8.0),
        intensity_scale: str = Query(default="linear"),
        range_min: float = Query(default=0.0, ge=0.0, le=100.0),
        range_max: float = Query(default=100.0, ge=0.0, le=100.0),
        compute_backend: str = Query(default="auto"),
        artifact_mode: str = Query(default="robust"),
        artifact_confidence_floor: float = Query(default=0.015, ge=0.0, le=1.0),
        spectral_index_min: float = Query(default=-4.0, ge=-8.0, le=8.0),
        spectral_index_max: float = Query(default=4.0, ge=-8.0, le=8.0),
        faint_behavior: str = Query(default="desaturate"),
        artifact_brightness_reference: float | None = Query(default=None, gt=0.0),
        spectral_color_mode: str = Query(default="spectrum"),
        project_dims: str | None = Query(default=None),
        response_format: str = Query(default="json"),
    ) -> Response:
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
        fmt = _parse_response_format(response_format)

        scene_view = registry.scene_view(data_id)
        if scene_view is not None and scene_view.descriptor.access.mode == "slice":
            recipe_axes = set(scene_view.recipe.presentation_axes)
            if "nu" not in recipe_axes:
                raise HTTPException(status_code=400, detail="dataset has no 'nu' axis")
            if plane_x == plane_y:
                raise HTTPException(status_code=400, detail="plane_x and plane_y must be different")
            if "nu" in (plane_x, plane_y):
                raise HTTPException(status_code=400, detail="multispectral view requires plane without 'nu'")
            if {plane_x, plane_y} - recipe_axes:
                raise HTTPException(status_code=400, detail="multispectral plane is not part of the Scene presentation")
            if project:
                raise HTTPException(
                    status_code=400,
                    detail="sparse Scene source does not advertise bounded axis projection",
                )

            axes = {axis.axis_id: axis for axis in scene_view.descriptor.axes}
            nu_axis = axes["nu"]
            lo = max(0, min(0 if nu0 is None else nu0, nu_axis.size))
            hi = max(0, min(nu_axis.size if nu1 is None else nu1, nu_axis.size))
            if hi <= lo:
                raise HTTPException(status_code=400, detail="invalid bounds for dim 'nu'")
            if hi - lo < 3:
                raise HTTPException(status_code=400, detail="need at least 3 spectral channels for multispectral RGB")

            selections = {
                axis: index
                for axis, index in {
                    "sample": sample,
                    "pol": pol,
                    "t": t,
                    "x": x,
                    "y": y,
                    "z": z,
                }.items()
                if index is not None
            }
            rendered_slices = []
            try:
                for nu_index in range(lo, hi):
                    rendered_slices.append(
                        await registry.render_scene_slice(
                            data_id,
                            SceneSliceRequest(
                                recipe_id=scene_view.recipe_id,
                                target=scene_view.target_kind,
                                component_id=(
                                    scene_view.target_id if scene_view.target_kind == "component" else None
                                ),
                                plane_axes=(plane_x, plane_y),
                                selections={**selections, "nu": nu_index},
                                sample_mode=mode,
                                max_pixels=max_pixels,
                            ),
                        )
                    )
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except RemoteSceneSourceError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            except (SceneValidationError, TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

            def axis_coordinate(index: int) -> float:
                if nu_axis.coordinates is not None:
                    value = nu_axis.coordinates[index]
                    if not isinstance(value, (int, float)):
                        raise HTTPException(status_code=400, detail="multispectral frequency coordinates must be numeric")
                    return float(value)
                if nu_axis.linear_coordinates is not None:
                    linear = nu_axis.linear_coordinates
                    return float(linear.start + linear.step * index)
                return float(index + 1)

            spectral_index_available = (
                nu_axis.coordinates is not None or nu_axis.linear_coordinates is not None
            )

            payload = build_multispectral_response_from_scene_slices(
                data_id,
                rendered_slices,
                nu_coords=np.asarray([axis_coordinate(index) for index in range(lo, hi)], dtype=np.float64),
                nu_unit=nu_axis.unit,
                sample_mode=mode,
                nu_axis_scale=nu_axis_scale,
                deslope=deslope,
                normalize_spectrum=normalize_spectrum,
                normalize_spectrum_boost=normalize_spectrum_boost,
                intensity_scale=intensity_scale,
                range_min=range_min,
                range_max=range_max,
                compute_backend=compute_backend,
                artifact_mode=artifact_mode,
                artifact_confidence_floor=artifact_confidence_floor,
                spectral_index_min=spectral_index_min,
                spectral_index_max=spectral_index_max,
                faint_behavior=faint_behavior,
                artifact_brightness_reference=artifact_brightness_reference,
                spectral_index_available=spectral_index_available,
                spectral_color_mode=spectral_color_mode,
            )
            dataset_metrics = {"cache": "remote-spectral-slices", "load_ms": 0.0}
            if fmt == "binary":
                values = payload.get("values", {})
                rgb_payload = RgbArrayPayload(
                    metadata={key: value for key, value in payload.items() if key != "values"},
                    red=values.get("r", ()),
                    green=values.get("g", ()),
                    blue=values.get("b", ()),
                    spectral_index=values.get("spectral_index"),
                )
                return timed_encoded_response(
                    lambda: rgb_payload,
                    encode_rgb_payload_binary,
                    media_type="application/vnd.mobula.rgb-array",
                    dataset_metrics=dataset_metrics,
                )
            return timed_json_response(lambda: payload, dataset_metrics=dataset_metrics)

        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)

        def build_multispectral_json() -> dict[str, Any]:
            return build_multispectral_response(
                ds,
                sample=sample,
                pol=pol,
                t=t,
                x=x,
                y=y,
                z=z,
                nu0=nu0,
                nu1=nu1,
                max_pixels=max_pixels,
                sample_mode=mode,
                plane_x=plane_x,
                plane_y=plane_y,
                nu_axis_scale=nu_axis_scale,
                deslope=deslope,
                normalize_spectrum=normalize_spectrum,
                normalize_spectrum_boost=normalize_spectrum_boost,
                intensity_scale=intensity_scale,
                range_min=range_min,
                range_max=range_max,
                compute_backend=compute_backend,
                artifact_mode=artifact_mode,
                artifact_confidence_floor=artifact_confidence_floor,
                spectral_index_min=spectral_index_min,
                spectral_index_max=spectral_index_max,
                faint_behavior=faint_behavior,
                artifact_brightness_reference=artifact_brightness_reference,
                spectral_color_mode=spectral_color_mode,
                project_dims=project,
            )

        def build_multispectral_binary() -> RgbArrayPayload:
            payload = build_multispectral_json()
            values = payload.get("values", {})
            return RgbArrayPayload(
                metadata={key: value for key, value in payload.items() if key != "values"},
                red=values.get("r", ()),
                green=values.get("g", ()),
                blue=values.get("b", ()),
                spectral_index=values.get("spectral_index"),
            )

        if fmt == "binary":
            return timed_encoded_response(
                build_multispectral_binary,
                encode_rgb_payload_binary,
                media_type="application/vnd.mobula.rgb-array",
                dataset_metrics=dataset_metrics,
            )
        return timed_json_response(
            build_multispectral_json,
            dataset_metrics=dataset_metrics,
        )

    @router.get("/datasets/{data_id}/export-cutout")
    def export_cutout(
        data_id: str,
        sample: int | None = Query(default=None),
        pol: int | None = Query(default=None),
        t: int | None = Query(default=None),
        nu: int | None = Query(default=None),
        x: int | None = Query(default=None),
        y: int | None = Query(default=None),
        z: int | None = Query(default=None),
        sample_mode: str = Query(default="single"),
        plane_x: str = Query(default="x"),
        plane_y: str = Query(default="y"),
        u0: int | None = Query(default=None),
        u1: int | None = Query(default=None),
        v0: int | None = Query(default=None),
        v1: int | None = Query(default=None),
        t0: int | None = Query(default=None),
        t1: int | None = Query(default=None),
        nu0: int | None = Query(default=None),
        nu1: int | None = Query(default=None),
    ) -> Response:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        payload, filename = build_export_cutout_fits(
            ds,
            sample=sample,
            pol=pol,
            t=t,
            nu=nu,
            x=x,
            y=y,
            z=z,
            sample_mode=mode,
            plane_x=plane_x,
            plane_y=plane_y,
            u0=u0,
            u1=u1,
            v0=v0,
            v1=v1,
            t0=t0,
            t1=t1,
            nu0=nu0,
            nu1=nu1,
        )
        return Response(
            content=payload,
            media_type="application/fits",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @router.post("/datasets/{data_id}/export-cutout/save")
    def export_cutout_save(data_id: str, req: ExportCutoutSaveRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(req.sample_mode)
        if req.format == "fits" and req.pixel_indices is not None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "FITS export for sphere/HEALPix cutouts is temporarily disabled "
                    "and planned as a future feature; use format='hdf5'."
                ),
            )
        out_dir = Path(req.output_dir).expanduser().resolve()
        if not out_dir.exists() or not out_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"output_dir is not a directory: {out_dir}")

        if req.format == "hdf5":
            payload, default_name = build_export_cutout_hdf5(
                ds,
                sample=req.sample,
                pol=req.pol,
                t=req.t,
                nu=req.nu,
                x=req.x,
                y=req.y,
                z=req.z,
                sample_mode=mode,
                plane_x=req.plane_x,
                plane_y=req.plane_y,
                u0=req.u0,
                u1=req.u1,
                v0=req.v0,
                v1=req.v1,
                t0=req.t0,
                t1=req.t1,
                nu0=req.nu0,
                nu1=req.nu1,
                pixel_indices=req.pixel_indices,
            )
            default_ext = ".h5"
        else:
            payload, default_name = build_export_cutout_fits(
                ds,
                sample=req.sample,
                pol=req.pol,
                t=req.t,
                nu=req.nu,
                x=req.x,
                y=req.y,
                z=req.z,
                sample_mode=mode,
                plane_x=req.plane_x,
                plane_y=req.plane_y,
                u0=req.u0,
                u1=req.u1,
                v0=req.v0,
                v1=req.v1,
                t0=req.t0,
                t1=req.t1,
                nu0=req.nu0,
                nu1=req.nu1,
                pixel_indices=req.pixel_indices,
            )
            default_ext = ".fits"

        base_name = (req.filename or default_name).strip()
        if not base_name:
            base_name = default_name
        base_name = Path(base_name).name
        if not base_name:
            raise HTTPException(status_code=400, detail="filename is empty")
        if not Path(base_name).suffix:
            base_name = f"{base_name}{default_ext}"

        out_path = (out_dir / base_name).resolve()
        if out_path.exists() and not req.overwrite:
            raise HTTPException(status_code=409, detail=f"file already exists: {out_path}")
        try:
            out_path.write_bytes(payload)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"failed to write export: {exc}") from exc
        return {
            "saved": True,
            "path": str(out_path),
            "size_bytes": len(payload),
            "format": req.format,
        }

    @router.post("/datasets/{data_id}/save-images")
    def save_images(data_id: str, req: SaveImagesRequest) -> dict[str, Any]:
        _safe_dataset(registry, data_id)
        out_dir = Path(req.output_dir).expanduser().resolve()
        if not out_dir.exists() or not out_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"output_dir is not a directory: {out_dir}")
        if not req.images:
            raise HTTPException(status_code=400, detail="images payload is empty")

        saved_files: list[dict[str, Any]] = []
        used_names: set[str] = set()

        for idx, item in enumerate(req.images):
            raw_name = Path(item.filename or "").name.strip()
            if not raw_name:
                raw_name = f"snapshot_{idx + 1}.png"
            stem = Path(raw_name).stem.strip() or f"snapshot_{idx + 1}"
            file_name = f"{stem}.png"
            suffix = 2
            while file_name in used_names:
                file_name = f"{stem}_{suffix}.png"
                suffix += 1
            used_names.add(file_name)

            prefix = "data:image/png;base64,"
            if not item.data_url.startswith(prefix):
                raise HTTPException(status_code=400, detail=f"unsupported image data for '{file_name}'")
            b64_data = item.data_url[len(prefix) :]
            try:
                payload = base64.b64decode(b64_data, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise HTTPException(status_code=400, detail=f"invalid image payload for '{file_name}'") from exc

            out_path = (out_dir / file_name).resolve()
            if out_path.exists() and not req.overwrite:
                raise HTTPException(status_code=409, detail=f"file already exists: {out_path}")
            try:
                out_path.write_bytes(payload)
            except OSError as exc:
                raise HTTPException(status_code=500, detail=f"failed to write image '{file_name}': {exc}") from exc

            saved_files.append(
                {
                    "filename": file_name,
                    "path": str(out_path),
                    "size_bytes": len(payload),
                }
            )

        return {"saved": True, "count": len(saved_files), "files": saved_files}

    @router.post("/datasets/{data_id}/save-movie")
    def save_movie(data_id: str, req: SaveMovieRequest) -> dict[str, Any]:
        def transcode_video(payload: bytes, input_ext: str, out_format: str) -> bytes:
            try:
                with tempfile.TemporaryDirectory(prefix="mobula_movie_") as tmpdir:
                    in_path = Path(tmpdir) / f"recording{input_ext}"
                    out_path = Path(tmpdir) / f"recording.{out_format}"
                    in_path.write_bytes(payload)
                    if out_format == "mp4":
                        cmd = [
                            _ffmpeg_executable(),
                            "-y",
                            "-hide_banner",
                            "-loglevel",
                            "error",
                            "-i",
                            str(in_path),
                            "-an",
                            "-vf",
                            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                            "-c:v",
                            "libx264",
                            "-pix_fmt",
                            "yuv420p",
                            "-movflags",
                            "+faststart",
                            str(out_path),
                        ]
                    elif out_format == "gif":
                        cmd = [
                            _ffmpeg_executable(),
                            "-y",
                            "-hide_banner",
                            "-loglevel",
                            "error",
                            "-i",
                            str(in_path),
                            "-vf",
                            "fps=12,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse",
                            str(out_path),
                        ]
                    else:
                        raise HTTPException(status_code=400, detail=f"unsupported movie output format: {out_format}")
                    _run_ffmpeg(cmd, f"ffmpeg transcode to {out_format} failed")
                    if not out_path.exists():
                        raise HTTPException(
                            status_code=500,
                            detail=f"ffmpeg transcode to {out_format} failed: output not produced",
                        )
                    return out_path.read_bytes()
            except HTTPException:
                raise

        _safe_dataset(registry, data_id)
        out_dir = Path(req.output_dir).expanduser().resolve()
        if not out_dir.exists() or not out_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"output_dir is not a directory: {out_dir}")

        data_url = str(req.data_url or "")
        if not data_url.startswith("data:"):
            raise HTTPException(status_code=400, detail="unsupported movie data")
        marker = ";base64,"
        if marker not in data_url:
            raise HTTPException(status_code=400, detail="unsupported movie data")
        marker_idx = data_url.find(marker)
        mime = data_url[len("data:") : marker_idx]

        b64_data = data_url[marker_idx + len(marker) :]
        try:
            payload = base64.b64decode(b64_data, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=400, detail="invalid movie payload") from exc
        if not payload:
            raise HTTPException(status_code=400, detail="movie payload is empty")

        input_ext = ""
        if mime.startswith("video/webm"):
            input_ext = ".webm"
        elif mime.startswith("video/mp4"):
            input_ext = ".mp4"
        elif mime.startswith("image/gif"):
            input_ext = ".gif"
        else:
            raise HTTPException(status_code=400, detail=f"unsupported movie format '{mime}'")

        if req.format == "webm":
            if input_ext != ".webm":
                raise HTTPException(status_code=400, detail=f"unsupported movie format '{mime}' for webm output")
            out_payload = payload
            default_name = "recording.webm"
            out_mime = "video/webm"
        elif req.format == "mp4":
            if input_ext == ".mp4":
                out_payload = payload
            elif input_ext == ".webm":
                out_payload = transcode_video(payload, input_ext=".webm", out_format="mp4")
            else:
                raise HTTPException(status_code=400, detail=f"unsupported movie format '{mime}' for mp4 output")
            default_name = "recording.mp4"
            out_mime = "video/mp4"
        else:
            if input_ext == ".gif":
                out_payload = payload
            elif input_ext in {".webm", ".mp4"}:
                out_payload = transcode_video(payload, input_ext=input_ext, out_format="gif")
            else:
                raise HTTPException(status_code=400, detail=f"unsupported movie format '{mime}' for gif output")
            default_name = "recording.gif"
            out_mime = "image/gif"

        raw_name = Path(req.filename or "").name.strip()
        if not raw_name:
            raw_name = default_name
        stem = Path(raw_name).stem.strip() or "recording"
        file_name = f"{stem}.{req.format}"

        out_path = (out_dir / file_name).resolve()
        if out_path.exists() and not req.overwrite:
            raise HTTPException(status_code=409, detail=f"file already exists: {out_path}")
        try:
            out_path.write_bytes(out_payload)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"failed to write movie '{file_name}': {exc}") from exc

        return {
            "saved": True,
            "filename": file_name,
            "path": str(out_path),
            "size_bytes": len(out_payload),
            "mime_type": out_mime,
            "format": req.format,
        }

    @router.post("/datasets/{data_id}/save-render-movie")
    def save_render_movie(data_id: str, req: SaveRenderedMovieRequest) -> dict[str, Any]:
        _safe_dataset(registry, data_id)
        out_dir = Path(req.output_dir).expanduser().resolve()
        if not out_dir.exists() or not out_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"output_dir is not a directory: {out_dir}")
        if not req.frames:
            raise HTTPException(status_code=400, detail="render frames payload is empty")

        default_name = "rendered.mp4"
        if req.format == "webm":
            default_name = "rendered.webm"
        elif req.format == "gif":
            default_name = "rendered.gif"
        raw_name = Path(req.filename or "").name.strip()
        if not raw_name:
            raw_name = default_name
        stem = Path(raw_name).stem.strip() or "rendered"
        file_name = f"{stem}.{req.format}"
        out_path = (out_dir / file_name).resolve()
        if out_path.exists() and not req.overwrite:
            raise HTTPException(status_code=409, detail=f"file already exists: {out_path}")

        frame_fps = max(1, int(req.fps))
        quality = req.quality if req.quality in _RENDER_MP4_CRF else "balanced"
        ffmpeg_bin = _ffmpeg_executable()

        try:
            with tempfile.TemporaryDirectory(prefix="mobula_render_") as tmpdir:
                tmp_root = Path(tmpdir)
                frames_dir = tmp_root / "frames"
                frames_dir.mkdir(parents=True, exist_ok=True)
                frame_pattern = str(frames_dir / "frame_%06d.png")
                for idx, item in enumerate(req.frames):
                    prefix = "data:image/png;base64,"
                    if not item.data_url.startswith(prefix):
                        raise HTTPException(status_code=400, detail=f"unsupported frame image data at index {idx}")
                    b64_data = item.data_url[len(prefix) :]
                    try:
                        payload = base64.b64decode(b64_data, validate=True)
                    except (ValueError, binascii.Error) as exc:
                        raise HTTPException(status_code=400, detail=f"invalid frame payload at index {idx}") from exc
                    if not payload:
                        raise HTTPException(status_code=400, detail=f"empty frame payload at index {idx}")
                    frame_path = frames_dir / f"frame_{idx:06d}.png"
                    frame_path.write_bytes(payload)

                if req.format == "mp4":
                    cmd = [
                        ffmpeg_bin,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-framerate",
                        str(frame_fps),
                        "-i",
                        frame_pattern,
                        "-an",
                        "-vf",
                        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "slow",
                        "-crf",
                        _RENDER_MP4_CRF[quality],
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        str(out_path),
                    ]
                    _run_ffmpeg(cmd, "ffmpeg render encode to mp4 failed")
                    out_mime = "video/mp4"
                elif req.format == "webm":
                    cmd = [
                        ffmpeg_bin,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-framerate",
                        str(frame_fps),
                        "-i",
                        frame_pattern,
                        "-an",
                        "-c:v",
                        "libvpx-vp9",
                        "-b:v",
                        "0",
                        "-crf",
                        _RENDER_WEBM_CRF[quality],
                        "-pix_fmt",
                        "yuv420p",
                        str(out_path),
                    ]
                    _run_ffmpeg(cmd, "ffmpeg render encode to webm failed")
                    out_mime = "video/webm"
                else:
                    gif_fps = max(1, min(30, frame_fps))
                    palette_path = tmp_root / "palette.png"
                    palette_cmd = [
                        ffmpeg_bin,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-framerate",
                        str(frame_fps),
                        "-i",
                        frame_pattern,
                        "-vf",
                        f"fps={gif_fps},palettegen=stats_mode=diff",
                        str(palette_path),
                    ]
                    _run_ffmpeg(palette_cmd, "ffmpeg palette generation failed")
                    cmd = [
                        ffmpeg_bin,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-framerate",
                        str(frame_fps),
                        "-i",
                        frame_pattern,
                        "-i",
                        str(palette_path),
                        "-lavfi",
                        f"fps={gif_fps}[x];[x][1:v]paletteuse",
                        str(out_path),
                    ]
                    _run_ffmpeg(cmd, "ffmpeg render encode to gif failed")
                    out_mime = "image/gif"
        except HTTPException:
            if out_path.exists():
                try:
                    out_path.unlink()
                except OSError:
                    pass
            raise
        except OSError as exc:
            if out_path.exists():
                try:
                    out_path.unlink()
                except OSError:
                    pass
            raise HTTPException(status_code=500, detail=f"failed to save rendered movie '{file_name}': {exc}") from exc

        if not out_path.exists():
            raise HTTPException(status_code=500, detail="rendered movie output was not produced")
        return {
            "saved": True,
            "filename": file_name,
            "path": str(out_path),
            "size_bytes": out_path.stat().st_size,
            "mime_type": out_mime,
            "format": req.format,
            "fps": frame_fps,
            "frame_count": len(req.frames),
            "quality": quality,
        }
