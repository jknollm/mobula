from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Any

from mobula.service.api_models import FileMappingDecision, MappingDecision, MappingPreset, PresetSignature


class _PresetStore:
    def __init__(self, path: Path, project_scope: str) -> None:
        self._path = path
        self._project_scope = project_scope
        self._lock = RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"version": 1, "presets": []}
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"version": 1, "presets": []}
        if not isinstance(payload, dict):
            return {"version": 1, "presets": []}
        presets = payload.get("presets")
        if not isinstance(presets, list):
            payload["presets"] = []
        return payload

    def _write(self, payload: dict[str, Any]) -> None:
        text = json.dumps(payload, indent=2, sort_keys=True)
        self._path.write_text(f"{text}\n", encoding="utf-8")

    def find_matches(self, signature: PresetSignature | None) -> list[MappingPreset]:
        if signature is None:
            return []
        with self._lock:
            payload = self._read()
            out: list[MappingPreset] = []
            for row in payload.get("presets", []):
                if not isinstance(row, dict):
                    continue
                if row.get("project_scope") != self._project_scope:
                    continue
                sig = row.get("signature")
                if not isinstance(sig, dict):
                    continue
                if (
                    sig.get("format") != signature.format
                    or int(sig.get("ndim", -1)) != signature.ndim
                    or list(sig.get("native_dim_labels", [])) != signature.native_dim_labels
                    or list(sig.get("axis_order_hint", [])) != signature.axis_order_hint
                ):
                    continue
                try:
                    out.append(
                        MappingPreset(
                            preset_id=str(row.get("preset_id", "")),
                            name=str(row.get("name", "Saved Mapping")),
                            project_scope=self._project_scope,
                            signature=signature,
                            default_dims=[str(d) for d in row.get("default_dims", [])],
                            default_grouping_mode=str(row.get("default_grouping_mode", "separate")),
                            default_tab_mode=str(row.get("default_tab_mode", "single_tab")),
                            confidence=float(row.get("confidence", 0.92)),
                            rationale=str(row.get("rationale", "Strong signature match from prior import.")),
                            last_used_at=row.get("last_used_at"),
                        )
                    )
                except Exception:
                    continue
            out.sort(key=lambda item: item.confidence, reverse=True)
            return out

    def get(self, preset_id: str) -> MappingPreset | None:
        with self._lock:
            payload = self._read()
            for row in payload.get("presets", []):
                if not isinstance(row, dict):
                    continue
                if str(row.get("preset_id", "")) != preset_id:
                    continue
                sig_payload = row.get("signature")
                if not isinstance(sig_payload, dict):
                    continue
                try:
                    return MappingPreset(
                        preset_id=preset_id,
                        name=str(row.get("name", "Saved Mapping")),
                        project_scope=self._project_scope,
                        signature=PresetSignature(
                            format=str(sig_payload.get("format", "")),
                            ndim=int(sig_payload.get("ndim", 0)),
                            native_dim_labels=[str(x) for x in sig_payload.get("native_dim_labels", [])],
                            axis_order_hint=[str(x) for x in sig_payload.get("axis_order_hint", [])],
                        ),
                        default_dims=[str(d) for d in row.get("default_dims", [])],
                        default_grouping_mode=str(row.get("default_grouping_mode", "separate")),
                        default_tab_mode=str(row.get("default_tab_mode", "single_tab")),
                        confidence=float(row.get("confidence", 0.92)),
                        rationale=str(row.get("rationale", "")),
                        last_used_at=row.get("last_used_at"),
                    )
                except Exception:
                    return None
            return None

    def upsert(
        self,
        *,
        signature: PresetSignature | None,
        decision: MappingDecision,
        mappings: list[FileMappingDecision],
    ) -> None:
        if signature is None or not mappings:
            return
        default_dims = list(mappings[0].dims)
        if not default_dims:
            return

        key = json.dumps(
            {
                "scope": self._project_scope,
                "signature": signature.model_dump(mode="json"),
                "dims": default_dims,
                "grouping": decision.grouping_mode,
                "tab_mode": decision.tab_mode,
            },
            sort_keys=True,
        )
        stable = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
        preset_id = f"preset-{stable}"

        now = datetime.now(UTC).isoformat()
        row = {
            "preset_id": preset_id,
            "name": "Recent Mapping",
            "project_scope": self._project_scope,
            "signature": signature.model_dump(mode="json"),
            "default_dims": default_dims,
            "default_grouping_mode": decision.grouping_mode,
            "default_tab_mode": decision.tab_mode,
            "confidence": 0.92,
            "rationale": "Matches previously confirmed ingest layout.",
            "last_used_at": now,
        }

        with self._lock:
            payload = self._read()
            presets = [x for x in payload.get("presets", []) if isinstance(x, dict)]
            replaced = False
            for idx, existing in enumerate(presets):
                if str(existing.get("preset_id", "")) == preset_id:
                    presets[idx] = row
                    replaced = True
                    break
            if not replaced:
                presets.append(row)
            payload["presets"] = presets
            self._write(payload)


__all__ = ["_PresetStore"]
