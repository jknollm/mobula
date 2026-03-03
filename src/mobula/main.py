from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from mobula.service.api import build_router
from mobula.service.registry import DatasetRegistry


def _resolve_static_dir() -> Path:
    env_static = os.environ.get("MOBULA_STATIC_DIR")
    if env_static:
        path = Path(env_static).expanduser().resolve()
        if path.is_dir():
            return path

    package_static = Path(__file__).resolve().parent / "static"
    if package_static.is_dir():
        return package_static

    repo_static = Path(__file__).resolve().parents[2] / "static"
    if repo_static.is_dir():
        return repo_static

    raise RuntimeError("Unable to locate static assets directory.")


STATIC_DIR = _resolve_static_dir()

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
