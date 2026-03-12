from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
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

    raise RuntimeError("Unable to locate static assets directory.")


STATIC_DIR = _resolve_static_dir()

registry = DatasetRegistry()
registry.ensure_default_datasets()

app = FastAPI(
    title="mobula",
    description="Interactive high-dimensional cube viewer with local mock data",
    version="0.1.0",
)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.include_router(build_router(registry))

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def add_request_timing(request, call_next):
    started = perf_counter()
    response = await call_next(request)
    total_ms = (perf_counter() - started) * 1000.0
    response.headers["X-Mobula-Request-Ms"] = f"{total_ms:.2f}"
    existing = response.headers.get("Server-Timing")
    total_metric = f"total;dur={total_ms:.2f}"
    response.headers["Server-Timing"] = f"{existing}, {total_metric}" if existing else total_metric
    return response


@app.get("/")
def index() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store, max-age=0, must-revalidate"},
    )


@app.get("/favicon.ico")
def favicon() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "assets" / "mobula_logo.png",
        media_type="image/png",
        headers={"Cache-Control": "no-store, max-age=0, must-revalidate"},
    )
