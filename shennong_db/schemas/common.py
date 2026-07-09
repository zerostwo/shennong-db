from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BackendKind(StrEnum):
    clickhouse = "clickhouse"
    tiledb_soma = "tiledb_soma"
    xena = "xena"
    tenx_h5 = "tenx_h5"
    postgres = "postgres"
    memory = "memory"


class DatasetType(StrEnum):
    bulk_expression = "bulk_expression"
    survival = "survival"
    single_cell = "single_cell"
    spatial = "spatial"
    eqtl = "eqtl"


class DatasetStatus(StrEnum):
    draft = "draft"
    active = "active"
    deprecated = "deprecated"


class LazyQuery(BaseModel):
    """Common lazy-query fields used by API and R client pagination."""

    dataset: str = Field(..., min_length=1)
    version: str | None = Field(
        default=None,
        description="Dataset version. If omitted, the active latest version is used.",
    )
    limit: int = Field(default=1000, ge=1, le=100_000)
    cursor: str | None = Field(default=None, description="Opaque cursor from a prior response.")

    model_config = ConfigDict(extra="forbid")

    @field_validator("dataset", "version")
    @classmethod
    def strip_identifiers(cls, value: str | None) -> str | None:
        if value is None:
            return value
        stripped = value.strip()
        if not stripped:
            raise ValueError("Identifier cannot be blank")
        return stripped


class QueryResponse(BaseModel):
    dataset: str
    version: str
    backend: BackendKind
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    next_cursor: str | None = None
    truncated: bool = False
    elapsed_ms: float
    cached: bool = False


class ErrorResponse(BaseModel):
    error: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
