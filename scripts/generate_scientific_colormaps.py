"""Generate Mobula's browser-owned scientific colour-map registry.

The generated adapter is committed so Mobula has no plotting-library runtime
dependency. Inputs are explicit and their hashes are recorded in the output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
from typing import Any

REGISTRY_VERSION = "mobula-science-colors-1"
RESOLVE_PROFILE_IDS = (
    "cyan_coral.paper",
    "cyan_coral.structure",
    "cyan_coral.night",
)

LEGACY_DIVERGING = [[58, 76, 192], [141, 175, 253], [247, 247, 247], [244, 109, 67], [180, 4, 38]]
LEGACY_CIRCULAR = [
    [255, 68, 68],
    [255, 183, 77],
    [234, 255, 77],
    [77, 255, 123],
    [77, 197, 255],
    [173, 92, 255],
    [255, 68, 68],
]


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def lerp_lut(anchors: list[list[int]], size: int = 256) -> list[list[int]]:
    out: list[list[int]] = []
    segments = len(anchors) - 1
    for index in range(size):
        scaled = index * segments / (size - 1)
        lower = min(int(scaled), segments - 1)
        fraction = scaled - lower
        out.append(
            [
                round(anchors[lower][channel] * (1 - fraction) + anchors[lower + 1][channel] * fraction)
                for channel in range(3)
            ]
        )
    return out


def read_float_table(value: str) -> list[list[int]]:
    raw_rows: list[list[float]] = []
    for line in value.splitlines():
        fields = line.replace(",", " ").split()
        if len(fields) < 3:
            continue
        raw_rows.append([float(field) for field in fields[:3]])
    if len(raw_rows) != 256:
        raise ValueError(f"expected 256 RGB rows, found {len(raw_rows)}")

    # Decide the numeric convention once for the complete table. Per-row
    # detection corrupts normalized perceptual tables such as afmhot_us: a few
    # upstream float rows intentionally overshoot 1.0 by about one percent and
    # must still be scaled as normalized RGB rather than rounded to [1, 1, 1].
    normalized = max(channel for row in raw_rows for channel in row) <= 1.1
    factor = 255 if normalized else 1
    return [[max(0, min(255, round(channel * factor))) for channel in row] for row in raw_rows]


def read_zip_text(archive: Path, suffix: str) -> tuple[str, str]:
    with zipfile.ZipFile(archive) as handle:
        names = [name for name in handle.namelist() if name.endswith(suffix)]
        if len(names) != 1:
            raise ValueError(f"expected one {suffix!r} in {archive}, found {names}")
        return names[0], handle.read(names[0]).decode("utf-8")


def matplotlib_luts(python: Path) -> tuple[str, dict[str, list[list[int]]]]:
    code = """
import json
import matplotlib
from matplotlib import colormaps
names = ('viridis', 'plasma', 'inferno')
print(json.dumps({'version': matplotlib.__version__, 'luts': {name: [[round(channel * 255) for channel in colormaps[name](i / 255)[:3]] for i in range(256)] for name in names}}))
"""
    completed = subprocess.run([str(python), "-c", code], check=True, capture_output=True, text=True)
    result: dict[str, Any] = json.loads(completed.stdout)
    return str(result["version"]), result["luts"]


def hex_lut(rows: list[list[int]]) -> str:
    if not rows:
        raise ValueError("expected a non-empty LUT")
    return "".join(f"{r:02x}{g:02x}{b:02x}" for r, g, b in rows)


def resolve_cd_records(registry_path: Path) -> dict[str, dict[str, Any]]:
    """Load exact accepted Resolve profiles instead of reconstructing anchors."""

    registry = json.loads(registry_path.read_text())
    result: dict[str, dict[str, Any]] = {}
    for profile_id in RESOLVE_PROFILE_IDS:
        source = next(record for record in registry["maps"] if record["id"] == profile_id)
        lut_path = registry_path.parent / source["lut"]["path"]
        raw_rows = [line.split() for line in lut_path.read_text().splitlines() if line]
        if len(raw_rows) != source["lut"]["entries"] or any(len(row) != 3 for row in raw_rows):
            raise ValueError(f"Resolve LUT differs from registry metadata: {profile_id}")
        rows = [[max(0, min(255, round(float(channel) * 255))) for channel in row] for row in raw_rows]
        result[profile_id] = record(
            profile_id,
            source["label"],
            source["kind"],
            rows,
            quantity=source["quantity"],
            provenance=source["provenance"],
            license_name=source["license"],
            source_version=source["sourceVersion"],
            normalization=source["normalization"],
            center=source["center"],
            calibration=source["calibration"],
        )
        result[profile_id]["sourceSha256"] = source["lut"]["sha256"]
        result[profile_id]["lutEntries"] = source["lut"]["entries"]
    return result


def record(
    map_id: str,
    label: str,
    kind: str,
    rows: list[list[int]],
    *,
    quantity: str,
    provenance: str,
    license_name: str,
    source_version: str,
    normalization: list[str],
    center: float | None = None,
    seam: str | None = None,
    calibration: str = "authoritative",
) -> dict[str, Any]:
    return {
        "id": map_id,
        "label": label,
        "kind": kind,
        "quantity": quantity,
        "normalization": normalization,
        "center": center,
        "seam": seam,
        "under": "clamp",
        "over": "clamp",
        "invalid": {"alpha": 0, "policy": "transparent"},
        "license": license_name,
        "provenance": provenance,
        "sourceVersion": source_version,
        "calibration": calibration,
        "lutHex": hex_lut(rows),
    }


def render_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, separators=(",", ":"))
    return f"""// Generated by scripts/generate_scientific_colormaps.py. Do not edit by hand.
