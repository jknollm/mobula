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
- `src/mobula/service/api_routes_views.py`
  - slice, volume, intensity-range, multispectral, EVPA
  - cutout export/save and PNG snapshot save endpoints
- `src/mobula/service/api_routes_profiles.py`
  - ROI stats, plane profiles, and HEALPix pixel-index profile endpoints
- `src/mobula/service/view_service.py`
  - view payload construction and statistical summaries
- `src/mobula/service/profile_service.py`
  - ROI and profile computations

## Frontend Structure

- `src/mobula/static/index.html`: UI layout and control groups
- `src/mobula/static/app.js`: main state machine, rendering orchestration, event wiring
- `src/mobula/static/app_gpu.js`: GPU renderer paths
- `src/mobula/static/app_interactions.js`: pointer/drag/zoom interaction handlers
- `src/mobula/static/app_requests.js`: API query parameter builders

## Data Flow

1. Dataset enters via built-in demo registry entry or `/api/load-local`.
2. Loader parses source, reorders dims into canonical order, and validates.
3. Registry stores dataset summary; data is fetched by endpoint handlers.
4. View/profile services compute requested slice/volume/profile payloads.
5. Frontend requests JSON payloads and renders via CPU or GPU path.

## Canonical Contracts

- Canonical axis order: `sample,pol,t,nu,x,y,z`
- Coordinates: one 1D coordinate array per present dim
- Units: one unit label per present dim + one intensity unit
- Responses return selected indices and corresponding coordinate values

## Performance Strategies

- Lazy dataset generation/loading for demos and seeded manifests
- Optional 2D downsampling using `max_pixels`
- Progressive playback rendering in frontend
- Configurable backend selection (`Auto`, `GPU`, `CPU`) for slice and volume paths
