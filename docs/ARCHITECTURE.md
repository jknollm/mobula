# Architecture

mobula is a single-process FastAPI app serving both API endpoints and static browser UI.

## Runtime Topology

- FastAPI app in `src/mobula/main.py`
- API router under `/api` composed in `src/mobula/service/api_router.py`
- Static frontend served from `src/mobula/static/` (with repo-level `static/` fallback)
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
  - view payload construction and statistical summaries
- `src/mobula/service/profile_service.py`
  - ROI and profile computations
- `src/mobula/service/ingest_service.py`
  - input inspection, axis inference, HDF5 key selection, multi-file plan validation, preset reuse
- `src/mobula/service/spectral_rgb.py`
  - spectral-to-visible RGB conversion helpers

## Frontend Structure

- `src/mobula/static/index.html`: UI layout and control groups
- `src/mobula/static/app.js`: main state machine, rendering orchestration, event wiring
- `src/mobula/static/app_gpu.js`: GPU renderer paths
- `src/mobula/static/app_interactions.js`: pointer/drag/zoom interaction handlers
- `src/mobula/static/app_requests.js`: API query parameter builders

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
5. Frontend requests JSON payloads and renders via CPU or GPU path.

## Canonical Contracts

- Internal axis model: `sample,pol,t,nu,x,y,z`
- User-provided `dims` do not need to be in that order; loaders normalize them after mapping
- Coordinates: one 1D coordinate array per present dim
- Units: one unit label per present dim + one intensity unit
- Responses return selected indices and corresponding coordinate values

## Performance Strategies

- Lazy dataset generation/loading for demos and seeded manifests
- Optional 2D downsampling using `max_pixels`
- Progressive playback rendering in frontend
- Configurable backend selection (`Auto`, `GPU`, `CPU`) for slice and volume paths
