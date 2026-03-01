# n'Cube Detailed Implementation Plan

## 1. Goal and Scope

n'Cube is an interactive visualization and analysis tool for high-dimensional imaging products with axes across:
- Spatial dimensions: up to 3 (`x`, `y`, optional `z`)
- Spectral dimension: frequency or wavelength (`nu` or `lambda`)
- Temporal dimension (`t`)
- Polarization dimension (`pol`)
- Posterior/sample dimension for uncertainty-aware products (`sample`)

Primary objective: deliver a polished, low-latency cube inspection experience for astronomy workflows, including linked views, overlays, and sample-based uncertainty summaries.

Out of scope for v1:
- Full source extraction / cataloging pipeline
- Interactive model fitting inside the viewer
- Multi-user real-time collaborative editing
- Remote/hosted dataset access and multi-tenant security hardening (v1 assumes local data only)

## 2. Product Requirements (What must be true)

### 2.1 Core user capabilities
1. Open large multidimensional cubes and inspect slices interactively.
2. Switch active axes quickly (spatial/spectral/temporal/polarization).
3. Play time and spectral movies with stable frame pacing.
4. Toggle polarization channels and derived polarization products.
5. Compose multi-frequency overlays and contour layers.
6. Compute and display ROI statistics, including sample-derived uncertainty.
7. Save, reload, and share reproducible sessions.

### 2.2 UX and performance requirements
1. Pan/zoom responsiveness feels immediate (target 60 FPS when feasible).
2. Slice change feedback under ~150 ms for cached/nearby data.
3. Movie playback supports deterministic frame pacing and smooth scrubbing.
4. Heavy operations provide progressive preview (coarse first, refined second).
5. Every visualized layer clearly exposes units, frame, axis metadata, and alignment status.
6. Performance is evaluated across defined hardware tiers, with acceleration paths enabled where available.

### 2.3 Science correctness requirements
1. WCS-aware alignment and reprojection across overlays.
2. Explicit interpolation policies and reprojection provenance.
3. Unit-safe axis/intensity transformations.
4. Sample statistics are reproducible and tied to exact sample sets.
5. Processing provenance is retained in session/export outputs.

### 2.4 Performance contract (v1)

1. **Hardware tiers (benchmark matrix)**
- **Tier 1 (Baseline):** 4-8 CPU cores, 16 GB RAM, integrated GPU.
- **Tier 2 (Target):** 8-12 CPU cores, 32 GB RAM, modern integrated or mid discrete GPU.
- **Tier 3 (Stretch):** 12+ CPU cores, 64 GB RAM, high-memory discrete GPU.

2. **Interaction SLOs by tier**
- **Warm slice latency (P95):** <=150 ms (Tier 1), <=100 ms (Tier 2), <=80 ms (Tier 3).
- **Pan/zoom:** interactive on all tiers, near-60 FPS on Tier 2 and Tier 3 where feasible.
- **Movie playback:** deterministic frame pacing on all tiers, with reduced resolution/quality fallback on Tier 1 if needed.

3. **Acceleration strategy**
- Renderer path is **WebGL-first** for v1.
- **WebGPU** may be supported behind an experimental feature flag and is not on the v1 critical path.
- Backend acceleration includes chunked I/O, async prefetch, vectorized/stat-streaming compute, and cached reprojection.
- Progressive quality (coarse preview -> refined result) is enabled for expensive operations.

4. **Benchmarking and reporting**
- Maintain a fixed benchmark pack: small, medium, and large cubes, plus one hard-case scenario (overlay + ROI uncertainty).
- Run all benchmarks with both cold-cache and warm-cache conditions.
- Report p50/p95 latency and memory ceilings per operation type and hardware tier.

## 3. Proposed System Architecture

### 3.1 High-level components
1. **Data Engine (Python):** Ingestion, normalization, chunked access, sample stats.
2. **Query/API Service (Python/FastAPI):** Low-latency slice/profile/stat requests.
3. **Rendering Client (TypeScript/React + WebGL, with optional experimental WebGPU):** Interactive rendering and UI.
4. **Session/Provenance Layer:** Serializable state and operation history.

### 3.2 Suggested technology stack
- **Backend:** Python, FastAPI, xarray, dask, zarr, astropy, reproject, h5py
- **Frontend:** TypeScript, React, renderer (WebGL-first; optional experimental WebGPU via vtk.js or custom)
- **Storage formats:** FITS and HDF5 inputs + Zarr internal working representation/cache
- **Testing:** pytest (backend), Playwright/Cypress + visual regression (frontend)

