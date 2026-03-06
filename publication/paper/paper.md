---
title: "mobula: Coordinated Multi-Domain Cube Exploration in a Local-First Interactive System"
tags:
  - Python
  - scientific visualization
  - multidimensional data
  - astronomy software
  - FastAPI
authors:
  - name: nCube Project Team
    affiliation: 1
affiliations:
  - name: nCube
    index: 1
date: 2026-03-04
bibliography: references.bib
---

# Summary

`mobula` is a local interactive system for high-dimensional cube exploration across a canonical axis model:
`sample, pol, t, nu, x, y, z`.
It combines a FastAPI backend with a browser frontend to support linked 2D slice, 3D volume, and HEALPix sphere workflows in one coordinated UI state.
The same state model drives ROI-linked temporal/spectral profiles, polarization pivots, and sample-derived uncertainty views without breaking context.
The motivating use case in this manuscript is astrophysical: evaluating whether a polarized emission region changes coherently across position, frequency, and time, and whether that interpretation remains credible under uncertainty.

# Statement of need

In many practical workflows, spatial, temporal, spectral, polarization, and uncertainty exploration are split across multiple tools.
This separation increases context-switch cost and weakens reproducibility because users must manually transfer selections and normalization choices between environments.
For astrophysics, this can directly affect interpretation quality: a feature that appears significant in one rendering state may not remain significant after polarization and uncertainty checks if those checks are performed out-of-context.
`mobula` addresses this gap by:

1. normalizing heterogeneous inputs (FITS/HDF5/Zarr) into one canonical axis contract,
2. exposing one shared interaction model across domain pivots,
3. treating uncertainty as a first-class interactive domain through sample-derived modes (`single`, `mean`, `std`, `rel_uncert`), and
4. providing reproducible API endpoints for loading, viewing, profiling, and export.

# State of the field

Established viewers and analysis tools provide important capabilities in adjacent areas.
SAOImage DS9 remains a long-standing astronomy viewer reference @joye2003ds9.
CARTA targets modern, high-performance interactive cube viewing in astronomy contexts @carta2026.
Glue emphasizes linked-view multidimensional exploration @glue2013.
Broader scientific analysis ecosystems such as yt and napari provide programmable and extensible multidimensional workflows @turk2011yt; @napari2019.

`mobula` is positioned as a local-first integration of these concerns for canonical multi-domain cube interaction in one API+UI artifact.
Its distinguishing focus is not replacing the full feature breadth of existing ecosystems, but keeping signal interpretation and uncertainty qualification in the same interaction state.
It does not claim to replace the full ecosystem breadth of existing tools.

# Software design

`mobula` is implemented as a single-process FastAPI service serving both API endpoints and static frontend assets.
The backend contains dataset loaders, canonical schema validation, an in-memory registry, view/profile services, and export routes.
The frontend maintains a shared state model across:

- spatial mode pivots (slice/volume/sphere),
- axis navigation and playback (`t`, `nu`),
- polarization mode changes,
- sample-derived uncertainty mode changes, and
- ROI-linked quantitative analysis.

This design keeps one scientific question in one state container. In the motivating scenario, the same ROI and axis state are reused as the analyst steps through time, frequency, polarization channels, and uncertainty views, reducing manual handoff errors and interpretation drift.

Visualization design is intentional rather than incidental:

- uncertainty is treated as a domain-level pivot, not a detached overlay,
- ROI/axis/normalization state is preserved across domain transitions,
- colormap and range policy are treated as analytical controls, and
- uncertainty interpretation is guarded by reading `rel_uncert` with `mean`/`std` context.

Advanced visualization workflows are explicit in the same state model:

- multispectral imaging (spectral-window RGB composites),
- sample morphing (interpolated transitions between sample realizations),
- simultaneous sample views (sample mosaics),
- sphere visualizations (HEALPix with projection pivots),
- rendering controls across CPU/GPU pathways, and
- time/frequency play-through linked to profiles and ROI context.

Most settings are intentionally composable in one workflow; when combinations are invalid, the system enforces guardrails and documents caveats.

Uncertainty semantics are explicit in the service:
`mean = avg(sample)`, `std = population std(sample, ddof=0)`, and
`rel_uncert = std / max(abs(mean), 1e-8)`.
These are applied in the same render/query path as other view operations, so uncertainty is not an offline post-processing step.
Current constraints: sample reduction modes are incompatible when `sample` is itself a visible plane axis, and EVPA/derived-polarization overlays currently use `mean` semantics under `std`/`rel_uncert`.

For reproducibility, the repository includes:

- API documentation at `/docs`,
- benchmark scripts (`scripts/benchmark.py`),
- automated tests (152 passing in the latest local run),
- figure capture automation (`publication/paper/scripts/capture_ui_screenshots.py`), and
- a comparative evaluation protocol template (`publication/comparative-evaluation-protocol.md`),
- manuscript sources and generated figures.

# Research impact statement

`mobula` provides a concrete, reproducible software artifact for coordinated multi-domain exploration.
On the current build (`3e9b3ef`) and benchmark protocol, median slice latency was 17--19 ms on two Cartesian demo datasets and 186 ms on a HEALPix dataset (`nside=128`), with low-median ROI-stat latency across tested modes.
These results establish a baseline for future comparative user studies and external artifact evaluation.
The primary impact is methodological: complexity that is intrinsic to high-dimensional astrophysical objects, including uncertainty, is made explicit and traceable in one interaction workflow instead of being hidden across multiple disconnected tools.
This version does not yet include executed head-to-head timing studies or a completed real observational case report; both are scoped through the protocol template for the next revision.

# Acknowledgements

We acknowledge contributors to the nCube project and maintainers of the open-source dependencies and scientific software ecosystem used by this work.

# AI usage disclosure

Generative AI assistance was used during manuscript drafting and editing.
All technical claims, commands, and reported measurements were verified against the running software artifact and repository contents before inclusion.
