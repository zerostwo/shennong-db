from fastapi import APIRouter, Depends, Request

from shennong_db.api.deps import get_backend_router, get_cache, get_registry, get_settings
from shennong_db.api.query_execution import cached_semantic_query_response
from shennong_db.backends.router import BackendRouter
from shennong_db.cache import AsyncQueryCache
from shennong_db.config import Settings
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.semantic import QuerySpec, SemanticQueryResponse
from shennong_db.security import ensure_dataset_read

router = APIRouter(tags=["semantic"])


@router.post("/query", response_model=SemanticQueryResponse)
async def query_data(
    spec: QuerySpec,
    request: Request,
    backend_router: BackendRouter = Depends(get_backend_router),
    registry: DatasetRegistryService = Depends(get_registry),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
) -> SemanticQueryResponse:
    dataset = await registry.get(spec.dataset, spec.version)
    await ensure_dataset_read(request, dataset)
    ttl = (
        settings.expression_gene_cache_ttl_seconds
        if spec.assay in {"rna", "spatial_rna"} and spec.select.features
        else settings.query_cache_ttl_seconds
    )
    return await cached_semantic_query_response(
        cache=cache,
        namespace="semantic:query",
        payload=spec.model_dump(mode="json", by_alias=True),
        ttl_seconds=ttl,
        producer=lambda: backend_router.query(spec),
    )
