# Troubleshooting

## App Does Not Start

Symptom:

- `ModuleNotFoundError: No module named 'mobula'`

Fix:

- Start with `PYTHONPATH=src`.
- Or use `./run_demo.sh`, which sets it for you.

Symptom:

- `python3: command not found`

Fix:

- Install Python 3.10+ and re-run setup.

## Picker Fails on Linux

Symptom:

- UI status shows `System picker failed: ...`

Cause:

- Linux native picker depends on `zenity`.

Fix:

- Install `zenity`.
- Or load datasets via API directly (`POST /api/load-local`).

## Local Load Fails

Symptom:

- `unsupported file extension`

Fix:

- Use supported extensions: `.h5`, `.hdf5`, `.fits`, `.fit`, `.fts`, `.npz`, `.zarr`.

Symptom:

- `missing 'dims' attribute`

Fix:

- Provide dims manually during legacy direct load.
- In the ingest UI, remap axes in source-file order.
- In API, send `dims` in request body.

Symptom:

- `dims length (...) does not match array ndim (...)`

Fix:

- Ensure provided dim list length equals array rank.

Symptom:

- `unknown dimensions` or `dims contain duplicates`

Fix:

- Use unique names from the supported axis set only: `sample`, `pol`, `t`, `nu`, `x`, `y`, `z`.
- The order can match the source array; mobula reorders internally after load.

Symptom:

- `select at least one data key`

Fix:

- In the HDF5 key-selection step, choose a numeric dataset before continuing.

Symptom:

- `axis 0 must be assigned to key-stack axis ...`

Fix:

- When stacking multiple HDF5 dataset keys, map source axis 0 to the selected key-stack axis.

Symptom:

- `sphere axis requires HEALPix npix=12*nside^2 ...`

Fix:

- Only assign the `sphere` mapper label to axes whose size is a valid HEALPix pixel count.

## Slice/Volume Request Errors

Symptom:

- `invalid sample_mode`

Fix:

- Use one of: `single`, `mean`, `std`, `rel_uncert`.

Symptom:

- `index for dim '...' out of bounds`

Fix:

- Check axis sizes from `/api/datasets/{data_id}/meta` and clamp indices.

Symptom:

- `plane_x and plane_y must be different`

Fix:

- Choose two different plane dimensions.

## Multispectral Errors

Symptom:

- `need at least 3 spectral channels for multispectral RGB`

Fix:

- Ensure selected `nu` window includes at least 3 channels.

Symptom:

- `multispectral view requires plane without 'nu'`

Fix:

- Set plane to spatial axes, for example `x` and `y`.

## EVPA Not Available

Symptom:

- EVPA toggle disabled or endpoint returns error

Fix:

- Use dataset with polarization axis containing at least I/Q/U channels.
- Use `XY` plane in slice mode.
- Avoid volume mode for EVPA overlay.

## Performance Feels Slow

Actions:

- Switch slice backend to `GPU` or `Auto`.
- Reduce playback speed.
- Use `max_pixels` (via API) for large slice views.
- In volume mode, lower quality (`Draft` or `Balanced`).
- Use smaller datasets for exploratory workflows.
