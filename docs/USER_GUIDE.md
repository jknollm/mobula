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
- **Load Data**: open the ingest flow from the native host picker
- **Color Map**: `Viridis`, `Plasma`, `Inferno`, `Gray`, `Diverging`, `Circular`
- **Color Range**: global min/max policy (`None`, `Time`, `Spectral`, `Time+Spectral`, `Space`, `Full`)
- **Slice Backend**: `Auto`, `GPU`, `CPU`
- **Flux Scale**: `Linear`, `Sqrt`, `Log`
- **Sample Mode**:
  - `Mean`: average over sample axis
  - `STD`: standard deviation over sample axis
  - `Samples`: single-sample view with `Mosaic` (`1`, `4`, `9`, `16`) or `Morph` (interpolated movie between consecutive samples, in slice or volume view)
    - `Morph` auto-starts when selected and uses its own `Sample Δt` control (time to transition to next sample).
  - `rel. uncertainty`: `std / max(abs(mean), 1e-8)`
- **Render FPS**: global redraw cadence.
- **Sample Δt** (Morph mode): time between two actual sample frames; with FPS this sets the number of intermediate blend frames.

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

### Sphere mode (HEALPix)

- Auto-enabled when dataset metadata matches HEALPix sphere layout:
  - `x` size is a valid HEALPix `npix` (`12 * nside^2`, power-of-two `nside`)
  - `y` size is `1`
- Projection controls in Spatial panel:
  - `Mollweide`
  - `Inside`
  - `Outside`
- Ordering comes from dataset metadata when available; defaults to `ring`.

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
- Drag in sphere mode: rotate view (hold `Shift` while dragging to make ROI selections)

### Expected Zoom and Aspect Behavior

These rules are intentional and should be treated as rendering contracts:

- Full-view (not zoomed) keeps the dataset's native view aspect ratio and centers it in the canvas.
- In full-view, empty margins (letterbox/pillarbox) are expected when panel and data aspect ratios differ.
- Zoom-in uses **cover** behavior: the visible data is cropped to the panel aspect so the canvas is fully used.
- Zoom-out returns to the original centered full-view aspect behavior.
- Sphere projections do not re-shape to panel size:
  - `Mollweide` keeps map-native aspect.
  - `Inside` and `Outside` keep a fixed circular/square basis.
- In `Inside` sphere projection specifically:
  - default (zoomed-out) view uses fixed aspect and may show margins,
  - zoom-in fills the full canvas,
  - zooming back out restores the original centered fixed-aspect view.

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
- Zarr: `.zarr` directory (path-based loading / direct API)

Current UI flow:

- **Load Data** opens ingest inspection instead of loading directly.
- Multi-file imports first ask whether to combine files into one dataset or create separate tabs.
- HDF5 imports can open a key-selection dialog before axis mapping.
- Datasets are not materialized until **Commit Import** succeeds.

Axis mapping:

- Assign axes in source-file order by dragging axis chips onto the source slots.
- Accepted labels are `sample`, `pol`, `t`, `nu`, `x`, `y`, `z`.
- The mapper also supports `sphere` as a HEALPix alias; it is validated and then stored as canonical `x`.
- Use **Apply To All Tabs** to copy the current mapping across compatible files in a multi-file import.

Example source-axis assignment:

```text
t,nu,x,y
```

Behavior notes:

- mobula reorders mapped axes internally; you do not need to rewrite them into the internal axis order yourself.
- A `pol` axis with 3 channels is treated as `I,Q,U` and padded to `I,Q,U,V` with `V=0`.
- Ingest commit pads missing axes to singleton size in the full internal 7D model.
- Drag-and-drop import is file-only; `.zarr` folders are not supported through browser drag-and-drop.

## Performance Behavior

- During playback, the app uses lower-resolution rendering for responsiveness, then refines when paused.
- Slice rendering can route through CPU or WebGL2 depending on control selection and availability.
- Volume rendering quality levels trade detail for interaction speed.

## Export and Snapshot Workflow

- Use API endpoint `GET /api/datasets/{data_id}/export-cutout` for FITS cutout download.
- Use API endpoint `POST /api/datasets/{data_id}/export-cutout/save` for direct server-side FITS/HDF5 file writes.
- Use API endpoint `POST /api/datasets/{data_id}/save-images` to persist PNG snapshots supplied as data URLs.
- For HEALPix explicit pixel-index cutouts, use `format="hdf5"` in `export-cutout/save`.
