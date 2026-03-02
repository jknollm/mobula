from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from mobula.service.api_models import PlaneProfilesRequest, ProfilesRequest, RoiStatsRequest
from mobula.service.api_utils import _safe_dataset
from mobula.service.profile_service import build_plane_profiles_response, build_profiles_response, build_roi_stats_response
from mobula.service.registry import DatasetRegistry


def _register_profile_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.post("/datasets/{data_id}/profiles")
    def profiles(data_id: str, req: ProfilesRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        return build_profiles_response(ds, req)

    @router.post("/datasets/{data_id}/profiles-plane")
    def profiles_plane(data_id: str, req: PlaneProfilesRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        return build_plane_profiles_response(ds, req)

    @router.post("/datasets/{data_id}/roi-stats")
    def roi_stats(data_id: str, req: RoiStatsRequest) -> dict[str, Any]:
        ds = _safe_dataset(registry, data_id)
        return build_roi_stats_response(ds, req)
