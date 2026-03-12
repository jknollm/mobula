from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import numpy as np


ComputeBackendMode = Literal["auto", "cpu", "native", "cuda", "metal"]
ComputeBackendName = Literal["cpu", "cuda", "metal"]


class ComputeBackendUnavailableError(RuntimeError):
    def __init__(self, backend: str, reason: str) -> None:
        self.backend = str(backend)
        self.reason = str(reason)
        super().__init__(self.reason)


@dataclass(frozen=True)
class MultispectralComputeRequest:
    spectral_cube: np.ndarray
    wavelength_axis_nm: np.ndarray
    nu_coords: np.ndarray
    intensity_mode: str
    clip_min: float
    clip_max: float
    deslope: float
    normalize_spectrum: bool
    normalize_boost: float


@dataclass
class MultispectralComputeResult:
    backend: ComputeBackendName
    red: np.ndarray
    green: np.ndarray
    blue: np.ndarray
    deslope_ref: float | None = None
    stage_timings_ms: dict[str, float] = field(default_factory=dict)
    diagnostics: dict[str, Any] = field(default_factory=dict)


class MultispectralComputeBackend(Protocol):
    backend_name: ComputeBackendName

    def compute(self, request: MultispectralComputeRequest) -> MultispectralComputeResult:
        ...
