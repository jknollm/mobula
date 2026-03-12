# Acceleration Implementation Plan

This document is the working implementation plan for cross-architecture acceleration in mobula.

The goal is not to "make everything GPU." The goal is to make the application fast, predictable, and inspectable across a wide range of machines while preserving a trustworthy CPU reference path.

This plan treats acceleration as a product capability, not a single backend choice.

## Why This Plan Exists

mobula  already uses browser-side GPU rendering for several viewer paths, but acceleration is uneven:

- slice, RGB, volume, and sphere display paths can use WebGL2 in `src/mobula/static/app.js` and `src/mobula/static/app_gpu.js`
- multispectral backend compute currently assumes `cpu` or `cuda/cupy`
- the current UI backend selector describes browser rendering, not all acceleration used by the app
- playback quality reduction lowers payload size and display cost, but the current multispectral backend still computes full-resolution RGB before downsampling

This creates three practical problems:

1. users cannot tell which backend is actually active
2. Apple Silicon and other non-CUDA machines are excluded from backend acceleration
3. some heavy operations stay expensive even when playback has switched to preview mode

## Product Goals

Acceleration work should satisfy all of the following:

- preserve a deterministic CPU baseline on every supported machine
- use acceleration where it materially improves responsiveness
- keep fallback behavior predictable and inspectable
- avoid architecture-specific dead ends that only help one hardware family
- improve movie playback and heavy view changes without making behavior harder to trust

## Non-Goals

This plan does not assume:

- a CUDA-only product architecture
- browser-only compute for all heavy operations
- a rewrite of the current viewer
- removal of CPU rendering or CPU compute paths

## Current State Summary

### Existing strengths

- Browser display acceleration already exists for slice, RGB, sphere, and volume rendering.
- Progressive playback preview and refinement already exist.
- Performance timing headers and browser-side perf collection already exist.
- The API already exposes `bands.compute_backend_requested` and `bands.compute_backend` for multispectral responses.

### Current gaps

- `buildMultispectralParams()` does not send `compute_backend`, so the frontend cannot explicitly control multispectral compute backend selection.
- The multispectral backend in `src/mobula/service/views/multispectral.py` chooses between CPU and CuPy/CUDA only.
- On Apple Silicon, CuPy/CUDA is not a viable acceleration path.
- Multispectral preview mode reduces `max_pixels`, but the backend currently downsamples only after full spectral-to-RGB computation.
- The UI does not clearly distinguish render backend from compute backend.

## Guiding Principles

- CPU is the source of truth.
- Auto-selection must be capability-driven and documented.
- Acceleration should be scoped per operation, not per application.
- Every accelerated path must have a defined fallback.
- Performance work must be tied to instrumentation and benchmark packs.
- Experimental backends must stay behind explicit feature flags until they are stable.

## Target Architecture

Acceleration should be split into three layers:

1. Render acceleration
   - browser display paths
   - initial target: WebGL2
   - optional future target: WebGPU behind a feature flag

2. Compute acceleration
   - backend transforms such as multispectral spectral-to-RGB conversion
   - candidate backends:
     - `cpu`
     - `cuda`
     - `metal`
     - optional future `rocm`

3. Transport acceleration
   - reduce serialization, wire size, and main-thread decode cost
   - binary formats where useful
   - preview downsampling before expensive compute when correctness allows

## Backend Model

The app should stop treating "GPU" as one generic backend.

### Required backend concepts

- `render_backend_requested`
- `render_backend_used`
- `compute_backend_requested`
- `compute_backend_used`
- `fallback_reason`
- `capability_snapshot`

### Required compute backend modes

- `auto`
- `cpu`
- `native`
- `cuda`
- `metal`

`native` means "best local accelerated backend for this machine." On Apple Silicon that should resolve to `metal` when available. On NVIDIA systems it should resolve to `cuda` when available.

### Required render backend modes

- `auto`
- `cpu`
- `gpu`

