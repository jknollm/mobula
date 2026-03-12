from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response

from mobula.service.api_models import HealpixProfilesRequest, PlaneProfilesRequest, ProfilesRequest, RoiStatsRequest
from mobula.service.api_utils import _safe_dataset_with_perf
from mobula.service.perf import timed_json_response
from mobula.service.profile_service import (
    build_healpix_profiles_response,
    build_plane_profiles_response,
    build_profiles_response,
    build_roi_stats_response,
)
from mobula.service.registry import DatasetRegistry


def _register_profile_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.post("/datasets/{data_id}/profiles")
    def profiles(data_id: str, req: ProfilesRequest) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        return timed_json_response(lambda: build_profiles_response(ds, req), dataset_metrics=dataset_metrics)

    @router.post("/datasets/{data_id}/profiles-plane")
    def profiles_plane(data_id: str, req: PlaneProfilesRequest) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        return timed_json_response(lambda: build_plane_profiles_response(ds, req), dataset_metrics=dataset_metrics)

    @router.post("/datasets/{data_id}/profiles-healpix")
    def profiles_healpix(data_id: str, req: HealpixProfilesRequest) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        return timed_json_response(lambda: build_healpix_profiles_response(ds, req), dataset_metrics=dataset_metrics)

    @router.post("/datasets/{data_id}/roi-stats")
    def roi_stats(data_id: str, req: RoiStatsRequest) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        return timed_json_response(lambda: build_roi_stats_response(ds, req), dataset_metrics=dataset_metrics)
