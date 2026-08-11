import importlib.util
from pathlib import Path

_GENERATOR_PATH = Path(__file__).parents[1] / "scripts/generate_scientific_colormaps.py"
_SPEC = importlib.util.spec_from_file_location("scientific_colormap_generator", _GENERATOR_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_GENERATOR = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_GENERATOR)
read_float_table = _GENERATOR.read_float_table
hex_lut = _GENERATOR.hex_lut


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
