from __future__ import annotations

from mobula.service.acceleration.registry import normalize_compute_backend_mode, resolve_compute_backend_selection


def _snapshot(*, native_backend: str = "cpu", cuda: bool = False, metal: bool = False) -> dict[str, object]:
    return {
        "platform": {"system": "Darwin" if metal else "Linux"},
        "backends": {
            "cpu": {"available": True, "reason": None},
            "cuda": {"available": cuda, "reason": None if cuda else "CUDA unavailable"},
            "metal": {"available": metal, "reason": None if metal else "Metal unavailable"},
        },
        "native_backend": native_backend,
    }


def test_normalize_compute_backend_mode_accepts_legacy_gpu_alias() -> None:
    assert normalize_compute_backend_mode("gpu") == "native"


def test_auto_prefers_native_accelerated_backend() -> None:
    selection = resolve_compute_backend_selection("auto", capability_snapshot=_snapshot(native_backend="cuda", cuda=True))
    assert selection.requested_mode == "auto"
    assert selection.backend_name == "cuda"
    assert selection.fallback_reason is None


def test_native_falls_back_to_cpu_with_reason() -> None:
    selection = resolve_compute_backend_selection("native", capability_snapshot=_snapshot(native_backend="metal", metal=False))
    assert selection.backend_name == "cpu"
    assert selection.fallback_reason is not None
    assert "fallback" in selection.fallback_reason.lower()


def test_explicit_unavailable_backend_falls_back_to_cpu() -> None:
    selection = resolve_compute_backend_selection("metal", capability_snapshot=_snapshot(native_backend="cpu", metal=False))
    assert selection.backend_name == "cpu"
    assert selection.fallback_reason is not None
    assert "metal" in selection.fallback_reason.lower()


def test_auto_uses_cpu_for_small_metal_workloads() -> None:
    selection = resolve_compute_backend_selection(
        "auto",
        capability_snapshot=_snapshot(native_backend="metal", metal=True),
        workload_elements=250_000,
    )
    assert selection.backend_name == "cpu"
    assert selection.fallback_reason is not None
    assert "threshold" in selection.fallback_reason.lower()


def test_explicit_metal_bypasses_small_workload_policy() -> None:
    selection = resolve_compute_backend_selection(
        "metal",
        capability_snapshot=_snapshot(native_backend="metal", metal=True),
        workload_elements=250_000,
    )
    assert selection.backend_name == "metal"
    assert selection.fallback_reason is None
