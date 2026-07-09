from typing import Any

from fastapi import APIRouter, Depends, Request

from shennong_db.api.deps import get_backend_router, get_cache, get_registry, get_settings
from shennong_db.api.query_execution import cached_semantic_query_response
from shennong_db.backends.router import BackendRouter
from shennong_db.cache import AsyncQueryCache
from shennong_db.catalog import capabilities, semantic_schema, summarize_dataset
from shennong_db.config import Settings
from shennong_db.errors import ValidationError
from shennong_db.jobs import InMemoryJobStore
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.semantic import (
    AgentCallRequest,
    AgentCallResponse,
    AgentTool,
    AgentToolsResponse,
    ComputeSpec,
    JobCreate,
    QuerySpec,
)
from shennong_db.security import require_admin_request

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/tools", response_model=AgentToolsResponse)
async def list_agent_tools() -> AgentToolsResponse:
    return AgentToolsResponse(
        tools=[
            _tool(
                "list_datasets",
                "List visible Shennong datasets and their default versions.",
                {"type": "object", "properties": {}, "required": []},
            ),
            _tool(
                "get_dataset_schema",
                "Return the semantic schema for a dataset.",
                {
                    "type": "object",
                    "properties": {"dataset": {"type": "string"}, "version": {"type": "string"}},
                    "required": ["dataset"],
                },
            ),
            _tool(
                "get_dataset_capabilities",
                "Return supported query and compute capabilities for a dataset.",
                {
                    "type": "object",
                    "properties": {"dataset": {"type": "string"}, "version": {"type": "string"}},
                    "required": ["dataset"],
                },
            ),
            _tool(
                "query_data",
                "Query a data slice from any Shennong dataset using QuerySpec.",
                QuerySpec.model_json_schema(),
            ),
            _tool(
                "compute",
                "Queue a supported analysis task using ComputeSpec.",
                ComputeSpec.model_json_schema(),
            ),
            _tool(
                "get_job",
                "Get an async job status.",
                {
                    "type": "object",
                    "properties": {"job_id": {"type": "string"}},
                    "required": ["job_id"],
                },
            ),
            _tool(
                "get_artifact",
                "Get generated artifact metadata.",
                {
                    "type": "object",
                    "properties": {"artifact_id": {"type": "string"}},
                    "required": ["artifact_id"],
                },
            ),
        ]
    )


@router.post("/call", response_model=AgentCallResponse)
async def call_agent_tool(
    payload: AgentCallRequest,
    request: Request,
    backend_router: BackendRouter = Depends(get_backend_router),
    cache: AsyncQueryCache = Depends(get_cache),
    settings: Settings = Depends(get_settings),
    registry: DatasetRegistryService = Depends(get_registry),
) -> AgentCallResponse:
    if payload.tool == "list_datasets":
        versions = await registry.list()
        defaults = _default_versions(versions)
        return AgentCallResponse(
            tool=payload.tool,
            data=[summarize_dataset(dataset).model_dump() for dataset in defaults],
        )
    if payload.tool == "get_dataset_schema":
        dataset = await registry.get(payload.args["dataset"], payload.args.get("version"))
        return AgentCallResponse(tool=payload.tool, data=semantic_schema(dataset))
    if payload.tool == "get_dataset_capabilities":
        dataset = await registry.get(payload.args["dataset"], payload.args.get("version"))
        return AgentCallResponse(tool=payload.tool, data=capabilities(dataset))
    if payload.tool == "query_data":
        spec = QuerySpec.model_validate(payload.args)
        response = await cached_semantic_query_response(
            cache=cache,
            namespace="agent:query_data",
            payload=spec.model_dump(mode="json", by_alias=True),
            ttl_seconds=settings.query_cache_ttl_seconds,
            producer=lambda: backend_router.query(spec),
        )
        return AgentCallResponse(
            tool=payload.tool,
            data=response.data,
            meta=response.meta.model_dump(mode="json"),
        )
    if payload.tool == "compute":
        require_admin_request(request)
        spec = ComputeSpec.model_validate(payload.args)
        store: InMemoryJobStore = request.app.state.job_store
        job = store.create(
            JobCreate(type="compute", spec=spec.model_dump(mode="json", by_alias=True))
        )
        return AgentCallResponse(
            tool=payload.tool,
            data={"job_id": job.job_id, "state": job.state},
        )
    if payload.tool == "get_job":
        store: InMemoryJobStore = request.app.state.job_store
        return AgentCallResponse(tool=payload.tool, data=store.get(payload.args["job_id"]))
    if payload.tool == "get_artifact":
        store: InMemoryJobStore = request.app.state.job_store
        return AgentCallResponse(
            tool=payload.tool,
            data=store.get_artifact(payload.args["artifact_id"]),
        )
    raise ValidationError(f"Unknown agent tool '{payload.tool}'")


def _tool(name: str, description: str, input_schema: dict[str, Any]) -> AgentTool:
    return AgentTool(name=name, description=description, input_schema=input_schema)


def _default_versions(versions: list) -> list:
    grouped: dict[str, list] = {}
    for version in versions:
        grouped.setdefault(version.dataset_id, []).append(version)
    defaults = []
    for candidates in grouped.values():
        default = next((item for item in candidates if item.is_default), None)
        defaults.append(default or sorted(candidates, key=lambda item: item.version)[-1])
    return sorted(defaults, key=lambda item: item.dataset_id)
