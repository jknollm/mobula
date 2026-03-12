from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from mobula.service.acceleration.capabilities import probe_compute_capabilities
from mobula.service.acceleration.compute_base import (
    ComputeBackendMode,
    ComputeBackendName,
    ComputeBackendUnavailableError,
    MultispectralComputeRequest,
    MultispectralComputeResult,
)
from mobula.service.acceleration.multispectral_cpu import CpuMultispectralBackend
from mobula.service.acceleration.multispectral_cuda import CudaMultispectralBackend
from mobula.service.acceleration.multispectral_metal import MetalMultispectralBackend


LEGACY_BACKEND_ALIASES = {
    "gpu": "native",
}


@dataclass(frozen=True)
class ComputeBackendSelection:
    requested_mode: ComputeBackendMode
    backend_name: ComputeBackendName
    fallback_reason: str | None
    capability_snapshot: dict[str, Any]


@dataclass
class ComputeExecution:
    result: MultispectralComputeResult
    requested_mode: ComputeBackendMode
    backend_used: ComputeBackendName
    fallback_reason: str | None
    capability_snapshot: dict[str, Any]


_BACKENDS = {
    "cpu": CpuMultispectralBackend(),
    "cuda": CudaMultispectralBackend(),
    "metal": MetalMultispectralBackend(),
}
_METAL_AUTO_MIN_ELEMENTS = 2_000_000


def normalize_compute_backend_mode(raw: str | None) -> ComputeBackendMode:
    mode = str(raw or "auto").strip().lower()
    mode = LEGACY_BACKEND_ALIASES.get(mode, mode)
    if mode not in {"auto", "cpu", "native", "cuda", "metal"}:
        raise ValueError("compute_backend must be 'auto', 'cpu', 'native', 'cuda', or 'metal'")
    return mode  # type: ignore[return-value]


def _candidate_backend_for_mode(mode: ComputeBackendMode, snapshot: dict[str, Any]) -> tuple[ComputeBackendName, str | None]:
    native_backend = str(snapshot.get("native_backend", "cpu")).strip().lower()
    backends = snapshot.get("backends", {})
    if mode == "cpu":
        return "cpu", None
    if mode == "auto":
        if native_backend in {"cuda", "metal"} and bool(backends.get(native_backend, {}).get("available")):
            return native_backend, None
        reason = str(backends.get(native_backend, {}).get("reason") or "No local accelerated compute backend is available")
        return "cpu", f"auto resolved to CPU: {reason}"
    if mode == "native":
        if native_backend in {"cuda", "metal"} and bool(backends.get(native_backend, {}).get("available")):
            return native_backend, None
        reason = str(backends.get(native_backend, {}).get("reason") or "No native accelerated compute backend is available")
        return "cpu", f"native fallback to CPU: {reason}"

    selected = mode
    if bool(backends.get(selected, {}).get("available")):
        return selected, None  # type: ignore[return-value]
    reason = str(backends.get(selected, {}).get("reason") or f"{selected} backend is unavailable")
    return "cpu", f"{selected} fallback to CPU: {reason}"


def _apply_workload_policy(
    *,
    mode: ComputeBackendMode,
    backend_name: ComputeBackendName,
    fallback_reason: str | None,
    workload_elements: int | None,
) -> tuple[ComputeBackendName, str | None]:
    if mode not in {"auto", "native"}:
        return backend_name, fallback_reason
    if backend_name != "metal":
        return backend_name, fallback_reason
    if workload_elements is None or workload_elements >= _METAL_AUTO_MIN_ELEMENTS:
        return backend_name, fallback_reason
    reason = (
        f"{mode} resolved to CPU: workload below Metal acceleration threshold "
        f"({workload_elements} < {_METAL_AUTO_MIN_ELEMENTS} elements)"
    )
    return "cpu", reason


def resolve_compute_backend_selection(
    requested_mode: str | None,
    *,
    capability_snapshot: dict[str, Any] | None = None,
    workload_elements: int | None = None,
) -> ComputeBackendSelection:
    snapshot = capability_snapshot or probe_compute_capabilities()
    mode = normalize_compute_backend_mode(requested_mode)
    backend_name, fallback_reason = _candidate_backend_for_mode(mode, snapshot)
    backend_name, fallback_reason = _apply_workload_policy(
        mode=mode,
        backend_name=backend_name,
        fallback_reason=fallback_reason,
        workload_elements=workload_elements,
    )
    return ComputeBackendSelection(
        requested_mode=mode,
        backend_name=backend_name,
        fallback_reason=fallback_reason,
        capability_snapshot=snapshot,
    )


def execute_multispectral_compute(
    request: MultispectralComputeRequest,
    *,
    requested_mode: str | None,
    capability_snapshot: dict[str, Any] | None = None,
) -> ComputeExecution:
    selection = resolve_compute_backend_selection(
        requested_mode,
        capability_snapshot=capability_snapshot,
        workload_elements=int(request.spectral_cube.size),
    )
    backend = _BACKENDS[selection.backend_name]
    try:
        result = backend.compute(request)
        return ComputeExecution(
            result=result,
            requested_mode=selection.requested_mode,
            backend_used=result.backend,
            fallback_reason=selection.fallback_reason,
            capability_snapshot=selection.capability_snapshot,
        )
    except ComputeBackendUnavailableError as exc:
        if selection.backend_name == "cpu":
            raise
        cpu_result = _BACKENDS["cpu"].compute(request)
        fallback_reason = selection.fallback_reason or f"{selection.backend_name} fallback to CPU: {exc.reason}"
        return ComputeExecution(
            result=cpu_result,
            requested_mode=selection.requested_mode,
            backend_used="cpu",
            fallback_reason=fallback_reason,
            capability_snapshot=selection.capability_snapshot,
        )
