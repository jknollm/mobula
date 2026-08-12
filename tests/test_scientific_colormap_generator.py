import importlib.util
import json
from pathlib import Path

_GENERATOR_PATH = Path(__file__).parents[1] / "scripts/generate_scientific_colormaps.py"
_SPEC = importlib.util.spec_from_file_location("scientific_colormap_generator", _GENERATOR_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_GENERATOR = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_GENERATOR)
read_float_table = _GENERATOR.read_float_table
hex_lut = _GENERATOR.hex_lut
resolve_cd_records = _GENERATOR.resolve_cd_records


def test_normalized_table_uses_one_scale_for_small_float_excursions() -> None:
    rows = [f"{index / 255:.8f} {index / 255:.8f} {index / 255:.8f}" for index in range(253)]
    rows.extend(("1.001623 0.990279 0.931788", "1.005280 0.993760 0.962384", "1.010192 0.996584 0.994029"))

    table = read_float_table("\n".join(rows))

    assert table[-3:] == [[255, 253, 238], [255, 253, 245], [255, 254, 253]]


def test_byte_table_is_not_rescaled() -> None:
    rows = [f"{index} {index} {index}" for index in range(256)]

    table = read_float_table("\n".join(rows))

    assert table[1] == [1, 1, 1]
    assert table[-1] == [255, 255, 255]


def test_hex_lut_preserves_257_entry_resolve_profile() -> None:
    rows = [[index % 256, 255 - (index % 256), 128] for index in range(257)]

    encoded = hex_lut(rows)

    assert len(encoded) == 257 * 6
    assert encoded[:6] == "00ff80"
    assert encoded[-6:] == "00ff80"


def test_resolve_profiles_include_distinct_structure_identity(tmp_path: Path) -> None:
    lut = tmp_path / "cyan-coral.txt"
    lut.write_text("\n".join(["0 0.5 1"] * 257), encoding="utf-8")
    profiles = []
    for profile_id in (
        "cyan_coral.paper",
        "cyan_coral.structure",
        "cyan_coral.night",
    ):
        profiles.append(
            {
                "id": profile_id,
                "label": profile_id,
                "kind": "diverging",
                "quantity": "signed scalar",
                "normalization": ["linear", "sqrt"],
                "center": 0,
                "license": "Resolve project",
                "provenance": "test registry",
                "sourceVersion": "test-1",
                "calibration": "test calibration",
                "lut": {
                    "path": lut.name,
                    "entries": 257,
                    "sha256": "test-sha256",
                },
            }
        )
    registry = tmp_path / "registry.json"
    registry.write_text(json.dumps({"maps": profiles}), encoding="utf-8")

    records = resolve_cd_records(registry)

    assert tuple(records) == (
        "cyan_coral.paper",
        "cyan_coral.structure",
        "cyan_coral.night",
    )
    assert records["cyan_coral.structure"]["lutEntries"] == 257
