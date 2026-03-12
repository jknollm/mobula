from __future__ import annotations

import json
from pathlib import Path

from mobula.service.api_models import FileMappingDecision, MappingDecision, PresetSignature
from mobula.service.ingest.presets import _PresetStore


def _signature() -> PresetSignature:
    return PresetSignature(
        format="hdf5",
        ndim=2,
        native_dim_labels=["x", "y"],
        axis_order_hint=["x", "y"],
    )


def _decision() -> MappingDecision:
    return MappingDecision(grouping_mode="separate", tab_mode="single_tab")


def _mapping() -> FileMappingDecision:
    return FileMappingDecision(raw_input_id="raw-1", dims=["x", "y"])


def test_preset_store_recovers_from_corrupt_json(tmp_path: Path) -> None:
    store_path = tmp_path / "presets.json"
    store_path.write_text("{ not json", encoding="utf-8")
    store = _PresetStore(store_path, "project-a")

    assert store.find_matches(_signature()) == []
    assert store.get("preset-missing") is None

    store.upsert(signature=_signature(), decision=_decision(), mappings=[_mapping()])
    payload = json.loads(store_path.read_text(encoding="utf-8"))
    assert payload["version"] == 1
    assert len(payload["presets"]) == 1


def test_preset_store_upsert_replaces_matching_preset_in_place(tmp_path: Path) -> None:
    store = _PresetStore(tmp_path / "presets.json", "project-a")

    store.upsert(signature=_signature(), decision=_decision(), mappings=[_mapping()])
    first_payload = json.loads((tmp_path / "presets.json").read_text(encoding="utf-8"))
    first_preset = first_payload["presets"][0]

    store.upsert(signature=_signature(), decision=_decision(), mappings=[_mapping()])
    second_payload = json.loads((tmp_path / "presets.json").read_text(encoding="utf-8"))

    assert len(second_payload["presets"]) == 1
    assert second_payload["presets"][0]["preset_id"] == first_preset["preset_id"]
    assert second_payload["presets"][0]["default_dims"] == ["x", "y"]
    assert second_payload["presets"][0]["last_used_at"] >= first_preset["last_used_at"]


def test_preset_store_filters_matches_by_project_scope(tmp_path: Path) -> None:
    store_path = tmp_path / "presets.json"
    store_a = _PresetStore(store_path, "project-a")
    store_b = _PresetStore(store_path, "project-b")

    store_a.upsert(signature=_signature(), decision=_decision(), mappings=[_mapping()])

    assert len(store_a.find_matches(_signature())) == 1
    assert store_b.find_matches(_signature()) == []
