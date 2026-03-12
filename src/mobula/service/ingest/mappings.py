from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from mobula.data.schema import CANONICAL_DIMS
from mobula.service.api_models import FileInference, FileMappingDecision, MappingDecision
from mobula.service.ingest.models import _InputRecord, _InspectionSession


def default_hdf5_dataset_path(format_metadata: dict[str, Any]) -> str | None:
    path = str(format_metadata.get("dataset_path", "")).strip()
    return path or None


def mapping_hdf5_dataset_paths(rec: _InputRecord, mapped: FileMappingDecision) -> list[str]:
    raw = [str(x).strip() for x in mapped.dataset_paths if str(x).strip()]
    single = str(mapped.dataset_path or "").strip()
    if single and raw:
        if len(raw) == 1 and raw[0] != single:
            # Guard against stale single-path state when dataset_path changed in UI.
            return [single]
        if len(raw) > 1 and single in raw and raw[0] != single:
            reordered = [single, *[path for path in raw if path != single]]
            return reordered
    if raw:
        return list(dict.fromkeys(raw))
    single = str(single or default_hdf5_dataset_path(rec.parsed.format_metadata) or "").strip()
    return [single] if single else []


def mapping_hdf5_key_stack_axis(mapped: FileMappingDecision) -> str | None:
    axis = str(mapped.key_stack_axis or "").strip().lower()
    if not axis:
        return None
    return axis


def hdf5_stack_shape_from_member_paths(
    format_metadata: dict[str, Any],
    member_paths: list[str],
    *,
    parse_stokes_stack_token: Callable[[str], list[str] | None],
    _seen: set[str] | None = None,
) -> list[int] | None:
    if not member_paths:
        return None
    shapes: list[list[int]] = []
    seen = _seen if _seen is not None else set()
    for member in member_paths:
        member_shape = hdf5_shape_for_dataset_path(
            format_metadata,
            member,
            parse_stokes_stack_token=parse_stokes_stack_token,
            _seen=seen,
        )
        if member_shape is None:
            return None
        shapes.append(member_shape)
    first = shapes[0]
    if any(shape != first for shape in shapes[1:]):
        return None
    return [int(len(shapes)), *[int(x) for x in first]]


def hdf5_shape_for_dataset_path(
    format_metadata: dict[str, Any],
    dataset_path: str,
    *,
    parse_stokes_stack_token: Callable[[str], list[str] | None],
    _seen: set[str] | None = None,
) -> list[int] | None:
    target = str(dataset_path).strip()
    if not target:
        return None
    seen = _seen if _seen is not None else set()
    if target in seen:
        return None
    seen.add(target)

    token_members = parse_stokes_stack_token(target)
    if token_members is not None:
        shape = hdf5_stack_shape_from_member_paths(
            format_metadata,
            token_members,
            parse_stokes_stack_token=parse_stokes_stack_token,
            _seen=seen,
        )
        if shape is not None:
            return shape

    selected = default_hdf5_dataset_path(format_metadata)
    if selected == target:
        shape = format_metadata.get("shape")
        if isinstance(shape, list) and all(isinstance(x, int) for x in shape):
            return [int(x) for x in shape]

    candidates = format_metadata.get("dataset_candidates")
    if not isinstance(candidates, list):
        return None
    for row in candidates:
        if not isinstance(row, dict):
            continue
        if str(row.get("path", "")).strip() != target:
            continue
        shape = row.get("shape")
        if isinstance(shape, list) and all(isinstance(x, int) for x in shape):
            return [int(x) for x in shape]
        return None
    return None


def hdf5_shape_for_dataset_path_from_file(
    file_path: Path,
    dataset_path: str,
    *,
    parse_stokes_stack_token: Callable[[str], list[str] | None],
    _seen: set[str] | None = None,
) -> list[int] | None:
    target = str(dataset_path).strip()
    if not target:
        return None
    seen = _seen if _seen is not None else set()
    if target in seen:
        return None
    seen.add(target)

    token_members = parse_stokes_stack_token(target)
    if token_members is not None:
        return hdf5_stack_shape_from_member_paths_from_file(
            file_path,
            token_members,
            parse_stokes_stack_token=parse_stokes_stack_token,
            _seen=seen,
        )

    try:
        import h5py

        with h5py.File(file_path, "r") as f:
            if target not in f:
                return None
            ds = f[target]
            if not isinstance(ds, h5py.Dataset):
                return None
            if int(getattr(ds, "ndim", 0)) < 1:
                return None
            return [int(x) for x in getattr(ds, "shape", ())]
    except Exception:
        return None


