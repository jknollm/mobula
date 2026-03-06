from __future__ import annotations

from fastapi import APIRouter

from mobula.service.api_routes_core import _register_core_routes
from mobula.service.api_routes_ingest import _register_ingest_routes
from mobula.service.api_routes_profiles import _register_profile_routes
from mobula.service.api_routes_views import _register_slice_routes
from mobula.service.registry import DatasetRegistry


def build_router(registry: DatasetRegistry) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["mobula"])
    _register_core_routes(router, registry)
    _register_ingest_routes(router, registry)
    _register_slice_routes(router, registry)
    _register_profile_routes(router, registry)
    return router
