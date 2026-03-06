# Usage Appendix

This appendix provides reproducible commands and API workflows for the software publication.

## 1. Run Locally

### Fast path

```bash
./run_demo.sh
```

### Manual path

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
PYTHONPATH=src uvicorn mobula.main:app --host 127.0.0.1 --port 8000 --reload
```

Viewer/API:

- `http://127.0.0.1:8000`
- `http://127.0.0.1:8000/docs`

## 2. Install and Run CLI

```bash
python -m pip install .
mobula --host 127.0.0.1 --port 8000 --reload
```

## 3. Dataset Workflow

1. Open the viewer and choose a built-in dataset from the `Dataset` dropdown.
2. For local files, click `Load Data` and choose an HDF5/FITS file or Zarr folder.
3. If dim inference fails, provide manual dim mapping (example: `t,nu,x,y`).
4. Confirm canonical interpretation against expected axes (`sample,pol,t,nu,x,y,z`).

Built-in datasets observed from the running service:

- `movie-2d-pol-hd`
- `time-5d-volume-samples-hd`
- `healpix-sky-time-nu-hd`
- `xy-nu-pol-radio-galaxy`
- `volume-3d-spiral-galaxy`

## 4. Recommended Demonstration Script (UI)

Use this short script when recording figures/videos:

1. Start in `XY` slice mode, select an ROI, and show right-panel profile updates.
2. Move `t` and `nu` controls to show linked profile behavior.
3. Switch `Sample Mode` (`single`, `mean`, `std`, `rel_uncert`).
4. Switch polarization channel (`I/Q/U/V`) and enable EVPA overlay.
5. Enter volume mode and rotate to show 3D context.
6. If HEALPix-compatible, switch to sphere mode and cycle projection type.
7. Toggle colormap/range policy and compare interpretation differences.

## 5. API Calls (Examples)

The exact query parameters are visible in OpenAPI at `/docs`; use these as baseline publication examples.

### List datasets

```bash
curl -s http://127.0.0.1:8000/api/datasets
```

### Query a 2D slice payload

```bash
curl -s "http://127.0.0.1:8000/api/datasets/movie-2d-pol-hd/slice?sample=0&pol=0&t=0&nu=0&z=0&plane_x=x&plane_y=y" \
  | jq '{shape, selected_indices, stats}'
```

### Query ROI profile payload

```bash
curl -s -X POST "http://127.0.0.1:8000/api/datasets/movie-2d-pol-hd/profiles" \
  -H 'Content-Type: application/json' \
  -d '{"x0":20,"x1":60,"y0":20,"y1":60,"pol":0,"t":0,"nu":0,"z":0}' \
  | jq '{pixel_count, selection, time_profile_keys:(.time_profile|keys), spectrum_profile_keys:(.spectrum_profile|keys)}'
```

### Query 3D volume payload

```bash
curl -s "http://127.0.0.1:8000/api/datasets/time-5d-volume-samples-hd/volume?sample=0&t=0&nu=0" \
  | jq '{shape, volume_dims, selected_indices, stats}'
```

### Export cutout (FITS download)

```bash
curl -L "http://127.0.0.1:8000/api/datasets/movie-2d-pol-hd/export-cutout?plane_x=x&plane_y=y&u0=0&u1=63&v0=0&v1=63&sample=0&pol=0&t=0&nu=0" \
  -o cutout.fits
```

## 6. Reproducibility Notes for Publication

- Always record:
  - commit hash,
  - Python version,
  - OS/GPU info,
  - dataset source and shape,
  - selected render backend (`Auto/GPU/CPU`).
- Save the exact UI state used for each figure:
  - `t`, `nu`, `pol`, `sample` indices,
  - colormap,
  - range policy,
  - flux scale,
  - spatial mode.

## 7. Benchmark Hook

When app is running:

```bash
source .venv/bin/activate
python scripts/benchmark.py --dataset movie-2d-pol-hd --n 40 --warmup 10
```

Additional benchmark examples:

```bash
python scripts/benchmark.py --dataset time-5d-volume-samples-hd --n 40 --warmup 10
python scripts/benchmark.py --dataset healpix-sky-time-nu-hd --n 20 --warmup 5
```

Observed results on `2026-03-04` (commit `3e9b3ef`, `Python 3.12.8`, `Apple M1 Pro`):

| Dataset | Slice p50 / p95 / mean (ms) | ROI p50 / p95 / mean (ms) |
| --- | --- | --- |
| `movie-2d-pol-hd` | `18.60 / 137.14 / 34.96` | `7.21 / 121.34 / 31.83` |
| `time-5d-volume-samples-hd` | `17.38 / 33.62 / 22.90` | `10.26 / 127.35 / 40.31` |
| `healpix-sky-time-nu-hd` | `186.46 / 235.37 / 190.71` | `4.09 / 14.40 / 6.01` |

Report the benchmark command and hardware in the manuscript so reviewers can interpret these numbers correctly.
