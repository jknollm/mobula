# API Reference

Base URL (local default):

```text
http://127.0.0.1:8000
```

Interactive OpenAPI docs:

- `GET /docs`

## Health and Dataset Discovery

### `GET /api/health`

Returns service health status.

Example response:

```json
{"status": "ok"}
```

### `GET /api/datasets`

Lists loaded and lazily-available dataset summaries.

Response shape:

```json
{
  "datasets": [
    {
      "data_id": "demo-quicklook-7d-pol-samples",
      "dims": ["sample", "pol", "t", "nu", "x", "y", "z"],
      "shape": [4, 4, 12, 16, 80, 80, 2],
      "intensity_unit": "arb",
      "source": "demo-generated"
    }
  ]
}
```

### `GET /api/datasets/{data_id}/meta`

Returns metadata and coordinate summaries.

Includes:

- `dims`, `shape`, `coords`, `units`
- `wcs`, `provenance`, `uncertainty`
- `pol_labels` when available

## Local File Loading

### `POST /api/fs/pick`

Opens native host path picker.

Request body (optional):

```json
{"target": "file"}
```

Allowed target values:

- `file`
- `folder`

Response examples:

```json
{"canceled": true}
```

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

Loads local dataset by extension and registers it under `data_id`.

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
- `pad_missing_dims` inserts singleton canonical axes in order.

Response example:

```json
{
  "loaded": "my-cube",
  "dims": ["sample", "pol", "t", "nu", "x", "y", "z"],
  "shape": [1, 1, 8, 10, 64, 64, 1],
  "path": "/abs/path/to/cube.h5",
  "padded_dims": ["sample", "pol", "z"]
}
```

### `POST /api/upload-local`

Uploads a dataset file with multipart form data and registers it under `data_id`.

Supported upload suffixes:

- `.h5`
- `.hdf5`
- `.fits`
- `.fit`
- `.fts`

Notes:

- `.zarr` drag/drop upload is not supported; use `POST /api/load-local` with a local folder path instead.
- `dims` is optional and should be comma-separated when provided (for example `t,nu,x,y`).

Form fields:

- `file` (required)
- `data_id` (optional)
- `dims` (optional)
- `pad_missing_dims` (optional boolean)

Response example:

```json
{
  "loaded": "upload-h5",
  "dims": ["t", "nu", "x"],
  "shape": [2, 3, 4],
  "path": "upload.h5",
  "padded_dims": []
}
```

## View Endpoints

Common query params (as applicable):

- Axis indices: `sample`, `pol`, `t`, `nu`, `x`, `y`, `z`
- Plane selection: `plane_x`, `plane_y`
- Sampling: `max_pixels`
- Aggregation: `sample_mode`

Supported `sample_mode` values:

- `single`
- `mean`
- `std`
- `rel_uncert`

### `GET /api/datasets/{data_id}/slice`

Returns 2D slice payload.

Example:

```bash
curl "http://127.0.0.1:8000/api/datasets/demo-quicklook-7d-pol-samples/slice?pol=0&t=0&nu=0&z=0&sample_mode=mean&plane_x=x&plane_y=y"
```

Response includes:

- `plane_dims`, `shape`, `full_shape`, `sampling_step`
- `selected_indices`, `selected_coords`
- `coords` and axis units
- `stats`
- flattened `values`

### `GET /api/datasets/{data_id}/volume`

Returns flattened 3D volume (`x,y,z`) for selected indices / sample mode.

### `GET /api/datasets/{data_id}/intensity-range`

Computes summary range stats for different variation scopes.

Supported `range_mode` values:

- `none`
- `time`
- `spectral`
- `time_spectral`
- `space`
- `full`

Optional windows:

- `t0`, `t1`
- `nu0`, `nu1`

### `GET /api/datasets/{data_id}/multispectral`

Returns RGB composite slice built from frequency bands.

Requirements:

- Dataset must include `nu` axis
- At least 3 spectral channels in selected `nu` window
- Plane must not include `nu`

Response includes per-channel flattened arrays under `values.r`, `values.g`, `values.b`.

### `GET /api/datasets/{data_id}/evpa`

Returns EVPA tick vectors for XY slices with polarization data.

Important params:

- `step` (4-32)
- `min_fraction` (0-1)
- `i_min_fraction` (0-1)

## Selection/Analysis Endpoints

### `POST /api/datasets/{data_id}/roi-stats`

Computes sample-based ROI summary stats.

Request:

```json
{"x0": 10, "x1": 20, "y0": 12, "y1": 22, "pol": 0, "t": 0, "nu": 0, "z": 0}
```

Response includes:

- `sample_count`, `pixel_count`
- `stats.mean`, `stats.std`, `stats.q16`, `stats.q50`, `stats.q84`
- `per_sample_means`

### `POST /api/datasets/{data_id}/profiles`

Returns time and spectral profiles for ROI in XY coordinates.

Request:

```json
{"x0": 8, "x1": 14, "y0": 9, "y1": 15, "pol": 0, "t": 0, "nu": 0, "z": 0}
```

### `POST /api/datasets/{data_id}/profiles-plane`

Returns time/spectral profiles for arbitrary plane selection and region bounds.

Request:

```json
{
  "plane_x": "y",
  "plane_y": "z",
  "u0": 4,
  "u1": 10,
  "v0": 0,
  "v1": 2,
  "sample": 0,
  "pol": 0,
  "t": 0,
  "nu": 0,
  "x": 12
}
```

Also returns remaining spatial-axis profile when available.

## Error Semantics

Common status codes:

- `400`: invalid sample/range mode, invalid bounds, unsupported format, parsing/validation failure
- `404`: dataset not found, path does not exist
- `422`: FastAPI input validation error
- `500`: backend internal error (for example native picker runtime failure)

Examples of 400 errors:

- `invalid sample_mode: ...`
- `index for dim 'nu' out of bounds: ...`
- `plane_x and plane_y must be different`
