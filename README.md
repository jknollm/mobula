<p>
  <picture>
    <source srcset="./src/mobula/static/assets/mobula_banner_black.svg" type="image/svg+xml" />
    <img src="./src/mobula/static/assets/mobula_banner_black.png" alt="MOBULA - Navigating Domains" width="780" />
  </picture>
</p>

mobula is a local-first viewer for exploring complex scientific cube data without breaking analytical context.

It is built for workflows where spatial structure, time, spectrum, polarization, sample variation, and uncertainty all matter at once. Instead of treating those as separate tools or post-hoc checks, mobula keeps them linked in one interactive workspace so you can pivot between views without rebuilding your interpretation from scratch.

Today that means a FastAPI backend plus a browser UI for loading local datasets, inspecting them in slice/volume/sphere views, and moving fluidly between spatial, temporal, spectral, polarization, and uncertainty-oriented analysis.

## What We Are Building

mobula is aimed at a few product-level goals:

- One coordinated exploration workflow across spatial, temporal, spectral, polarization, sample, and uncertainty domains
- Uncertainty as a first-class part of interpretation, not something deferred until the end
- Stable, predictable behavior when users change plane, mode, dataset, or rendering path
- Local, inspectable, reproducible analysis that does not depend on a remote service

The running contract for intended viewer behavior lives in [docs/EXPECTED_BEHAVIOR.md](./docs/EXPECTED_BEHAVIOR.md). When the app and the docs disagree, that mismatch should be made explicit and resolved deliberately.

## Current Product Shape

The app currently provides:

- Guided local ingest for FITS, HDF5, NPZ, and Zarr-based data
- A fixed internal axis model: `sample, pol, t, nu, x, y, z`
- Linked 2D slice views across `XY`, `YZ`, and `ZX`
- 3D volume rendering for valid spatial cubes
- HEALPix sphere views for compatible spherical datasets
- Selection-driven time, spectral, and hidden-axis profiles
- Sample-aware viewing modes including `single`, `mean`, `std`, `rel_uncert`, mosaics, and morph playback
- Polarization workflows including `I/Q/U/V`, EVPA overlays, and derived polarization quantities
- Local export and snapshot flows tied to the currently rendered state

## Quick Start

```bash
./run_demo.sh
```

Open:

- Viewer: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

## Install CLI

```bash
python -m pip install .
mobula
```

For a host-native install that includes Apple Silicon Metal support when applicable:

```bash
python -m pip install ".[native]"
mobula
```

Optional flags:

```bash
mobula --host 127.0.0.1 --port 8000 --reload
```

## Documentation

- [Docs Index](./docs/README.md)
- [Installation Guide](./docs/INSTALL.md)
- [Quickstart](./docs/QUICKSTART.md)
- [Feature Overview](./docs/FEATURES.md)
- [User Guide](./docs/USER_GUIDE.md)
- [API Reference](./docs/API.md)
- [Data Loading and Axis Mapping](./docs/DATA_LOADING.md)
- [Expected Behavior](./docs/EXPECTED_BEHAVIOR.md)
- [Performance Baseline](./docs/PERFORMANCE_BASELINE.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Development Guide](./docs/DEVELOPMENT.md)
- [Software Publication Package](./publication/README.md)
- [Contributing](./CONTRIBUTING.md)

## Local Development

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev,native]"
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
python scripts/benchmark.py --dataset movie-2d-pol-hd --n 40 --warmup 10
```

Regenerate brand banners:

```bash
python scripts/generate_brand_banners.py
```

## Scope And Delivery

- Local data workflows only
- Python package install supported via the `mobula` CLI
- Frontend served as static assets by FastAPI
- Acceleration paths are optional and should improve responsiveness without hiding behavior

## Native Acceleration Install

- `./run_demo.sh` and `requirements.txt` install `.[dev,native]`.
- The `native` extra is host-aware:
  - Apple Silicon macOS installs the Metal/MPS dependency set
  - other currently supported hosts fall back to the base CPU dependency set
- Existing environments can be upgraded with:

```bash
mobula install-acceleration --apply
```