### 3.3 Data model (canonical internal schema)
All loaded products should normalize into a common schema:
- `data_id`: stable identifier
- `dims`: ordered dimensions in canonical order (subset of `sample,pol,t,nu,x,y,z`)
- `coords`: per-dim coordinates (values + units + spacing metadata)
- `wcs`: frame metadata + transforms
- `values`: chunked array handle
- `mask`: optional validity mask
- `uncertainty`: optional structure (`samples`, `weights`, derived summaries)
- `beam_psf`: optional instrument response metadata
- `provenance`: ingestion and transformation metadata

Validation rules:
1. Dimension names must be explicit and non-ambiguous.
2. Units must be attached to coordinates and intensity.
3. Missing-value semantics (`NaN`, mask, sentinel) must be normalized.
4. Axis monotonicity/irregularity must be declared.
5. Canonical axis order is `sample,pol,t,nu,x,y,z`; missing axes are omitted while preserving this order.
6. Spectral inputs must normalize to canonical frequency axis `nu` with explicit provenance of any conversion.

### 3.4 HDF5 support contract (first-class)
HDF5 ingestion must be deterministic and explicit. The implementation should define and enforce:

1. **Dataset mapping contract**
- Explicit mapping from HDF5 groups/datasets to canonical axes (`sample,pol,t,nu,x,y,z`).
- Required declaration of primary signal dataset and optional mask/uncertainty datasets.

2. **Metadata contract**
- Required attrs for units and coordinate semantics on each axis dataset.
- Required WCS/frame attrs (or deterministic fallback mapping rules when partial metadata exists).
- Required missing-data semantics (`_FillValue`, mask dataset, or documented fallback).

3. **Layout and performance contract**
- Accept both contiguous and chunked HDF5, but validate access cost.
- Define rechunk/convert-to-Zarr path for non-performant HDF5 layouts.
- Prohibit full in-memory materialization for large arrays by default.

4. **Validation and error contract**
- Clear errors for ambiguous axis mapping, missing units, or incomplete WCS metadata.
- Structured diagnostics indicating whether a file is directly usable or requires normalization.

## 4. Task Graph and Dependencies

Legend:
- **Inputs:** prerequisites and artifacts consumed
- **Outputs:** tangible deliverables
- **DoD:** Definition of Done / acceptance checks
- **Depends on:** upstream tasks

### T0. Product Contract and Interaction Spec
**Inputs:** stakeholder goals
**Outputs:**
- Workflow inventory (top science tasks)
- Interaction grammar (mouse/keyboard/shortcuts)
- UX quality bar + latency SLOs
- v1/v2 boundary

**DoD:**
1. Written, versioned spec approved by team.
2. Top 5 workflows represented as user scenarios.
3. Explicit latency targets assigned to each critical interaction.

**Depends on:** none

### T1. Canonical Data Schema and Metadata Contract
**Inputs:** T0 workflows
**Outputs:**
- Schema spec for axes, WCS, units, mask semantics, sample dimension
- HDF5 metadata and axis-mapping conventions
- Validation library and schema fixtures
- Error taxonomy for invalid/incomplete products

**DoD:**
1. Schema supports all required axis combinations.
2. Validation catches malformed axis/unit/WCS metadata.
3. Test fixtures include regular and irregular axis spacing across FITS and HDF5 inputs.

**Depends on:** T0

### T2. Data Ingestion + Internal Storage Pipeline
**Inputs:** T1 schema
**Outputs:**
- FITS, HDF5, and Zarr loaders
- Normalization into canonical schema
- Chunking and cache policy
- Optional conversion tools (FITS/HDF5 -> Zarr)

**DoD:**
1. Representative astro datasets ingest from FITS and HDF5 without manual intervention.
2. Read performance baseline captured for large cubes.
3. Metadata fidelity checks pass (units/WCS/axes preserved).

**Depends on:** T1

### T3. Query and Slice Service API
**Inputs:** T2 data access primitives
**Outputs:**
- Endpoints for 2D/3D slices, profiles, cursor probes
- ROI summary endpoints
- Histogram/stat endpoints
- API contract (OpenAPI + client bindings)

**DoD:**
1. Slice queries satisfy latency targets on benchmark datasets.
2. APIs are deterministic for identical requests.
3. Error responses are structured and actionable.

