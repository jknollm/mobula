# Refactoring Plan

This document is the working plan for refactoring mobula into a more maintainable, well-documented, and performance-focused codebase without destabilizing current features.

It is intentionally incremental. The goal is not to rewrite the application. The goal is to reduce technical debt, improve clarity, and create the engineering guardrails needed to keep the app fast and trustworthy as it grows.

This plan assumes a pre-release posture. The project is not yet deployed, so backward-compatibility is not a standing constraint. Internal APIs, module boundaries, file layout, and frontend contracts may change when doing so produces a simpler, cleaner design. User-visible behavior should still be changed deliberately and documented, but compatibility for its own sake is not a goal.

## Why This Plan Exists

The repository is currently in a strong feature state, but the implementation has several structural pressure points:

- Frontend logic is heavily concentrated in [src/mobula/static/app.js](../src/mobula/static/app.js).
- Backend view and ingest logic are concentrated in [src/mobula/service/view_service.py](../src/mobula/service/view_service.py) and [src/mobula/service/ingest_service.py](../src/mobula/service/ingest_service.py).
- Browser-side behavior is only lightly protected by automation.
- The user-facing behavior contract in [docs/EXPECTED_BEHAVIOR.md](./EXPECTED_BEHAVIOR.md) is still sparse.
- Frontend assets currently exist in both [src/mobula/static](../src/mobula/static) and [static](../static), which makes source-of-truth ownership unclear.
- Performance on demo paths is good, but large payload transfer and serialization costs are likely to become limiting factors on real datasets.

This plan assumes that feature work continues, but major refactoring is staged so the product stays usable and measurable throughout.

## Refactoring Principles

- Preserve behavior first. Structural cleanup should not quietly change the product contract.
- Prefer clean breaks over legacy shims when a refactor exposes a better design.
- Prefer extraction over rewrite. Create seams around existing logic before replacing internals.
- Measure before optimizing. Performance work should follow instrumentation, not guesses.
- Keep source-of-truth clear. Each asset, dependency declaration, and behavior contract should have one canonical home.
- Land changes in reviewable slices. Large mechanical moves should still produce understandable diffs.
- Expand the plan when necessary. If refactoring exposes adjacent debt that should be cleaned up, add it explicitly rather than working around it indefinitely.

## Current Baseline

Baseline observations captured on March 6, 2026:

- Demo benchmark on `movie-2d-pol-hd`:
  - JSON slice transport: `p50 66.55 ms`, `p95 98.57 ms`
  - binary slice transport: `p50 4.26 ms`, `p95 4.71 ms`
  - ROI stats: `p50 2.16 ms`, `p95 13.31 ms`
- Representative payload sizes:
  - demo 2D slice: JSON `421,870 B` raw vs binary `88,916 B` raw
  - large 2D slice: JSON `41,045,325 B` raw vs binary `8,447,596 B` raw
  - medium 3D volume response: JSON `7,369,700 B` raw vs binary `1,438,196 B` raw

Interpretation:

- The backend is not currently in crisis on demo paths.
- The bigger performance risk is transport, serialization, and browser-side processing for large views.
- Refactoring should therefore be measurement-first, not rewrite-first.
- Because the project is pre-release, those measurements can justify breaking internal compatibility if that produces a leaner architecture.

## Implementation Update

Status as of March 6, 2026:

- Phase 0 completed:
  - [EXPECTED_BEHAVIOR](./EXPECTED_BEHAVIOR.md), [ARCHITECTURE](./ARCHITECTURE.md), and [PERFORMANCE_BASELINE](./PERFORMANCE_BASELINE.md) now capture the product contract, architectural invariants, and baseline measurements.
- Phase 1 completed:
  - CI, ruff, targeted mypy, browser smoke coverage, and browser contract checks for dataset reset, plane reset, and playback refinement are in place.
- Phase 2 completed:
  - `src/mobula/static/` is the canonical frontend asset tree and `pyproject.toml` is the dependency source of truth.
