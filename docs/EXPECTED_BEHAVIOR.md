# Expected Behavior

This document is the product contract for observable viewer behavior. It should answer "is this a regression?" without requiring code archaeology or team memory.

Keep entries concrete, user-facing, and testable. When a behavior changes intentionally, update this file in the same change.

## Application Shell And Appearance

- Mobula presents one connected three-region workbench:
  - domain navigation and local controls on the left
  - the dominant scientific view in the center
  - measurements, linked profiles, performance evidence, and provenance on the right
- The domain index uses the stable Spatial, Time, Spectrum, Polarization, and Uncertainty identities, but exposes
  only domains applicable to the active dataset. Unavailable domains do not occupy rows or compact-grid columns.
- Only the active domain's local controls are prominent in the left rail. Display, range, backend, axis, and ingest
  operations remain available in the named `Display & operations` disclosure instead of lengthening every domain.
- Opening a domain reveals its existing controls. It does not change the dataset, sample treatment, ROI,
  coordinates, axes, map, normalization, projection, playback window, zoom, or rendered quantity.
- Dataset scope and sample quantity remain global and available in the app bar. The interface offers button controls
  for `Light`, `System`, and `Dark` appearance preferences. The preference persists locally and
  `System` follows the operating-system color-scheme setting without a light/dark flash during page load.
- Appearance changes preserve the complete applicable option inventory and all compatible explicit viewer choices.
  They change interface surfaces, the unused canvas field, canvas annotations, and measurement-chart framing. They
  never recolor the scientific raster itself or change a held color-map profile.
- Interface fonts load from Mobula's packaged static assets. Atkinson Hyperlegible Next is used for interface labels
  and controls; Martian Mono is used for coordinates, values, units, provenance, and canvas data labels, including
  nested dialogs. STIX Two Math owns mathematical Greek such as `σ` and `μ`; the Latin subsets do not provide an
  uncontrolled fallback. Running the local viewer does not require a public font service or other presentation CDN.
- With no dataset selected, the central field identifies itself and names the dataset selector as the action that
  unblocks it. A pending field request is identified on the same theme-aware canvas.
- A transient modal backdrop may temporarily obscure the scientific view while the modal owns interaction. Changing
  appearance or holding a scientific display profile may not recolor the raster itself.
- At viewport widths from compact mobile through wide desktop, the application shell does not create horizontal
  document overflow. The resizable three-column workbench becomes a single connected column when panel resizing is
  no longer practical.

## Dataset And Tab Switching

- Mobula works at the origin root and under an owning application's path prefix. Static assets, API and binary requests,
  and Scene launch URLs stay within the path from which the viewer page was opened.

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
- A committed point or ROI remains marked in the field. A point uses a lightweight focus-colored circle and crosshair;
  an ROI uses a focus-colored dashed rectangle. The marker locates the selected evidence without adding a heavy
  contrast keyline. Viewer snapshots include the current selection overlay; numerical data cutout exports do not
  rasterize interface overlays into the data.
- Selection outside the rendered image does not create a ROI.
- Shift-click outside the canvas clears the active ROI.
- Selection-driven profile panels update from the current ROI:
  - time flux profile when `t` varies
  - spectral flux profile when `nu` varies
  - hidden spatial profile when the currently hidden spatial axis varies and sphere mode is not active
- If no valid ROI is active, profile canvases render the empty-state message `No selected area`.
- Profile zoom is local to each profile axis and can be reset independently.

## Color Normalization

- The default viewer colorbar is a compact attached horizontal rail. Its ramp is `10px` high, sits across a `3px`
  optical gap, and follows the active viewer width. The same attached proportion is retained in snapshots,
  rendered frames, and recordings. This remains a configurable presentation default rather than a restriction on
  provider-defined orientations or Mobula's wider scientific-map and normalization inventory.
- The selectable map inventory comes from Mobula's versioned scientific-color registry. Viridis, Plasma, Inferno,
  `afmhot_us`, Gray, and the legacy Diverging/Circular maps remain available; Resolve adds `oslo`,
  `cyan_coral.paper`, `cyan_coral.night`, and the half-turned ColorCET C3 phase profile without removing choices.
- Each registry record owns an explicit-length LUT (256 for the retained general maps and 257 for Resolve cyan/coral profiles), map/profile identity, quantity structure, normalization support,
  center or seam where applicable, under/over behavior, invalid policy, source version, license, and provenance.
  The Resolve cyan/coral records preserve the exact accepted Uniform Vivid Ink and Uniform Vivid Neon LUTs,
  including their `resolve-cyan-coral-1.0` source version and canonical hashes; Mobula does not reconstruct them
  from preview anchors or interpolate them from interface colors.
