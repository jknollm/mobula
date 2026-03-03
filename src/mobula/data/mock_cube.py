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


def _unit_axis(n: int) -> np.ndarray:
    """Return symmetric coordinates in [-1, 1], centered when singleton."""
    if n <= 1:
        return np.zeros((1,), dtype=np.float32)
    return np.linspace(-1.0, 1.0, n, dtype=np.float32)


def _physical_axis(lo: float, hi: float, n: int) -> np.ndarray:
    """Return physical coordinates, centered at midpoint when singleton."""
    if n <= 1:
        return np.array([(lo + hi) * 0.5], dtype=np.float32)
    return np.linspace(lo, hi, n, dtype=np.float32)


def _build_base_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a dynamic spatial signal across t/nu/z."""
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
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
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
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


def _healpix_nside_from_npix(npix: int) -> int | None:
    if npix < 12 or npix % 12 != 0:
        return None
    nside = int(round(float(np.sqrt(npix / 12.0))))
    if 12 * nside * nside != npix:
        return None
    if nside <= 0 or (nside & (nside - 1)) != 0:
        return None
    return nside


def _healpix_ring_pix_to_vector(nside: int, ipix: int) -> np.ndarray:
    """Map a HEALPix RING pixel index to unit vector coordinates."""
    npix = 12 * nside * nside
    ncap = 2 * nside * (nside - 1)
    nl2 = 2 * nside
    nl4 = 4 * nside
    ipix1 = ipix + 1

    if ipix1 <= ncap:
        hip = 0.5 * ipix1
        fihip = np.floor(hip)
        iring = int(np.floor(np.sqrt(hip - np.sqrt(fihip))) + 1)
        iphi = ipix1 - 2 * iring * (iring - 1)
        z = 1.0 - (iring * iring) / (3.0 * nside * nside)
        phi = ((iphi - 0.5) * np.pi) / (2.0 * iring)
    elif ipix1 <= npix - ncap:
        ip = ipix1 - ncap - 1
        iring = int(np.floor(ip / nl4) + nside)
        iphi = int(ip % nl4) + 1
        fodd = 0.5 * (1 + ((iring + nside) & 1))
        z = (nl2 - iring) * (2.0 / (3.0 * nside))
        phi = ((iphi - fodd) * np.pi) / nl2
    else:
        ip = npix - ipix1 + 1
        hip = 0.5 * ip
        fihip = np.floor(hip)
        iring = int(np.floor(np.sqrt(hip - np.sqrt(fihip))) + 1)
        iphi = 4 * iring + 1 - (ip - 2 * iring * (iring - 1))
        z = -1.0 + (iring * iring) / (3.0 * nside * nside)
        phi = ((iphi - 0.5) * np.pi) / (2.0 * iring)

    st = np.sqrt(max(0.0, 1.0 - z * z))
    return np.asarray([st * np.cos(phi), st * np.sin(phi), z], dtype=np.float32)


def _healpix_ring_vectors(nside: int) -> np.ndarray:
    npix = 12 * nside * nside
    out = np.empty((npix, 3), dtype=np.float32)
    for ipix in range(npix):
        out[ipix] = _healpix_ring_pix_to_vector(nside, ipix)
    return out


def _unit_vector_from_lon_lat(lon: float, lat: float) -> np.ndarray:
    c = np.cos(lat)
    return np.asarray([c * np.cos(lon), c * np.sin(lon), np.sin(lat)], dtype=np.float32)


def _build_healpix_sky_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a dynamic HEALPix sky map with moving hotspots and filaments."""
    if cfg.y != 1 or cfg.z != 1:
        raise ValueError("healpix_sky model requires y=1 and z=1")
    nside = _healpix_nside_from_npix(cfg.x)
    if nside is None:
        raise ValueError(
            f"healpix_sky requires x to be valid HEALPix npix=12*nside^2 with power-of-two nside; got x={cfg.x}"
        )

    vec = _healpix_ring_vectors(nside).astype(np.float32)
    lon = np.arctan2(vec[:, 1], vec[:, 0]).astype(np.float32)
    lat = np.arcsin(np.clip(vec[:, 2], -1.0, 1.0)).astype(np.float32)

    ref_a = _unit_vector_from_lon_lat(np.deg2rad(42.0), np.deg2rad(18.0))
    ref_b = _unit_vector_from_lon_lat(np.deg2rad(188.0), np.deg2rad(-24.0))
    ref_c = _unit_vector_from_lon_lat(np.deg2rad(312.0), np.deg2rad(11.0))

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    eps = np.float32(1.0e-6)
    for ti in range(cfg.t):
        tphase = np.float32(2.0 * np.pi * ti / max(cfg.t, 1))
        for ni in range(cfg.nu):
            nphase = np.float32(2.0 * np.pi * ni / max(cfg.nu, 1))

            src1 = _unit_vector_from_lon_lat(
                float(0.55 * tphase + 0.35 * nphase),
                float(0.32 * np.sin(0.7 * tphase - 0.4 * nphase)),
            )
            src2 = _unit_vector_from_lon_lat(
                float(2.2 - 0.31 * tphase + 0.5 * nphase),
                float(-0.26 + 0.15 * np.cos(0.5 * tphase + 0.7 * nphase)),
            )
            src3 = _unit_vector_from_lon_lat(
                float(-1.4 + 0.18 * tphase - 0.7 * nphase),
                float(0.05 + 0.2 * np.sin(0.9 * tphase + 0.2 * nphase)),
            )
            anchor = _unit_vector_from_lon_lat(
                float(1.1 + 0.2 * nphase),
                float(-0.25 + 0.1 * np.sin(tphase)),
            )

            dot1 = np.clip(vec @ src1, -1.0, 1.0)
            dot2 = np.clip(vec @ src2, -1.0, 1.0)
            dot3 = np.clip(vec @ src3, -1.0, 1.0)
            dot_anchor = np.clip(vec @ anchor, -1.0, 1.0)
            a1 = np.arccos(dot1).astype(np.float32)
            a2 = np.arccos(dot2).astype(np.float32)
            a3 = np.arccos(dot3).astype(np.float32)
            da = np.arccos(dot_anchor).astype(np.float32)

            hot_1 = np.exp(-(a1 * a1) / (2.0 * (0.18**2))).astype(np.float32)
            hot_2 = np.exp(-(a2 * a2) / (2.0 * (0.14**2))).astype(np.float32)
            hot_3 = np.exp(-(a3 * a3) / (2.0 * (0.11**2))).astype(np.float32)

            ridge_center = (0.12 * np.sin(2.0 * (lon + 0.45 * tphase) - 0.3 * nphase)).astype(np.float32)
            ridge = np.exp(-((lat - ridge_center) ** 2) / (2.0 * (0.11**2))).astype(np.float32)
            equator_band = np.exp(-(lat**2) / (2.0 * (0.35**2))).astype(np.float32)
            ripples = (0.5 + 0.5 * np.sin(5.0 * lon + 2.2 * tphase - 0.5 * nphase)).astype(np.float32) * equator_band

            shock_r = np.float32(0.9 + 0.12 * np.sin(0.8 * tphase - 0.3 * nphase))
            shock = np.exp(-((da - shock_r) ** 2) / (2.0 * (0.07**2))).astype(np.float32)

            dip_a = (vec @ ref_a).astype(np.float32)
            dip_b = (vec @ ref_b).astype(np.float32)
            dip_c = (vec @ ref_c).astype(np.float32)
            background = (0.17 + 0.09 * (dip_a**2) + 0.07 * np.maximum(dip_b, 0.0) + 0.03 * dip_c).astype(np.float32)

            sky = (background + 0.85 * hot_1 + 0.72 * hot_2 + 0.58 * hot_3 + 0.45 * ridge + 0.32 * shock + 0.18 * ripples).astype(
                np.float32
            )
            spectral_weight = np.float32(1.08 - 0.28 * (ni / max(cfg.nu - 1, 1)))
            temporal_mod = np.float32(0.92 + 0.22 * np.sin(tphase + 0.4 * dip_c))
            sky = np.maximum(spectral_weight * temporal_mod * sky, eps)
            sky_peak = float(np.max(sky))
            if sky_peak > 1.0e-8:
                sky = (sky / sky_peak).astype(np.float32)
            base[ti, ni, :, 0, 0] = sky
    return base


