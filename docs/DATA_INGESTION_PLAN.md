# Data Ingestion Implementation Plan

Status note:

- The inspect/plan/commit ingest flow described here has largely shipped.
- Multi-file intent selection, HDF5 key selection, guided axis mapping, strict combine validation, and preset suggestions are part of the current codebase.
- The remaining sections are kept as design/history context rather than a statement of missing functionality.

## Context

Current ingest behavior is centered on the implemented inspect/plan/commit workflow:

- Supported loaders: HDF5 (`.h5`, `.hdf5`), FITS (`.fits`, `.fit`, `.fts`), Zarr (`.zarr` folder path).
- Canonical axis model: `sample, pol, t, nu, x, y, z`.
- Guided axis mapping uses a drag-and-drop mapper in source-axis order.
- Multi-file imports require explicit user intent before datasets/tabs are materialized.

This plan defines the next ingest architecture so users can provide more varied data while controlling how files map into datasets and axes.

## Goals

1. Make ingest flexible across single-file and multi-file inputs without forcing one interpretation.
2. Aggressively infer structure from file metadata, headers, and filenames, but never auto-commit ambiguous structure.
3. Replace text-only axis mapping with guided button-driven mapping.
4. Require explicit user confirmation before dataset/tab materialization.
5. Keep canonical internal axis contract unchanged (`sample, pol, t, nu, x, y, z`).

## Explicitly Deferred

1. Cross-channel resolution alignment/resampling policy engine.
2. Coordinate system transformation/reprojection design in ingest.

These are planned for a later milestone.

## Design Principles

1. Parse first, commit later: inference and preview must be separate from dataset creation.
2. User intent wins: precedence is `User > in-file metadata > filename/folder metadata > header heuristics > positional guess`.
3. No implicit tab proliferation: multi-file import behavior is user-selected.
4. Provenance on every decision: inferred mappings and confidence sources are stored.
5. Reproducible imports: mapping presets can be reused.
6. Safe ambiguity defaults: low-confidence grouping defaults to separate datasets.
7. No silent shape repair: combine operations fail on incompatibility unless user explicitly changes policy in a future milestone.

## Locked v1 Decisions

1. Inspect sessions are in-memory only for v1 with TTL-based expiration (`30 minutes`).
2. Low-confidence multi-file ingest defaults to `Create separate datasets`.
3. Multi-file combine uses strict shape compatibility checks and fail-fast errors (no implicit pad/trim/resample).
4. No legacy endpoint compatibility work is required in this phase.
5. Delivery order is backend inspect/plan/commit first, then frontend dialog wiring.

## Target User Flows

### Flow A: Single file with strong metadata

1. User selects file.
2. System suggests mapping with high confidence.
3. User confirms or adjusts.
4. System imports and materializes dataset.

### Flow B: Single file with weak metadata

1. User selects file.
2. System provides low-confidence guess.
3. User assigns axes via buttons (`Set X`, `Set Y`, `Set t`, `Set nu`, `Set sample`, `Set pol`, `Ignore`).
4. User confirms import preview.

### Flow C: Multiple files

1. User selects/drops multiple files.
2. System parses all files and proposes import modes (for example: files as `sample`, files as `t`, files as `nu`, files as `channel`, separate datasets).
3. User selects mode and adjusts mapping.
4. System previews resulting dataset count and shape.
5. User confirms import; only then create datasets/tabs.

## Ingestion Architecture

### Phase 1: Inspect (read-only)

Input:
- One or more file paths/uploads.

Output:
- `IngestInspection` bundle containing per-file metadata, inferred dims, candidate groupings, confidence scores, and conflicts.
- `inspection_id` and `expires_at` for short-lived in-memory planning sessions.

### Phase 2: Plan (user-driven mapping)

Input:
- Inspection result + user mapping decisions.

Output:
- `IngestPlan` describing concrete datasets to create, axis mappings, joins/grouping, and warnings.

### Phase 3: Commit (materialize)

Input:
- Approved plan.

Output:
- Registered datasets + UI materialization instructions (tab behavior based on user-selected mode).

## Data Model Additions

Add dedicated ingest models (Pydantic/dataclass) in service/data layer:

1. `RawInputRef`
- `id`, `name`, `source_type`, `path_or_upload_ref`.

2. `ParsedArrayInfo`
- `shape`, `dtype`, `ndim`, native dim labels (if present), format-specific metadata.

3. `AxisCandidate`
- `target_dim` (`sample|pol|t|nu|x|y|z`), `score`, `reason`, `source` (`header|filename|embedded|heuristic`).

4. `FileInference`
- per-file candidates, conflicts, recommended mapping, confidence.

5. `GroupingCandidate`
- interpretation of file set (`files_as_sample`, `files_as_t`, `files_as_nu`, `files_as_channel`, `separate`), score, rationale.

6. `IngestInspection`
- `inspection_id`, `expires_at`, list of `FileInference`, grouping candidates, global warnings.

7. `MappingDecision`
- user-confirmed mapping for columns/dims/tokens and grouping mode.

8. `IngestPlan`
- resulting dataset specs, canonical dims, projected shapes, strict compatibility errors, warnings.

9. `PresetSignature`
- stable fingerprint of reusable layout traits (format, ndim, dim labels/order hints, selected header keys), intentionally independent of file count.

10. `MappingPreset`
- saved user mapping/grouping defaults keyed by `PresetSignature`, with provenance and last-used metadata.

## Inference Engine

### Inputs

1. Format metadata (FITS CTYPE/CUNIT/WCS, HDF5/Zarr attrs).
2. Header-like labels from supported tabular loaders (future CSV/XLSX work).
3. Filename and folder tokens (regex + delimiter tokenization).
4. Numeric heuristics (monotonic coordinate-like vectors, datetime parsing, categorical uniqueness).

