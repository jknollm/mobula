from __future__ import annotations

from fastapi import APIRouter

from ncube.service.api_routes_core import _register_core_routes
from ncube.service.api_routes_profiles import _register_profile_routes
from ncube.service.api_routes_views import _register_slice_routes
from ncube.service.registry import DatasetRegistry


def build_router(registry: DatasetRegistry) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["ncube"])
    _register_core_routes(router, registry)
    _register_slice_routes(router, registry)
    _register_profile_routes(router, registry)
    return router

