# API Reference

Base URL (local default):

```text
http://127.0.0.1:8000
```

Interactive OpenAPI docs:

- `GET /docs`

## Conventions

Common axis index query params (as applicable):

- `sample`, `pol`, `t`, `nu`, `x`, `y`, `z`

Common mode query params:

- `sample_mode`: `single`, `mean`, `std`, `rel_uncert`
- `range_mode`: `none`, `time`, `spectral`, `time_spectral`, `space`, `full`

Optional projection query param:

- `project_dims`: comma-separated dims to reduce by mean (for example `project_dims=t,nu`)

## Health and Dataset Discovery

### `GET /api/health`

Returns service health status.

Example response:

```json
{"status": "ok"}
```

### `GET /api/datasets`

Lists loaded and lazily-available dataset summaries.

### `GET /api/datasets/{data_id}/meta`

Returns metadata and coordinate summaries.

Includes:

- `dims`, `shape`, `coords`, `units`
- `wcs`, `provenance`, `uncertainty`
- `pol_labels` when available
- `sphere` summary for HEALPix-like layouts, including inferred `ordering`

## Ingest API (Inspect / Plan / Commit)

### `POST /api/ingest/inspect`

Parses one or many local paths and/or uploaded files, infers axis/grouping candidates, and opens a short-lived ingest session.

Request format: multipart form data.

- `paths_json`: JSON list of absolute local paths (optional)
- `files`: uploaded files (`.h5`, `.hdf5`, `.fits`, `.fit`, `.fts`, `.npz`) (optional)

At least one source is required.

Notes:

- Path-based inspect accepts `.zarr` folders; multipart upload does not.
- HDF5 and NPZ inspection metadata include numeric dataset candidates and the currently preferred default key when available.

Response includes:

- `inspection_id`, `expires_at`
- per-file parsed shape/dtype/native labels
- inferred axis candidates and confidence
- grouping candidates and warnings
- optional preset suggestions

### `POST /api/ingest/plan`

Builds a deterministic plan from `inspection_id` and user mapping decisions.

Request body:

```json
{
  "inspection_id": "insp-abc123",
  "decision": {
    "grouping_mode": "separate",
    "tab_mode": "single_tab",
    "combined_data_id": "optional-combined-id",
    "file_mappings": [
      {
        "raw_input_id": "raw-1",
        "dims": ["pol", "x", "y"],
        "ignore": false,
        "dataset_paths": ["science/I", "science/Q", "science/U", "science/V"],
        "key_stack_axis": "pol"
      }
    ]
  }
}
```

Optional per-file mapping fields:

- `dataset_path`: selected data key for HDF5
- `dataset_paths`: ordered HDF5 key list for same-shape key stacking
- `key_stack_axis`: canonical axis used for stacked HDF5 keys; must also be mapped onto source axis 0
- `sphere_axis`: source-axis index to validate and tag as a HEALPix pixel axis

Response includes:

- `plan_id`
- projected canonical shapes per resulting dataset
- `canonical_dims`, always the full internal 7D axis model
- strict errors (for incompatible combine)
- `is_valid` gating commit

### `POST /api/ingest/commit`

Materializes datasets for a previously validated `plan_id`.

Request body:

```json
{"plan_id": "plan-xyz987"}
```

Response includes:

- `created_data_ids`
- `tab_mode` materialization hint
- warnings

### Ingest limits and TTL

Environment variables:

- `MOBULA_INGEST_MAX_TOTAL_BYTES` (default `8 GiB`)
- `MOBULA_INGEST_MAX_FILE_BYTES` (default `8 GiB`)
- `MOBULA_INGEST_MAX_FILES` (default `256`)
- `MOBULA_INGEST_SESSION_TTL_SECONDS` (default `1800`)

## Local File Loading (Legacy Direct Load)

These endpoints still work, but the browser UI now uses the ingest flow above by default.

### `POST /api/fs/pick`

Opens the native host picker.

Request body (optional):

```json
{"target": "file"}
```

Allowed `target` values:

- `file`
- `folder`

Response shape:

```json
{
  "canceled": false,
  "path": "/abs/path/to/file.fits",
  "exists": true,
  "is_dir": false,
  "is_file": true,
  "loadable": true
}
```

### `POST /api/load-local`

Loads a local dataset path and registers it as `data_id`.

Request body:

```json
{
  "path": "/abs/path/to/cube.h5",
  "data_id": "my-cube",
  "dims": ["t", "nu", "x", "y"],
  "pad_missing_dims": true
}
```

Notes:

- `dims` is optional and used when source metadata is incomplete.
- `dims` should follow the source array order; the server reorders internally.
- `pad_missing_dims` inserts singleton canonical axes in order.

### `POST /api/upload-local`

Uploads and registers a dataset via multipart form data.

Supported upload suffixes:

- `.h5`, `.hdf5`, `.fits`, `.fit`, `.fts`

Notes:

