from __future__ import annotations

import platform
from pathlib import Path
import subprocess
import tempfile
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ncube.service.api_models import LoadLocalRequest, PickLocalPathRequest
from ncube.service.api_utils import _coords_summary, _dim_size, _safe_dataset
from ncube.service.registry import DatasetRegistry

SUPPORTED_LOCAL_DATASET_EXTS = {".h5", ".hdf5", ".fits", ".fit", ".fts", ".zarr"}


def _is_loadable_local_dataset(path: Path) -> bool:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_LOCAL_DATASET_EXTS:
        return False
    if suffix == ".zarr":
        return path.is_dir()
    return path.is_file()


def _pick_local_path_native(target: str = "file") -> str | None:
    """Open native host picker and return selected absolute path or None if canceled.

    target: "file" (default), "folder", or "dataset" (legacy interactive mode chooser).
    """
    system = platform.system()
    home = str(Path.home().resolve())

    if system == "Darwin":
        if target not in {"file", "folder", "dataset"}:
            raise RuntimeError("target must be 'file', 'folder', or 'dataset'")

        def run_osascript(lines: list[str]) -> subprocess.CompletedProcess[str]:
            cmd: list[str] = ["osascript"]
            for line in lines:
                cmd.extend(["-e", line])
            try:
                return subprocess.run(cmd, capture_output=True, text=True, check=False)
            except OSError as exc:
                raise RuntimeError(f"failed to run osascript: {exc}") from exc

        mode = target
        if target == "dataset":
            mode_pick = run_osascript(
                [
                    f'set homeAlias to POSIX file "{home}"',
                    'set modeChoice to button returned of (display dialog "Select dataset type" buttons {"Cancel", "Folder (.zarr)", "File"} default button "File" cancel button "Cancel")',
                    "modeChoice",
                ]
            )
            if mode_pick.returncode != 0:
                mode_err = (mode_pick.stderr or "").lower()
                if "canceled" in mode_err or "cancelled" in mode_err:
                    return None
                raise RuntimeError(mode_pick.stderr.strip() or "native picker failed")
            mode = mode_pick.stdout.strip().lower()

        if mode == "file":
            file_pick = run_osascript(
                [
                    f'set homeAlias to POSIX file "{home}"',
                    'POSIX path of (choose file with prompt "Select dataset file" default location homeAlias)',
                ]
            )
            if file_pick.returncode == 0:
                picked = file_pick.stdout.strip()
                return picked or None
            file_err = (file_pick.stderr or "").lower()
            if "canceled" in file_err or "cancelled" in file_err:
                return None
            raise RuntimeError(file_pick.stderr.strip() or "native picker failed")

        folder_pick = run_osascript(
            [
                f'set homeAlias to POSIX file "{home}"',
                'POSIX path of (choose folder with prompt "Select dataset folder (.zarr)" default location homeAlias)',
            ]
        )
        if folder_pick.returncode == 0:
            picked = folder_pick.stdout.strip()
            return picked or None
        folder_err = (folder_pick.stderr or "").lower()
        if "canceled" in folder_err or "cancelled" in folder_err:
            return None
        raise RuntimeError(folder_pick.stderr.strip() or "native picker failed")

    if system == "Linux":
        if target not in {"file", "folder", "dataset"}:
            raise RuntimeError("target must be 'file', 'folder', or 'dataset'")

        def run_zenity(cmd: list[str]) -> subprocess.CompletedProcess[str]:
            try:
                return subprocess.run(cmd, capture_output=True, text=True, check=False)
            except OSError as exc:
                raise RuntimeError(f"failed to run zenity: {exc}") from exc

        if target in {"file", "dataset"}:
            file_pick = run_zenity(["zenity", "--file-selection", f"--filename={home}/"])
            if file_pick.returncode == 0:
                picked = file_pick.stdout.strip()
                return picked or None

        if target in {"folder", "dataset"}:
            folder_pick = run_zenity(["zenity", "--file-selection", "--directory", f"--filename={home}/"])
            if folder_pick.returncode == 0:
                picked = folder_pick.stdout.strip()
                return picked or None
        return None

    raise RuntimeError(f"native picker is not implemented for platform: {system}")


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
        dims = tuple(d.strip().lower() for d in req.dims) if req.dims else None
        try:
            ds = registry.load_local(
                str(p),
                data_id=req.data_id,
                dims=dims,
                pad_missing_dims=req.pad_missing_dims,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"failed to load {p.name}: {exc}") from exc
        padded_dims = ds.provenance.get("padded_dims", [])
        if not isinstance(padded_dims, list):
            padded_dims = []
        return {
            "loaded": ds.data_id,
            "dims": list(ds.dims),
            "shape": list(ds.shape),
            "path": str(p),
            "padded_dims": [str(d) for d in padded_dims],
        }

    @router.post("/upload-local")
    async def upload_local(
        file: UploadFile = File(...),
        data_id: str | None = Form(None),
        dims: str | None = Form(None),
        pad_missing_dims: bool = Form(False),
    ) -> dict[str, Any]:
        filename = str(file.filename or "").strip()
        suffix = Path(filename).suffix.lower()
        inferred_data_id = Path(filename).stem if filename else None
        effective_data_id = data_id or inferred_data_id
        if suffix == ".zarr":
            raise HTTPException(status_code=400, detail="zarr folder upload is not supported by drag-and-drop")
        if suffix not in SUPPORTED_LOCAL_DATASET_EXTS:
            raise HTTPException(status_code=400, detail=f"unsupported file extension: {suffix or '(none)'}")

        parsed_dims: tuple[str, ...] | None = None
        if dims is not None and dims.strip():
            parsed_dims = tuple(d.strip().lower() for d in dims.split(",") if d.strip())

        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".tmp") as tmp:
                tmp_path = Path(tmp.name)
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    tmp.write(chunk)

            ds = registry.load_local(
                str(tmp_path),
                data_id=effective_data_id,
                dims=parsed_dims,
                pad_missing_dims=pad_missing_dims,
            )
        except HTTPException:
            raise
        except Exception as exc:
            label = filename or "upload"
            raise HTTPException(status_code=400, detail=f"failed to load {label}: {exc}") from exc
        finally:
            await file.close()
            if tmp_path is not None:
                try:
                    tmp_path.unlink(missing_ok=True)
                except OSError:
                    pass

        padded_dims = ds.provenance.get("padded_dims", [])
        if not isinstance(padded_dims, list):
            padded_dims = []
        return {
            "loaded": ds.data_id,
            "dims": list(ds.dims),
            "shape": list(ds.shape),
            "path": filename,
            "padded_dims": [str(d) for d in padded_dims],
        }

    @router.post("/fs/pick")
    def pick_local_path(req: PickLocalPathRequest | None = None) -> dict[str, Any]:
        target = req.target if req is not None else "file"
        try:
            picked = _pick_local_path_native(target)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        if picked is None:
            return {"canceled": True}

        p = Path(picked).expanduser().resolve()
        if not p.exists():
            return {"canceled": False, "path": str(p), "exists": False, "loadable": False}
        return {
            "canceled": False,
            "path": str(p),
            "exists": True,
            "is_dir": p.is_dir(),
            "is_file": p.is_file(),
            "loadable": _is_loadable_local_dataset(p),
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
