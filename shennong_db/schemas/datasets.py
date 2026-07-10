from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from shennong_db.schemas.common import BackendKind, DatasetStatus, DatasetType


class DatasetVisibility(StrEnum):
    public = "public"
    private = "private"


class AssetKind(StrEnum):
    matrix = "matrix"
    metadata = "metadata"
    embedding = "embedding"
    reference = "reference"
    index = "index"
    annotation = "annotation"
    database = "database"
    table = "table"
    archive = "archive"
    other = "other"


class AssetStatus(StrEnum):
    ready = "ready"
    processing = "processing"
    failed = "failed"


class DatasetVersion(BaseModel):
    dataset_id: str
    type: DatasetType
    backend: BackendKind
    version: str
    citation: str | None = None
    storage_uri: str | None = None
    status: DatasetStatus = DatasetStatus.active
    is_default: bool = False
    schema_version: str = "1.0"
    visibility: DatasetVisibility = DatasetVisibility.public
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DatasetVersionCreate(BaseModel):
    dataset_id: str = Field(..., min_length=1)
    type: DatasetType
    backend: BackendKind
    version: str = Field(..., min_length=1)
    citation: str | None = None
    storage_uri: str | None = None
    status: DatasetStatus = DatasetStatus.active
    is_default: bool = False
    schema_version: str = "1.0"
    visibility: DatasetVisibility = DatasetVisibility.public
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class DatasetAssetCreate(BaseModel):
    role: str = Field(..., min_length=1, max_length=160)
    kind: AssetKind = AssetKind.other
    format: str = Field(..., min_length=1, max_length=80)
    storage_uri: str
    media_type: str | None = None
    compression: str | None = None
    checksum: str | None = None
    size_bytes: int | None = None
    derived_from: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class DatasetAsset(DatasetAssetCreate):
    asset_id: str
    dataset_id: str
    version: str
    status: AssetStatus = AssetStatus.ready
    created_at: datetime | None = None


class DatasetManifest(BaseModel):
    dataset: DatasetVersion
    assets: list[DatasetAsset]