### Confidence strategy

1. Compute per-axis and per-grouping score in `[0,1]`.
2. Mark confidence tiers:
- High: `>= 0.85`
- Medium: `>= 0.60 and < 0.85`
- Low: `< 0.60`
3. If multiple candidates are within a small margin (for example `<= 0.10`), mark as ambiguous and require explicit user decision.

### Conflict handling

When sources disagree (for example filename indicates `t`, header indicates `nu`):

1. Surface conflict row with each source and value.
2. Default to source precedence rules.
3. Allow user override and persist override in plan provenance.

### Preset matching and reuse

1. Build a file-layout signature from metadata that excludes file count.
2. On inspect, look up prior `MappingPreset` candidates by signature similarity and rank by confidence.
3. Auto-suggest (never auto-commit) a prior preset when the signature match is strong, even if the current file count differs.
4. Show why the preset matched and allow one-click accept or edit.

## API Changes

Add new endpoints (names can be adjusted during implementation):

1. `POST /api/ingest/inspect`
- Accept one or many files/paths.
- Return `IngestInspection`.

2. `POST /api/ingest/plan`
- Accept `inspection_id` + `MappingDecision`.
- Return `IngestPlan`.

3. `POST /api/ingest/commit`
- Accept approved `IngestPlan`.
- Materialize datasets and return created dataset ids + materialization hints.

## Frontend Changes

Primary file: `src/mobula/static/app.js` (split by concern if needed).

### New ingest UI

1. Ingest wizard dialog window with steps:
- Inspect
- Map
- Preview
- Commit

2. Button-driven axis assignment:
- Per field card: `Set sample`, `Set pol`, `Set t`, `Set nu`, `Set x`, `Set y`, `Set z`, `Ignore`.

3. Multi-file intent selector:
- `Combine into one dataset`
- `Create separate datasets`
- `Treat file identity as axis` (choose axis)
- Default when grouping confidence is low: `Create separate datasets`

4. Preview panel:
- Resulting dims and shapes.
- Dataset/tab count.
- Missing combinations and warnings.

### Tab creation behavior

Replace current implicit multi-file tab creation flow with:

1. Default: no tab creation until commit.
2. Post-commit behavior controlled by user choice:
- Single tab active dataset
- Multiple tabs (one per created dataset)

## Loader Roadmap

### Immediate (within this plan)

1. Keep existing FITS/HDF5/Zarr loaders and wrap them with inspect/plan/commit orchestration.
2. Improve metadata extraction reuse from `loaders.py` in inspect stage (without full registration).

### Next extension (after orchestration is stable)

1. Add tabular loaders for CSV/TSV/XLSX with column/header-based mapping.
2. Integrate table-specific axis candidate generation.

## Milestones

### M1 - Foundations

1. Add ingest models.
2. Build inspect service for current formats.
3. Add confidence/conflict primitives.
4. Add in-memory inspect session store with expiration.

Acceptance:

1. Inspection works for single and multi-file FITS/HDF5/Zarr inputs.
2. No dataset is registered during inspect.
3. Inspect response includes valid `inspection_id` + `expires_at`.

### M2 - Plan/Commit Backend

1. Add plan endpoint with explicit mapping decisions.
2. Add commit endpoint with provenance capture.
3. Enforce strict shape compatibility checks for combine modes.

Acceptance:

1. User decisions deterministically produce expected dims/order.
2. Commit creates datasets only after explicit approval.
3. Incompatible combines fail with actionable preview errors.

### M3 - Frontend Wizard

1. Replace prompt-based axis mapping with dialog wizard.
2. Add multi-file interpretation controls.
3. Add import preview and confirmation gate.

Acceptance:

1. No automatic tab creation on multi-file drop before confirmation.
2. Manual mapping is fully possible without free-text input.
3. Low-confidence multi-file defaults to separate datasets in the UI.

### M4 - Hardening

1. Smart preset reuse for repeated file layouts (including changed file counts).
2. Better error messaging and conflict UX.
3. Metrics instrumentation (acceptance vs override rates).

Acceptance:

1. High-confidence suggestions are accepted frequently.
2. Override flow remains low-friction for ambiguous data.
3. Prior mappings are suggested when layout signatures match, even with different numbers of input files.

## Testing Plan

1. Unit tests:
- inference scoring
- conflict resolution
- plan validation

2. API tests:
- inspect/plan/commit happy paths
- ambiguous mappings requiring override
- multi-file grouping modes
- strict shape incompatibility failures for combine modes
- in-memory inspection TTL expiration behavior

3. UI tests:
- wizard step transitions
- button-driven axis assignment
- preview correctness
- no auto-tabs before commit

4. Preset tests:
- preset signature generation is stable for same layout across different file counts
- matching logic suggests prior mapping when signature similarity is high
- suggested preset remains editable before commit

## File-Level Implementation Map

Likely touchpoints:

1. `src/mobula/data/loaders.py`
- expose reusable metadata inspection helpers.

2. `src/mobula/service/api_models.py`
- add ingest request/response models.

3. `src/mobula/service/api_routes_core.py` (or new `api_routes_ingest.py`)
- add inspect/plan/commit routes.

4. `src/mobula/service/registry.py`
- add commit integration path.

5. `src/mobula/static/app.js`
- replace prompt flow and multi-file auto-tab logic with wizard flow.

6. `docs/DATA_LOADING.md`
- document new ingest flow, strict combine behavior, and preset suggestion behavior.

7. `docs/API.md`
- document new ingest endpoints and payloads.

## Open Questions

1. Do we need explicit user-defined custom axis labels beyond canonical dims in this phase?
2. Should v1 mapping presets be per-project only, or also support per-folder scope?
