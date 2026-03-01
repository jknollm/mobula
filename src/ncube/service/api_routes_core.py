from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ncube.service.api_models import LoadLocalRequest
from ncube.service.api_utils import _coords_summary, _dim_size, _safe_dataset
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