**Depends on:** T2

### T4. Registration and Reprojection Engine
**Inputs:** T1 schema, T2 data access
**Outputs:**
- WCS reprojection module for overlays
- Interpolation policies (nearest/bilinear/higher-order where appropriate)
- Alignment diagnostics (exact/regridded/mismatch)

**DoD:**
1. Reprojection correctness validated on known synthetic cases.
2. Diagnostic status surfaced per overlay.
3. Reprojection provenance captured for reproducibility.

**Depends on:** T1, T2

### T5. Rendering Core
**Inputs:** T3 APIs
**Outputs:**
- GPU-backed viewport renderer
- Tile/caching strategy
- Progressive rendering (preview/refine)

**DoD:**
1. Smooth pan/zoom in target hardware profile.
2. Slice interactions hit UX SLOs with warm cache.
3. Large data access degrades gracefully.

**Depends on:** T3

### T6. Viewer Shell and Global State
**Inputs:** T0 interaction spec, T5 renderer
**Outputs:**
- Main layout (viewport, layer stack, axis control, plots panel)
- State model for current cube, layer visibility, axis selections
- Session serialization format

**DoD:**
1. UI state round-trips via save/load.
2. All controls are keyboard accessible.
3. State transitions are consistent and undoable.

**Depends on:** T0, T5

### T7. Axis Navigation, Movies, and Polarization Controls
**Inputs:** T6 shell, T3 API
**Outputs:**
- Scrubbers for spectral/time axes
- Playback controller with loop modes and prefetch
- Polarization toggle groups and presets

**DoD:**
1. Playback remains smooth under defined dataset profile.
2. Axis switching preserves context where appropriate.
3. Pol toggles support instant visibility changes.

**Depends on:** T6, T3

### T8. Overlay and Compositing Pipeline
**Inputs:** T4 reprojection, T5 renderer, T6 shell
**Outputs:**
- Layer types: image, contour, mask, annotation
- Blend/opacity/z-order controls
- Multi-frequency color mapping modes + legends

**DoD:**
1. Overlay alignment status is visible and reliable.
2. Color-frequency mapping is interpretable (legend + units).
3. Compositing rules are consistent across layer types.

**Depends on:** T4, T5, T6

### T9. Sample-Aware Uncertainty Pipeline
**Inputs:** T3 APIs, T6 shell
**Outputs:**
- On-demand sample summaries (mean/std/quantile/credible intervals)
- ROI uncertainty computations
- Display of uncertainty bands in linked plots

**DoD:**
1. Sample statistics are reproducible with fixed seeds/order.
2. Weighted/unweighted sample handling is explicit.
3. Compute paths support progressive feedback for large sample counts.

**Depends on:** T3, T6

### T10. Linked Analysis Tools
**Inputs:** T7 interactions, T9 uncertainty
**Outputs:**
- Linked crosshair and ROI synchronization
- Spectral/time profile panels tied to viewport selection
- Derived quick products (projections/moments if in scope)

**DoD:**
1. Cross-panel interactions remain in sync.
2. ROI edits immediately propagate to derived plots.
3. Analysis operations preserve provenance metadata.

**Depends on:** T7, T9

### T11. Performance Engineering and Hardening
**Inputs:** T8 overlays, T10 linked tools
**Outputs:**
- Profiling dashboards/benchmarks
- Tuned cache/prefetch/chunk parameters
- Failure handling and recovery pathways
- Hardware-tier performance matrix and acceleration strategy (GPU/vectorized paths where available)

**DoD:**
1. SLO compliance report on target datasets across defined hardware tiers.
2. Memory ceilings and backpressure behavior documented.
3. No blocking UI stalls for expected workflows.

**Depends on:** T8, T10

### T12. Validation, Regression, and Reproducibility
**Inputs:** T8, T9, T10 capabilities
**Outputs:**
- Golden-image and numeric regression suite
- Synthetic truth datasets for reprojection/stat checks
- Session replay tests

**DoD:**
1. Scientific correctness checks pass for key transformations.
2. Visual regressions are detectable and actionable.
3. Session replay reproduces equivalent state and outputs.

**Depends on:** T8, T9, T10

### T13. Export and Sharing
**Inputs:** T12 stable behavior
**Outputs:**
- Figure and movie export pipeline
- Session share artifacts
- Embedded provenance in exports

