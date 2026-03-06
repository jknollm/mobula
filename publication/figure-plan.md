# Figure Plan

This plan focuses on visual evidence for the publication narrative: why multi-domain exploration is hard and how `mobula` addresses it.

## Figure 1: System and Interaction Overview

- Goal: show the end-to-end architecture and where user interactions map to backend services.
- Content:
  - UI columns (controls, viewport, profiles).
  - Backend modules (loaders, registry, view/profile services).
  - Data flow arrows from local files to rendered outputs and exports.
- Source material:
  - `docs/ARCHITECTURE.md`
  - `src/mobula/static/index.html`

## Figure 2: Coordinated Multi-Domain UI

- Goal: make domain coupling visible in one screenshot series.
- Content:
  - Same ROI selection reflected in:
    - central spatial view,
    - temporal profile,
    - spectral profile,
    - polarization/sample mode changes.
- Capture tips:
  - Keep ROI location fixed.
  - Use consistent color range policy unless demonstrating normalization differences.

## Figure 3: Spatial Mode Comparison

- Goal: demonstrate that one system handles multiple spatial representations.
- Content:
  - Panel A: 2D slice (`XY`).
  - Panel B: 3D volume view.
  - Panel C: HEALPix sphere projection.
- Suggested annotation:
  - identical dataset/time/spectral state across all three panels.

## Figure 4: Color and Time Semantics

- Goal: document design decisions around perceptual mapping and temporal navigation.
- Content:
  - Same frame under sequential, diverging, and cyclic colormaps.
  - Mini-sequence showing playback (low-quality interactive phase to refined paused frame).
  - Example of `Time` vs `Full` color range policy impact.

## Figure 5: Reproducible API Workflow

- Goal: connect UI claims to scriptable, reproducible operations.
- Content:
  - Endpoint sequence:
    1. dataset listing/loading,
    2. view/profile query,
    3. cutout export/save.
  - Include minimal request/response snippets.

## Optional Table 1: Capability Matrix

- Rows: tasks (slice inspect, volume context, HEALPix view, ROI profiling, polarization analysis, export).
- Columns: `mobula` and baseline workflow/tools.
- Note: keep baseline neutral and verifiable.

## Asset Checklist

- Banner/logo assets already available under:
  - `src/mobula/static/assets/`
- Ensure all figures record:
  - dataset id/name,
  - axis indices (`t`, `nu`, `pol`, `sample`),
  - colormap and range policy,
  - render backend (`CPU/GPU/Auto`).
