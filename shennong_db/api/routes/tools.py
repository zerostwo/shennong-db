from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from shennong_db.api.deps import get_backend_router, get_cache, get_registry, get_settings
from shennong_db.api.query_execution import cached_query_response
from shennong_db.backends.router import BackendRouter
from shennong_db.cache import AsyncQueryCache
from shennong_db.config import Settings
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.common import DatasetType
from shennong_db.schemas.datasets import DatasetListResponse
from shennong_db.schemas.queries import (
    EqtlQuery,
    ExpressionQuery,
    SingleCellQuery,
    SpatialQuery,
    SurvivalQuery,
)
from shennong_db.schemas.tools import ToolCallRequest, ToolDefinition

router = APIRouter(prefix="/tools", tags=["ai-tools"])


class ListDatasetsArgs(BaseModel):
    type: DatasetType | None = Field(default=None, description="Optional dataset type filter.")


def _tool(name: str, description: str, model: type[BaseModel]) -> ToolDefinition:
    return ToolDefinition(
        function={
            "name": name,
            "description": description,
            "parameters": model.model_json_schema(),
        }
    )


@router.get("", response_model=list[ToolDefinition])
async def list_tools() -> list[ToolDefinition]:
    return [
        _tool(
            "query_expression",
            "Query bulk gene expression without loading full matrices.",
            ExpressionQuery,
        ),
        _tool(
            "query_survival",
            "Query survival/event records for downstream survival analysis.",
            SurvivalQuery,
        ),
        _tool(
            "query_singlecell",
            "Query sparse single-cell expression from TileDB-SOMA.",
            SingleCellQuery,
        ),
        _tool("query_spatial", "Query sparse spatial expression from TileDB-SOMA.", SpatialQuery),
        _tool("query_eqtl", "Query eQTL or sQTL summary statistics.", EqtlQuery),
        _tool("list_datasets", "List registered datasets and versions.", ListDatasetsArgs),
    ]


@router.post("/call")
async def call_tool(
    request: ToolCallRequest,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
    registry: DatasetRegistryService = Depends(get_registry),
) -> Any:
    if request.name == "query_expression":
        query = ExpressionQuery.model_validate(request.arguments)
        return await cached_query_response(
            cache=cache,
            namespace="tool:expression",
            payload=query.model_dump(mode="json"),
            ttl_seconds=settings.expression_gene_cache_ttl_seconds,
            producer=lambda: backend_router.query_expression(query),
        )
    if request.name == "query_survival":
        query = SurvivalQuery.model_validate(request.arguments)
        return await cached_query_response(
            cache=cache,
            namespace="tool:survival",
            payload=query.model_dump(mode="json"),
            ttl_seconds=settings.query_cache_ttl_seconds,
            producer=lambda: backend_router.query_survival(query),
        )
    if request.name == "query_singlecell":
        query = SingleCellQuery.model_validate(request.arguments)
        return await cached_query_response(
            cache=cache,
            namespace="tool:singlecell",
            payload=query.model_dump(mode="json"),
            ttl_seconds=settings.query_cache_ttl_seconds,
            producer=lambda: backend_router.query_singlecell(query),
        )
    if request.name == "query_spatial":
        query = SpatialQuery.model_validate(request.arguments)
        return await cached_query_response(
            cache=cache,
            namespace="tool:spatial",
            payload=query.model_dump(mode="json"),
            ttl_seconds=settings.query_cache_ttl_seconds,
            producer=lambda: backend_router.query_spatial(query),
        )
    if request.name == "query_eqtl":
        query = EqtlQuery.model_validate(request.arguments)
        return await cached_query_response(
            cache=cache,
            namespace="tool:eqtl",
            payload=query.model_dump(mode="json"),
            ttl_seconds=settings.query_cache_ttl_seconds,
            producer=lambda: backend_router.query_eqtl(query),
        )
    if request.name == "list_datasets":
        args = ListDatasetsArgs.model_validate(request.arguments)
        return DatasetListResponse(datasets=await registry.list(args.type))
    from shennong_db.errors import ValidationError

    raise ValidationError(f"Unknown tool '{request.name}'")
