from fastapi import APIRouter, Depends

from shennong_db.api.deps import get_backend_router, get_cache, get_settings
from shennong_db.api.query_execution import cached_query_response
from shennong_db.backends.router import BackendRouter
from shennong_db.cache import AsyncQueryCache
from shennong_db.config import Settings
from shennong_db.schemas.common import QueryResponse
from shennong_db.schemas.queries import (
    EqtlQuery,
    ExpressionQuery,
    SingleCellQuery,
    SpatialQuery,
    SurvivalQuery,
)

router = APIRouter(tags=["queries"])


@router.post("/expression/query", response_model=QueryResponse)
async def query_expression(
    query: ExpressionQuery,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
) -> QueryResponse:
    ttl = (
        settings.expression_gene_cache_ttl_seconds
        if query.version
        else min(60, settings.query_cache_ttl_seconds)
    )
    return await cached_query_response(
        cache=cache,
        namespace="expression",
        payload=query.model_dump(mode="json"),
        ttl_seconds=ttl,
        producer=lambda: backend_router.query_expression(query),
    )


@router.post("/survival/query", response_model=QueryResponse)
async def query_survival(
    query: SurvivalQuery,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
) -> QueryResponse:
    return await cached_query_response(
        cache=cache,
        namespace="survival",
        payload=query.model_dump(mode="json"),
        ttl_seconds=settings.query_cache_ttl_seconds,
        producer=lambda: backend_router.query_survival(query),
    )


@router.post("/singlecell/query", response_model=QueryResponse)
async def query_singlecell(
    query: SingleCellQuery,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
) -> QueryResponse:
    return await cached_query_response(
        cache=cache,
        namespace="singlecell",
        payload=query.model_dump(mode="json"),
        ttl_seconds=settings.query_cache_ttl_seconds,
        producer=lambda: backend_router.query_singlecell(query),
    )


@router.post("/spatial/query", response_model=QueryResponse)
async def query_spatial(
    query: SpatialQuery,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
) -> QueryResponse:
    return await cached_query_response(
        cache=cache,
        namespace="spatial",
        payload=query.model_dump(mode="json"),
        ttl_seconds=settings.query_cache_ttl_seconds,
        producer=lambda: backend_router.query_spatial(query),
    )


@router.post("/eqtl/query", response_model=QueryResponse)
async def query_eqtl(
    query: EqtlQuery,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
) -> QueryResponse:
    return await cached_query_response(
        cache=cache,
        namespace="eqtl",
        payload=query.model_dump(mode="json"),
        ttl_seconds=settings.query_cache_ttl_seconds,
        producer=lambda: backend_router.query_eqtl(query),
    )