For render paths, `gpu` currently means WebGL2.

## Workstreams

### Workstream A: No-Regrets Algorithmic Improvements

These changes benefit every architecture and should land first.

#### A1. Downsample before multispectral conversion

Current issue:

- `src/mobula/service/views/multispectral.py` computes full-resolution multispectral RGB and only then downsamples via `_downsample_2d`.

Required change:

- move preview downsampling earlier in the pipeline so `max_pixels` reduces the size of the array passed through normalization, deslope, spectral conversion, and brightness scaling
- preserve `full_shape` and `sampling_step` metadata for UI and export correctness

Acceptance criteria:

- preview mode materially reduces multispectral compute time
- lower `max_pixels` lowers backend compute time, not just response size
- output remains visually consistent with the full-resolution path within expected preview tolerances

#### A2. Add multispectral stage timing

Required timings:

- extraction and axis projection
- optional preview downsampling
- spectrum normalization
- deslope weighting
- chroma preparation
- spectral-to-RGB conversion
- brightness scaling
- serialization

Implementation notes:

- extend existing perf helpers in `src/mobula/service/perf.py` or adjacent timing utilities
- expose timing in dev headers or debug payload fields only when appropriate

Acceptance criteria:

- developers can isolate whether playback is compute-bound, transport-bound, or render-bound

### Workstream B: Capability Detection And Backend Registry

This work creates a durable model for cross-architecture acceleration.

#### B1. Add backend capability probing

Backend probe responsibilities:

- detect CPU-only mode
- detect CUDA availability
- detect Metal-capable acceleration backend availability
- record version and device metadata where safe
- record why a backend is unavailable

Frontend probe responsibilities:

- detect WebGL2 support
- detect WebGPU support if experimental support is enabled
- preserve the current WebGL2 availability checks already present in viewer state

Suggested modules:

- `src/mobula/service/acceleration/registry.py`
- `src/mobula/service/acceleration/capabilities.py`
- `src/mobula/static/viewer_acceleration.js`

Acceptance criteria:

- backend and frontend can report capabilities independently
- `auto` selection is based on explicit capability data, not ad hoc checks buried inside view code

#### B2. Introduce a compute backend interface

Create a stable backend interface for multispectral conversion:

- input: normalized request config plus array payload
- output: RGB arrays and backend diagnostics

Suggested shape:

- `src/mobula/service/acceleration/compute_base.py`
- `src/mobula/service/acceleration/multispectral_cpu.py`
- `src/mobula/service/acceleration/multispectral_cuda.py`
- `src/mobula/service/acceleration/multispectral_metal.py`

Acceptance criteria:

- multispectral view code depends on an interface, not directly on CuPy
- CPU and accelerated backends produce comparable output under test

### Workstream C: Apple Silicon / Metal Compute Path

Apple GPU acceleration must use an Apple-native route, not CuPy.

#### C1. Add a Metal-backed multispectral compute adapter

Initial scope:

- multispectral spectral-to-RGB conversion only
- no immediate expansion to all backend compute paths

Requirements:

- isolate Apple-specific code behind the compute backend interface
- keep CPU parity tests mandatory
- provide a kill switch if the backend is unstable

Implementation constraints:

- prefer a small adapter layer over scattering platform checks across view code
- keep numerical tolerances explicit and documented

Acceptance criteria:

- Apple Silicon machines can accelerate multispectral compute when supported
- failure falls back to CPU cleanly
- diagnostics identify when Metal was attempted and why it did or did not run

### Workstream D: CUDA Backend Consolidation

The current CuPy/CUDA path should be preserved but moved behind the shared backend interface.

#### D1. Migrate existing CuPy path

Current code to migrate:

- `src/mobula/service/views/multispectral.py`
- `src/mobula/service/spectral_rgb.py`

Required outcomes:

- retain current CUDA acceleration behavior on supported NVIDIA systems
- remove CUDA-specific policy from general multispectral orchestration
- make CUDA one backend option, not the application model

