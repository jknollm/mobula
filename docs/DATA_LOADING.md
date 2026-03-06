# Data Loading and Ingest Mapping

mobula uses a fixed internal axis set:

```text
sample, pol, t, nu, x, y, z
```

When you map a file, use the axes in the file's native axis order. mobula reorders internally after loading. Missing axes are allowed and are padded to singleton size during ingest commit.

## Ingest Flow (Inspect -> Plan -> Commit)

Data ingest is a three-step flow:

1. `inspect`: parse files and infer axis/grouping candidates without creating datasets.
2. `plan`: apply user mapping choices, validate strict compatibility, and preview resulting shapes/dataset count.
3. `commit`: materialize datasets only after explicit confirmation.

In the UI, **Load Data** and drag-and-drop open the ingest wizard and do not auto-create tabs before commit.

For multi-file imports, the UI adds an intent step:

- `Combine files into one dataset`
- `Create separate datasets (multi-tab)`

For HDF5 files with multiple numeric arrays, the UI can also add an HDF5 key-selection step before axis mapping.

## Supported Formats

- HDF5: `.h5`, `.hdf5`
- FITS: `.fits`, `.fit`, `.fts`
- Zarr: `.zarr` (directory, path-based loading)

## Loader Behavior by Format

### HDF5

Expected primary dataset path: `values`.

Preferred metadata:

- `values.attrs["dims"]` as comma-separated string or list
- optional `values.attrs["unit_<dim>"]`
- optional `values.attrs["intensity_unit"]`
- optional coordinate arrays at `coords/<dim>`

Current ingest behavior:

- If `values` is missing, inspect chooses the best numeric dataset candidate and warns when the choice is ambiguous.
- The mapper can select one or more dataset keys.
- Multiple selected keys must share shape and use a `key_stack_axis` mapped onto source axis 0.
- Four-way `I/Q/U/V` HDF5 groups are surfaced as a quick Stokes stacking option when detected.

If `dims` metadata is missing and no explicit dims are passed in legacy direct load, loading fails.

### FITS

- Uses HDU 0 by default
- Attempts dim inference from `CTYPE*`
- Falls back to trailing canonical dims when inference is ambiguous
- Reads axis units from `CUNIT*`
- Uses `BUNIT` for intensity unit and `RADESYS`/`WCSNAME` for frame
- Expands 3-channel polarization axes to `I,Q,U,V` by assuming `V=0`

### Zarr

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

Notes:

- `.zarr` is supported through path-based loading and the legacy direct-load API.
- Drag-and-drop upload is file-only and does not support `.zarr` folders.

## Manual Axis Mapping

During ingest mapping, each source axis is assigned in file order by dragging axis chips onto the source-axis slots.

Allowed axis labels:

- `sample`, `pol`, `t`, `nu`, `x`, `y`, `z`
- `sphere` (UI-only alias for a HEALPix pixel axis; stored internally as canonical `x`)

Mapping rules:

- Each file axis can map to at most one canonical axis.
- Duplicate assignments within a file are rejected.
- Mapping length must match the selected array rank.
- `pol` axis size must be `1`, `3`, or `4`.
- `sphere` requires `npix = 12 * nside^2` with power-of-two `nside`.

## Multi-File Grouping

Combine mode can stack files along:

- `sample`
- `pol`
- `t`
- `nu`

Strict combine behavior:

- Every non-grouping dimension must match exactly across files.
- The grouping dimension must be singleton in each input before stacking.
- Low-confidence grouping suggestions default back to separate datasets.

## Padding Missing Dimensions

During ingest commit, each mapped dataset is padded to the full internal axis model by inserting singleton axes for missing dimensions.

Example:

Input dims:

```text
x, y
```

Padded dims:

```text
sample, pol, t, nu, x, y, z
```

## Common Ingest Errors

- `unsupported file extension`: suffix not in supported list
- `missing 'dims' attribute`: HDF5/Zarr dim metadata missing
- `unknown dimensions`: dim names outside canonical set
- `dims contain duplicates`: repeated axis names
- `dims length (...) does not match array ndim (...)`: mismatch between provided dims and array rank
- `select at least one data key`: HDF5 import has no selected numeric dataset
- `selected data keys must share the same shape`: HDF5 key stacking requires identical shapes
- `axis 0 must be assigned to key-stack axis ...`: multi-key HDF5 stacking axis mismatch
- `pol axis must have size 1, 3, or 4`: invalid polarization channel count
- `sphere axis requires HEALPix npix=12*nside^2 ...`: invalid HEALPix pixel count
- `axis '<dim>' must be singleton ... for strict file-axis combine`: combine mode requires singleton along the selected file identity axis
- `shape mismatch on dim ...`: combine mode requires exact shape match on all non-grouping dimensions

See [Troubleshooting](./TROUBLESHOOTING.md) for fixes.
