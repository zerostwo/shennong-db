from fastapi import APIRouter, Depends, Query

from shennong_db.api.deps import get_registry, get_settings
from shennong_db.config import Settings
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.common import DatasetType
from shennong_db.schemas.datasets import DatasetListResponse, DatasetVersion, DatasetVersionCreate
from shennong_db.security import require_admin, validate_dataset_storage

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("", response_model=DatasetListResponse)
async def list_datasets(
    dataset_type: DatasetType | None = Query(default=None, alias="type"),
    registry: DatasetRegistryService = Depends(get_registry),
) -> DatasetListResponse:
    return DatasetListResponse(datasets=await registry.list(dataset_type))


@router.post("", response_model=DatasetVersion, status_code=201)
async def register_dataset_version(
    dataset: DatasetVersionCreate,
    _: None = Depends(require_admin),
    registry: DatasetRegistryService = Depends(get_registry),
    settings: Settings = Depends(get_settings),
) -> DatasetVersion:
    validate_dataset_storage(settings, dataset)
    return await registry.upsert(dataset)


@router.get("/{dataset_id}", response_model=DatasetVersion)
async def get_default_dataset_version(
    dataset_id: str,
    registry: DatasetRegistryService = Depends(get_registry),
) -> DatasetVersion:
    return await registry.get(dataset_id)


@router.get("/{dataset_id}/versions/{version}", response_model=DatasetVersion)
async def get_dataset_version(
    dataset_id: str,
    version: str,
    registry: DatasetRegistryService = Depends(get_registry),
) -> DatasetVersion:
    return await registry.get(dataset_id, version)