Acceptance criteria:

- NVIDIA systems still benefit
- backend policy code does not assume CUDA is the only accelerated compute path

### Workstream E: UI And Product Contract

Users need to understand what the app is doing.

#### E1. Split render and compute controls

Current issue:

- the `Backend` selector in `src/mobula/static/index.html` refers to render backend behavior but reads as if it controls all acceleration

Required change:

- keep render backend controls for slice/viewer rendering
- add compute backend controls where relevant for multispectral and future heavy compute paths

Suggested UI model:

- `Render Backend`: `Auto`, `GPU`, `CPU`
- `Compute Backend`: `Auto`, `Native Accelerated`, `CPU`
- optional expanded debug detail:
  - effective render backend
  - effective compute backend
  - fallback reason

Acceptance criteria:

- users can distinguish display acceleration from compute acceleration
- backend status is visible without opening devtools

#### E2. Surface backend diagnostics

Required surfaced data:

- requested backend
- effective backend
- fallback reason
- whether preview mode is active

Suggested state updates:

- extend `viewer_state.js`
- keep `currentMultispectralBands` as the source of multispectral compute diagnostics
- add a general status area for effective backend display

Acceptance criteria:

- diagnosing "why is this slow?" no longer requires code inspection

### Workstream F: Transport And Serialization

Large payloads are already a known risk area.

#### F1. Review multispectral transport format

Current state:

- multispectral responses are JSON-only flattened channel arrays

Required evaluation:

- determine whether multispectral should gain a binary response mode similar to slice and volume payloads
- benchmark browser parse cost, serialization cost, and wire size tradeoffs before changing the contract

Acceptance criteria:

- any transport change is benchmarked against the current JSON path
- transport changes do not obscure backend behavior

## Implementation Phases

### Phase 0: Document And Instrument

Deliverables:

- this plan document
- explicit backend capability terminology in docs
- stage timing for multispectral requests

Files likely touched:

- `docs/EXPECTED_BEHAVIOR.md`
- `docs/USER_GUIDE.md`
- `docs/PERFORMANCE_BASELINE.md`
- `src/mobula/service/views/multispectral.py`
- `src/mobula/service/perf.py`

Exit criteria:

- current behavior and bottlenecks are documented
- developers can measure multispectral stage costs

### Phase 1: Universal Performance Fixes

Deliverables:

- early preview downsampling in multispectral compute
- frontend support for sending compute backend preference
- backend timing and diagnostics in the UI

Files likely touched:

- `src/mobula/service/views/multispectral.py`
- `src/mobula/static/app_requests.js`
- `src/mobula/static/app.js`
- `src/mobula/static/viewer_state.js`
- `src/mobula/static/index.html`

Exit criteria:

- CPU-only playback improves
- preview mode lowers multispectral compute work
- UI exposes effective backend for multispectral

### Phase 2: Backend Registry

Deliverables:

- capability probes
- compute backend registry
- documented `auto` selection policy

Files likely touched:

- `src/mobula/service/acceleration/*`
- `src/mobula/service/view_service.py`
- `src/mobula/service/views/multispectral.py`
- `docs/ARCHITECTURE.md`

Exit criteria:

- backend selection is centralized and testable
- `auto` is deterministic and inspectable

### Phase 3: Apple Silicon Acceleration

Deliverables:

- optional Metal-backed multispectral compute backend
- fallback logic and parity tests

Files likely touched:

- `src/mobula/service/acceleration/multispectral_metal.py`
- backend registry modules
- multispectral tests

Exit criteria:

- supported Apple Silicon machines can use accelerated multispectral compute
- CPU fallback remains reliable

### Phase 4: CUDA Consolidation

Deliverables:

- current CuPy logic moved behind backend interface
- unified backend diagnostics and policy

Files likely touched:

- `src/mobula/service/spectral_rgb.py`
- `src/mobula/service/acceleration/multispectral_cuda.py`
- backend registry modules

