# Architecture

mobula is a single-process FastAPI app serving both API endpoints and static browser UI.

## Runtime Topology

- FastAPI app in `src/mobula/main.py`
- API router under `/api` composed in `src/mobula/service/api_router.py`
- Static frontend served from `src/mobula/static/`
- In-memory dataset registry with lazy dataset materialization

## Core Backend Modules

- `src/mobula/data/schema.py`
  - canonical dims
  - dataset model and validation
  - reorder-to-canonical utilities
- `src/mobula/data/loaders.py`
  - FITS/HDF5/Zarr ingestion
  - metadata extraction and dim normalization
  - optional canonical padding
- `src/mobula/service/registry.py`
  - dataset registry
  - built-in demo dataset specs
  - optional seeded-manifest lazy datasets
- `src/mobula/service/api_routes_core.py`
  - health, dataset listing, local file picker, local loader, dataset metadata
- `src/mobula/service/api_routes_ingest.py`
  - inspect, plan, commit ingest endpoints
- `src/mobula/service/api_routes_views.py`
  - slice, volume, intensity-range, multispectral, EVPA
  - cutout export/save and PNG snapshot save endpoints
- `src/mobula/service/api_routes_profiles.py`
  - ROI stats, plane profiles, and HEALPix pixel-index profile endpoints
- `src/mobula/service/view_service.py`
  - compatibility facade for extracted view-domain modules
- `src/mobula/service/views/`
  - `slice.py`, `volume.py`, `multispectral.py`, `evpa.py`, `export.py`, `serialization.py`
  - separated compute and serialization paths for hot view endpoints
- `src/mobula/service/profile_service.py`
  - ROI and profile computations
- `src/mobula/service/ingest_service.py`
  - ingest orchestration facade and capability grouping
- `src/mobula/service/ingest/`
  - `models.py`, `session_store.py`, `presets.py`, `inspect.py`, `plan.py`, `commit.py`
  - ingest session state, preset persistence, shared ingest records, and staged ingest orchestration
- `src/mobula/service/spectral_rgb.py`
  - spectral-to-visible RGB conversion helpers
- `src/mobula/service/perf.py`
  - JSON serialization timing and response-size instrumentation

## Architectural Invariants

- The canonical internal axis order is always `sample,pol,t,nu,x,y,z`.
- Loaders and ingest flows may accept other source orders, but data is normalized into the canonical axis model before registry storage.
- Browser state is authoritative for interaction context such as:
  - plane choice
  - ROI selection
  - zoom / pan state
  - playback windows
  - color normalization window
- API routes are expected to stay thin:
  - validate request shape
  - resolve dataset access
  - dispatch domain work
  - serialize the response
- Static assets have one canonical source tree: `src/mobula/static/`.

## Frontend Structure

- `src/mobula/static/index.html`: UI layout and control groups
- `src/mobula/static/app.js`: current composition root and high-level viewer orchestration
- `src/mobula/static/app_gpu.js`: GPU renderer paths
- `src/mobula/static/app_interactions.js`: pointer/drag/zoom interaction handlers
- `src/mobula/static/app_requests.js`: API query parameter builders and fetch timing capture
- `src/mobula/static/app_state_transitions.js`: dataset/plane reset behavior
- `src/mobula/static/viewer_constants.js`: viewer defaults, ramps, and plane metadata
- `src/mobula/static/viewer_dom.js`: DOM lookup and stable element ownership
- `src/mobula/static/viewer_playback.js`: playback timers, pacing, and refinement flow
- `src/mobula/static/viewer_state.js`: state creation and normalization helpers
- `src/mobula/static/viewer_perf.js`: opt-in browser perf store and `?perf=1` readout

### Frontend Ownership Rules

- `index.html` owns semantic structure and stable element ids.
- `app.js` should compose subsystems rather than absorb all new logic.
- Pure helpers should live in dedicated viewer modules instead of accumulating in the composition root.
- Browser modules should depend on explicit arguments or state handles rather than hidden globals where practical.

### View-Fit and Zoom Contract (Frontend)

The main canvas fit/zoom behavior is implemented in `src/mobula/static/app.js` (`getViewRect`, `getDrawRect`, `shouldUseCoverView`, `getRenderGeometry`).

- Full-view: preserve source aspect, centered in canvas.
- Zoom-in: use cover behavior so the canvas is fully occupied.
- Zoom-out: restore full-view centered aspect behavior.
- Sphere view geometry is projection-stable and not panel-shaped:
  - `Mollweide` keeps map-native aspect.
  - `Inside`/`Outside` keep fixed circular/square basis.

## Data Flow

1. Dataset enters via a built-in demo registry entry, the `/api/ingest/*` flow, or legacy `/api/load-local`.
2. Loader/ingest parses the source, applies inferred or user-selected mappings, reorders to the internal axis order, and validates.
3. Registry stores dataset summary; data is fetched by endpoint handlers.
4. View/profile services compute requested slice/volume/profile payloads.
5. Frontend requests JSON or binary scalar payloads and renders via CPU or GPU path.

## Canonical Contracts

- Internal axis model: `sample,pol,t,nu,x,y,z`
- User-provided `dims` do not need to be in that order; loaders normalize them after mapping
- Coordinates: one 1D coordinate array per present dim
- Units: one unit label per present dim + one intensity unit
- Responses return selected indices and corresponding coordinate values
- Dataset changes clear dataset-scoped exploration state in the browser instead of trying to translate stale ROI or zoom state across unrelated data.

## Performance Strategies

- Lazy dataset generation/loading for demos and seeded manifests
- Optional 2D downsampling using `max_pixels`
- Progressive playback rendering in frontend
- Configurable backend selection (`Auto`, `GPU`, `CPU`) for slice and volume paths
- Request timing headers: request, compute, serialization, dataset cache/load, response bytes
- Opt-in browser perf readout and `window.__mobulaPerf` snapshots for fetch/render analysis
- `window.__mobulaDebug.getStateSnapshot()` for inspectable browser-state assertions in tests and manual debugging
- Gzip compression for larger JSON responses to reduce transport cost
- Binary scalar transport for hot slice and volume endpoints
- Performance work should distinguish:
  - numeric compute time
  - serialization cost
  - payload transfer size
  - browser parse and render cost
