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


class HealpixProfilesRequest(BaseModel):
    pixel_indices: list[int] = Field(default_factory=list)
    sample: int | None = None
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    y: int | None = None
    z: int | None = None


class ExportCutoutSaveRequest(BaseModel):
    format: Literal["fits", "hdf5"] = "fits"
    output_dir: str
    filename: str | None = None
    overwrite: bool = True
    sample: int | None = None
    pol: int | None = None
    t: int | None = None
    nu: int | None = None
    x: int | None = None
    y: int | None = None
    z: int | None = None
    sample_mode: str = "single"
    plane_x: str = "x"
    plane_y: str = "y"
    u0: int | None = None
    u1: int | None = None
    v0: int | None = None
    v1: int | None = None
    t0: int | None = None
    t1: int | None = None
    nu0: int | None = None
    nu1: int | None = None
    pixel_indices: list[int] | None = None


class SaveImageItem(BaseModel):
    filename: str
    data_url: str


class SaveImagesRequest(BaseModel):
    output_dir: str
    overwrite: bool = True
    images: list[SaveImageItem] = Field(default_factory=list)


SampleMode = Literal["single", "mean", "std", "rel_uncert"]
RangeMode = Literal["none", "time", "spectral", "time_spectral", "space", "full"]
