# mobula

mobula is a local interactive viewer for high-dimensional cube data with canonical axes:

```text
sample, pol, t, nu, x, y, z
```

It includes a FastAPI backend, a browser UI, built-in demo datasets, and local FITS/HDF5/Zarr loading.

## Quick Start

```bash
./run_demo.sh
```

Open:

- Viewer: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

## Documentation

- [Docs Index](./docs/README.md)
- [Installation Guide](./docs/INSTALL.md)
- [Quickstart](./docs/QUICKSTART.md)
- [User Guide](./docs/USER_GUIDE.md)
- [API Reference](./docs/API.md)
- [Data Loading and Axis Mapping](./docs/DATA_LOADING.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Development Guide](./docs/DEVELOPMENT.md)
- [Contributing](./CONTRIBUTING.md)

## Key Capabilities

- Interactive 2D slice navigation across `XY`, `YZ`, `ZX`
- Volume rendering over `x,y,z`
- Time/spectral/hidden-spatial playback and linked profile graphs
- Sample-aware views (`single`, `mean`, `std`, `rel_uncert`) and sample mosaics
- Polarization tools (I/Q/U/V, EVPA overlay, derived polarization modes)
- Color map/range controls and multiple flux scales
- Local file loading via native picker, drag-and-drop (file datasets), and API

## Manual Startup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
PYTHONPATH=src uvicorn mobula.main:app --host 127.0.0.1 --port 8000 --reload
```

## Useful Commands

Run tests:

```bash
source .venv/bin/activate
pytest
```

Seed local fixture datasets:

```bash
source .venv/bin/activate
PYTHONPATH=src python scripts/seed_local_datasets.py --overwrite
```

Run benchmark (app must already be running):

```bash
source .venv/bin/activate
python scripts/benchmark.py --dataset demo-quicklook-7d-pol-samples --n 40 --warmup 10
```

## Current Scope

- Local data workflows only
- No packaging/release pipeline configured yet
- Frontend served as static assets by FastAPI
