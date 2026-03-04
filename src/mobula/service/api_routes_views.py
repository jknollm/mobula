from __future__ import annotations

import base64
import binascii
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response

from mobula.service.api_models import ExportCutoutSaveRequest, SaveImagesRequest
from mobula.service.api_utils import _parse_range_mode, _parse_sample_mode, _safe_dataset
from mobula.service.registry import DatasetRegistry
from mobula.service.view_service import (
    build_evpa_response,
    build_export_cutout_fits,
    build_export_cutout_hdf5,
    build_intensity_range_response,
    build_multispectral_response,
    build_slice_response,
    build_volume_response,
)


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
        project_dims: str | None = Query(default=None),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
        return build_slice_response(
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
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
        return build_volume_response(
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
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        rmode = _parse_range_mode(range_mode)
        project = _parse_project_dims(project_dims)
        return build_intensity_range_response(
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
        )

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
        project_dims: str | None = Query(default=None),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
        return build_evpa_response(
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
        )

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
        nu_axis_scale: str = Query(default="linear"),
        deslope: float = Query(default=0.0, ge=-8.0, le=8.0),
        project_dims: str | None = Query(default=None),
    ) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        mode = _parse_sample_mode(sample_mode)
        project = _parse_project_dims(project_dims)
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
            project_dims=project,
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
            b64_data = item.data_url[len(prefix):]
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
