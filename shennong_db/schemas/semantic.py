from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shennong_db.schemas.common import BackendKind


class APIStatus(StrEnum):
    success = "success"
    accepted = "accepted"
    error = "error"


class DataModel(StrEnum):
    bulk = "bulk"
    single_cell = "single_cell"
    spatial = "spatial"
    table = "table"
    clinical = "clinical"
    qtl = "qtl"
    knowledge = "knowledge"
    multiome = "multiome"


class ReturnFormat(StrEnum):
    json = "json"
    arrow = "arrow"
    parquet = "parquet"
    h5ad = "h5ad"
    seurat = "seurat"
    csv = "csv"


class ReturnShape(StrEnum):
    tidy = "tidy"
    matrix = "matrix"
    matrix_with_obs = "matrix_with_obs"
    table = "table"
    anndata = "anndata"
    seurat = "seurat"


class QuerySelect(BaseModel):
    features: list[str] = Field(default_factory=list, max_length=10_000)
    observations: dict[str, Any] = Field(default_factory=dict)
    fields: list[str] = Field(default_factory=list, max_length=512)

    model_config = ConfigDict(extra="forbid")


class QueryReturnSpec(BaseModel):
    format: ReturnFormat = ReturnFormat.json
    shape: ReturnShape = ReturnShape.tidy

    model_config = ConfigDict(extra="forbid")


class QueryOptions(BaseModel):
    limit: int = Field(default=1000, ge=1, le=100_000)
    cursor: str | None = None
    include_metadata: bool = True
    include_feature_metadata: bool = False
    aggregation: Literal["none", "mean", "median", "sum"] = "none"

    model_config = ConfigDict(extra="allow")


class QuerySpec(BaseModel):
    dataset: str = Field(..., min_length=1)
    version: str | None = Field(
        default=None,
        description="Dataset version. 'latest' resolves to the default active version.",
    )
    assay: str = Field(..., min_length=1)
    data_model: DataModel | None = None
    select: QuerySelect = Field(default_factory=QuerySelect)
    layer: str | None = None
    measure: str | list[str] | None = None
    return_spec: QueryReturnSpec = Field(default_factory=QueryReturnSpec, alias="return")
    options: QueryOptions = Field(default_factory=QueryOptions)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("version")
    @classmethod
    def normalize_latest(cls, value: str | None) -> str | None:
        if value is None or value == "latest":
            return None
        return value


class QueryMeta(BaseModel):
    dataset: str
    version: str
    backend: BackendKind
    n_rows: int
    columns: list[str] = Field(default_factory=list)
    next_cursor: str | None = None
    truncated: bool = False
    elapsed_ms: float
    cached: bool = False
    return_format: ReturnFormat = ReturnFormat.json
    return_shape: ReturnShape = ReturnShape.tidy


class SemanticQueryResponse(BaseModel):
    status: APIStatus = APIStatus.success
    data: list[dict[str, Any]]
    meta: QueryMeta


class ComputeReturnSpec(BaseModel):
    format: ReturnFormat = ReturnFormat.json
    include_plot_data: bool = True
    shape: ReturnShape | None = None

    model_config = ConfigDict(extra="allow")


class ComputeExecutionSpec(BaseModel):
    mode: Literal["sync", "async", "auto"] = "auto"

    model_config = ConfigDict(extra="forbid")


class ComputeSpec(BaseModel):
    task: str = Field(..., min_length=1)
    dataset: str = Field(..., min_length=1)
    version: str | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    cohort: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    return_spec: ComputeReturnSpec = Field(default_factory=ComputeReturnSpec, alias="return")
    execution: ComputeExecutionSpec = Field(default_factory=ComputeExecutionSpec)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("version")
    @classmethod
    def normalize_latest(cls, value: str | None) -> str | None:
        if value is None or value == "latest":
            return None
        return value


class ComputeResponse(BaseModel):
    status: APIStatus
    result: dict[str, Any] | None = None
    job_id: str | None = None
    state: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class CatalogDatasetSummary(BaseModel):
    dataset: str
    title: str
    data_model: DataModel
    assays: list[str]
    default_version: str
    backend: BackendKind
    visibility: str = "public"


class CatalogDatasetDetail(CatalogDatasetSummary):
    description: str | None = None
    versions: list[str]
    citation: str | None = None
    license: str | None = None
    status: str
    publication_state: str
    source_roles: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CatalogResponse(BaseModel):
    status: APIStatus = APIStatus.success
    data: Any
    meta: dict[str, Any] = Field(default_factory=dict)


class AgentTool(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]


class AgentToolsResponse(BaseModel):
    status: APIStatus = APIStatus.success
    tools: list[AgentTool]


class AgentCallRequest(BaseModel):
    tool: str = Field(..., min_length=1)
    args: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class AgentCallResponse(BaseModel):
    status: APIStatus = APIStatus.success
    tool: str
    data: Any = None
    meta: dict[str, Any] = Field(default_factory=dict)


class JobCreate(BaseModel):
    type: Literal["query", "compute", "ingest"] = "compute"
    spec: dict[str, Any]

    model_config = ConfigDict(extra="forbid")


class JobRecord(BaseModel):
    job_id: str
    type: str
    state: Literal["queued", "running", "completed", "failed", "cancelled"]
    spec: dict[str, Any]
    result: dict[str, Any] | None = None
    error: str | None = None
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    message: str | None = None
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class JobAcceptedResponse(BaseModel):
    status: APIStatus = APIStatus.accepted
    job_id: str
    state: str


class JobResponse(BaseModel):
    status: APIStatus = APIStatus.success
    data: JobRecord


class ArtifactRecord(BaseModel):
    artifact_id: str
    type: str
    format: str
    path: str | None = None
    size_bytes: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    download_url: str | None = None
    expires_at: datetime | None = None


class ArtifactResponse(BaseModel):
    status: APIStatus = APIStatus.success
    data: ArtifactRecord
