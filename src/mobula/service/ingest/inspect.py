from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from fastapi import UploadFile

from mobula.service.api_models import IngestInspection
from mobula.service.ingest.models import _InspectionSession

if TYPE_CHECKING:
    from mobula.service.ingest_service import IngestService


async def inspect_inputs(service: IngestService, paths: list[str], uploads: list[UploadFile]) -> IngestInspection:
    service._sessions.sweep()
    local_paths = [Path(p).expanduser().resolve() for p in paths]
    upload_files = list(uploads)
    total_inputs = len(local_paths) + len(upload_files)
    if total_inputs < 1:
        raise ValueError("inspect requires at least one local path or uploaded file")
    if total_inputs > service._limits.max_files:
        raise ValueError(f"too many inputs ({total_inputs}); max is {service._limits.max_files}")

    inspection_id = f"insp-{uuid4().hex[:12]}"
    expires_at = service._now() + timedelta(seconds=service._limits.session_ttl_seconds)
    session_dir = service._sessions.create_session_dir(inspection_id)

    total_bytes = 0
    inputs = {}
    inferences = []

    try:
        for idx, path in enumerate(local_paths):
            if not path.exists():
                raise ValueError(f"path does not exist: {path}")
            input_id = f"raw-{idx + 1}"
            rec, inf = service._inspect_local_input(input_id, path)
            if rec.raw_input.size_bytes > service._limits.max_file_bytes:
                raise ValueError(
                    f"input '{rec.raw_input.name}' exceeds max file size "
                    f"({service._format_bytes(rec.raw_input.size_bytes)} > {service._format_bytes(service._limits.max_file_bytes)})"
                )
            total_bytes += rec.raw_input.size_bytes
            if total_bytes > service._limits.max_total_bytes:
                raise ValueError(
                    f"total ingest size exceeds limit "
                    f"({service._format_bytes(total_bytes)} > {service._format_bytes(service._limits.max_total_bytes)})"
                )
            inputs[input_id] = rec
            inferences.append(inf)

        base_idx = len(inputs)
        for up_idx, upload in enumerate(upload_files):
            filename = str(upload.filename or "upload").strip() or "upload"
            suffix = Path(filename).suffix.lower()
            if suffix not in service.SUPPORTED_INGEST_EXTS or suffix == ".zarr":
                raise ValueError(
                    "drag-and-drop supports FITS and HDF5 uploads only; use local path selection for .zarr folders"
                )
            input_id = f"raw-{base_idx + up_idx + 1}"
            target = session_dir / f"{uuid4().hex[:8]}-{Path(filename).name}"
            written = 0
            with target.open("wb") as out:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > service._limits.max_file_bytes:
                        raise ValueError(
                            f"uploaded file '{filename}' exceeds max file size "
                            f"({service._format_bytes(written)} > {service._format_bytes(service._limits.max_file_bytes)})"
                        )
                    total_bytes += len(chunk)
                    if total_bytes > service._limits.max_total_bytes:
                        raise ValueError(
                            f"total ingest size exceeds limit "
                            f"({service._format_bytes(total_bytes)} > {service._format_bytes(service._limits.max_total_bytes)})"
                        )
                    out.write(chunk)

            rec, inf = service._inspect_local_input(input_id, target)
            rec.raw_input.name = filename
            rec.raw_input.source_type = "upload"
            rec.raw_input.path_or_upload_ref = filename
            rec.raw_input.size_bytes = written

            inf.raw_input.name = filename
            inf.raw_input.source_type = "upload"
            inf.raw_input.path_or_upload_ref = filename
            inf.raw_input.size_bytes = written

            inputs[input_id] = rec
            inferences.append(inf)
            await upload.close()

        grouping_candidates, grouping_warnings = service._grouping_candidates(inferences)
        signature = service._build_signature(inferences)
        preset_suggestions = service._preset_store.find_matches(signature)

        warnings = list(grouping_warnings)
        for inf in inferences:
            warnings.extend(inf.warnings)

        session = _InspectionSession(
            inspection_id=inspection_id,
            expires_at=expires_at,
            temp_dir=session_dir,
            inputs=inputs,
            inferences=inferences,
            grouping_candidates=grouping_candidates,
            warnings=warnings,
            signature=signature,
        )
        service._sessions.save_session(session)

        return IngestInspection(
            inspection_id=inspection_id,
            expires_at=expires_at.isoformat(),
            files=inferences,
            grouping_candidates=grouping_candidates,
            global_warnings=warnings,
            preset_suggestions=preset_suggestions,
        )
    except Exception:
        service._sessions.finalize_inspection(inspection_id)
        raise
