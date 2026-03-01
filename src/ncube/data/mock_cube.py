from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .schema import CANONICAL_DIMS, CubeDataset


@dataclass(slots=True)
class MockCubeConfig:
    sample: int = 6
    pol: int = 4
    t: int = 8
    nu: int = 10
    x: int = 64
    y: int = 64
    z: int = 4
    seed: int = 42
    model: str = "dynamic"


def _build_base_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a dynamic spatial signal across t/nu/z."""
    x = np.linspace(-1.0, 1.0, cfg.x, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, cfg.y, dtype=np.float32)
    xx, yy = np.meshgrid(x, y, indexing="ij")
    rr = np.sqrt(xx**2 + yy**2).astype(np.float32)
    theta = np.arctan2(yy, xx).astype(np.float32)

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            for zi in range(cfg.z):
                zphase = (zi - (cfg.z - 1) / 2.0) / max(cfg.z, 1)
                cx = 0.35 * np.sin(tphase) + 0.15 * np.cos(nphase)
                cy = 0.35 * np.cos(tphase + nphase / 2.0)
                sigma = 0.18 + 0.08 * (1.0 + np.sin(nphase + 0.5 * tphase))
                gauss = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2.0 * sigma**2)).astype(np.float32)
                ring = 0.35 * np.exp(-((rr - (0.45 + 0.05 * np.sin(tphase + zphase))) ** 2) / 0.01)
                wave = 0.12 * np.sin(10.0 * rr + 2.0 * theta + nphase + zphase)
                zweight = 1.0 - 0.18 * abs(zphase)
                base[ti, ni, :, :, zi] = zweight * (gauss + ring + wave)
    return base


def _build_spherical_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a spherically symmetric 3D signal with mild t/nu evolution."""
    x = np.linspace(-1.0, 1.0, cfg.x, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, cfg.y, dtype=np.float32)
    z = np.linspace(-1.0, 1.0, cfg.z, dtype=np.float32)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    rr = np.sqrt(xx**2 + yy**2 + zz**2).astype(np.float32)

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    shell_sigma = np.float32(0.06)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            core_sigma = np.float32(0.23 + 0.02 * np.sin(0.6 * tphase + 0.35 * nphase))
            shell_r = np.float32(0.56 + 0.04 * np.cos(nphase - 0.25 * tphase))
            core = np.exp(-(rr**2) / (2.0 * core_sigma**2)).astype(np.float32)
            shell = np.exp(-((rr - shell_r) ** 2) / (2.0 * shell_sigma**2)).astype(np.float32)
            ripple = 0.08 * np.cos(6.0 * rr + 0.35 * nphase).astype(np.float32)
            base[ti, ni] = 1.15 * core + 0.52 * shell + ripple
    return base


