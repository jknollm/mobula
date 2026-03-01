#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
python -m pip install -r requirements.txt >/dev/null
PYTHONPATH="${ROOT_DIR}/src" python scripts/seed_local_datasets.py >/dev/null

export PYTHONPATH="${ROOT_DIR}/src"
exec uvicorn ncube.main:app --host 127.0.0.1 --port 8000 --reload
