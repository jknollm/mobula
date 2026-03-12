from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from mobula.data.schema import CANONICAL_DIMS
from mobula.service.api_models import IngestDatasetPlan, IngestPlan, MappingDecision
from mobula.service.ingest.constants import GROUPING_AXIS_MAP
from mobula.service.ingest.models import _DatasetPlanRecord, _PlanRecord

if TYPE_CHECKING:
    from mobula.service.ingest_service import IngestService


def build_ingest_plan(service: IngestService, inspection_id: str, decision: MappingDecision) -> IngestPlan:
    session = service._sessions.get_session(inspection_id)

    selected_mappings = service._resolve_mappings(session, decision)
    mapping_by_input = {entry.raw_input_id: entry for entry in selected_mappings}

    errors: list[str] = []
    warnings = list(session.warnings)
    selected_inputs: list[str] = []
    canonical_shapes: dict[str, tuple[int, ...]] = {}

    for inf in session.inferences:
        input_id = inf.raw_input.id
        mapped = mapping_by_input.get(input_id)
        if mapped is None:
            errors.append(f"missing mapping decision for input {input_id}")
            continue
        if mapped.ignore:
            continue

        rec = session.inputs[input_id]
        try:
            mapped_shape = service._shape_for_mapping(rec, mapped)
        except ValueError as exc:
            errors.append(f"{inf.raw_input.name}: {exc}")
            continue

        mapped_dims = [str(dim) for dim in mapped.dims]
        if rec.format_name == "hdf5":
            selected_paths = service._mapping_hdf5_dataset_paths(rec, mapped)
            if len(selected_paths) > 1:
                stack_axis = service._mapping_hdf5_key_stack_axis(mapped)
                if stack_axis is None:
                    errors.append(
                        f"{inf.raw_input.name}: key_stack_axis is required when multiple dataset_paths are selected"
                    )
                    continue
                if not mapped_dims or mapped_dims[0] != stack_axis:
                    errors.append(
                        f"{inf.raw_input.name}: key_stack_axis '{stack_axis}' must be assigned to axis 0 for stacked keys"
                    )
                    continue
                if stack_axis not in mapped_dims:
                    errors.append(
                        f"{inf.raw_input.name}: key_stack_axis '{stack_axis}' must appear in mapped dimensions"
                    )
                    continue
        try:
            _, projected_shape = service._validate_dims(mapped_shape, mapped_dims)
        except ValueError as exc:
            errors.append(f"{inf.raw_input.name}: {exc}")
            continue

        pol_axis = next((idx for idx, dim in enumerate(mapped_dims) if dim == "pol"), -1)
        if pol_axis >= 0:
            pol_size = int(mapped_shape[pol_axis])
            if pol_size not in {1, 3, 4}:
                errors.append(f"{inf.raw_input.name}: pol axis must have size 1, 3, or 4 (got {pol_size})")
                continue
            if pol_size == 3:
                warnings.append(
                    f"{inf.raw_input.name}: pol axis has 3 channels; assuming I,Q,U and padding V=0 during load."
                )

        if mapped.sphere_axis is not None:
            sphere_axis = int(mapped.sphere_axis)
            if sphere_axis < 0 or sphere_axis >= len(mapped_dims):
                errors.append(f"{inf.raw_input.name}: sphere_axis={sphere_axis} is out of bounds")
                continue
            sphere_dim = mapped_dims[sphere_axis]
            if sphere_dim != "x":
                errors.append(
                    f"{inf.raw_input.name}: sphere axis must be mapped to canonical dim 'x' (got '{sphere_dim}')"
                )
                continue
            npix = int(mapped_shape[sphere_axis])
            nside = service._healpix_nside_from_npix(npix)
            if nside is None:
                errors.append(
                    f"{inf.raw_input.name}: sphere axis requires HEALPix npix=12*nside^2 with power-of-two nside (got N={npix})"
                )
                continue

        selected_inputs.append(input_id)
        canonical_shapes[input_id] = projected_shape

    if not selected_inputs:
        errors.append("no inputs selected for ingest")

    grouping_mode = decision.grouping_mode
    if grouping_mode != "separate" and len(selected_inputs) <= 1:
        warnings.append("Only one file selected; grouping mode has been reduced to separate dataset creation.")
        grouping_mode = "separate"

    existing_ids = {summary.data_id for summary in service._registry.list()}
    dataset_plans: list[_DatasetPlanRecord] = []

    if grouping_mode == "separate":
        for input_id in selected_inputs:
            rec = session.inputs[input_id]
            mapped = mapping_by_input[input_id]
            base_id = service._safe_file_stem(mapped.data_id or rec.raw_input.name)
            dataset_id = service._unique_data_id(base_id, existing_ids)
            dataset_plans.append(
                _DatasetPlanRecord(
                    dataset_id=dataset_id,
                    source_input_ids=[input_id],
                    canonical_dims=tuple(CANONICAL_DIMS),
                    projected_shape=canonical_shapes[input_id],
                )
            )
    else:
        axis = GROUPING_AXIS_MAP.get(grouping_mode)
        if axis is None:
            errors.append(f"unsupported grouping mode: {grouping_mode}")
        else:
            axis_idx = CANONICAL_DIMS.index(axis)
            base_shape: tuple[int, ...] | None = None
            strict_errors: list[str] = []
            for input_id in selected_inputs:
                shape = canonical_shapes[input_id]
                if shape[axis_idx] != 1:
                    strict_errors.append(
                        f"{session.inputs[input_id].raw_input.name}: axis '{axis}' must be singleton (size=1) for strict file-axis combine"
                    )
                if base_shape is None:
                    base_shape = shape
                    continue
                for idx, dim in enumerate(CANONICAL_DIMS):
                    if idx == axis_idx:
                        continue
                    if shape[idx] != base_shape[idx]:
                        strict_errors.append(
                            f"shape mismatch on dim '{dim}' between files for combine mode '{grouping_mode}'"
                        )

            if base_shape is None:
                errors.append("unable to build combined dataset: no valid input shapes")
            else:
                combined_shape = list(base_shape)
                combined_shape[axis_idx] = len(selected_inputs)
                names = [session.inputs[input_id].raw_input.name for input_id in selected_inputs]
                suggested_base = service._safe_file_stem(
                    decision.combined_data_id or f"{service._common_prefix(names)}-{axis}-stack"
                )
                dataset_id = service._unique_data_id(suggested_base, existing_ids)
                dataset_plans.append(
                    _DatasetPlanRecord(
                        dataset_id=dataset_id,
                        source_input_ids=list(selected_inputs),
                        canonical_dims=tuple(CANONICAL_DIMS),
                        projected_shape=tuple(combined_shape),
                        strict_errors=strict_errors,
                        warnings=[] if not strict_errors else ["Resolve strict compatibility errors before commit."],
                    )
                )

    for ds_plan in dataset_plans:
        errors.extend(ds_plan.strict_errors)

    is_valid = not errors
    plan_id = f"plan-{uuid4().hex[:12]}"
    plan_record = _PlanRecord(
        plan_id=plan_id,
        inspection_id=inspection_id,
        expires_at=session.expires_at,
        grouping_mode=grouping_mode,
        tab_mode=decision.tab_mode,
        mapping_by_input=mapping_by_input,
        datasets=dataset_plans,
        warnings=warnings,
        errors=errors,
        is_valid=is_valid,
    )
    service._sessions.save_plan(plan_record)

    return IngestPlan(
        plan_id=plan_id,
        inspection_id=inspection_id,
        expires_at=session.expires_at.isoformat(),
        grouping_mode=grouping_mode,
        tab_mode=decision.tab_mode,
        datasets=[
            IngestDatasetPlan(
                dataset_id=ds_plan.dataset_id,
                source_input_ids=list(ds_plan.source_input_ids),
                canonical_dims=[str(dim) for dim in ds_plan.canonical_dims],
                projected_shape=[int(x) for x in ds_plan.projected_shape],
                warnings=list(ds_plan.warnings),
                strict_errors=list(ds_plan.strict_errors),
            )
            for ds_plan in dataset_plans
        ],
        warnings=warnings,
        errors=errors,
        is_valid=is_valid,
    )
