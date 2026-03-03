from __future__ import annotations

import os
from pathlib import Path


def default_data_dir() -> Path:
    override = os.environ.get("MOBULA_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".mobula" / "data"


def default_seeded_manifest_path() -> Path:
    return default_data_dir() / "seeded" / "manifest.json"