def _build_center_structured_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a centrally bright 3D signal with asymmetric structure."""
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
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
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
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


def _build_ring_shock_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a ring-dominated morphology with moving hot spots and mild bar structure."""
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    rr = np.sqrt(xx**2 + yy**2).astype(np.float32)
    theta = np.arctan2(yy, xx).astype(np.float32)

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            ring_r = np.float32(0.44 + 0.07 * np.sin(0.5 * tphase + 0.9 * nphase))
            ring_w = np.float32(0.040 + 0.010 * (1.0 + np.cos(0.8 * nphase - 0.35 * tphase)))
            ring = np.exp(-((rr - ring_r) ** 2) / (2.0 * ring_w**2)).astype(np.float32)

            bar_y0 = np.float32(0.18 * np.sin(0.7 * tphase))
            bar_sigma_y = np.float32(0.09)
            bar_sigma_x = np.float32(0.45 + 0.08 * np.cos(nphase))
            bar = np.exp(-((yy - bar_y0) ** 2) / (2.0 * bar_sigma_y**2) - (xx**2) / (2.0 * bar_sigma_x**2)).astype(
                np.float32
            )

            phi1 = np.float32(0.65 * tphase + nphase)
            h1x = np.float32(ring_r * np.cos(phi1))
            h1y = np.float32(ring_r * np.sin(phi1))
            h2x = np.float32(-0.95 * h1x)
            h2y = np.float32(-0.95 * h1y)
            hotspot_sigma = np.float32(0.065)
            hotspot_1 = np.exp(-((xx - h1x) ** 2 + (yy - h1y) ** 2) / (2.0 * hotspot_sigma**2)).astype(np.float32)
            hotspot_2 = np.exp(-((xx - h2x) ** 2 + (yy - h2y) ** 2) / (2.0 * hotspot_sigma**2)).astype(np.float32)

            corrugation = 0.08 * np.sin(16.0 * rr + 3.0 * theta + 1.1 * nphase).astype(np.float32)
            zenv = np.exp(-((zz - 0.20 * np.sin(tphase)) ** 2) / (2.0 * (0.44**2))).astype(np.float32)

            base[ti, ni] = zenv * (1.05 * ring + 0.35 * bar + 0.46 * hotspot_1 + 0.38 * hotspot_2) + corrugation
    return base