def _build_center_structured_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a centrally bright 3D signal with asymmetric structure."""
    x = np.linspace(-1.0, 1.0, cfg.x, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, cfg.y, dtype=np.float32)
    z = np.linspace(-1.0, 1.0, cfg.z, dtype=np.float32)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    rr = np.sqrt(xx**2 + yy**2 + zz**2).astype(np.float32)
    phi = np.arctan2(yy, xx).astype(np.float32)

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            core_sigma = np.float32(0.23 + 0.02 * np.sin(0.4 * tphase + 0.7 * nphase))
            core = np.exp(-(rr**2) / (2.0 * core_sigma**2)).astype(np.float32)

            shell_r = np.float32(0.44 + 0.05 * np.cos(0.8 * nphase - 0.3 * tphase))
            shell_width = np.float32(0.055)
            shell = np.exp(-((rr - shell_r) ** 2) / (2.0 * shell_width**2)).astype(np.float32)

            helix_mod = np.cos(3.4 * phi + 2.1 * zz + 0.35 * nphase).astype(np.float32)
            helical_ridge = np.exp(-((rr - (0.50 + 0.06 * helix_mod)) ** 2) / (2.0 * (0.04**2))).astype(np.float32)

            jet_profile = np.exp(-(xx**2 + yy**2) / (2.0 * (0.065**2))).astype(np.float32)
            jet = jet_profile * (
                np.exp(-((zz - 0.47) ** 2) / (2.0 * (0.12**2))) + np.exp(-((zz + 0.47) ** 2) / (2.0 * (0.12**2)))
            ).astype(np.float32)

            clump_a = np.exp(-((xx - 0.24) ** 2 + (yy + 0.12) ** 2 + (zz - 0.05) ** 2) / (2.0 * (0.10**2))).astype(
                np.float32
            )
            clump_b = np.exp(-((xx + 0.20) ** 2 + (yy - 0.18) ** 2 + (zz + 0.18) ** 2) / (2.0 * (0.08**2))).astype(
                np.float32
            )
            cavity = np.exp(-((xx - 0.30) ** 2 + (yy + 0.04) ** 2 + (zz + 0.02) ** 2) / (2.0 * (0.13**2))).astype(
                np.float32
            )
            ripple = 0.07 * np.cos(9.0 * rr + 1.8 * phi + 0.25 * nphase).astype(np.float32)

            base[ti, ni] = 1.30 * core + 0.42 * shell + 0.36 * helical_ridge + 0.25 * jet + 0.20 * clump_a + 0.16 * clump_b - 0.28 * cavity + ripple
    return base


def _build_center_structured_time_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a centrally bright 3D signal with stronger temporal evolution."""
    x = np.linspace(-1.0, 1.0, cfg.x, dtype=np.float32)
    y = np.linspace(-1.0, 1.0, cfg.y, dtype=np.float32)
    z = np.linspace(-1.0, 1.0, cfg.z, dtype=np.float32)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    rr = np.sqrt(xx**2 + yy**2 + zz**2).astype(np.float32)
    phi = np.arctan2(yy, xx).astype(np.float32)

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            core_sigma = np.float32(0.21 + 0.05 * np.sin(1.2 * tphase + 0.5 * nphase))
            core = np.exp(-(rr**2) / (2.0 * core_sigma**2)).astype(np.float32)

            shell_r = np.float32(0.43 + 0.08 * np.cos(1.1 * tphase - 0.35 * nphase))
            shell_width = np.float32(0.055)
            shell = np.exp(-((rr - shell_r) ** 2) / (2.0 * shell_width**2)).astype(np.float32)

            helix_mod = np.cos(3.8 * phi + 2.3 * zz + 0.9 * tphase + 0.4 * nphase).astype(np.float32)
            helical_ridge = np.exp(-((rr - (0.49 + 0.07 * helix_mod)) ** 2) / (2.0 * (0.038**2))).astype(np.float32)

            jet_profile = np.exp(-(xx**2 + yy**2) / (2.0 * (0.060**2))).astype(np.float32)
            jet_sep = np.float32(0.40 + 0.10 * np.sin(tphase + 0.4 * nphase))
            jet_w = np.float32(0.10 + 0.03 * np.cos(0.7 * tphase))
            jet = jet_profile * (
                np.exp(-((zz - jet_sep) ** 2) / (2.0 * jet_w**2)) + np.exp(-((zz + jet_sep) ** 2) / (2.0 * jet_w**2))
            ).astype(np.float32)

            ax = np.float32(0.24 * np.cos(0.7 * tphase))
            ay = np.float32(0.18 * np.sin(0.9 * tphase))
            az = np.float32(0.11 * np.cos(1.1 * tphase))
            bx = np.float32(-0.22 + 0.12 * np.sin(0.8 * tphase + 0.5))
            by = np.float32(-0.10 + 0.14 * np.cos(0.6 * tphase + 0.2))
            bz = np.float32(0.18 * np.sin(0.95 * tphase + 1.1))
            clump_a = np.exp(-((xx - ax) ** 2 + (yy - ay) ** 2 + (zz - az) ** 2) / (2.0 * (0.09**2))).astype(np.float32)
            clump_b = np.exp(-((xx - bx) ** 2 + (yy - by) ** 2 + (zz - bz) ** 2) / (2.0 * (0.08**2))).astype(np.float32)

            cavx = np.float32(0.25 * np.cos(0.55 * tphase + 0.8))
            cavy = np.float32(0.16 * np.sin(0.65 * tphase + 0.4))
            cavz = np.float32(0.12 * np.cos(0.5 * tphase + 1.2))
            cavity = np.exp(-((xx - cavx) ** 2 + (yy - cavy) ** 2 + (zz - cavz) ** 2) / (2.0 * (0.14**2))).astype(
                np.float32
            )

            ripple = 0.08 * np.cos(10.0 * rr + 2.4 * phi + 0.35 * nphase + 0.8 * tphase).astype(np.float32)
            pulse = (0.90 + 0.22 * np.sin(tphase + 0.6 * rr * np.pi)).astype(np.float32)

            base[ti, ni] = pulse * (
                1.22 * core + 0.40 * shell + 0.38 * helical_ridge + 0.24 * jet + 0.22 * clump_a + 0.18 * clump_b - 0.30 * cavity
            ) + ripple
    return base