- Invalid, masked, missing, unevaluated, and outside-domain scalar samples render with alpha `0` in CPU, WebGL,
  sphere, and volume sources. Transparency-preserving snapshots retain that alpha; destinations without alpha,
  including encoded movies, composite the same source over the current observation field.
- Quantity recommendations are `afmhot_us` for positive intensity, `oslo` for ordered uncertainty, a theme-matched
  named cyan/coral profile for signed circular polarization, and half-turned C3 for phase/orientation. A user map
  choice is retained as an explicit override for that quantity and is not replaced by an appearance change.

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

- In a zoomed two-dimensional view, viewport panning tracks the pointer in both screen directions even when an axis is
  displayed flipped. Panning changes only the viewport and does not change the data-axis/WCS orientation or ROI bounds.
- Clicking a zoomed two-dimensional view, including normal sub-pixel or few-pixel pointer jitter during the click, does
  not pan or recenter the viewport. Panning begins only after an intentional drag crosses the interaction threshold.

- Volume mode is only available for non-spherical datasets with a varying hidden spatial axis.
- Sphere mode is only available when the dataset presents a valid HEALPix layout:
  - canonical `x` length is `12 * nside^2`
  - `nside` is a power of two
  - the dataset is marked and interpreted as HEALPix-capable
- Entering an invalid mode should not silently fail; the corresponding controls must remain unavailable or the mode must fall back to a valid one.
- Sphere projection behavior is stable by mode:
  - `Mollweide` preserves map aspect
  - `Inside` and `Outside` preserve a projection-stable circular or square basis
  - sphere mode defaults to astronomy-style left-right orientation, and Axis Settings exposes a left-right flip toggle for alternate map conventions
- Full-view and zoomed-view rendering follow a consistent contract:
  - zoomed-out view preserves source aspect and may show margins
  - zoomed-in view uses cover behavior to fill the main canvas
  - zoom reset returns to the original centered full-view behavior
- The shared `3D Rotate` helper stays available in both 3D spatial modes:
  - in volume mode, the helper rebases the volume rotate axis to the current viewer-up axis without changing the current pose
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
- Active ingest work should refresh the temporary import session while the user is previewing or committing, so normal mapping/preview iteration does not expire mid-flow.
- If an ingest session or plan does expire or is cleared, the wizard should show an explicit recovery message telling the user to re-inspect or rebuild, not a raw internal ID/error string.
- If inspect fails before any ingest dialog opens, the viewer status area should still show the explicit reason instead of leaving the user with a silent failure or a generic busy message.
- HDF5 imports support:
  - choosing a primary numeric dataset
  - stacking same-shape keys under an explicit stack axis
  - quick Stokes `I/Q/U/V` stacking when compatible members are found
- A `pol` axis with size `3` is interpreted as `I,Q,U` and padded to `I,Q,U,V` during load.
- Missing canonical axes are padded to singleton dimensions during ingest commit.
- Drag-and-drop upload supports file-based FITS, HDF5, and NPZ inputs. `.zarr` folders require path-based selection.
- Cancelling or restarting the ingest flow should leave the currently active dataset unchanged.

## Export And Save

- `Export Zoom` is only available for non-volume, non-sphere, non-sample-morph views when a spatial or domain zoom window exists.
- FITS and HDF5 cutout export preserve selected coordinates, selected indices, and axis metadata where available.
- HEALPix explicit pixel-index export is supported for HDF5 saves.
- Snapshot and movie save flows operate on the currently rendered viewer state rather than recomputing a separate interpretation.
- Export actions should fail with explicit messages when a format or mode combination is unsupported.

## Structured Scenes

- A Mobula Scene is a versioned hierarchy of stable component identities. Components declare their representation kind,
  native fields and domains, and an explicit mapping to the Scene's exploration axes.
- The initially supported component kinds are raster fields, point sources, and component groups. Unknown future kinds
  may remain described by a provider, but must not be silently interpreted as a supported renderer.
- Missing axes are explicit invariants. In particular, moving through time in a combined Scene keeps a component with an
  invariant time mapping constant instead of requiring that component to store repeated time planes.
- Categorical coordinates such as polarization labels remain labels in dataset metadata and selected-coordinate state;
  they are not coerced to numeric values.
- Presentation recipes explicitly name their axes, participating component layers, output quantity/unit, renderers, and
  composition rule. Mobula does not infer scientific projection or unit-conversion rules from array shapes.
- A Scene session offers its combined presentation and renderable component layers through one `Scene Layer` control.
  Switching layers preserves compatible analytical context, including current axis positions, ROI, zoom, and
  normalization; only values and analyses derived from the previous layer are refreshed.
- Scene descriptions advertise either legacy materialized access or sparse-required slice access. Existing
  `CubeDataset` inputs and v1 snapshots remain explicit materialized sources; a source advertising slice access is
  never allowed to fall back to a full presentation cube.