Exit criteria:

- CUDA path remains available
- CUDA is no longer special-cased in top-level multispectral orchestration

### Phase 5: Transport Review

Deliverables:

- benchmark-backed decision on multispectral binary transport
- optional binary response mode if justified

Files likely touched:

- `src/mobula/service/api_routes_views.py`
- `src/mobula/static/app_requests.js`
- `docs/API.md`
- `docs/PERFORMANCE_BASELINE.md`

Exit criteria:

- transport changes are benchmark-backed
- browser parse cost is measurable and improved where needed

### Phase 6: Experimental WebGPU Exploration

Deliverables:

- optional experimental render or compute path behind a feature flag
- benchmark comparison against WebGL2 and CPU

Constraints:

- not on the critical path for core acceleration work
- must not replace the WebGL2 baseline until proven stable

Exit criteria:

- experimental only
- no user-facing dependency on WebGPU

## Auto-Selection Policy

The application should use the following precedence for `auto`:

1. apply algorithmic cost reduction first
2. prefer stable local accelerated compute backend if available
3. otherwise use CPU compute
4. prefer browser GPU rendering where supported and beneficial
5. never select an experimental backend unless explicitly enabled

This policy should be documented in:

- `docs/EXPECTED_BEHAVIOR.md`
- `docs/USER_GUIDE.md`
- backend selection code

## Testing Strategy

### Unit tests

- backend capability parsing
- backend selection policy
- fallback reason generation
- preview downsampling correctness
- CPU vs accelerated multispectral parity within tolerance

Suggested files:

- `tests/test_multispectral_backends.py`
- `tests/test_spectral_rgb.py`
- `tests/test_api_endpoints.py`

### Integration tests

- API returns requested and effective compute backend fields
- invalid backend requests are rejected
- preview mode reduces shape before expensive conversion path

### Browser tests

- effective backend status is visible
- render backend and compute backend controls behave independently
- playback refinement still restores higher-quality frames after stop

## Benchmark Matrix

Benchmark the following environments whenever possible:

- CPU-only Linux
- CPU-only Windows
- Intel macOS
- Apple Silicon macOS
- NVIDIA CUDA system

Benchmark scenarios:

- single multispectral frame, small dataset
- single multispectral frame, large dataset
- spectral movie playback
- time movie playback in multispectral mode
- sample morph with multispectral active
- render-only operations with multispectral display

Required reported metrics:

- p50 and p95 request time
- stage timings for multispectral compute
- response bytes
- browser fetch, parse, and draw time
- dropped-frame estimate during playback

## Risks And Guardrails

### Risk: backend divergence

Mitigation:

- keep CPU as reference
- require parity tests for accelerated backends

### Risk: opaque fallback behavior

Mitigation:

- surface requested backend, effective backend, and fallback reason in UI and diagnostics

### Risk: architecture-specific complexity

Mitigation:

- isolate backend implementations behind a shared interface
- keep view orchestration free of platform-specific branches where possible

### Risk: performance regressions from transport changes

Mitigation:

- benchmark before changing API transport contracts

## Suggested Pull Request Sequence

1. Add backend diagnostics and multispectral stage timing.
2. Move multispectral preview downsampling earlier in the pipeline.
3. Send compute backend preference from the frontend and expose it in the UI.
4. Add backend registry and explicit `auto` policy.
5. Move current CuPy/CUDA code behind the registry.
6. Add Apple Silicon backend behind a feature flag.
7. Evaluate multispectral binary transport.
8. Explore experimental WebGPU support only after the prior steps are stable.

## Definition Of Success

This plan is complete when:

- multispectral playback is materially faster on CPU-only systems
- Apple Silicon and NVIDIA systems can both use local acceleration through the same product model
- users can see what backend the app actually used
- CPU fallback remains correct and reliable
- acceleration behavior is documented, benchmarked, and test-covered