def _build_radio_galaxy_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a core-jet-lobe morphology resembling a classical double radio galaxy."""
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        axis_angle = np.float32(0.55 + 0.07 * np.sin(0.7 * tphase))
        c = np.float32(np.cos(axis_angle))
        s = np.float32(np.sin(axis_angle))
        along = c * xx + s * yy
        across = -s * xx + c * yy

        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            spectral_weight = np.float32(1.10 - 0.26 * (ni / max(cfg.nu - 1, 1)))

            core_sigma = np.float32(0.035 + 0.004 * np.sin(0.4 * nphase))
            core = np.exp(-((xx**2 + yy**2 + (1.5 * zz) ** 2) / (2.0 * core_sigma**2))).astype(np.float32)

            lobe_sep = np.float32(0.58 + 0.03 * np.sin(0.5 * tphase + 0.6 * nphase))
            lobe_long = np.float32(0.24 + 0.02 * np.cos(0.8 * nphase))
            lobe_cross = np.float32(0.13 + 0.015 * np.sin(0.9 * tphase))
            lobe_sigma_z = np.float32(0.30)
            lobe_n = np.exp(
                -(((along - lobe_sep) ** 2) / (2.0 * lobe_long**2) + (across**2) / (2.0 * lobe_cross**2) + (zz**2) / (2.0 * lobe_sigma_z**2))
            ).astype(np.float32)
            lobe_s = np.exp(
                -(((along + lobe_sep) ** 2) / (2.0 * lobe_long**2) + (across**2) / (2.0 * lobe_cross**2) + (zz**2) / (2.0 * lobe_sigma_z**2))
            ).astype(np.float32)

            hotspot_sigma = np.float32(0.055)
            hotspot_n = np.exp(
                -(((along - (lobe_sep + 0.13)) ** 2) / (2.0 * hotspot_sigma**2) + (across**2) / (2.0 * hotspot_sigma**2) + (zz**2) / (2.0 * (0.22**2)))
            ).astype(np.float32)
            hotspot_s = np.exp(
                -(((along + (lobe_sep + 0.11)) ** 2) / (2.0 * hotspot_sigma**2) + (across**2) / (2.0 * hotspot_sigma**2) + (zz**2) / (2.0 * (0.22**2)))
            ).astype(np.float32)

            jet_sigma_across = np.float32(0.020 + 0.003 * np.cos(0.8 * nphase))
            jet_taper = np.clip(1.0 - (np.abs(along) / (lobe_sep + 0.08)), 0.0, 1.0).astype(np.float32)
            jet = np.exp(-((across**2) / (2.0 * jet_sigma_across**2) + (zz**2) / (2.0 * (0.18**2)))).astype(np.float32) * jet_taper

            bridge = np.exp(-((along**2) / (2.0 * (0.32**2)) + (across**2) / (2.0 * (0.050**2)) + (zz**2) / (2.0 * (0.22**2)))).astype(
                np.float32
            )

            cocoon = np.exp(
                -(((along) ** 2) / (2.0 * (0.72**2)) + (across**2) / (2.0 * (0.28**2)) + (zz**2) / (2.0 * (0.35**2)))
            ).astype(np.float32)
            cavity = np.exp(
                -(((along) ** 2) / (2.0 * (0.24**2)) + (across**2) / (2.0 * (0.10**2)) + (zz**2) / (2.0 * (0.16**2)))
            ).astype(np.float32)

            texture = 0.012 * np.cos(10.0 * along + 2.5 * across + 0.9 * nphase + 0.6 * tphase).astype(np.float32)
            asym = np.float32(1.0 + 0.10 * np.sin(0.7 * nphase))
            base[ti, ni] = spectral_weight * (
                0.40 * core
                + 1.05 * (asym * lobe_n + (2.0 - asym) * lobe_s)
                + 0.95 * (hotspot_n + hotspot_s)
                + 0.78 * jet
                + 0.20 * bridge
                + 0.15 * cocoon
                - 0.18 * cavity
            ) + texture * cocoon
    return base


def _assoc_legendre_low(l: int, m: int, x: np.ndarray, sin_theta: np.ndarray) -> np.ndarray:
    """Low-order associated Legendre P_l^m(x), unnormalized, for l<=3."""
    if m < 0 or m > l:
        raise ValueError(f"invalid associated Legendre indices l={l}, m={m}")

    if l == 0 and m == 0:
        return np.ones_like(x, dtype=np.float32)

    if l == 1:
        if m == 0:
            return x.astype(np.float32)
        if m == 1:
            return (-sin_theta).astype(np.float32)

    if l == 2:
        if m == 0:
            return (0.5 * (3.0 * x**2 - 1.0)).astype(np.float32)
        if m == 1:
            return (-3.0 * x * sin_theta).astype(np.float32)
        if m == 2:
            return (3.0 * sin_theta**2).astype(np.float32)

    if l == 3:
        if m == 0:
            return (0.5 * (5.0 * x**3 - 3.0 * x)).astype(np.float32)
        if m == 1:
            return (-1.5 * (5.0 * x**2 - 1.0) * sin_theta).astype(np.float32)
        if m == 2:
            return (15.0 * x * sin_theta**2).astype(np.float32)
        if m == 3:
            return (-15.0 * sin_theta**3).astype(np.float32)

    raise ValueError(f"unsupported associated Legendre order l={l}, m={m}; only l<=3 is implemented")


def _gen_laguerre(k: int, alpha: int, x: np.ndarray) -> np.ndarray:
    """Generalized Laguerre L_k^alpha(x) via three-term recurrence."""
    if k == 0:
        return np.ones_like(x, dtype=np.float32)
    if k == 1:
        return (1.0 + float(alpha) - x).astype(np.float32)

    lkm2 = np.ones_like(x, dtype=np.float32)
    lkm1 = (1.0 + float(alpha) - x).astype(np.float32)
    for n in range(2, k + 1):
        n_f = float(n)
        num = ((2.0 * n_f - 1.0 + float(alpha) - x) * lkm1) - ((n_f - 1.0 + float(alpha)) * lkm2)
        lkn = (num / n_f).astype(np.float32)
        lkm2, lkm1 = lkm1, lkn
    return lkm1


def _hydrogen_radial_mode(n: int, l: int, r: np.ndarray, a0: float) -> np.ndarray:
    """Hydrogen-like radial mode R_nl up to normalization constants."""
    if n < 1 or l < 0 or l >= n:
        raise ValueError(f"invalid hydrogen indices n={n}, l={l}")
    rho = (2.0 * r / (float(n) * a0)).astype(np.float32)
    k = n - l - 1
    lag = _gen_laguerre(k, 2 * l + 1, rho)
    radial = (np.exp(-0.5 * rho) * (rho**l) * lag).astype(np.float32)
    return radial


def _build_hydrogen_orbital_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a centered, richly structured morphology from low-order hydrogen modes."""
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    rr = np.sqrt(xx**2 + yy**2 + zz**2).astype(np.float32)
    rr_safe = np.maximum(rr, 1.0e-6).astype(np.float32)
    cos_theta = (zz / rr_safe).astype(np.float32)
    sin_theta = np.sqrt(np.clip(1.0 - cos_theta**2, 0.0, 1.0)).astype(np.float32)
    phi = np.arctan2(yy, xx).astype(np.float32)

    # Keep radial structure inside the cube while preserving visible nodal shells.
    bohr_scale = 0.50

    # (n, l, m, weight, phase_t_coeff, phase_n_coeff)
    mode_spec = (
        (1, 0, 0, 0.05, 0.00, 0.00),
        (2, 1, 0, 0.20, 0.12, 0.10),
        (2, 1, 1, 0.24, 0.44, 0.28),
        (3, 1, 0, 0.18, 0.22, 0.18),
        (3, 1, 1, 0.22, 0.56, 0.34),
        (3, 2, 0, 0.26, 0.25, 0.24),
        (3, 2, 1, 0.24, 0.60, 0.34),
        (3, 2, 2, 0.28, 0.86, 0.52),
        (4, 3, 1, 0.20, 0.76, 0.30),
        (4, 3, 2, 0.20, 1.02, 0.44),
        (4, 3, 3, 0.22, 1.24, 0.72),
    )

    radial_cache: dict[tuple[int, int], np.ndarray] = {}
    for n, l, _, _, _, _ in mode_spec:
        key = (n, l)
        if key not in radial_cache:
            radial_cache[key] = _hydrogen_radial_mode(n, l, rr, bohr_scale)

    legendre_cache: dict[tuple[int, int], np.ndarray] = {}
    for _, l, m, _, _, _ in mode_spec:
        key = (l, m)
        if key not in legendre_cache:
            legendre_cache[key] = _assoc_legendre_low(l, m, cos_theta, sin_theta)

    cos_mphi: dict[int, np.ndarray] = {}
    sin_mphi: dict[int, np.ndarray] = {}
    for _, _, m, _, _, _ in mode_spec:
        if m > 0 and m not in cos_mphi:
            cos_mphi[m] = np.cos(float(m) * phi).astype(np.float32)
            sin_mphi[m] = np.sin(float(m) * phi).astype(np.float32)

    edge_envelope = np.exp(-(rr**2) / (2.0 * (0.52**2))).astype(np.float32)
    boundary_taper = np.clip((1.0 - xx**2) * (1.0 - yy**2) * (1.0 - zz**2), 0.0, 1.0).astype(np.float32) ** np.float32(0.30)
    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            intensity = np.zeros_like(rr, dtype=np.float32)
            mode_fields: list[np.ndarray] = []

            for n, l, m, weight, wt, wn in mode_spec:
                radial = radial_cache[(n, l)]
                plm = legendre_cache[(l, m)]
                phase = float(wt * tphase + wn * nphase)
                if m == 0:
                    angular = plm
                else:
                    cp = np.float32(np.cos(phase))
                    sp = np.float32(np.sin(phase))
                    angular = (plm * (cos_mphi[m] * cp + sin_mphi[m] * sp)).astype(np.float32)
                orbital = (radial * angular).astype(np.float32)
                orbital_peak = float(np.max(np.abs(orbital)))
                if orbital_peak > 1.0e-7:
                    orbital = (orbital / orbital_peak).astype(np.float32)
                mode_fields.append(orbital)
                mode_power = (orbital * orbital).astype(np.float32)
                mode_peak = float(np.max(mode_power))
                if mode_peak > 1.0e-7:
                    mode_power = (mode_power / mode_peak).astype(np.float32)
                intensity += np.float32(weight) * mode_power

            cross = np.zeros_like(rr, dtype=np.float32)
            cross_pairs = (
                (1, 5, 0.14),
                (2, 7, 0.12),
                (3, 8, 0.10),
                (4, 9, 0.10),
                (6, 10, 0.08),
            )
            for a_idx, b_idx, w in cross_pairs:
                if a_idx < len(mode_fields) and b_idx < len(mode_fields):
                    cross += np.float32(w) * np.abs(mode_fields[a_idx] * mode_fields[b_idx]).astype(np.float32)

            shell_r1 = np.float32(0.30 + 0.02 * np.sin(0.32 * tphase + 0.16 * nphase))
            shell_r2 = np.float32(0.48 + 0.03 * np.cos(0.28 * tphase + 0.22 * nphase))
            shell1 = np.exp(-((rr - shell_r1) ** 2) / (2.0 * (0.075**2))).astype(np.float32)
            shell2 = np.exp(-((rr - shell_r2) ** 2) / (2.0 * (0.090**2))).astype(np.float32)
            shell_texture = (shell1 + 0.8 * shell2).astype(np.float32)
            angular_texture = (1.0 + 0.15 * (sin_theta**2) * np.cos(2.0 * phi + 0.18 * tphase - 0.12 * nphase)).astype(np.float32)

            composite = np.maximum(
                edge_envelope * boundary_taper * (intensity + 0.70 * cross + 0.10 * shell_texture * angular_texture),
                0.0,
            )
            # Force exact centrosymmetry so the morphology stays centered in the cube.
            composite = 0.5 * (composite + composite[::-1, ::-1, ::-1])
            peak = float(np.max(composite))
            if peak > 1.0e-7:
                composite = (composite / peak).astype(np.float32)
            base[ti, ni] = composite
    return base