- Phase 3 completed for round 2:
  - `app.js` now delegates shared constants, DOM lookup, state normalization, perf collection, and playback orchestration to dedicated browser modules.
- Phase 4 completed for round 2:
  - view payload logic is split under `src/mobula/service/views/`, and ingest session/preset/model plus inspect/plan/commit orchestration are extracted under `src/mobula/service/ingest/`.
- Phase 5 completed:
  - backend timing headers, browser-side fetch/render instrumentation, and devtools state snapshots are available in development.
- Phase 6 second round completed:
  - larger JSON responses are gzip-compressed, slice/volume endpoints support binary scalar transport, and refreshed benchmarks now quantify the transport win directly.
- Phase 7 maintenance rules adopted:
  - development and contribution docs now point to the current checks and source-of-truth policy.

## Success Criteria

The refactor should be considered successful when all of the following are true:

- Core user-visible behavior is documented and testable.
- Frontend logic is split into coherent modules with clear ownership.
- Backend services are organized by domain capability instead of historical accumulation.
- Performance is tracked with explicit metrics rather than anecdotal feel alone.
- The repository has one source of truth for static assets, dependencies, and development workflow.
- Large datasets degrade gracefully rather than causing opaque stalls.

## Phased Plan

### Phase 0: Contract And Baseline

Objective: define what must not regress before code is moved around.

Primary deliverables:

- Expand [docs/EXPECTED_BEHAVIOR.md](./EXPECTED_BEHAVIOR.md) into a concrete product contract.
- Capture current architectural invariants in [docs/ARCHITECTURE.md](./ARCHITECTURE.md).
- Add a dedicated performance baseline document, for example `docs/PERFORMANCE_BASELINE.md`.

Behavior topics that should be documented explicitly:

- dataset switching: what resets, what persists
- plane switching and axis mapping semantics
- ROI creation, movement, resizing, and linked profile updates
- color normalization behavior across quantity and mode changes
- playback behavior, preview quality, and refinement rules
- volume and sphere mode validity and guardrails
- ingest wizard step transitions, warnings, and recovery paths
- export and save behavior, including format limitations

Exit criteria:

- The team can decide whether a change is a regression by reading docs, not by relying on memory.
- The top workflows are described in user-facing language.
- Current latency and payload baselines are written down and versioned.

### Phase 1: Tooling And Safety Net

Objective: make refactoring safe and repeatable.

Primary deliverables:

- Add Python linting and formatting configuration in [pyproject.toml](../pyproject.toml).
- Add incremental type checking for stable, high-value modules.
- Add CI to run automated checks on every change.
- Add a minimal browser smoke suite for the most important workflows.

Recommended first checks:

- `pytest`
- Python lint
- formatting check
- browser smoke tests for:
  - app load
  - dataset change
  - slice render
  - ROI/profile interaction
  - volume or sphere mode on a compatible dataset

Notes:

- Type checking should start narrowly, not across the entire codebase at once.
- Browser tests should begin as smoke coverage, not a large end-to-end matrix.

Exit criteria:

- Refactor changes run against the same checks locally and in CI.
- Core UI workflows have at least minimal automated protection.
- New structural work can be reviewed with lower regression risk.

### Phase 2: Repository Hygiene And Source-Of-Truth Cleanup

Objective: remove ambiguous ownership before deeper refactoring begins.

Primary deliverables:

- Choose one canonical frontend asset tree.
- Update static asset loading rules and docs to match that choice.
- Define a single source of truth for dependencies.
- Tighten development workflow documentation.

Required decisions:

- Canonical static asset source:
  - recommended: [src/mobula/static](../src/mobula/static)
- Secondary dependency file policy:
  - recommended: [pyproject.toml](../pyproject.toml) is primary
  - [requirements.txt](../requirements.txt) is generated or explicitly secondary

Follow-up work:

- Update [src/mobula/main.py](../src/mobula/main.py) comments and docs if fallback behavior changes.
- Document the intended developer workflow in [docs/DEVELOPMENT.md](./DEVELOPMENT.md).

