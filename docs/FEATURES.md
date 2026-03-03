# Feature Overview

This page summarizes what mobula can do today.

## Data and Loading

- Canonical cube model with dims drawn from: `sample, pol, t, nu, x, y, z`
- Built-in demo datasets available at startup
- Local loading from:
  - HDF5 (`.h5`, `.hdf5`)
  - FITS (`.fits`, `.fit`, `.fts`)
  - Zarr folders (`.zarr`) via path-based loading
- Optional manual dim mapping when source metadata is incomplete
- Optional canonical singleton padding for missing dims

## Interactive Visualization

- 2D slice rendering across `XY`, `YZ`, and `ZX`
- 3D volume rendering across `x,y,z`
- HEALPix sphere mode for compatible datasets
- Temporal and spectral playback with linked controls
- Color map, flux scale, and range policy controls
- CPU/GPU rendering paths with auto selection

## Sample and Polarization Workflows

- Sample modes:
  - `single`
  - `mean`
  - `std`
  - `rel_uncert` (`std / max(abs(mean), 1e-8)`)
- Sample-oriented visualization options:
  - single-sample
  - sample mosaics
  - sample morph playback
- Polarization channel selection (`I/Q/U/V`)
- EVPA tick overlay on XY slices
- Derived polarization views:
  - fractional polarization
  - magnetic field angle
  - linear polarization
  - circular polarization

## Quantitative Analysis

- ROI summary statistics over selected XY regions
- Time and spectral profile extraction over ROI
- Plane-based profile extraction for non-XY views
- HEALPix pixel-index profile extraction for sphere datasets

## Export and Capture

- FITS cutout export endpoint
- Server-side cutout save endpoint:
  - FITS output
  - HDF5 output
- Explicit HEALPix `pixel_indices` cutout path for HDF5 saves
- PNG snapshot save endpoint from data URL payloads

## Developer and Ops

- FastAPI + OpenAPI (`/docs`) service surface
- In-memory registry with lazy dataset materialization
- Automated test suite (API, loaders, schema, registry)
- Utility scripts for seed generation and benchmarking
