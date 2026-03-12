from __future__ import annotations

from collections.abc import Iterable
from contextlib import contextmanager
from time import perf_counter

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.testclient import TestClient

from mobula.data.mock_cube import MockCubeConfig, generate_mock_dataset
from mobula.data.schema import CubeDataset
from mobula.service.api import build_router
from mobula.service.registry import DatasetRegistry


@pytest.fixture()
def base_dataset() -> CubeDataset:
    return generate_mock_dataset(
        "test-cube",
        MockCubeConfig(sample=3, pol=4, t=5, nu=6, x=8, y=7, z=4, seed=123, model="dynamic"),
    )


def subset_dataset(base: CubeDataset, keep_dims: Iterable[str], data_id: str) -> CubeDataset:
    keep = set(keep_dims)
    dims = tuple(dim for dim in base.dims if dim in keep)
    slicer: list[int | slice] = [slice(None) if dim in keep else 0 for dim in base.dims]
    values = np.asarray(base.values[tuple(slicer)], dtype=np.float32)

    dataset = CubeDataset(
        data_id=data_id,
        dims=dims,
        coords={dim: np.asarray(base.coords[dim]).copy() for dim in dims},
        values=values,
        units={dim: base.units[dim] for dim in dims},
        intensity_unit=base.intensity_unit,
        wcs=dict(base.wcs),
        provenance={"source": "test-subset", "subset_of": base.data_id},
        uncertainty=None,
    )
    dataset.validate()
    return dataset


@contextmanager
def build_client(*datasets: CubeDataset):
    registry = DatasetRegistry()
    for ds in datasets:
        registry.add(ds)

    app = FastAPI()
    app.add_middleware(GZipMiddleware, minimum_size=2048)

    @app.middleware("http")
    async def add_request_timing(request, call_next):
        started = perf_counter()
        response = await call_next(request)
        total_ms = (perf_counter() - started) * 1000.0
        response.headers["X-Mobula-Request-Ms"] = f"{total_ms:.2f}"
        existing = response.headers.get("Server-Timing")
        total_metric = f"total;dur={total_ms:.2f}"
        response.headers["Server-Timing"] = f"{existing}, {total_metric}" if existing else total_metric
        return response

    app.include_router(build_router(registry))
    with TestClient(app) as client:
        yield client


@pytest.fixture()
def client(base_dataset: CubeDataset):
    with build_client(base_dataset) as c:
        yield c


@pytest.fixture()
def client_factory():
    return build_client


@pytest.fixture()
def subset_builder():
    return subset_dataset
