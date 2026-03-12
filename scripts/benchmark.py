#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import statistics
import time
from typing import Any

import httpx
import numpy as np


def pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = int(round((len(sorted_vals) - 1) * q))
    return sorted_vals[max(0, min(len(sorted_vals) - 1, idx))]


def decode_scalar_payload_binary(body: bytes) -> dict[str, Any]:
    if len(body) < 4:
        raise ValueError("binary payload is too short")
    metadata_length = int.from_bytes(body[:4], byteorder="little", signed=False)
    metadata_start = 4
    padded_length = (metadata_length + 3) & ~3
    values_start = metadata_start + padded_length
    metadata = json.loads(body[metadata_start : metadata_start + metadata_length].decode("utf-8"))
    values = np.frombuffer(body, dtype=np.float32, count=-1, offset=values_start)
    return {**metadata, "values": values}


def timed_get(client: httpx.Client, url: str, params: dict[str, Any], *, response_format: str) -> float:
    t0 = time.perf_counter()
    r = client.get(url, params=params, timeout=30.0)
    r.raise_for_status()
    if response_format == "binary":
        _ = decode_scalar_payload_binary(r.content)
    else:
        _ = r.json()
    return (time.perf_counter() - t0) * 1000.0


def timed_post(client: httpx.Client, url: str, json: dict[str, Any]) -> float:
    t0 = time.perf_counter()
    r = client.post(url, json=json, timeout=30.0)
    r.raise_for_status()
    _ = r.json()
    return (time.perf_counter() - t0) * 1000.0


def main() -> None:
    parser = argparse.ArgumentParser(description="mobula demo API benchmark")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--dataset", default="movie-2d-pol-hd", help="dataset id")
    parser.add_argument("--n", type=int, default=60, help="number of measured iterations")
    parser.add_argument("--warmup", type=int, default=15, help="number of warmup iterations")
    parser.add_argument(
        "--response-format",
        default="json",
        choices=["json", "binary"],
        help="slice transport format to benchmark",
    )
    args = parser.parse_args()

    rng = random.Random(123)
    slice_url = f"{args.base_url}/api/datasets/{args.dataset}/slice"
    roi_url = f"{args.base_url}/api/datasets/{args.dataset}/roi-stats"

    with httpx.Client() as client:
        meta = client.get(f"{args.base_url}/api/datasets/{args.dataset}/meta", timeout=30.0).json()
        coords = meta.get("coords", {})
        s_sample = int(coords.get("sample", {}).get("size", 1))
        s_pol = int(coords.get("pol", {}).get("size", 1))
        s_t = int(coords.get("t", {}).get("size", 1))
        s_nu = int(coords.get("nu", {}).get("size", 1))
        s_z = int(coords.get("z", {}).get("size", 1))
        s_x = int(coords.get("x", {}).get("size", 64))
        s_y = int(coords.get("y", {}).get("size", 64))

        # Warm-up path
        for _ in range(args.warmup):
            params = {
                "sample": rng.randrange(max(1, s_sample)),
                "pol": rng.randrange(max(1, s_pol)),
                "t": rng.randrange(max(1, s_t)),
                "nu": rng.randrange(max(1, s_nu)),
                "z": rng.randrange(max(1, s_z)),
                "response_format": args.response_format,
            }
            timed_get(client, slice_url, params, response_format=args.response_format)

        slice_lat: list[float] = []
        roi_lat: list[float] = []
        for _ in range(args.n):
            params = {
                "sample": rng.randrange(max(1, s_sample)),
                "pol": rng.randrange(max(1, s_pol)),
                "t": rng.randrange(max(1, s_t)),
                "nu": rng.randrange(max(1, s_nu)),
                "z": rng.randrange(max(1, s_z)),
                "response_format": args.response_format,
            }
            slice_lat.append(timed_get(client, slice_url, params, response_format=args.response_format))

            roi_w = max(8, min(24, s_x // 4))
            roi_h = max(8, min(24, s_y // 4))
            x0 = rng.randrange(0, max(1, s_x - roi_w))
            y0 = rng.randrange(0, max(1, s_y - roi_h))
            body = {
                "x0": x0,
                "x1": x0 + roi_w,
                "y0": y0,
                "y1": y0 + roi_h,
                "pol": params["pol"],
                "t": params["t"],
                "nu": params["nu"],
                "z": params["z"],
            }
            roi_lat.append(timed_post(client, roi_url, body))

    print("mobula demo benchmark")
    print(f"dataset: {args.dataset}")
    print(f"iterations: {args.n}")
    print(f"slice response format: {args.response_format}")
    print("slice latency (ms):")
    print(f"  p50={pct(slice_lat, 0.50):.2f} p95={pct(slice_lat, 0.95):.2f} mean={statistics.mean(slice_lat):.2f}")
    print("roi-stats latency (ms):")
    print(f"  p50={pct(roi_lat, 0.50):.2f} p95={pct(roi_lat, 0.95):.2f} mean={statistics.mean(roi_lat):.2f}")


if __name__ == "__main__":
    main()
