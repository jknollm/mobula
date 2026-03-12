from __future__ import annotations

from typing import TYPE_CHECKING

from mobula.data.loaders import pad_dataset_to_canonical
from mobula.service.api_models import IngestCommitResponse, MappingDecision
from mobula.service.ingest.constants import GROUPING_AXIS_MAP

if TYPE_CHECKING:
    from mobula.service.ingest_service import IngestService


def commit_ingest_plan(service: IngestService, plan_id: str) -> IngestCommitResponse:
    plan = service._sessions.get_plan(plan_id)
    session = service._sessions.get_session(plan.inspection_id)

    if not plan.is_valid:
        raise ValueError("ingest plan is invalid; resolve errors before commit")

    created_ids: list[str] = []
    existing_ids = {summary.data_id for summary in service._registry.list()}

    for ds_plan in plan.datasets:
        if len(ds_plan.source_input_ids) == 1:
            input_id = ds_plan.source_input_ids[0]
            rec = session.inputs[input_id]
            mapping = plan.mapping_by_input[input_id]
            target_id = service._unique_data_id(ds_plan.dataset_id, existing_ids)

            loaded = service._load_dataset_for_input(rec, mapping, target_id)
            loaded, _ = pad_dataset_to_canonical(loaded)
            loaded.provenance["ingest"] = {
                "inspection_id": session.inspection_id,
                "plan_id": plan.plan_id,
                "mode": "separate",
                "raw_input_id": input_id,
            }
            loaded.validate()
            service._registry.add(loaded)
            created_ids.append(target_id)
            continue

        if plan.grouping_mode == "separate":
            raise ValueError("unexpected multi-source dataset plan under separate grouping mode")

        axis = GROUPING_AXIS_MAP.get(plan.grouping_mode)
        if axis is None:
            raise ValueError(f"unsupported grouping mode: {plan.grouping_mode}")

        loaded_parts = []
        for input_id in ds_plan.source_input_ids:
            rec = session.inputs[input_id]
            mapping = plan.mapping_by_input[input_id]
            temp_ds = service._load_dataset_for_input(rec, mapping, service._safe_file_stem(rec.raw_input.name))
            temp_ds, _ = pad_dataset_to_canonical(temp_ds)
            loaded_parts.append(temp_ds)

        target_id = service._unique_data_id(ds_plan.dataset_id, existing_ids)
        combined = service._combine_datasets(
            loaded_parts,
            combined_data_id=target_id,
            combine_axis=axis,
            inspection_id=session.inspection_id,
            plan_id=plan.plan_id,
            source_ids=list(ds_plan.source_input_ids),
        )
        service._registry.add(combined)
        created_ids.append(target_id)

    used_mappings = [
        plan.mapping_by_input[input_id]
        for input_id in plan.mapping_by_input
        if input_id in session.inputs and not plan.mapping_by_input[input_id].ignore
    ]
    decision = MappingDecision(
        grouping_mode=plan.grouping_mode,
        file_mappings=used_mappings,
        tab_mode=plan.tab_mode,
    )
    service._preset_store.upsert(signature=session.signature, decision=decision, mappings=used_mappings)

    service._sessions.finalize_inspection(session.inspection_id)
    return IngestCommitResponse(created_data_ids=created_ids, tab_mode=plan.tab_mode, warnings=list(plan.warnings))