Exit criteria:

- There is one clear answer to "where do I edit frontend assets?"
- There is one clear answer to "where do dependencies live?"
- New contributors do not need repo folklore to avoid touching the wrong copy of a file.

### Phase 3: Frontend Decomposition

Objective: break the browser-side monolith into coherent modules without changing behavior.

Primary target:

- [src/mobula/static/app.js](../src/mobula/static/app.js)

Strategy:

- Extract pure functions first.
- Extract state management and domain controllers second.
- Keep a thin composition root last.
- Avoid framework migration during this phase.

Suggested module boundaries:

- `viewer_constants.js`
  - defaults
  - color ramps
  - plane metadata
- `viewer_state.js`
  - state creation
  - normalization
  - snapshot/restore
- `viewer_axes.js`
  - axis labels
  - axis settings
  - coordinate mapping
- `viewer_geometry.js`
  - fit/cover rules
  - draw rectangle math
  - zoom and pan transforms
- `viewer_playback.js`
  - timers
  - playback pacing
  - preview budget control
- `viewer_selection.js`
  - ROI state
  - drag state
  - selection transforms
- `viewer_profiles.js`
  - profile request orchestration
  - chart-specific data handling
- `viewer_ingest.js`
  - ingest wizard state and transitions
- `viewer_export.js`
  - save image flow
  - save movie flow
  - render movie flow
- `viewer_render.js`
  - top-level render dispatch
  - CPU/GPU path selection
- `viewer_dom.js`
  - element lookup
  - UI binding

Rules for this phase:

- No product redesign in the same PR as structural extraction.
- Keep modules small enough to reason about in review.
- Prefer moving tested or pure logic before moving highly stateful event code.
- Keep behavior identical unless a separate change explicitly updates the product contract.
- Do not preserve legacy shapes, parameter names, saved-state formats, or module boundaries unless they still earn their keep.

Exit criteria:

- [src/mobula/static/app.js](../src/mobula/static/app.js) becomes a composition layer instead of a logic dump.
- Frontend responsibilities are grouped by domain.
- New features no longer need to be added to one global file by default.

### Phase 4: Backend Service Decomposition

Objective: separate routing, computation, validation, and serialization concerns.

Primary targets:

- [src/mobula/service/view_service.py](../src/mobula/service/view_service.py)
- [src/mobula/service/ingest_service.py](../src/mobula/service/ingest_service.py)
- [src/mobula/service/api_routes_views.py](../src/mobula/service/api_routes_views.py)

Suggested backend split:

- `service/views/slice.py`
- `service/views/volume.py`
- `service/views/multispectral.py`
- `service/views/evpa.py`
- `service/views/export.py`
- `service/views/serialization.py`
- `service/ingest/inspect.py`
- `service/ingest/plan.py`
- `service/ingest/commit.py`
- `service/ingest/session_store.py`
- `service/ingest/presets.py`

Refactor rules:

- Route modules should validate and dispatch, not own business logic.
- Compute functions should return typed internal results where practical.
- Serialization should be separated from numeric computation.
- Shared validation should not live only inside route files.

Why this matters:

- Current hot endpoints combine selection logic, numeric work, and JSON shaping.
- That makes it hard to isolate performance issues and increases review complexity.

Exit criteria:

- Route files are small and predictable.
- View and ingest logic are grouped by capability.
- Serialization cost can be reasoned about independently from computation cost.

### Phase 5: Performance Instrumentation

Objective: measure where latency and stutter actually come from.

Backend metrics to add:

- request duration by endpoint
- compute duration
- serialization duration
- response size
- dataset load or materialization duration
- cache hit or miss indicators where caching exists

Frontend metrics to add:

- fetch duration
- JSON parse duration
- render duration
- time to first visible update after interaction
- frame pacing during playback
- dropped frames during pan, zoom, and playback

Implementation guidance:

- Start lightweight with `time.perf_counter()` on the backend and `performance.mark()` in the browser.
- Expose metrics in development before worrying about production-grade telemetry.
- Keep benchmark results in versioned docs so regressions are visible over time.

Exit criteria:

- Slow interactions can be explained by data, not intuition.
- The team can distinguish compute cost from transport and rendering cost.

### Phase 6: Performance Optimization

Objective: improve responsiveness only after metrics identify the highest-value targets.

Priority order:

1. reduce payload size
2. reduce browser main-thread work
3. optimize compute paths
4. improve caching and prefetch behavior

High-value likely candidates:

- Reduce or replace giant JSON float array responses for large slices and volumes.
- Tighten adaptive resolution defaults for heavy datasets.
- Use progressive preview and refinement more consistently.
- Avoid repeated `.tolist()` conversion in hot response paths when payloads are large.
- Reuse decoded or render-ready client buffers where possible.
- Make playback quality explicitly adaptive under load.

Possible medium-term architecture changes:

- binary transport for slices and volumes
- tiled slice transport
- cached derived views for repeated access patterns
- server-generated preview representations for very large data

Compatibility note:

- Pre-release status means transport or API cleanup does not need to preserve old request or response shapes unless there is a deliberate reason to do so.

Exit criteria:

- Large datasets remain usable with graceful degradation.
- Performance targets are written, measured, and improving against the baseline.

### Phase 7: Documentation And Maintenance Rules

Objective: keep the codebase from drifting back into the same shape.

Primary deliverables:

- Update [docs/ARCHITECTURE.md](./ARCHITECTURE.md) after each major structural phase.
- Add module-level documentation for major backend and frontend subsystems.
- Record important architectural decisions in short ADR-style notes.
- Tighten contributor guidance in [docs/DEVELOPMENT.md](./DEVELOPMENT.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

Recommended maintenance rules:

- New user-visible behavior updates [docs/EXPECTED_BEHAVIOR.md](./EXPECTED_BEHAVIOR.md).
- New performance-sensitive features add a benchmark, metric, or measurement note.
- Composition-root files should stay thin.
- Shared logic should move into domain modules instead of growing monolith entry points.

Exit criteria:

- Documentation reflects the actual structure of the codebase.
- New technical debt becomes visible earlier in code review.
- The project has an explicit maintenance model instead of relying on individual memory.

## Recommended Milestones

Milestone 1:

- complete Phase 0
- complete Phase 1

Milestone 2:

- complete Phase 2

Milestone 3:

- frontend decomposition round 1 from Phase 3

Milestone 4:

- backend decomposition round 1 from Phase 4

Milestone 5:

- complete Phase 5 instrumentation
- refresh baseline numbers

Milestone 6:

- complete first optimization round from Phase 6

Milestone 7:

- complete Phase 7 cleanup and maintenance rule adoption

## Risks And Controls

Risk: frontend extraction causes subtle state regressions.
Control: expand behavior docs first and add browser smoke coverage before major moves.

Risk: asset tree cleanup breaks local development.
Control: document the source-of-truth decision and make fallback behavior explicit.

Risk: performance work changes scientific semantics.
Control: separate contract documentation and verification from optimization changes.

Risk: test effort grows too broad too early.
Control: begin with smoke coverage and add depth only where refactors expose risk.

Risk: opportunistic cleanup causes scope creep and stalls delivery.
Control: allow scope expansion when useful, but record each newly discovered refactor item in this plan or in a linked task list so growth stays explicit and reviewable.

## Immediate Next Actions

Recommended order for the next concrete steps:

1. expand [docs/EXPECTED_BEHAVIOR.md](./EXPECTED_BEHAVIOR.md)
2. add linting, formatting, and CI
3. resolve the dual static asset trees
4. begin extracting pure frontend helpers from [src/mobula/static/app.js](../src/mobula/static/app.js)
5. separate serialization from computation in [src/mobula/service/view_service.py](../src/mobula/service/view_service.py)

This plan should be updated as milestones complete and as measurement work reveals where the real cost centers are.
