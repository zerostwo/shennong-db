from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from shennong_db.schemas.common import BackendKind, DatasetStatus, DatasetType


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
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")
