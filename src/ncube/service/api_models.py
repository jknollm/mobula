from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LoadLocalRequest(BaseModel):
    path: str
    data_id: str | None = None
    dims: list[str] | None = None
    pad_missing_dims: bool = False


class PickLocalPathRequest(BaseModel):
    target: Literal["file", "folder"] = "file"


class RoiStatsRequest(BaseModel):
    x0: int = Field(ge=0)
    x1: int = Field(gt=0)
    y0: int = Field(ge=0)
    y1: int = Field(gt=0)
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    z: int | None = None


class ProfilesRequest(BaseModel):
    x0: int = Field(ge=0)
    x1: int = Field(gt=0)
    y0: int = Field(ge=0)
    y1: int = Field(gt=0)
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    z: int | None = None


class PlaneProfilesRequest(BaseModel):
    plane_x: str
    plane_y: str
    u0: int = Field(ge=0)
    u1: int = Field(gt=0)
    v0: int = Field(ge=0)
    v1: int = Field(gt=0)
    sample: int | None = None
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    x: int | None = None
    y: int | None = None
    z: int | None = None


SampleMode = Literal["single", "mean", "std", "rel_uncert"]
RangeMode = Literal["none", "time", "spectral", "time_spectral", "space", "full"]
