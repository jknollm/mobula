from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response

from mobula.data.scene import SceneProfilesRequest, SceneValidationError
from mobula.data.scene_remote import RemoteSceneSourceError
from mobula.service.api_models import HealpixProfilesRequest, PlaneProfilesRequest, ProfilesRequest, RoiStatsRequest
from mobula.service.api_utils import _safe_dataset_with_perf
from mobula.service.perf import timed_json_response
from mobula.service.profile_service import (
    build_healpix_profiles_response,
    build_plane_profiles_response,
    build_profiles_response,
    build_roi_stats_response,
    build_scene_profiles_response,
)
from mobula.service.registry import DatasetRegistry


def _register_profile_routes(router: APIRouter, registry: DatasetRegistry) -> None:
    @router.post("/datasets/{data_id}/profiles")
    def profiles(data_id: str, req: ProfilesRequest) -> Response:
        ds, dataset_metrics = _safe_dataset_with_perf(registry, data_id)
        return timed_json_response(lambda: build_profiles_response(ds, req), dataset_metrics=dataset_metrics)

    @router.post("/datasets/{data_id}/profiles-plane")
    async def profiles_plane(data_id: str, req: PlaneProfilesRequest) -> Response:
        scene_view = registry.scene_view(data_id)
        if scene_view is not None and scene_view.descriptor.access.mode == "slice":
            capability = scene_view.descriptor.access.profiles
            if capability is None:
                raise HTTPException(status_code=409, detail="Scene source does not advertise profile access")
            axes = {axis.axis_id: axis for axis in scene_view.descriptor.axes}
            recipe_axes = tuple(scene_view.recipe.presentation_axes)
            plane_axes = (req.plane_x, req.plane_y)
            if plane_axes != capability.plane_axes:
                raise HTTPException(status_code=400, detail="Scene source does not advertise the requested profile plane")
            profile_candidates = ["t", "nu"]
            profile_candidates.extend(
                axis for axis in ("x", "y", "z") if axis in recipe_axes and axis not in plane_axes
            )
            profile_axes = tuple(
                axis
                for axis in profile_candidates
                if axis in capability.axes and axis in axes and axes[axis].size > 1
            )
            if not profile_axes:
                raise HTTPException(status_code=400, detail="Scene has no advertised varying profile axis")

            request_values = req.model_dump()
            selections = {
                axis: (
                    int(request_values[axis])
                    if axis in request_values and request_values[axis] is not None
                    else axes[axis].size // 2
                )
                for axis in recipe_axes
                if axis not in plane_axes and axis != "sample"
            }
            spatial_window = {
                plane_axes[0]: (
                    max(0, min(req.u0, axes[plane_axes[0]].size - 1)),
                    max(1, min(req.u1, axes[plane_axes[0]].size)),
                ),
                plane_axes[1]: (
                    max(0, min(req.v0, axes[plane_axes[1]].size - 1)),
                    max(1, min(req.v1, axes[plane_axes[1]].size)),
                ),
            }
            reductions = {item.reduction_id for item in capability.reductions}
            spatial_reduction = (
                "integral"
                if "integral" in reductions
                else "mean"
                if "mean" in reductions
                else capability.reductions[0].reduction_id
            )
            try:
                rendered = await registry.render_scene_profiles(
                    data_id,
                    SceneProfilesRequest(
                        recipe_id=scene_view.recipe_id,
                        target=scene_view.target_kind,
                        component_id=scene_view.target_id if scene_view.target_kind == "component" else None,
                        profile_axes=profile_axes,
                        selections=selections,
                        plane_axes=plane_axes,
                        spatial_window=spatial_window,
                        spatial_reduction=spatial_reduction,
                        include_members=capability.include_members,
                        max_output_values=capability.max_output_values,
                    ),
                )
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except RemoteSceneSourceError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            except (SceneValidationError, TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            payload = build_scene_profiles_response(data_id, rendered)
            return timed_json_response(
                lambda: payload,
                dataset_metrics={"cache": "remote-profile", "load_ms": 0.0},
            )
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
