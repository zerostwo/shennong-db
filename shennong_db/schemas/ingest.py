from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shennong_db.schemas.common import BackendKind, DatasetStatus, DatasetType
from shennong_db.schemas.semantic import APIStatus, DataModel, JobRecord


class IngestRequest(BaseModel):
    dataset: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    data_model: DataModel
    backend: BackendKind
    source: dict[str, str] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    dataset_type: DatasetType | None = None
    storage_uri: str | None = None
    citation: str | None = None
    status: DatasetStatus = DatasetStatus.active
    is_default: bool = False
    schema_version: str = "1.0"
    register_dataset: bool = Field(default=True, alias="register")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("dataset", "version")
    @classmethod
    def strip_identifiers(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Identifier cannot be blank")
        return stripped


class UploadPreview(BaseModel):
    filename: str
    content_type: str | None = None
    size_bytes: int
    delimiter: str | None = None
    columns: list[str] = Field(default_factory=list)
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)
    sampled_rows: int = 0
    truncated: bool = False
    warnings: list[str] = Field(default_factory=list)


class IngestValidationIssue(BaseModel):
    level: Literal["error", "warning", "info"]
    field: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class IngestValidationReport(BaseModel):
    status: APIStatus = APIStatus.success
    valid: bool
    queryable: bool
    dataset: str
    version: str
    data_model: DataModel
    backend: BackendKind
    dataset_type: DatasetType | None = None
    required_source_roles: list[str] = Field(default_factory=list)
    present_source_roles: list[str] = Field(default_factory=list)
    storage_uri: str | None = None
    issues: list[IngestValidationIssue] = Field(default_factory=list)
    preview: UploadPreview | None = None


class IngestResponse(BaseModel):
    status: APIStatus
    job_id: str
    state: str
    dataset: str
    version: str
    registered: bool = False
    message: str | None = None
    preview: UploadPreview | None = None
    data: JobRecord | None = None