- `.zarr` upload is not supported through multipart; use `POST /api/load-local` with a folder path.
- `dims` is optional, must be comma-separated when provided, and should follow source array order.

## View Endpoints

### `GET /api/datasets/{data_id}/slice`

Returns 2D slice payload.

Key params:

- `plane_x`, `plane_y` (default `x`,`y`)
- `max_pixels` (optional downsample budget)
- axis index params and `sample_mode`
- optional `project_dims`

Response includes:

- `plane_dims`, `shape`, `full_shape`, `sampling_step`
- `selected_indices`, `selected_coords`
- `coords` and axis units
- `stats`
- flattened `values`

### `GET /api/datasets/{data_id}/volume`

Returns flattened 3D volume payload over `x,y,z`.

Supports axis selection, `sample_mode`, and optional `project_dims`.

### `GET /api/datasets/{data_id}/intensity-range`

Computes summary range stats for variation scopes.

Key params:

- `range_mode`
- `plane_x`, `plane_y`
- optional windows: `t0`,`t1`,`nu0`,`nu1`
- optional `project_dims`

Response includes `vary_dims`, `windowed_dims`, and aggregate stats.

### `GET /api/datasets/{data_id}/multispectral`

Returns an RGB composite built from spectral bins.

Requirements:

- dataset includes `nu`
- selected `nu` window contains at least 3 channels
- plane cannot include `nu`

Response includes:

- `bands.blue|green|red` coord ranges and `bands.unit`
- `bands.compute_backend_requested` and `bands.compute_backend` (`cpu` or `gpu`)
- flattened channel arrays at `values.r`, `values.g`, `values.b`

Optional params:

- `compute_backend`: `auto` (default), `cpu`, `gpu`
  - `auto` prefers GPU conversion for larger multispectral requests and falls back to CPU if unavailable.

### `GET /api/datasets/{data_id}/evpa`

Returns EVPA tick vectors for `x,y` slices with polarization data.

Key params:

- `step` (`4..32`)
- `min_fraction` (`0..1`)
- `i_min_fraction` (`0..1`)
- optional `project_dims`

## Export and Snapshot Endpoints

### `GET /api/datasets/{data_id}/export-cutout`

Exports a FITS cutout attachment.

Key params:

- plane selection: `plane_x`, `plane_y`
- spatial bounds on selected plane: `u0`,`u1`,`v0`,`v1`
- optional windows: `t0`,`t1`,`nu0`,`nu1`
- axis indices and `sample_mode`

### `POST /api/datasets/{data_id}/export-cutout/save`

Builds a cutout and writes it directly to disk.

Request body:

```json
{
  "format": "fits",
  "output_dir": "/abs/path",
  "filename": "cutout.fits",
  "overwrite": true,
  "sample_mode": "single",
  "plane_x": "x",
  "plane_y": "y",
  "u0": 2,
  "u1": 8,
  "v0": 1,
  "v1": 6,
  "t0": 1,
  "t1": 4,
  "nu0": 0,
  "nu1": 6,
  "pixel_indices": [0, 5, 17, 18]
}
```

Notes:

- `format` supports `fits` and `hdf5`.
- `pixel_indices` explicit HEALPix export is currently allowed for `hdf5` only.
- When `format="fits"` and `pixel_indices` is provided, the endpoint returns `400`.

### `POST /api/datasets/{data_id}/save-images`

Saves one or more PNG snapshots to disk.

Request body:

```json
{
  "output_dir": "/abs/path",
  "overwrite": true,
  "images": [
    {
      "filename": "viewer.png",
      "data_url": "data:image/png;base64,..."
    }
  ]
}
```

## Selection and Analysis Endpoints

### `POST /api/datasets/{data_id}/roi-stats`

Computes sample-based ROI summary stats in `x,y`.

### `POST /api/datasets/{data_id}/profiles`

Returns time and spectral profiles over an `x,y` ROI.

### `POST /api/datasets/{data_id}/profiles-plane`

Returns time/spectral profiles for an arbitrary plane ROI and also returns the remaining spatial-axis profile when available.

### `POST /api/datasets/{data_id}/profiles-healpix`

Returns time/spectral profiles for an explicit list of HEALPix pixel indices.

Example request:

```json
{
  "pixel_indices": [0, 1, 2, 3, 4],
  "sample": 0,
  "pol": 0,
  "t": 0,
  "nu": 0,
  "y": 0,
  "z": 0
}
```

## Error Semantics

Common status codes:

- `400`: invalid mode/bounds/payload/unsupported combination
- `404`: dataset or file path not found
- `409`: output file already exists when `overwrite=false`
- `422`: FastAPI validation error
- `500`: backend runtime/internal error

Common `400` examples:

- `invalid sample_mode: ...`
- `invalid range_mode: ...`
- `index for dim 'nu' out of bounds: ...`
- `plane_x and plane_y must be different`
- `pixel_indices export requires plane_x='x'`
