from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse

from shennong_db.api.deps import get_backend_router, get_registry
from shennong_db.backends.router import BackendRouter
from shennong_db.catalog import (
    capabilities,
    detail_dataset,
    fields,
    semantic_schema,
    summarize_dataset,
)
from shennong_db.formats import DATA_PROFILES
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.datasets import DatasetAsset, DatasetVersion, DatasetVisibility
from shennong_db.schemas.semantic import CatalogResponse
from shennong_db.security import ensure_dataset_read, get_principal

router = APIRouter(prefix="/catalog", tags=["catalog"])


async def _visible(request: Request, datasets: list[DatasetVersion]) -> list[DatasetVersion]:
    principal = await get_principal(
        request,
        request.app.state.settings,
        request.headers.get("authorization"),
        request.headers.get("x-shennong-admin-key"),
    )
    visible = []
    for dataset in datasets:
        if (
            dataset.visibility == DatasetVisibility.public
            or await request.app.state.access_service.can_read_dataset(
                dataset.dataset_id, principal
            )
        ):
            visible.append(dataset)
    return visible


def _public_asset(asset: DatasetAsset) -> dict:
    data = asset.model_dump(mode="json", exclude={"storage_uri"})
    data["download_url"] = f"/v1/catalog/assets/{asset.asset_id}/download"
    return data


@router.get("/formats", response_model=CatalogResponse)
async def list_formats() -> CatalogResponse:
    return CatalogResponse(data=DATA_PROFILES)


@router.get("/datasets", response_model=CatalogResponse)
async def list_catalog_datasets(
    request: Request,
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    versions = await _visible(request, await registry.list())
    defaults = _default_versions(versions)
    return CatalogResponse(data=[summarize_dataset(dataset).model_dump() for dataset in defaults])


@router.get("/datasets/{dataset_id}", response_model=CatalogResponse)
async def get_catalog_dataset(
    dataset_id: str,
    request: Request,
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    versions = await registry.list()
    dataset = await registry.get(dataset_id)
    await ensure_dataset_read(request, dataset)
    return CatalogResponse(data=detail_dataset(dataset, versions).model_dump())


@router.get("/datasets/{dataset_id}/manifest", response_model=CatalogResponse)
async def get_dataset_manifest(
    dataset_id: str,
    request: Request,
    version: str | None = Query(default=None),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    await ensure_dataset_read(request, dataset)
    assets = await registry.list_assets(dataset.dataset_id, dataset.version)
    return CatalogResponse(
        data={
            "dataset": detail_dataset(dataset, await registry.list()).model_dump(),
            "assets": [_public_asset(a) for a in assets],
        }
    )


@router.get("/datasets/{dataset_id}/schema", response_model=CatalogResponse)
async def get_catalog_schema(
    dataset_id: str,
    request: Request,
    version: str | None = Query(default=None),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    await ensure_dataset_read(request, dataset)
    return CatalogResponse(data=semantic_schema(dataset))


@router.get("/datasets/{dataset_id}/capabilities", response_model=CatalogResponse)
async def get_catalog_capabilities(
    dataset_id: str,
    request: Request,
    version: str | None = Query(default=None),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    await ensure_dataset_read(request, dataset)
    return CatalogResponse(data=capabilities(dataset))


@router.get("/datasets/{dataset_id}/fields", response_model=CatalogResponse)
async def get_catalog_fields(
    dataset_id: str,
    request: Request,
    version: str | None = Query(default=None),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    await ensure_dataset_read(request, dataset)
    return CatalogResponse(data=fields(dataset))


@router.get("/datasets/{dataset_id}/values/{field}", response_model=CatalogResponse)
async def get_catalog_values(
    dataset_id: str,
    field: str,
    request: Request,
    version: str | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=10000),
    backend_router: BackendRouter = Depends(get_backend_router),
    registry: DatasetRegistryService = Depends(get_registry),
) -> CatalogResponse:
    dataset = await registry.get(dataset_id, None if version == "latest" else version)
    await ensure_dataset_read(request, dataset)
    values = await backend_router.get_values(dataset_id, dataset.version, field, limit=limit)
    return CatalogResponse(data={"field": field, "values": values})


@router.get("/assets/{asset_id}/download")
async def download_asset(
    asset_id: str,
    request: Request,
    registry: DatasetRegistryService = Depends(get_registry),
) -> FileResponse:
    asset = await registry.get_asset(asset_id)
    dataset = await registry.get(asset.dataset_id, asset.version)
    await ensure_dataset_read(request, dataset)
    return FileResponse(Path(asset.storage_uri), filename=Path(asset.storage_uri).name)


def _default_versions(versions: list[DatasetVersion]) -> list[DatasetVersion]:
    grouped: dict[str, list[DatasetVersion]] = {}
    for version in versions:
        grouped.setdefault(version.dataset_id, []).append(version)
    defaults = []
    for candidates in grouped.values():
        default = next((item for item in candidates if item.is_default), None)
        defaults.append(default or sorted(candidates, key=lambda item: item.version)[-1])
    return sorted(defaults, key=lambda item: item.dataset_id)
