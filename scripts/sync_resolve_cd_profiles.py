#!/usr/bin/env python3
"""Refresh only Resolve-owned profiles in Mobula's generated registry."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from generate_scientific_colormaps import render_payload, resolve_cd_records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = args.output.read_text(encoding="utf-8")
    marker = "const PAYLOAD = "
    start = source.index(marker) + len(marker)
    payload, _ = json.JSONDecoder().raw_decode(source[start:].lstrip())
    replacements = resolve_cd_records(args.registry)
    payload["maps"] = [replacements.get(record["id"], record) for record in payload["maps"]]
    payload["sourceHashes"].pop("resolveProfileAnchors", None)
    payload["sourceHashes"]["resolveCdRegistry"] = hashlib.sha256(
        args.registry.read_bytes()
    ).hexdigest()
    args.output.write_text(render_payload(payload), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
