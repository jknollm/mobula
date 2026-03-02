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

- Use supported extensions: `.h5`, `.hdf5`, `.fits`, `.fit`, `.fts`, `.zarr`.

Symptom:

- `missing 'dims' attribute`

Fix:

- Provide dims manually during load.
- In UI, enter mapping when prompted.
- In API, send `dims` in request body.

Symptom:

- `dims length (...) does not match array ndim (...)`

Fix:

- Ensure provided dim list length equals array rank.

Symptom:

- `unknown dimensions` or `dims contain duplicates`

Fix:

- Use unique names from canonical dim set only.

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
