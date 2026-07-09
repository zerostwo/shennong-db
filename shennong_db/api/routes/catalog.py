from fastapi import APIRouter, Depends, Query

from shennong_db.api.deps import get_backend_router, get_registry
from shennong_db.backends.router import BackendRouter
from shennong_db.catalog import (
    capabilities,
    detail_dataset,
    fields,
    semantic_schema,
    summarize_dataset,
)
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.semantic import CatalogResponse

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/datasets", response_model=CatalogResponse)
async def list_catalog_datasets(
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    versions = await registry.list()
    defaults = _default_versions(versions)
    return CatalogResponse(data=[summarize_dataset(dataset).model_dump() for dataset in defaults])


@router.get("/datasets/{dataset_id}", response_model=CatalogResponse)
async def get_catalog_dataset(
    dataset_id: str,
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    versions = await registry.list()
    dataset = await registry.get(dataset_id)
    return CatalogResponse(data=detail_dataset(dataset, versions).model_dump())


@router.get("/datasets/{dataset_id}/schema", response_model=CatalogResponse)
async def get_catalog_schema(
    dataset_id: str,
    version: str | None = Query(default=None),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    return CatalogResponse(data=semantic_schema(dataset))


@router.get("/datasets/{dataset_id}/capabilities", response_model=CatalogResponse)
async def get_catalog_capabilities(
    dataset_id: str,
    version: str | None = Query(default=None),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    return CatalogResponse(data=capabilities(dataset))


@router.get("/datasets/{dataset_id}/fields", response_model=CatalogResponse)
async def get_catalog_fields(
    dataset_id: str,
    version: str | None = Query(default=None),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    return CatalogResponse(data=fields(dataset))


@router.get("/datasets/{dataset_id}/values/{field}", response_model=CatalogResponse)
async def get_catalog_values(
    dataset_id: str,
    field: str,
    version: str | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=10000),
    backend_router: BackendRouter = Depends(get_backend_router),
) -> CatalogResponse:
    values = await backend_router.get_values(
        dataset_id,
        None if version == "latest" else version,
        field,
        limit=limit,
    )
    return CatalogResponse(data={"field": field, "values": values})


def _default_versions(versions: list) -> list:
    grouped: dict[str, list] = {}
    for version in versions:
        grouped.setdefault(version.dataset_id, []).append(version)
    defaults = []
    for candidates in grouped.values():
        default = next((item for item in candidates if item.is_default), None)
        defaults.append(default or sorted(candidates, key=lambda item: item.version)[-1])
    return sorted(defaults, key=lambda item: item.dataset_id)

