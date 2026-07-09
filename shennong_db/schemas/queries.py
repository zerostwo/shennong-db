from typing import Any, Literal

from pydantic import Field

from shennong_db.schemas.common import LazyQuery


class ExpressionQuery(LazyQuery):
    genes: list[str] = Field(..., min_length=1, max_length=512)
    cancer: list[str] | None = None
    group_name: list[str] | None = None
    sample_ids: list[str] | None = None
    aggregation: Literal["none", "mean", "median", "sum"] = "none"


class SurvivalQuery(LazyQuery):
    cancer: list[str] | None = None
    sample_ids: list[str] | None = None
    time_field: str = "time"
    event_field: str = "event"
    covariates: list[str] = Field(default_factory=list, max_length=64)


class SingleCellQuery(LazyQuery):
    genes: list[str] = Field(..., min_length=1, max_length=256)
    obs_filter: dict[str, Any] = Field(default_factory=dict)
    layer: str | None = None
    embedding: str | None = None


class SpatialQuery(LazyQuery):
    genes: list[str] = Field(..., min_length=1, max_length=256)
    obs_filter: dict[str, Any] = Field(default_factory=dict)
    region: dict[str, float] | None = Field(
        default=None,
        description="Optional x_min/x_max/y_min/y_max bounding box.",
    )
    layer: str | None = None


class EqtlQuery(LazyQuery):
    genes: list[str] | None = Field(default=None, max_length=512)
    variants: list[str] | None = Field(default=None, max_length=1024)
    tissue: list[str] | None = None
    phenotype: str | None = None
    pvalue_lte: float | None = Field(default=None, ge=0.0, le=1.0)
