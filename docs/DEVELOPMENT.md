# Development Guide

## Local Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Run app:

```bash
PYTHONPATH=src uvicorn mobula.main:app --host 127.0.0.1 --port 8000 --reload
```

## Test Suite

Run all tests:

```bash
source .venv/bin/activate
pytest
```

Run a focused test module:

```bash
pytest tests/test_api_endpoints.py -q
```

## Useful Scripts

### Seed local fixtures

```bash
source .venv/bin/activate
PYTHONPATH=src python scripts/seed_local_datasets.py --overwrite
```

Generates:

- `data/seeded/seed_7d_cube.h5`
- `data/seeded/seed_7d_cube.fits`
- `data/seeded/seed_7d_cube.zarr`
- `data/seeded/seed_7d_cube_xarray.zarr`
- `data/seeded/manifest.json`

### Export mock files

```bash
source .venv/bin/activate
PYTHONPATH=src python scripts/export_mock_files.py
```

### Benchmark API

```bash
source .venv/bin/activate
python scripts/benchmark.py --dataset movie-2d-pol-hd --n 40 --warmup 10
```

Requires app to be running.

## Project Layout

- `src/mobula/`: backend application and data/model logic
- `src/mobula/static/`: browser UI assets packaged with the Python distribution
- `static/`: repo-level static fallback used in local development
- `tests/`: pytest coverage for API, loaders, and registry
- `scripts/`: utility scripts for benchmark and dataset generation
- `data/`: generated dataset artifacts

## Current Constraints

- Local-data workflow only; no remote data source integration
- Static frontend delivered directly by backend; no JS build pipeline in repo
