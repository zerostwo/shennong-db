from fastapi import APIRouter, Depends, Request

from shennong_db.api.deps import get_backend_router, get_cache, get_settings
from shennong_db.api.query_execution import cached_semantic_query_response
from shennong_db.backends.router import BackendRouter
from shennong_db.cache import AsyncQueryCache
from shennong_db.config import Settings
from shennong_db.errors import ValidationError
from shennong_db.jobs import InMemoryJobStore
from shennong_db.schemas.semantic import (
    APIStatus,
    ArtifactResponse,
    ComputeResponse,
    ComputeSpec,
    JobAcceptedResponse,
    JobCreate,
    JobResponse,
    QuerySpec,
    SemanticQueryResponse,
)
from shennong_db.security import require_admin

router = APIRouter(tags=["semantic"])


@router.post("/query", response_model=SemanticQueryResponse)
async def query_data(
    spec: QuerySpec,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
) -> SemanticQueryResponse:
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


@router.post("/compute", response_model=ComputeResponse)
async def compute(
    spec: ComputeSpec,
    request: Request,
    _: None = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> ComputeResponse:
    del settings
    if spec.execution.mode == "sync":
        raise ValidationError(
            "Synchronous compute execution is not configured yet; "
            "use execution.mode='async' or 'auto'",
            details={"task": spec.task},
        )
    store: InMemoryJobStore = request.app.state.job_store
    job = store.create(
        JobCreate(type="compute", spec=spec.model_dump(mode="json", by_alias=True)),
        message="Queued; durable compute workers are not configured in this deployment.",
    )
    return ComputeResponse(status=APIStatus.accepted, job_id=job.job_id, state=job.state)


def register_stateful_routes(router: APIRouter) -> None:
    @router.post("/jobs", response_model=JobAcceptedResponse)
    async def create_job(
        payload: JobCreate,
        request: Request,
        _: None = Depends(require_admin),
    ) -> JobAcceptedResponse:
        store: InMemoryJobStore = request.app.state.job_store
        job = store.create(payload)
        return JobAcceptedResponse(job_id=job.job_id, state=job.state)

    @router.get("/jobs/{job_id}", response_model=JobResponse)
    async def get_job(
        job_id: str,
        request: Request,
        _: None = Depends(require_admin),
    ) -> JobResponse:
        store: InMemoryJobStore = request.app.state.job_store
        return JobResponse(data=store.get(job_id))

    @router.delete("/jobs/{job_id}", response_model=JobResponse)
    async def cancel_job(
        job_id: str,
        request: Request,
        _: None = Depends(require_admin),
    ) -> JobResponse:
        store: InMemoryJobStore = request.app.state.job_store
        return JobResponse(data=store.cancel(job_id))

    @router.get("/artifacts/{artifact_id}", response_model=ArtifactResponse)
    async def get_artifact(
        artifact_id: str,
        request: Request,
        _: None = Depends(require_admin),
    ) -> ArtifactResponse:
        store: InMemoryJobStore = request.app.state.job_store
        return ArtifactResponse(data=store.get_artifact(artifact_id))


register_stateful_routes(router)