def generate_mock_dataset(
    dataset_id: str = "mock-7d-cube",
    cfg: MockCubeConfig | None = None,
) -> CubeDataset:
    cfg = cfg or MockCubeConfig()
    rng = np.random.default_rng(cfg.seed)
    if cfg.model == "spherical":
        base = _build_spherical_signal(cfg)
    elif cfg.model == "center_structured":
        base = _build_center_structured_signal(cfg)
    elif cfg.model == "center_structured_time":
        base = _build_center_structured_time_signal(cfg)
    else:
        base = _build_base_signal(cfg)

    x = np.linspace(-32.0, 32.0, cfg.x, dtype=np.float32)
    y = np.linspace(-32.0, 32.0, cfg.y, dtype=np.float32)
    z = np.linspace(-2.0, 2.0, cfg.z, dtype=np.float32)

    pol_cube = np.zeros((cfg.pol, cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    pol_cube[0] = base

    if cfg.model == "spherical":
        if cfg.pol > 1:
            pol_cube[1] = 0.06 * base
        if cfg.pol > 2:
            pol_cube[2] = -0.04 * base
        if cfg.pol > 3:
            pol_cube[3] = 0.02 * base
    elif cfg.model == "center_structured" or cfg.model == "center_structured_time":
        if cfg.pol > 1:
            xx, yy = np.meshgrid(x, y, indexing="ij")
            theta = np.arctan2(yy, xx).astype(np.float32)
            q_pat = np.cos(2.0 * theta).astype(np.float32)[None, None, :, :, None]
            pol_cube[1] = 0.24 * base * q_pat
            if cfg.pol > 2:
                u_pat = np.sin(2.0 * theta).astype(np.float32)[None, None, :, :, None]
                pol_cube[2] = 0.20 * base * u_pat
            if cfg.pol > 3:
                zmod = np.tanh(z / max(np.max(np.abs(z)), 1.0e-6)).astype(np.float32)
                v_pat = zmod[None, None, None, None, :]
                pol_cube[3] = 0.10 * base * v_pat
    else:
        if cfg.pol > 1:
            xx, yy = np.meshgrid(x, y, indexing="ij")
            theta = np.arctan2(yy, xx).astype(np.float32)
            swirl = np.sin(2.0 * theta).astype(np.float32)
            pol_cube[1] = 0.55 * base * swirl[None, None, :, :, None]
            if cfg.pol > 2:
                pol_cube[2] = 0.45 * base * np.cos(2.0 * theta).astype(np.float32)[None, None, :, :, None]
            if cfg.pol > 3:
                pol_cube[3] = 0.30 * base * np.sin(4.0 * theta).astype(np.float32)[None, None, :, :, None]

    if cfg.pol > 4:
        for pi in range(4, cfg.pol):
            pol_cube[pi] = (0.15 / (pi - 2)) * pol_cube[1]

    values = np.empty((cfg.sample, cfg.pol, cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for si in range(cfg.sample):
        noise_sigma = 0.035 + 0.01 * (si / max(cfg.sample - 1, 1))
        noise = rng.normal(0.0, noise_sigma, size=pol_cube.shape).astype(np.float32)
        values[si] = pol_cube + noise

    coords: dict[str, np.ndarray] = {
        "sample": np.arange(cfg.sample, dtype=np.int32),
        "pol": np.arange(cfg.pol, dtype=np.int32),
        "t": np.linspace(0.0, 70.0, cfg.t, dtype=np.float32),
        "nu": np.linspace(88.0e9, 112.0e9, cfg.nu, dtype=np.float64),
        "x": x,
        "y": y,
        "z": z,
    }
    units = {
        "sample": "index",
        "pol": "stokes-index",
        "t": "s",
        "nu": "Hz",
        "x": "arcsec",
        "y": "arcsec",
        "z": "channel",
    }

    dataset = CubeDataset(
        data_id=dataset_id,
        dims=CANONICAL_DIMS,
        coords=coords,
        values=values,
        units=units,
        intensity_unit="arb",
        wcs={"frame": "ICRS", "projection": "TAN", "note": "mock synthetic coordinate model"},
        provenance={
            "source": "generated",
            "generator": "generate_mock_dataset",
            "seed": cfg.seed,
            "model": cfg.model,
            "shape": list(values.shape),
            "pol_labels": ["I", "Q", "U", "V"][: cfg.pol],
        },
        uncertainty={"type": "sample-axis", "sample_dim": "sample", "weights": None},
    )
    dataset.validate()
    return dataset