**DoD:**
1. Exports match viewport state and chosen overlays.
2. Export metadata is complete enough to reproduce figures.
3. Common publication settings are available as presets.

**Depends on:** T12

## 5. Dependency Summary

### 5.1 Critical path
`T0 -> T1 -> T2 -> T3 -> T5 -> T6 -> T7 -> T10 -> T11 -> T12 -> T13`

### 5.2 Parallelizable tracks
1. `T4` can start after `T1+T2` and run in parallel with `T5/T6`.
2. `T8` and `T9` can run in parallel once dependencies are met.
3. Validation scaffolding can begin early, full gating at `T12`.

## 6. Work Package Breakdown (Actionable Backlog)

### WP-A Foundation
Tasks: T0, T1, T2
- Establish non-negotiable contracts: UX, schema, ingestion.
- Exit condition: representative datasets load into canonical form with validated metadata.

### WP-B Interactive Core
Tasks: T3, T5, T6, T7
- Build thin interactive vertical slice.
- Exit condition: user can inspect cube slices, switch axes, and play time/spectral movies smoothly.

### WP-C Science Features
Tasks: T4, T8, T9, T10
- Add correctness-heavy overlay and uncertainty behavior.
- Exit condition: aligned overlays, contour composition, uncertainty-aware ROI workflows.

### WP-D Production Readiness
Tasks: T11, T12, T13
- Make the system robust, measurable, and reproducible.
- Exit condition: SLO compliance and validated export/share pipeline.

## 7. Cross-Cutting Concerns (Must be integrated throughout)

1. **Observability:** trace latency by operation type (slice, reprojection, ROI stats, playback frame fetch).
2. **Provenance:** every transform and derived product records parameters and source IDs.
3. **Accessibility:** keyboard-first control and readable color/contrast options.
4. **Configurability:** central config for chunk sizes, cache budgets, interpolation defaults.
5. **Error UX:** user-facing diagnostics for missing metadata, misalignment, and partial failures.
6. **Security and privacy:** v1 assumes local datasets only; define authn/authz and audit controls when remote support is introduced.

## 8. Acceptance Test Matrix

Minimum acceptance scenarios:
1. Load a 4D+ cube from FITS and HDF5 with WCS and inspect arbitrary slices.
2. Play temporal sequence while toggling overlays without visible UI stalls.
3. Switch polarization channels and preserve per-channel display settings.
4. Overlay two frequencies with reprojection and contour layer; verify alignment diagnostics.
5. Draw ROI and view mean + quantile uncertainty from sample dimension.
6. Save session, reload it, and reproduce same viewport/analysis state.
7. Export figure/movie with provenance metadata.

## 9. Risks and Mitigation

1. **Risk:** Reprojection cost causes interaction lag.
   - **Mitigation:** precompute aligned pyramids for common views; async reproject with preview.
2. **Risk:** Large sample sets overwhelm compute/memory.
   - **Mitigation:** chunked/stat streaming, quantile approximations where acceptable, caching.
3. **Risk:** UI complexity reduces usability.
   - **Mitigation:** strict interaction grammar and progressive disclosure of advanced controls.
4. **Risk:** Inconsistent metadata in real-world FITS files.
   - **Mitigation:** normalization + validation + clear remediation prompts.
5. **Risk:** HDF5 layout and metadata variability breaks deterministic ingestion.
   - **Mitigation:** strict HDF5 mapping contract, validation diagnostics, and a robust normalize-to-Zarr path.

## 10. Definition of Project Done

The project is considered complete when:
1. All tasks T0-T13 meet DoD and pass acceptance tests.
2. Performance SLOs are met on target hardware and benchmark datasets.
3. Science validation and visual regression suites pass in CI.
4. Users can reproduce and share analyses through saved sessions and export artifacts.
5. Backward compatibility between pre-release internal/session schema versions is not required for v1 (green-field).

## 11. Immediate Next Execution Steps

1. Create `docs/specs/interaction-contract.md` (T0 artifact).
2. Create `docs/specs/canonical-data-schema.md` (T1 artifact).
3. Create `docs/specs/hdf5-mapping-contract.md` (axis mapping, attrs, and validation rules).
4. Define hardware tiers and benchmark datasets, then scaffold a baseline benchmark harness.
5. Build a thin end-to-end spike: load FITS and HDF5 datasets -> fetch slice -> render viewport.
