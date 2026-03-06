# Draft: A Multi-Domain Interactive Viewer for High-Dimensional Cube Data

## 1. Motivation

Scientific and technical cube datasets increasingly combine multiple analysis domains in one artifact: spatial structure (`x,y,z`), temporal evolution (`t`), spectral behavior (`nu`), polarization (`pol`), and repeated samples (`sample`). The challenge is not only dimensionality; it is coupling. Real scientific claims depend on how these domains interact.

In common workflows, these checks still happen across disconnected tools or weakly linked views. Analysts must repeatedly export data, rebuild region selections, and reconcile normalization choices. This slows hypothesis testing and makes interpretation harder to reproduce.

The core problem this project addresses is coordinated exploration across all domains, including uncertainty, without forcing users to leave one interaction environment.

## 2. Approach

`mobula` implements a local-first viewer and API around a canonical cube contract:

```text
sample, pol, t, nu, x, y, z
```

The system combines:

- A FastAPI backend for loading, validation, slicing, profiling, and export.
- A browser interface for linked visual and quantitative exploration.
- A canonical axis model that normalizes FITS/HDF5/Zarr inputs into one interaction grammar.

This design makes domain switching a UI event instead of a data conversion task. Crucially, `sample` is treated as an uncertainty domain that remains coupled to the same ROI and axis state used for signal interpretation.

## 3. Multi-Domain Visualization Strategy

### 3.1 Spatial domain

- 2D slice views (`XY`, `YZ`, `ZX`) for precise inspection.
- 3D volume rendering for global spatial context.
- HEALPix sphere projections (`Mollweide`, `Inside`, `Outside`) for spherical datasets.

### 3.2 Temporal and spectral domains

- Dedicated playback/navigation controls for `t` and `nu`.
- Linked profile graphs that update from spatial ROI selections.
- Mutual-exclusion playback policy to keep interaction legible when navigating multiple axes.
- Multispectral imaging via spectral-window RGB composition.

### 3.3 Polarization and sample domains

- Direct polarization channel selection (`I/Q/U/V`), EVPA overlay, and derived polarization modes.
- Sample-aware views (`single`, `mean`, `std`, `rel_uncert`) and sample morph/mosaic displays.

Together, these views allow users to compare "where, when, at what frequency, under which polarization condition, and under which uncertainty condition" within one interface. That final uncertainty step is the key distinction: robustness checks are part of exploration, not a separate post-processing phase.

### 3.4 Composable settings in one workflow

The interaction model is built so most controls can be applied together in one persistent state:

- sample mode and sample visualization mode (single/mosaic/morph),
- polarization selection and derived polarization views,
- colormap/flux scale/range policy choices,
- slice/volume/sphere spatial pivots,
- temporal and spectral play-through.

Where combinations are invalid or ambiguous, the software applies explicit guardrails and reports constraints.

### 3.5 Explicit uncertainty semantics

To avoid ambiguity, sample-derived modes are defined explicitly for each fixed non-sample coordinate tuple:

- `single`: one selected sample realization.
- `mean`: average over sample axis.
- `std`: population standard deviation over sample axis (`ddof=0`).
- `rel_uncert`: `std / max(abs(mean), 1e-8)`.

These semantics are applied directly in the rendering/query path (not as a detached export-time statistic).

## 4. User-Interface Domain Design

### 4.1 What is shown on screen

The UI uses a three-column layout:

- Left column: controls grouped by domain (`Data`, `Spatial`, `Temporal`, `Spectral`, `Polarization`).
- Center column: primary rendering surface (slice/volume/sphere), colorbar, and interaction toolbar.
- Right column: profiles and selection-linked quantitative plots.

This makes domain controls explicit while preserving one central visual frame. A single ROI and axis state can be reused as the analyst pivots across spatial context, time/frequency behavior, polarization behavior, and uncertainty behavior.

### 4.2 Visualization concepts (why this layout)

The UI structure follows four visualization concepts:

- Uncertainty as a co-equal domain: `sample`-derived modes are analytical pivots, not decorative overlays.
- State coherence: ROI, axis position, and normalization are preserved during domain pivots.
- Encoding as method: colormap/range choices are explicit analytical controls.
- Interpretation safeguards: `rel_uncert` is interpreted together with `mean/std`, especially in low-mean regions.

### 4.3 Color design choices

- Multiple colormap families support different data semantics:
  - Sequential (`Viridis`, `Plasma`, `Inferno`) for monotonic intensity fields.
  - Neutral (`Gray`) for structural interpretation and publication grayscale compatibility.
  - Diverging (`Diverging`) for signed/contrast-centered fields.
  - Cyclic (`Circular`) for angle-like quantities.
- Range policies (`Time`, `Spectral`, `Space`, `Full`) expose normalization tradeoffs across domains.
- Flux scales (`Linear`, `Sqrt`, `Log`) balance interpretability and dynamic-range compression.

### 4.4 Time design choices

- Time is represented as both index/value and as an explicit navigation graph.
- Playback is available on temporal/spectral axes and sample morph transitions.
- Progressive rendering prioritizes interaction responsiveness during playback, then refines quality on pause.

## 5. Usage and Reproducibility

The tool is intended to be runnable locally with minimal setup:

```bash
./run_demo.sh
```

Or via installed CLI:

```bash
python -m pip install .
mobula --host 127.0.0.1 --port 8000 --reload
```

Browser entry points:

