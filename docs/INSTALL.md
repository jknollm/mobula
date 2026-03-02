# Installation Guide

This guide installs mobula for local development and demo usage.

## Requirements

- macOS or Linux
- Python 3.10+
- `pip`
- Modern browser with WebGL2 support (Chrome, Edge, Firefox, Safari)

Optional:

- Linux only: `zenity` for native file/folder picker integration

## Option A: One-command start (recommended)

From repository root:

```bash
./run_demo.sh
```

What this does:

- Creates `.venv/` if missing
- Installs dependencies from `requirements.txt`
- Seeds local example files into `data/seeded/` (if missing)
- Starts the app at `http://127.0.0.1:8000`

Open:

- Viewer: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`

## Option B: Manual setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
PYTHONPATH=src uvicorn mobula.main:app --host 127.0.0.1 --port 8000 --reload
```

## Install Notes

- The backend serves static UI assets from `static/`; no separate frontend build step is required.
- The app loads with built-in demo datasets automatically.
- `run_demo.sh` suppresses `pip` and seeding output unless there is an error.

## Verify Installation

Run these checks in another terminal:

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/datasets
```

Expected:

- `{"status":"ok"}` for health
- A non-empty dataset list for datasets
