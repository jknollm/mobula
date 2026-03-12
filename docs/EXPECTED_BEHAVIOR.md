# Expected Behavior

This document is the product contract for observable viewer behavior. It should answer "is this a regression?" without requiring code archaeology or team memory.

Keep entries concrete, user-facing, and testable. When a behavior changes intentionally, update this file in the same change.

## Dataset And Tab Switching

- Switching the dataset in the active tab resets dataset-scoped exploration state:
  - axis indices return to `0`
  - ROI selection, zoom state, profile zoom, hover probe, playback windows, and cached frames are cleared
  - sphere-specific orientation and cached sphere geometry are cleared
  - if the previous dataset was in sphere mode, the new dataset opens in slice mode
- Switching datasets does not reset general viewer preferences that are not dataset-specific:
  - color map
  - flux scale
  - render backend preference (`Auto` / `GPU` / `CPU`)
  - multispectral compute backend preference (`Auto` / `Native Accelerated` / `CPU` / backend-specific overrides)
  - playback FPS preference
  - panel widths
- After loading or switching to a dataset, the first visible frame should appear as soon as the initial view payload is ready.
- Fixed-range normalization may refine the first frame immediately after it appears, but it should not block the initial visualization from showing up.
- Multi-tab ingest preserves one state snapshot per tab. Activating a different tab restores that tab's saved dataset, control state, and view state rather than starting from scratch.

## Acceleration And Backend Status

- Render acceleration and compute acceleration are separate controls and separate status signals.
- The render backend control applies to browser-side display work:
  - `Auto` may use WebGL2 when supported and beneficial for the active view
  - `GPU` requests WebGL2 directly
  - `CPU` keeps rendering on the CPU path
- The multispectral compute backend control applies to backend spectral-to-RGB conversion only.
- When a requested accelerated compute backend is unavailable or fails at runtime, the request falls back to CPU and the UI surfaces:
  - requested backend
  - effective backend
  - fallback reason when present
- Multispectral backend status should be inspectable from the UI without opening devtools.

## Plane Switching And Axis Mapping

- The `Plane` control maps visible spatial axes as follows:
  - `XY` -> visible axes `x,y`, hidden axis `z`
  - `YZ` -> visible axes `y,z`, hidden axis `x`
  - `ZX` -> visible axes `z,x`, hidden axis `y`
- Changing plane preserves the current dataset and current axis indices, but clears plane-dependent state:
  - ROI selection
  - selection and view profiles
  - zoom drag / pan drag state
  - domain windowing on `t` and `nu`
  - EVPA overlay cache
- Hidden-axis navigation always tracks the currently non-visible spatial axis for the selected plane.
- Axis settings are display mappings, not data rewrites. Flips, labels, units, and plane swaps affect interpretation and rendering, but do not mutate dataset values on the backend.

## ROI Selection And Profiles

- In inspect mode, clicking creates a point selection and dragging creates a rectangular ROI on the rendered data region.
- Creating a new ROI replaces the previous selection. The current product does not expose separate move/resize handles for an existing ROI.
- Releasing the pointer commits the current ROI and refreshes linked profiles for the selection.
- Selection outside the rendered image does not create a ROI.
- Shift-click outside the canvas clears the active ROI.
- Selection-driven profile panels update from the current ROI:
  - time flux profile when `t` varies
  - spectral flux profile when `nu` varies
  - hidden spatial profile when the currently hidden spatial axis varies and sphere mode is not active
- If no valid ROI is active, profile canvases render the empty-state message `No selected area`.
- Profile zoom is local to each profile axis and can be reset independently.

## Color Normalization

- Color normalization uses the currently selected range policy:
  - `None`: current slice only
  - `Time`: visible plane over the selected time window
  - `Spectral`: visible plane over the selected spectral window
  - `Time+Spectral`: visible plane over both windows
  - `Space`: spatial domain
  - `Full`: full available spatial + temporal + spectral extent
- Each displayed intensity quantity keeps its own normalization window. Switching between quantities restores that quantity's last-used manual range when available.
- Changing to a different quantity or visualization mode should not silently reuse an incompatible normalization window from another quantity.
- Manual min/max handles operate in the chosen flux scale (`Linear`, `Sqrt`, `Log`) and are clamped to a valid ordered range.
- Dataset changes clear quantity-specific normalization history.

## Playback And Refinement

- Playback is mutually exclusive across navigable axes. Starting playback on one axis stops playback on others.
- Playback favors responsiveness over final fidelity:
  - lower-resolution preview frames may be used while playback is active
  - when the user is playing along an axis, the viewer may prefetch upcoming playback frames to reduce stalls
  - multispectral preview mode reduces compute size before spectral-to-RGB conversion, not only after conversion
  - when playback stops, the viewer refines back to a higher-quality frame
- Slice, hidden-axis, time, and spectral playback all keep the rest of the analytical context intact:
  - current dataset
  - current plane
  - current ROI
  - current normalization mode
- Sample morph mode is a separate playback mode for sample interpolation:
  - selecting morph starts sample-morph playback automatically
  - `Sample Δt` controls the time between true sample endpoints
  - render FPS controls the number of in-between blend frames

## Spatial Modes And Guardrails

- Volume mode is only available for non-spherical datasets with a varying hidden spatial axis.
- Sphere mode is only available when the dataset presents a valid HEALPix layout:
  - canonical `x` length is `12 * nside^2`
  - `nside` is a power of two
  - the dataset is marked and interpreted as HEALPix-capable
- Entering an invalid mode should not silently fail; the corresponding controls must remain unavailable or the mode must fall back to a valid one.
- Sphere projection behavior is stable by mode:
  - `Mollweide` preserves map aspect
  - `Inside` and `Outside` preserve a projection-stable circular or square basis
- Full-view and zoomed-view rendering follow a consistent contract:
  - zoomed-out view preserves source aspect and may show margins
  - zoomed-in view uses cover behavior to fill the main canvas
  - zoom reset returns to the original centered full-view behavior
- The shared `3D Rotate` helper stays available in both 3D spatial modes:
  - in volume mode, the helper resets the volume orientation to the default view
  - in sphere mode, the helper rebases the spin axis to the current viewer-forward axis

## Ingest Wizard

- Ingest follows a staged workflow:
  - inspect input files and infer likely axes
  - choose multi-file intent when needed
  - optionally choose HDF5 data keys
  - map axes
  - preview a plan
  - commit import
- Inspection warnings are advisory until they imply an invalid plan.
- Plan errors block commit and must stay visible until resolved.
- HDF5 imports support:
  - choosing a primary numeric dataset
  - stacking same-shape keys under an explicit stack axis
  - quick Stokes `I/Q/U/V` stacking when compatible members are found
- A `pol` axis with size `3` is interpreted as `I,Q,U` and padded to `I,Q,U,V` during load.
- Missing canonical axes are padded to singleton dimensions during ingest commit.
- Drag-and-drop upload supports file-based FITS and HDF5 inputs. `.zarr` folders require path-based selection.
- Cancelling or restarting the ingest flow should leave the currently active dataset unchanged.

## Export And Save

- `Export Zoom` is only available for non-volume, non-sphere, non-sample-morph views when a spatial or domain zoom window exists.
- FITS and HDF5 cutout export preserve selected coordinates, selected indices, and axis metadata where available.
- HEALPix explicit pixel-index export is supported for HDF5 saves.
- Snapshot and movie save flows operate on the currently rendered viewer state rather than recomputing a separate interpretation.
- Export actions should fail with explicit messages when a format or mode combination is unsupported.
