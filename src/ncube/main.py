from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ncube.service.api import build_router
from ncube.service.registry import DatasetRegistry

BASE_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = BASE_DIR / "static"

registry = DatasetRegistry()
registry.ensure_default_datasets()

app = FastAPI(
    title="mobula",
    description="Interactive high-dimensional cube viewer with local mock data",
    version="0.1.0",
)
app.include_router(build_router(registry))

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store, max-age=0, must-revalidate"},
    )
