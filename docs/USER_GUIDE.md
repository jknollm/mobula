# User Guide

This guide explains the viewer layout and common workflows.

## Viewer Layout

The app has three main columns:

- Left: controls (`Data`, `Spatial`, `Temporal`, `Spectral`, `Polarization`)
- Center: main image/volume canvas + colorbar + interaction toolbar
- Right: selection-driven profile panels (time, spectral, and spatial profile)

## Data Panel

Controls:

- **Dataset**: choose currently loaded dataset
- **Load Data**: open native host picker and load local files/folders
- **Color Map**: `Viridis`, `Plasma`, `Inferno`, `Gray`, `Diverging`, `Circular`
- **Color Range**: global min/max policy (`None`, `Time`, `Spectral`, `Time+Spectral`, `Space`, `Full`)
- **Slice Backend**: `Auto`, `GPU`, `CPU`
- **Flux Scale**: `Linear`, `Sqrt`, `Log`
- **Sample Mode**:
  - `Mean`: average over sample axis
  - `STD`: standard deviation over sample axis
  - `Samples`: random single-sample mosaic (`1`, `4`, `9`, `16`)
  - `rel. uncertainty`: `std / max(abs(mean), 1e-8)`
- **Playback Speed**: shared playback FPS

## Spatial Panel

### Slice mode

- Choose plane: `XY`, `YZ`, `ZX`
- Hidden spatial axis gets its own navigator panel
- Drag to inspect (point/box), or switch to zoom mode

### Volume mode

- Renders full `x,y,z` volume
- Backend: `Auto`, `GPU`, `CPU`
- Quality: `Draft`, `Balanced`, `Fine`, `Ultra`
- Render modes: `Composite`, `MIP`, `MinIP`, `Average`, `Isosurface`
- Additional controls: transfer function, opacity, gamma, cutoff, clipping, iso threshold

## Temporal and Spectral Panels

Each panel provides:

- Current index/value display
- Play/Pause button
- Interactive navigation graph with axis min/max labels

Playback is mutually exclusive per axis. Starting playback on one axis stops playback on others.

## Polarization Panel

- Direct channel jumps: `I`, `Q`, `U`, `V`
- EVPA overlay toggle with density and intensity threshold controls
- Derived modes:
  - `Fractional Pol`
  - `Magnetic Field Angle`
  - `Linear Pol`
  - `Circular Pol`

## Interaction Toolbar

Buttons below the main view:

- **Inspect**: click/drag for profile/ROI selection
- **Zoom**: drag box to zoom into current plane
- **Reset**: reset view transform and profile zoom state

Mouse interactions:

- Wheel: zoom
- `Alt+drag` or right-button drag: pan (slice mode)
- Drag in volume mode: rotate view

## Selection and Profiles

Selection updates profiles in the right panel:

- Time Flux Profile
- Spectral Flux Profile
- Spatial Flux Profile (remaining spatial axis)

Profile graphs support axis zoom by dragging in the chart area. Double-click the corresponding navigator graph to reset that axis range.

## Local Data Loading

Supported local formats:

- HDF5: `.h5`, `.hdf5`
- FITS: `.fits`, `.fit`, `.fts`
- Zarr: `.zarr` directory

If automatic dimension parsing fails, the UI prompts for manual mapping in file order.

Accepted dim names:

- `sample`, `pol`, `t`, `nu`, `x`, `y`, `z`

Example mapping input:

```text
t,nu,x,y
```

The loader can pad missing canonical axes as singleton dimensions when requested.

## Performance Behavior

- During playback, the app uses lower-resolution rendering for responsiveness, then refines when paused.
- Slice rendering can route through CPU or WebGL2 depending on control selection and availability.
- Volume rendering quality levels trade detail for interaction speed.
