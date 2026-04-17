# Development Guide

## Local Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev,native]"
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

Run browser smoke coverage:

```bash
pytest tests/browser -q
```

Run lint, format, and targeted type checks:

```bash
ruff check src/mobula/main.py src/mobula/service/view_service.py src/mobula/service/views src/mobula/service/ingest src/mobula/service/ingest_service.py tests/browser/test_smoke.py tests/conftest.py tests/test_api_endpoints.py scripts/generate_brand_banners.py
ruff format --check src/mobula/main.py src/mobula/service/view_service.py src/mobula/service/views src/mobula/service/ingest src/mobula/service/ingest_service.py tests/browser/test_smoke.py tests/conftest.py tests/test_api_endpoints.py scripts/generate_brand_banners.py
mypy src/mobula/data/schema.py src/mobula/service/api_models.py src/mobula/service/api_utils.py
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
python scripts/benchmark.py --dataset movie-2d-pol-hd --n 40 --warmup 10 --response-format json
python scripts/benchmark.py --dataset movie-2d-pol-hd --n 40 --warmup 10 --response-format binary
```

Requires app to be running.

### Inspect browser perf metrics

Run the app and open:

```text
http://127.0.0.1:8000/?perf=1
```

This enables the dev-only perf readout and `window.__mobulaPerf`.

For viewer-state inspection in browser tests or manual debugging, use:

```text
window.__mobulaDebug.getStateSnapshot()
```

## Project Layout

- `src/mobula/`: backend application and data/model logic
- `src/mobula/static/`: canonical browser UI asset tree
- `tests/`: pytest coverage for API, loaders, and registry
- `scripts/`: utility scripts for benchmark and dataset generation
- `data/`: generated dataset artifacts

## Source Of Truth Policy

- Dependencies live in `pyproject.toml`.
- `requirements.txt` is a secondary compatibility wrapper for local tooling; do not edit it as the primary dependency definition.
- Frontend assets live in `src/mobula/static/`.

## Agentic Development Policy

mobula is an agentically coded project. We use coding agents as part of normal development, but the repository standard stays the same: changes should be understandable, testable, and documented when they affect user-visible behavior or contributor expectations.

## License Header Policy

mobula uses a repo-level MIT license, and we are not retrofitting headers across all existing files.

- For new source files, prefer a minimal SPDX header when practical: `SPDX-License-Identifier: MIT`
- Do not churn existing files just to add license headers
- If a file format has an established comment style, use that style for the SPDX line

## Change Checklist

- Update [EXPECTED_BEHAVIOR](./EXPECTED_BEHAVIOR.md) when user-visible behavior changes.
- Update [ARCHITECTURE](./ARCHITECTURE.md) when module ownership or data flow changes materially.
- Add a benchmark, metric, or note to [PERFORMANCE_BASELINE](./PERFORMANCE_BASELINE.md) when changing performance-sensitive paths.

## Current Constraints

- Local-data workflow only; no remote data source integration
- Static frontend delivered directly by backend; no JS build pipeline in repo