def _build_spiral_galaxy_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create a centered 3D galaxy-like morphology from superimposed logarithmic spirals."""
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    rr_xy = np.sqrt(xx**2 + yy**2).astype(np.float32)
    phi = np.arctan2(yy, xx).astype(np.float32)
    rr_safe = np.maximum(rr_xy, 1.0e-3).astype(np.float32)

    def wrap_angle(a: np.ndarray) -> np.ndarray:
        return ((a + np.pi) % (2.0 * np.pi) - np.pi).astype(np.float32)

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    ref_r = np.float32(0.06)
    pitch_a = np.float32(np.deg2rad(19.0))
    pitch_b = np.float32(np.deg2rad(27.0))
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)
            rot = np.float32(0.22 * tphase + 0.12 * nphase)

            bulge = np.exp(-(rr_xy**2) / (2.0 * (0.16**2)) - (zz**2) / (2.0 * (0.12**2))).astype(np.float32)
            bar_u = xx * np.cos(rot) + yy * np.sin(rot)
            bar_v = -xx * np.sin(rot) + yy * np.cos(rot)
            bar = np.exp(-(bar_u**2) / (2.0 * (0.30**2)) - (bar_v**2) / (2.0 * (0.055**2)) - (zz**2) / (2.0 * (0.11**2))).astype(
                np.float32
            )

            disc = np.exp(-rr_xy / np.float32(0.58)).astype(np.float32) * np.exp(-(zz**2) / (2.0 * (0.10**2))).astype(np.float32)

            arms = np.zeros_like(rr_xy, dtype=np.float32)
            arm_count = 4
            arm_sigma = np.float32(0.22)
            for arm in range(arm_count):
                arm_phase = rot + np.float32(2.0 * np.pi * arm / arm_count)
                theta_a = arm_phase + np.log(rr_safe / ref_r).astype(np.float32) / np.tan(pitch_a)
                theta_b = -0.5 * arm_phase + np.log(rr_safe / ref_r).astype(np.float32) / np.tan(pitch_b)
                dphi_a = wrap_angle(phi - theta_a)
                dphi_b = wrap_angle(phi - theta_b)
                arm_a = np.exp(-0.5 * (dphi_a / arm_sigma) ** 2).astype(np.float32)
                arm_b = np.exp(-0.5 * (dphi_b / (arm_sigma * 1.15)) ** 2).astype(np.float32)
                arm_profile = (0.9 * arm_a + 0.55 * arm_b).astype(np.float32)
                radial_window = (1.0 - np.exp(-(rr_xy**2) / (2.0 * (0.11**2)))).astype(np.float32) * np.exp(
                    -(rr_xy**2) / (2.0 * (0.74**2))
                ).astype(np.float32)
                knot_mod = (1.0 + 0.25 * np.cos(11.0 * np.log(rr_safe + 1.0e-3) + 2.0 * phi + 0.6 * tphase + 0.4 * nphase)).astype(
                    np.float32
                )
                arms += arm_profile * radial_window * knot_mod

            warp = np.float32(0.055) * np.sin(2.0 * phi + 0.35 * tphase).astype(np.float32)
            thick = np.exp(-((zz - warp) ** 2) / (2.0 * (0.09**2))).astype(np.float32)

            halo = np.exp(-rr_xy / np.float32(0.95)).astype(np.float32) * np.exp(-(zz**2) / (2.0 * (0.32**2))).astype(np.float32)
            boundary_taper = np.clip(1.0 - (rr_xy / np.float32(0.95)) ** 2, 0.0, 1.0).astype(np.float32) ** np.float32(0.28)
            boundary_taper *= np.clip(1.0 - (np.abs(zz) / np.float32(0.98)) ** 2, 0.0, 1.0).astype(np.float32) ** np.float32(0.20)
            composite = (0.65 * disc + 1.35 * arms * thick + 0.70 * bulge + 0.25 * bar + 0.16 * halo).astype(np.float32)
            composite = (boundary_taper * composite).astype(np.float32)
            composite = np.maximum(composite, 0.0)
            composite = 0.5 * (composite + composite[::-1, ::-1, ::-1])
            peak = float(np.max(composite))
            if peak > 1.0e-7:
                composite = (composite / peak).astype(np.float32)
            base[ti, ni] = composite
    return base


def _build_filamentary_time_signal(cfg: MockCubeConfig) -> np.ndarray:
    """Create braided filament structures with moving knots over time."""
    x = _unit_axis(cfg.x)
    y = _unit_axis(cfg.y)
    z = _unit_axis(cfg.z)
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    rr = np.sqrt(xx**2 + yy**2).astype(np.float32)

    base = np.empty((cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    for ti in range(cfg.t):
        tphase = 2.0 * np.pi * ti / max(cfg.t, 1)
        for ni in range(cfg.nu):
            nphase = 2.0 * np.pi * ni / max(cfg.nu, 1)

            wave1 = 0.30 * np.sin(4.2 * xx + 0.8 * tphase + 0.4 * nphase)
            wave2 = 0.22 * np.cos(3.5 * xx - 1.1 * tphase + 0.6 * nphase)
            wave3 = 0.28 * np.cos(3.1 * yy + 1.3 * tphase - 0.5 * nphase)
            diag_wave = 0.16 * np.sin(2.6 * xx - 0.9 * tphase + 0.3 * nphase)

            fil1 = np.exp(-((yy - wave1) ** 2) / (2.0 * (0.055**2))).astype(np.float32)
            fil2 = np.exp(-((yy + wave2) ** 2) / (2.0 * (0.050**2))).astype(np.float32)
            fil3 = np.exp(-((xx - wave3) ** 2) / (2.0 * (0.060**2))).astype(np.float32)
            fil4 = np.exp(-((yy - (0.58 * xx + diag_wave)) ** 2) / (2.0 * (0.052**2))).astype(np.float32)

            k1x = np.float32(-0.55 + 1.10 * (ti / max(cfg.t - 1, 1)))
            k1y = np.float32(0.18 * np.sin(1.2 * tphase + 0.2 * nphase))
            k2x = np.float32(0.45 * np.cos(0.7 * tphase + 0.4 * nphase))
            k2y = np.float32(-0.42 + 0.84 * (ti / max(cfg.t - 1, 1)))
            k3x = np.float32(-0.40 + 0.78 * (ti / max(cfg.t - 1, 1)))
            k3y = np.float32(-0.12 + 0.62 * (ti / max(cfg.t - 1, 1)))
            knot_1 = np.exp(-((xx - k1x) ** 2 + (yy - k1y) ** 2) / (2.0 * (0.085**2))).astype(np.float32)
            knot_2 = np.exp(-((xx - k2x) ** 2 + (yy - k2y) ** 2) / (2.0 * (0.075**2))).astype(np.float32)
            knot_3 = np.exp(-((xx - k3x) ** 2 + (yy - k3y) ** 2) / (2.0 * (0.070**2))).astype(np.float32)

            fan = np.exp(-((rr - (0.62 - 0.08 * np.sin(0.6 * tphase))) ** 2) / (2.0 * (0.13**2))).astype(np.float32)
            texture = 0.06 * np.cos(22.0 * xx - 18.0 * yy + 0.9 * tphase + 0.3 * nphase).astype(np.float32)
            zenv = (1.0 - 0.22 * np.abs(zz)).astype(np.float32)

            base[ti, ni] = zenv * (
                0.64 * fil1 + 0.50 * fil2 + 0.44 * fil3 + 0.40 * fil4 + 0.26 * knot_1 + 0.23 * knot_2 + 0.21 * knot_3 + 0.16 * fan
            ) + texture
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
    elif cfg.model == "ring_shock":
        base = _build_ring_shock_signal(cfg)
    elif cfg.model == "radio_galaxy":
        base = _build_radio_galaxy_signal(cfg)
    elif cfg.model == "hydrogen_orbitals":
        base = _build_hydrogen_orbital_signal(cfg)
    elif cfg.model == "spiral_galaxy":
        base = _build_spiral_galaxy_signal(cfg)
    elif cfg.model == "filamentary_time":
        base = _build_filamentary_time_signal(cfg)
    elif cfg.model == "healpix_sky":
        base = _build_healpix_sky_signal(cfg)
    else:
        base = _build_base_signal(cfg)

    x = _physical_axis(-32.0, 32.0, cfg.x)
    y = _physical_axis(-32.0, 32.0, cfg.y)
    z = _physical_axis(-2.0, 2.0, cfg.z)
    if cfg.model == "healpix_sky":
        x = np.arange(cfg.x, dtype=np.float64)
        y = np.array([0.0], dtype=np.float32)
        z = np.array([0.0], dtype=np.float32)

    pol_cube = np.zeros((cfg.pol, cfg.t, cfg.nu, cfg.x, cfg.y, cfg.z), dtype=np.float32)
    pol_cube[0] = base

    if cfg.model in {"spherical", "hydrogen_orbitals", "spiral_galaxy"}:
        if cfg.pol > 1:
            pol_cube[1] = 0.06 * base
        if cfg.pol > 2:
            pol_cube[2] = -0.04 * base
        if cfg.pol > 3:
            pol_cube[3] = 0.02 * base
    elif cfg.model in {"center_structured", "center_structured_time", "ring_shock", "radio_galaxy"}:
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
        if cfg.model == "hydrogen_orbitals":
            noise_sigma = 0.004 + 0.003 * (si / max(cfg.sample - 1, 1))
        elif cfg.model == "spiral_galaxy":
            noise_sigma = 0.004 + 0.002 * (si / max(cfg.sample - 1, 1))
        elif cfg.model == "radio_galaxy":
            noise_sigma = 0.012 + 0.006 * (si / max(cfg.sample - 1, 1))
        else:
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
    wcs = {"frame": "ICRS", "projection": "TAN", "note": "mock synthetic coordinate model"}
    if cfg.model == "healpix_sky":
        nside = _healpix_nside_from_npix(cfg.x)
        wcs = {
            "frame": "ICRS",
            "projection": "HEALPIX",
            "healpix_ordering": "ring",
            "healpix_nside": int(nside) if nside is not None else None,
            "note": "mock HEALPix sky model",
        }
        units["x"] = "healpix-pix"
        units["y"] = "index"
        units["z"] = "index"

    provenance = {
        "source": "generated",
        "generator": "generate_mock_dataset",
        "seed": cfg.seed,
        "model": cfg.model,
        "shape": list(values.shape),
        "pol_labels": ["I", "Q", "U", "V"][: cfg.pol],
    }
    if cfg.model == "healpix_sky":
        provenance["healpix_ordering"] = "ring"

    dataset = CubeDataset(
        data_id=dataset_id,
        dims=CANONICAL_DIMS,
        coords=coords,
        values=values,
        units=units,
        intensity_unit="arb",
        wcs=wcs,
        provenance=provenance,
        uncertainty={"type": "sample-axis", "sample_dim": "sample", "weights": None},
    )
    dataset.validate()
    return dataset
