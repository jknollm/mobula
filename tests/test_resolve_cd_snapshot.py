from __future__ import annotations

from pathlib import Path


STATIC = Path(__file__).parents[1] / "src" / "mobula" / "static"


def test_resolve_identity_snapshot_records_current_canonical_source() -> None:
    tokens = (STATIC / "resolve_tokens.css").read_text(encoding="utf-8")

    assert "Resolve identity tokens 0.3.0-draft" in tokens
    assert (
        "0ce5c1a8a70d0620084ca71db1fdaaf0c34f1e4a9011032b8d370873b4d8c1d2"
        in tokens
    )
    assert "--r-type-meta-size: 10px" in tokens
    assert "--r-type-label-size: 11px" in tokens
    assert '--r-map-residual-paper: "cyan_coral.paper"' in tokens
    assert '--r-map-residual-night: "cyan_coral.night"' in tokens


def test_resolve_scientific_color_snapshot_records_current_registry() -> None:
    colors = (STATIC / "scientific_colormaps.js").read_text(encoding="utf-8")

    assert (
        '"resolveCdRegistry":"be3fe277215d5721ce8a68990e3698f1e73048f6567fa59590218a312fd2a34b"'
        in colors
    )
    assert colors.count('"sourceVersion":"resolve-cyan-coral-1.0"') == 2
    assert colors.count('"lutEntries":257') == 2
