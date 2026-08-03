from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class LoadLocalRequest(BaseModel):
    path: str
    data_id: str | None = None
    dims: list[str] | None = None
    pad_missing_dims: bool = False


class PickLocalPathRequest(BaseModel):
    target: Literal["file", "folder"] = "file"


class RenderSceneRequest(BaseModel):
    recipe_id: str
    target: Literal["combined", "component"] = "combined"
    component_id: str | None = None
    exploration_indices: dict[str, int] = Field(default_factory=dict)
    spatial_window: dict[str, tuple[int, int]] = Field(default_factory=dict)
    sample_mode: str = "single"


class RegisterSceneSnapshotRequest(BaseModel):
    path: str


class RoiStatsRequest(BaseModel):
    x0: int = Field(ge=0)
    x1: int = Field(gt=0)
    y0: int = Field(ge=0)
    y1: int = Field(gt=0)
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    z: int | None = None


class ProfilesRequest(BaseModel):
    x0: int = Field(ge=0)
    x1: int = Field(gt=0)
    y0: int = Field(ge=0)
    y1: int = Field(gt=0)
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    z: int | None = None


class PlaneProfilesRequest(BaseModel):
    plane_x: str
    plane_y: str
    u0: int = Field(ge=0)
    u1: int = Field(gt=0)
    v0: int = Field(ge=0)
    v1: int = Field(gt=0)
    sample: int | None = None
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    x: int | None = None
    y: int | None = None
    z: int | None = None


class HealpixProfilesRequest(BaseModel):
    pixel_indices: list[int] = Field(default_factory=list)
    sample: int | None = None
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    y: int | None = None
    z: int | None = None


class ExportCutoutSaveRequest(BaseModel):
    format: Literal["fits", "hdf5"] = "fits"
    output_dir: str
    filename: str | None = None
    overwrite: bool = True
    sample: int | None = None
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    x: int | None = None
    y: int | None = None
    z: int | None = None
    sample_mode: str = "single"
    plane_x: str = "x"
    plane_y: str = "y"
    u0: int | None = None
    u1: int | None = None
    v0: int | None = None
    v1: int | None = None
    t0: int | None = None
    t1: int | None = None
    nu0: int | None = None
    nu1: int | None = None
    pixel_indices: list[int] | None = None


class SaveImageItem(BaseModel):
    filename: str
    data_url: str


class SaveImagesRequest(BaseModel):
    output_dir: str
    overwrite: bool = True
    images: list[SaveImageItem] = Field(default_factory=list)


class SaveMovieRequest(BaseModel):
    format: Literal["webm", "mp4", "gif"] = "mp4"
    output_dir: str
    filename: str | None = None
    overwrite: bool = True
    data_url: str


class RenderFrameItem(BaseModel):
    data_url: str


class SaveRenderedMovieRequest(BaseModel):
    format: Literal["webm", "mp4", "gif"] = "mp4"
    quality: Literal["low", "balanced", "high"] = "balanced"
    fps: int = Field(default=30, ge=1, le=240)
    output_dir: str
    filename: str | None = None
    overwrite: bool = True
    frames: list[RenderFrameItem] = Field(default_factory=list)


SampleMode = Literal["single", "mean", "std", "rel_uncert"]
RangeMode = Literal["none", "time", "spectral", "time_spectral", "space", "full"]

CanonicalDim = Literal["sample", "pol", "t", "nu", "x", "y", "z"]
IngestSourceType = Literal["local_path", "upload"]
AxisCandidateSource = Literal["header", "filename", "embedded", "heuristic"]
ConfidenceTier = Literal["high", "medium", "low"]
GroupingMode = Literal["files_as_sample", "files_as_t", "files_as_nu", "files_as_pol", "separate"]
TabMaterializationMode = Literal["single_tab", "multiple_tabs"]


class RawInputRef(BaseModel):
    id: str
    name: str
    source_type: IngestSourceType
    path_or_upload_ref: str
    format: str
    size_bytes: int = Field(ge=0)


class ParsedArrayInfo(BaseModel):
    shape: list[int] = Field(default_factory=list)
    dtype: str
    ndim: int = Field(ge=0)
    native_dim_labels: list[str] = Field(default_factory=list)
    format_metadata: dict[str, Any] = Field(default_factory=dict)


class AxisCandidate(BaseModel):
    target_dim: CanonicalDim
    score: float = Field(ge=0.0, le=1.0)
    reason: str
    source: AxisCandidateSource


class AxisInference(BaseModel):
    axis_index: int = Field(ge=0)
    native_label: str | None = None
    candidates: list[AxisCandidate] = Field(default_factory=list)
    recommended: CanonicalDim | None = None


class FileInference(BaseModel):
    raw_input: RawInputRef
    parsed: ParsedArrayInfo
    axis_inferences: list[AxisInference] = Field(default_factory=list)
    recommended_dims: list[CanonicalDim] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_tier: ConfidenceTier
    conflicts: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class GroupingCandidate(BaseModel):
    mode: GroupingMode
    score: float = Field(ge=0.0, le=1.0)
    rationale: str


class PresetSignature(BaseModel):
    format: str
    ndim: int = Field(ge=0)
    native_dim_labels: list[str] = Field(default_factory=list)
    axis_order_hint: list[str] = Field(default_factory=list)


class MappingPreset(BaseModel):
    preset_id: str
    name: str
    project_scope: str
    signature: PresetSignature
    default_dims: list[CanonicalDim] = Field(default_factory=list)
    default_grouping_mode: GroupingMode = "separate"
    default_tab_mode: TabMaterializationMode = "single_tab"
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    rationale: str = ""
    last_used_at: str | None = None


class IngestInspection(BaseModel):
    inspection_id: str
    expires_at: str
    files: list[FileInference] = Field(default_factory=list)
    grouping_candidates: list[GroupingCandidate] = Field(default_factory=list)
    global_warnings: list[str] = Field(default_factory=list)
    preset_suggestions: list[MappingPreset] = Field(default_factory=list)


class FileMappingDecision(BaseModel):
    raw_input_id: str
    dims: list[CanonicalDim] = Field(default_factory=list)
    ignore: bool = False
    data_id: str | None = None
    dataset_path: str | None = None
    dataset_paths: list[str] = Field(default_factory=list)
    key_stack_axis: CanonicalDim | None = None
    sphere_axis: int | None = Field(default=None, ge=0)


class MappingDecision(BaseModel):
    grouping_mode: GroupingMode = "separate"
    file_mappings: list[FileMappingDecision] = Field(default_factory=list)
    tab_mode: TabMaterializationMode = "single_tab"
    combined_data_id: str | None = None
    use_preset_id: str | None = None


class IngestPlanRequest(BaseModel):
    inspection_id: str
    decision: MappingDecision


class IngestDatasetPlan(BaseModel):
    dataset_id: str
    source_input_ids: list[str] = Field(default_factory=list)
    canonical_dims: list[CanonicalDim] = Field(default_factory=list)
    projected_shape: list[int] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    strict_errors: list[str] = Field(default_factory=list)


class IngestPlan(BaseModel):
    plan_id: str
    inspection_id: str
    expires_at: str
    grouping_mode: GroupingMode
    tab_mode: TabMaterializationMode
    datasets: list[IngestDatasetPlan] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    is_valid: bool = True


class IngestCommitRequest(BaseModel):
    plan_id: str


class IngestCommitResponse(BaseModel):
    created_data_ids: list[str] = Field(default_factory=list)
    tab_mode: TabMaterializationMode
    warnings: list[str] = Field(default_factory=list)