def hdf5_stack_shape_from_member_paths_from_file(
    file_path: Path,
    member_paths: list[str],
    *,
    parse_stokes_stack_token: Callable[[str], list[str] | None],
    _seen: set[str] | None = None,
) -> list[int] | None:
    if not member_paths:
        return None
    seen = _seen if _seen is not None else set()
    shapes: list[list[int]] = []
    for member in member_paths:
        shape = hdf5_shape_for_dataset_path_from_file(
            file_path,
            member,
            parse_stokes_stack_token=parse_stokes_stack_token,
            _seen=seen,
        )
        if shape is None:
            return None
        shapes.append(shape)
    first = shapes[0]
    if any(shape != first for shape in shapes[1:]):
        return None
    return [int(len(shapes)), *[int(x) for x in first]]


def shape_for_mapping(
    rec: _InputRecord,
    mapped: FileMappingDecision,
    *,
    parse_stokes_stack_token: Callable[[str], list[str] | None],
) -> list[int]:
    if rec.format_name != "hdf5":
        return [int(x) for x in rec.parsed.shape]
    selected_paths = mapping_hdf5_dataset_paths(rec, mapped)
    if not selected_paths:
        return [int(x) for x in rec.parsed.shape]

    shapes: list[list[int]] = []
    for path in selected_paths:
        shape = hdf5_shape_for_dataset_path(
            rec.parsed.format_metadata,
            path,
            parse_stokes_stack_token=parse_stokes_stack_token,
        )
        if shape is None:
            shape = hdf5_shape_for_dataset_path_from_file(
                rec.path,
                path,
                parse_stokes_stack_token=parse_stokes_stack_token,
            )
        if shape is None:
            raise ValueError(f"dataset_path '{path}' is not available from inspect candidates or source file")
        shapes.append(shape)

    if len(shapes) == 1:
        return [int(x) for x in shapes[0]]

    stack_axis = mapping_hdf5_key_stack_axis(mapped)
    if stack_axis is None:
        raise ValueError("dataset_paths requires key_stack_axis when multiple keys are selected")
    if stack_axis not in CANONICAL_DIMS:
        raise ValueError(f"unknown key_stack_axis '{stack_axis}'")
    first = shapes[0]
    if any(shape != first for shape in shapes[1:]):
        raise ValueError("selected dataset_paths must have matching shapes for key stacking")
    return [int(len(shapes)), *[int(x) for x in first]]


def default_mapping(inf: FileInference) -> FileMappingDecision:
    default_dataset_path = None
    if inf.raw_input.format == "hdf5":
        default_dataset_path = default_hdf5_dataset_path(inf.parsed.format_metadata)
    return FileMappingDecision(
        raw_input_id=inf.raw_input.id,
        dims=list(inf.recommended_dims),
        ignore=False,
        dataset_path=default_dataset_path,
        dataset_paths=[default_dataset_path] if default_dataset_path else [],
    )


def build_default_mappings(session: _InspectionSession) -> list[FileMappingDecision]:
    return [default_mapping(inf) for inf in session.inferences]


def resolve_mappings(
    session: _InspectionSession,
    decision: MappingDecision,
    *,
    preset_loader: Callable[[str], Any | None],
) -> list[FileMappingDecision]:
    if decision.file_mappings:
        mapping_by_id = {entry.raw_input_id: entry for entry in decision.file_mappings}
        out: list[FileMappingDecision] = []
        for inf in session.inferences:
            mapped = mapping_by_id.get(inf.raw_input.id)
            if mapped is None:
                out.append(default_mapping(inf))
                continue
            if inf.raw_input.format == "hdf5":
                default_path = default_hdf5_dataset_path(inf.parsed.format_metadata)
                if not mapped.dataset_path and default_path:
                    mapped.dataset_path = default_path
                if not mapped.dataset_paths and mapped.dataset_path:
                    mapped.dataset_paths = [mapped.dataset_path]
            out.append(mapped)
        return out

    if decision.use_preset_id:
        preset = preset_loader(decision.use_preset_id)
        if preset is not None and preset.default_dims:
            return [
                FileMappingDecision(
                    raw_input_id=inf.raw_input.id,
                    dims=list(preset.default_dims),
                    ignore=False,
                    dataset_path=default_hdf5_dataset_path(inf.parsed.format_metadata)
                    if inf.raw_input.format == "hdf5"
                    else None,
                    dataset_paths=(
                        [default_hdf5_dataset_path(inf.parsed.format_metadata)]
                        if inf.raw_input.format == "hdf5" and default_hdf5_dataset_path(inf.parsed.format_metadata)
                        else []
                    ),
                )
                for inf in session.inferences
            ]

    return build_default_mappings(session)


__all__ = [
    "build_default_mappings",
    "default_hdf5_dataset_path",
    "default_mapping",
    "hdf5_shape_for_dataset_path",
    "hdf5_shape_for_dataset_path_from_file",
    "hdf5_stack_shape_from_member_paths",
    "hdf5_stack_shape_from_member_paths_from_file",
    "mapping_hdf5_dataset_paths",
    "mapping_hdf5_key_stack_axis",
    "resolve_mappings",
    "shape_for_mapping",
]