- Viewer: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`

Detailed command/API examples are in [Usage Appendix](./usage-appendix.md).

## 6. Claimed Contributions

1. A canonical, domain-spanning axis contract for heterogeneous cube inputs.
2. A coordinated interaction model that links spatial, temporal, spectral, and polarization analysis in one UI state.
3. An uncertainty-as-domain design where sample-derived views (`single`, `mean`, `std`, `rel_uncert`) are first-class interactive pivots.
4. A local-first implementation that combines interactive rendering and quantitative profile extraction.
5. A reproducible API surface for loading, viewing, profiling, and exporting derived data products.

## 7. Current Evidence from Running Service (March 4, 2026)

### 7.1 Verified runtime scope

The live service (`http://127.0.0.1:8000`) reports five built-in datasets through `GET /api/datasets`:

- `movie-2d-pol-hd` (`shape=[4,4,120,1,144,144,1]`)
- `time-5d-volume-samples-hd` (`shape=[4,1,20,1,80,80,56]`)
- `healpix-sky-time-nu-hd` (`shape=[4,1,20,12,196608,1,1]`, HEALPix `nside=128`)
- `xy-nu-pol-radio-galaxy` (`shape=[4,4,1,10,2048,1024,1]`)
- `volume-3d-spiral-galaxy` (`shape=[1,1,1,1,256,256,256]`)

These datasets cover all major interaction modes used in the draft figures: 2D slice workflows, 3D volume workflows, and sphere workflows.

### 7.2 Measured latency snapshot

Using `python scripts/benchmark.py` against the running service on the current machine (`Apple M1 Pro`, `Python 3.12.8`, commit `3e9b3ef`):

| Dataset | Iterations | Slice p50 (ms) | Slice p95 (ms) | Slice mean (ms) | ROI p50 (ms) | ROI p95 (ms) | ROI mean (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `movie-2d-pol-hd` | 40 | 18.60 | 137.14 | 34.96 | 7.21 | 121.34 | 31.83 |
| `time-5d-volume-samples-hd` | 40 | 17.38 | 33.62 | 22.90 | 10.26 | 127.35 | 40.31 |
| `healpix-sky-time-nu-hd` | 20 | 186.46 | 235.37 | 190.71 | 4.09 | 14.40 | 6.01 |

Interpretation for manuscript text:

- Slice interaction is typically sub-20 ms median on the two Cartesian demo datasets.
- HEALPix slice payload generation is predictably slower due to larger spherical pixel domains.
- ROI statistics remain low-latency at median, with occasional high-percentile spikes that should be acknowledged in limitations.

### 7.3 Baseline-comparison text now supportable

A concrete comparison narrative can now be stated without a full user study:

- In `mobula`, one ROI gesture updates spatial context plus both temporal and spectral profiles in the same state.
- In a baseline multi-tool workflow, the same check requires at least one export and one external profiling/plotting step, then manual reconciliation.
- The paper can therefore claim reduced interaction handoffs; it should not yet claim statistically significant user-time reduction.

### 7.5 Comparative and real-dataset protocols

To close remaining evidence gaps, a reproducible protocol is included at:

- `publication/comparative-evaluation-protocol.md`

This protocol defines:

- cross-workflow tasks (`T1/T2/T3`),
- measurable outcomes (time, handoffs, manual state transfers, replayability, interpretation stability), and
- a real-dataset case narrative template.

### 7.4 Current known constraints

- Local-first scope: no distributed backend and no shared multi-user session model.
- Hardware dependence: latency and smoothness depend on CPU/GPU path and dataset size.
- Memory pressure risk on large dense volumes.
- No formal user study in the current draft.

## 8. Candidate Venues and Fit

### Primary recommendation

- **JOSS (Journal of Open Source Software)**: strong fit for reproducible software artifacts with explicit install/run instructions, API surface, and tests.

### Secondary options

- **SoftwareX**: good fit if expanded evaluation and engineering details are added.
- **Astronomy and Computing** (if framing is astronomy-first): good fit when HEALPix and polarization workflows are central to the narrative.
- **Domain workshop software tracks** (fast turnaround): useful for early feedback before a journal version.

### Practical submission choice for this repository state

If the target is shortest path to submission, prioritize JOSS-style packaging first (artifact completeness and reproducibility checklist), then prepare an expanded journal variant with deeper quantitative evaluation.

## 9. Abstract (Submission Candidate)

High-dimensional datasets often couple spatial, temporal, spectral, polarization, and sample dimensions, yet many workflows still separate these checks across multiple tools. We present `mobula`, a local-first interactive system that normalizes heterogeneous inputs to a canonical axis contract (`sample, pol, t, nu, x, y, z`) and supports coordinated exploration through 2D slices, 3D volume renderings, HEALPix sphere views, and linked ROI-driven profiles. The key design choice is to treat uncertainty as a first-class interactive domain via sample-derived views (`single`, `mean`, `std`, `rel_uncert`) rather than as a post-hoc diagnostic. The interface keeps domain controls, visual state, and quantitative outputs synchronized so one interaction propagates across views without manual state reconstruction. A FastAPI backend exposes reproducible endpoints for dataset discovery, metadata inspection, slicing, profiling, and cutout export, while the browser frontend provides CPU/GPU rendering paths with progressive interaction behavior. On the current build and demo datasets, median slice latencies are approximately 17-19 ms for Cartesian datasets and approximately 186 ms for a HEALPix dataset (`nside=128`), with low-median ROI-stat latency across tested modes. These results establish a reproducible baseline for submission and motivate follow-on comparative user studies.
