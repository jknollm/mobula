from __future__ import annotations

from contextlib import contextmanager
import json
from time import perf_counter
from typing import Any, Callable, Iterator

from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response


class StageTimings:
    def __init__(self, stage_names: list[str] | tuple[str, ...] | None = None) -> None:
        self._timings: dict[str, float] = {}
        for name in stage_names or ():
            self._timings[str(name)] = 0.0

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        started = perf_counter()
        try:
            yield
        finally:
            self._timings[str(name)] = self._timings.get(str(name), 0.0) + ((perf_counter() - started) * 1000.0)

    def snapshot(self) -> dict[str, float]:
        return {name: round(float(ms), 4) for name, ms in self._timings.items()}

    def merge(self, values: dict[str, float]) -> None:
        for name, ms in values.items():
            self._timings[str(name)] = float(ms)


def _apply_perf_headers(
    response: Response,
    *,
    compute_ms: float,
    serialize_ms: float,
    response_bytes: int,
    dataset_metrics: dict[str, Any] | None = None,
) -> Response:
    response.headers["X-Mobula-Compute-Ms"] = f"{compute_ms:.2f}"
    response.headers["X-Mobula-Serialize-Ms"] = f"{serialize_ms:.2f}"
    response.headers["X-Mobula-Response-Bytes"] = str(response_bytes)

    server_timing_parts = [
        f"compute;dur={compute_ms:.2f}",
        f"serialize;dur={serialize_ms:.2f}",
    ]
    if dataset_metrics:
        cache_state = str(dataset_metrics.get("cache", "")).strip()
        if cache_state:
            response.headers["X-Mobula-Dataset-Cache"] = cache_state
        load_ms = dataset_metrics.get("load_ms")
        if isinstance(load_ms, (int, float)):
            response.headers["X-Mobula-Dataset-Load-Ms"] = f"{float(load_ms):.2f}"
            server_timing_parts.append(f"dataset_load;dur={float(load_ms):.2f}")

    response.headers["Server-Timing"] = ", ".join(server_timing_parts)
    return response


def timed_encoded_response(
    build_payload: Callable[[], Any],
    encode_payload: Callable[[Any], bytes | tuple[bytes, dict[str, str]]],
    *,
    media_type: str,
    dataset_metrics: dict[str, Any] | None = None,
) -> Response:
    compute_started = perf_counter()
    payload = build_payload()
    compute_ms = (perf_counter() - compute_started) * 1000.0

    serialize_started = perf_counter()
    encoded = encode_payload(payload)
    if isinstance(encoded, tuple):
        body, extra_headers = encoded
    else:
        body, extra_headers = encoded, {}
    serialize_ms = (perf_counter() - serialize_started) * 1000.0

    response = Response(content=body, media_type=media_type)
    for key, value in extra_headers.items():
        response.headers[key] = value
    return _apply_perf_headers(
        response,
        compute_ms=compute_ms,
        serialize_ms=serialize_ms,
        response_bytes=len(body),
        dataset_metrics=dataset_metrics,
    )


def timed_json_response(
    build_payload: Callable[[], Any],
    *,
    dataset_metrics: dict[str, Any] | None = None,
) -> Response:
    return timed_encoded_response(
        build_payload,
        lambda payload: json.dumps(jsonable_encoder(payload), separators=(",", ":"), allow_nan=False).encode("utf-8"),
        media_type="application/json",
        dataset_metrics=dataset_metrics,
    )
