from __future__ import annotations

import platform
from functools import lru_cache
from typing import Any


def _base_snapshot() -> dict[str, Any]:
    return {
        "platform": {
            "system": platform.system(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": platform.python_version(),
        },
        "backends": {
            "cpu": {
                "available": True,
                "reason": None,
            },
            "cuda": {
                "available": False,
                "reason": None,
            },
            "metal": {
                "available": False,
                "reason": None,
            },
        },
        "native_backend": "cpu",
    }


def _probe_cuda() -> dict[str, Any]:
    out: dict[str, Any] = {
        "available": False,
        "reason": None,
    }
    try:
        import cupy as cp
    except Exception:
        out["reason"] = "CuPy is not installed"
        return out
    try:
        device_count = int(cp.cuda.runtime.getDeviceCount())
    except Exception as exc:
        out["reason"] = f"CUDA runtime unavailable: {exc}"
        return out
    if device_count < 1:
        out["reason"] = "No CUDA device detected"
        return out

    out["available"] = True
    out["reason"] = None
    out["device_count"] = device_count
    try:
        props = cp.cuda.runtime.getDeviceProperties(0)
        name = props.get("name", b"")
        out["device_name"] = name.decode("utf-8", errors="replace") if isinstance(name, bytes) else str(name)
    except Exception:
        pass
    try:
        out["cupy_version"] = str(cp.__version__)
    except Exception:
        pass
    return out


def _probe_metal() -> dict[str, Any]:
    out: dict[str, Any] = {
        "available": False,
        "reason": None,
    }
    if platform.system() != "Darwin":
        out["reason"] = "Metal backend is only available on Darwin"
        return out
    try:
        import torch
    except Exception:
        out["reason"] = "PyTorch is not installed"
        return out
    try:
        mps = getattr(torch.backends, "mps", None)
        if mps is None:
            out["reason"] = "PyTorch was built without MPS support"
            return out
        if not bool(mps.is_built()):
            out["reason"] = "PyTorch MPS backend is not built"
            return out
        if not bool(mps.is_available()):
            out["reason"] = "PyTorch MPS backend is unavailable on this machine"
            return out
    except Exception as exc:
        out["reason"] = f"Unable to query PyTorch MPS support: {exc}"
        return out

    out["available"] = True
    out["reason"] = None
    out["device"] = "mps"
    try:
        out["torch_version"] = str(torch.__version__)
    except Exception:
        pass
    return out


def _resolve_native_backend(snapshot: dict[str, Any]) -> str:
    system = str(snapshot.get("platform", {}).get("system", "")).lower()
    metal = snapshot["backends"]["metal"]
    cuda = snapshot["backends"]["cuda"]
    if system == "darwin" and metal.get("available") is True:
        return "metal"
    if cuda.get("available") is True:
        return "cuda"
    if metal.get("available") is True:
        return "metal"
    return "cpu"


@lru_cache(maxsize=1)
def probe_compute_capabilities() -> dict[str, Any]:
    snapshot = _base_snapshot()
    snapshot["backends"]["cuda"] = _probe_cuda()
    snapshot["backends"]["metal"] = _probe_metal()
    snapshot["native_backend"] = _resolve_native_backend(snapshot)
    return snapshot
