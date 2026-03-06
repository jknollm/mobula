from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from mobula.service.api_models import IngestCommitRequest, IngestPlanRequest
from mobula.service.ingest_service import IngestService
from mobula.service.registry import DatasetRegistry


def _parse_paths_json(paths_json: str | None) -> list[str]:
    if paths_json is None or not paths_json.strip():
        return []
    try:
        payload = json.loads(paths_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid paths_json payload: {exc}") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="paths_json must be a JSON list of local paths")
    out: list[str] = []
    for item in payload:
        if not isinstance(item, str) or not item.strip():
            raise HTTPException(status_code=400, detail="paths_json contains invalid path entries")
        out.append(item)
    return out


def _register_ingest_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    ingest = IngestService(registry)

    @router.post("/ingest/inspect")
    async def ingest_inspect(
        paths_json: str | None = Form(None),
        files: list[UploadFile] | None = File(None),
    ) -> dict[str, Any]:
        paths = _parse_paths_json(paths_json)
        uploads = list(files or [])
        try:
            payload = await ingest.inspect(paths, uploads)
            return payload.model_dump(mode="json")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/ingest/plan")
    def ingest_plan(req: IngestPlanRequest) -> dict[str, Any]:
        try:
            payload = ingest.plan(req.inspection_id, req.decision)
            return payload.model_dump(mode="json")
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/ingest/commit")
    def ingest_commit(req: IngestCommitRequest) -> dict[str, Any]:
        try:
            payload = ingest.commit(req.plan_id)
            return payload.model_dump(mode="json")
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
