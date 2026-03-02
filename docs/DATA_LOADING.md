# Data Loading and Axis Mapping

mobula normalizes all datasets into canonical axis order:

```text
sample, pol, t, nu, x, y, z
```

Missing axes are allowed. Axis order must be a subsequence of canonical order.

## Supported Formats

- HDF5: `.h5`, `.hdf5`
- FITS: `.fits`, `.fit`, `.fts`
- Zarr: `.zarr` (directory)

## Loader Behavior by Format

## HDF5

Expected primary dataset path: `values`.

Preferred metadata:

- `values.attrs["dims"]` as comma-separated string or list
- optional `values.attrs["unit_<dim>"]`
- optional `values.attrs["intensity_unit"]`
- optional coordinate arrays at `coords/<dim>`

If `dims` is missing and no explicit dims are passed, loading fails.

## FITS

- Uses HDU 0 by default
- Attempts dim inference from `CTYPE*`
- Falls back to trailing canonical dims when inference is ambiguous
- Reads axis units from `CUNIT*`
- Uses `BUNIT` for intensity unit and `RADESYS`/`WCSNAME` for frame

## Zarr

Expected array key: `values`.

Dim metadata accepted:

- `values.attrs["dims"]`
- `values.attrs["_ARRAY_DIMENSIONS"]` (xarray style)

Coordinates accepted from either:

- `coords/<dim>` arrays
- root-level one-dimensional coord arrays named by dim (`xarray`-style)

Intensity unit accepted from:

- `values.attrs["intensity_unit"]`
- fallback `values.attrs["units"]`

## Manual Axis Mapping

When source metadata is incomplete, pass `dims` explicitly:

```json
{"path":"/abs/path/cube.h5","dims":["t","nu","x","y"]}
```

In the UI, if loading fails for missing/invalid dims, you are prompted to enter mapping in file order.

Allowed dim names:

- `sample`, `pol`, `t`, `nu`, `x`, `y`, `z`

## Padding Missing Dimensions

Set `pad_missing_dims: true` during `/api/load-local` to add singleton canonical axes.

Example:

Input dims:

```text
x, y
```

Padded dims:

```text
sample, pol, t, nu, x, y, z
```

## Common Loading Errors

- `unsupported file extension`: suffix not in supported list
- `missing 'dims' attribute`: HDF5/Zarr dim metadata missing
- `unknown dimensions`: dim names outside canonical set
- `dims contain duplicates`: repeated axis names
- `dims length (...) does not match array ndim (...)`: mismatch between provided dims and array rank

See [Troubleshooting](./TROUBLESHOOTING.md) for fixes.