- `mobula --scene-snapshot PATH` accepts the local `mobula.scene-snapshot/v1` JSON+NPZ handoff, starts the normal local
  service, and opens its default combined Scene. The snapshot is a launch handoff and does not imply a Zarr dependency
  or a requirement to persist every scientific component on one common native domain.
- `mobula --scene-source-url ... --initial-scene ...` connects to an authenticated `mobula.scene-source/v2` runtime.
  The bearer token is sent in an authorization header, never in the URL. Opening a layer registers a stable virtual
  dataset from its descriptor only; numerical values are first requested when the viewer asks for a plane.
- Opening Mobula with an initial Scene selects its default combined layer as the active dataset and displays its first
  frame without requiring a second selection in the dataset picker.
- Raster orientation follows explicit dataset WCS metadata. A Resolve tangent-plane layer is displayed west-right and
  north-up by default; the axis controls remain available for deliberate display flips.
- A runtime request contains the visible plane, every non-visible axis selection, sample reduction, and an optional
  output pixel bound. Its response must contain exactly one two-dimensional plane. Mobula rejects higher-dimensional or
  oversized responses and never registers remote Scene values as a `CubeDataset`.
- Mean and standard-deviation Scene slices retain the presentation recipe unit. Relative-uncertainty slices are
  dimensionless and use intensity unit `1`.
- A sparse Scene which advertises bounded profiles enables the existing point, ROI, visible-view, and full-field
  profile workflow. Time, spectral, and hidden-spatial profiles are requested together once per region; Mobula never
  reconstructs them from repeated slices or a dense presentation cube.
- Sparse profile selections use explicit half-open bounds on the active plane and preserve the current indices on all
  other exploration axes. Switching between combined and component layers keeps the ROI and axis state while
  refreshing the layer-dependent profiles.
- When a source advertises both `integral` and `mean`, Mobula requests `integral`. Profile charts display the
  provider-declared profile unit (for example `Jy`) rather than reusing the displayed plane's intensity unit.
- Exact explicit or regular-linear coordinate encodings are preserved in virtual metadata. If a provider omits both,
  Mobula uses the axis index for navigation rather than inventing physical coordinates from a min/max range.
- Sparse Scene views normalize from the returned plane. Operations which require an undeclared whole-domain query
  (global ranges, unadvertised profiles, volume, EVPA ticks, and data cutout export) remain visibly
  unavailable until the source advertises a bounded query for them; they never trigger hidden dense work.
- Multi-spectral rendering is available for a sparse Scene with at least three spectral channels. Mobula requests one
  bounded plane for each selected spectral channel at the current exploration indices and viewport resolution, then
  combines only that temporary plane stack into RGB; it never materializes the Scene presentation cube.
- Multi-spectral artifact suppression defaults to a stable robust preset: pixels below 1.5% of a robust
  high-percentile reference brightness (so isolated point sources cannot set the entire field's threshold)
  or outside spectral index -4 to +4 lose chroma through a soft transition while retaining luminance. The reference
  is established by the first multi-spectral frame and reused while navigating or playing the current dataset,
  layer, plane, spectral window, polarization, sample reduction, and projection context, so a variable source cannot
  make suppression breathe between frames without leaking a scale across scientifically different quantities. Manual
  mode exposes the confidence floor, spectral-index interval, and desaturate-versus-hide behavior; Off preserves the
  unfiltered RGB conversion. Sparse Scenes without physical frequency coordinates retain brightness suppression but
  skip spectral-index suppression rather than inventing a physical index.
- Multi-spectral color encoding offers both Spectrum RGB and direct Spectral Index alpha. Direct alpha coloring fits
  `I(nu) proportional to nu**alpha` per pixel, clips the selected alpha interval to blue and red endpoint colors,
  uses a constant-lightness palette scaled only by integrated intensity, and renders invalid fits gray unless Manual
  Hide suppression is selected. The fitted alpha is available in the hover readout. Its alpha result is invariant to
  the hidden Spectrum RGB deslope and mean-normalization settings. The alpha range remains directly adjustable even
  with robust confidence suppression, and controls which only affect Spectrum RGB are hidden. If physical frequency
  coordinates are unavailable, the viewer falls back to Spectrum RGB and disables direct alpha coloring.
- Multi-spectral brightness uses the 99.5th percentile of positive pixels as its default display reference. Isolated
  bright sources clip at the top of the display range instead of forcing diffuse morphology below the log floor;
  the brightness-range controls refine that robust reference explicitly.
- Layer identity includes recipe id, target kind, and target id. A component named `combined` remains distinct from the
  recipe's reserved combined presentation.
- An owning application may add `--no-browser` and open the local service itself.