const PAYLOAD = {encoded};

function decodeLut(hex) {{
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {{
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }}
  return out;
}}

const maps = Object.fromEntries(PAYLOAD.maps.map((entry) => {{
  const {{ lutHex, ...metadata }} = entry;
  return [entry.id, Object.freeze({{ ...metadata, lut: decodeLut(lutHex) }})];
}}));

export const SCIENTIFIC_COLOR_REGISTRY = Object.freeze({{
  version: PAYLOAD.version,
  sourceHashes: Object.freeze(PAYLOAD.sourceHashes),
  invalid: Object.freeze({{ alpha: 0, policy: "transparent" }}),
  maps: Object.freeze(maps),
}});
"""


def generate(args: argparse.Namespace) -> str:
    mpl_version, mpl = matplotlib_luts(args.matplotlib_python)
    afmhot_bytes = args.afmhot_us.read_bytes()
    afmhot = read_float_table(afmhot_bytes.decode("utf-8"))
    oslo_name, oslo_text = read_zip_text(args.scientific_colour_maps, "/oslo/oslo.txt")
    c3_name, c3_text = read_zip_text(args.colorcet, "/CET-C3.csv")
    oslo = read_float_table(oslo_text)
    c3 = read_float_table(c3_text)
    c3_half_turn = c3[128:] + c3[:128]
    resolve_profiles = resolve_cd_records(args.resolve_cd_registry)

    records = [
        record(
            "viridis",
            "Viridis",
            "sequential",
            mpl["viridis"],
            quantity="general scalar",
            provenance="Matplotlib listed colormap",
            license_name="CC0-1.0",
            source_version=f"Matplotlib {mpl_version}",
            normalization=["linear", "log", "sqrt"],
        ),
        record(
            "plasma",
            "Plasma",
            "sequential",
            mpl["plasma"],
            quantity="general scalar",
            provenance="Matplotlib listed colormap",
            license_name="CC0-1.0",
            source_version=f"Matplotlib {mpl_version}",
            normalization=["linear", "log", "sqrt"],
        ),
        record(
            "inferno",
            "Inferno",
            "sequential",
            mpl["inferno"],
            quantity="general scalar",
            provenance="Matplotlib listed colormap",
            license_name="CC0-1.0",
            source_version=f"Matplotlib {mpl_version}",
            normalization=["linear", "log", "sqrt"],
        ),
        record(
            "afmhot_us",
            "afmhot_us",
            "sequential",
            afmhot,
            quantity="positive intensity",
            provenance="ehtplot uniform symmetrized afmhot table",
            license_name="GPL-3.0-or-later",
            source_version="pyehtplot 0.9.0",
            normalization=["linear", "log", "sqrt"],
        ),
        record(
            "gray",
            "Gray",
            "sequential",
            lerp_lut([[0, 0, 0], [255, 255, 255]]),
            quantity="general scalar",
            provenance="Mobula legacy map",
            license_name="MIT",
            source_version=REGISTRY_VERSION,
            normalization=["linear", "log", "sqrt"],
        ),
        record(
            "diverging",
            "Diverging (legacy)",
            "diverging",
            lerp_lut(LEGACY_DIVERGING),
            quantity="signed scalar",
            provenance="Mobula legacy map preserved for compatibility",
            license_name="MIT",
            source_version=REGISTRY_VERSION,
            normalization=["linear", "sqrt"],
            center=0,
        ),
        record(
            "circular",
            "Circular (legacy)",
            "cyclic",
            lerp_lut(LEGACY_CIRCULAR),
            quantity="orientation",
            provenance="Mobula legacy map preserved for compatibility",
            license_name="MIT",
            source_version=REGISTRY_VERSION,
            normalization=["linear"],
            seam="0/1",
        ),
        record(
            "oslo",
            "oslo",
            "sequential",
            oslo,
            quantity="ordered positive uncertainty",
            provenance=f"Scientific Colour Maps 8.0 ({oslo_name})",
            license_name="Scientific Colour Maps licence",
            source_version="8.0.0",
            normalization=["linear", "log", "sqrt"],
        ),
        resolve_profiles["cyan_coral.paper"],
        resolve_profiles["cyan_coral.structure"],
        resolve_profiles["cyan_coral.night"],
        record(
            "phase_c3",
            "ColorCET C3 · half-turn",
            "cyclic",
            c3_half_turn,
            quantity="phase or orientation",
            provenance=f"Peter Kovesi ColorCET ({c3_name}), rotated 128 samples",
            license_name="CC-BY-4.0",
            source_version="ColorCET",
            normalization=["linear"],
            center=0,
            seam="-pi/+pi",
        ),
    ]
    source_hashes = {
        "matplotlibListed": sha256_bytes(json.dumps(mpl, separators=(",", ":")).encode()),
        "afmhot_us": sha256_bytes(afmhot_bytes),
        "scientificColourMaps8": sha256_bytes(args.scientific_colour_maps.read_bytes()),
        "colorCET": sha256_bytes(args.colorcet.read_bytes()),
        "resolveCdRegistry": sha256_bytes(args.resolve_cd_registry.read_bytes()),
    }
    return render_payload({"version": REGISTRY_VERSION, "sourceHashes": source_hashes, "maps": records})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matplotlib-python", type=Path, required=True)
    parser.add_argument("--afmhot-us", type=Path, required=True)
    parser.add_argument("--scientific-colour-maps", type=Path, required=True)
    parser.add_argument("--colorcet", type=Path, required=True)
    parser.add_argument("--resolve-cd-registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = generate(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
