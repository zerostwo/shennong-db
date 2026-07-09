from shennong_db.errors import ValidationError
from shennong_db.registry.repository import DatasetRegistryRepository
from shennong_db.schemas.common import DatasetType
from shennong_db.schemas.datasets import DatasetVersion, DatasetVersionCreate


class DatasetRegistryService:
    def __init__(self, repository: DatasetRegistryRepository) -> None:
        self.repository = repository

    async def init(self) -> None:
        await self.repository.init()

    async def close(self) -> None:
        await self.repository.close()

    async def list(self, dataset_type: DatasetType | None = None) -> list[DatasetVersion]:
        return await self.repository.list(dataset_type)

    async def get(self, dataset_id: str, version: str | None = None) -> DatasetVersion:
        return await self.repository.get(dataset_id, version)

    async def resolve(
        self, dataset_id: str, version: str | None, expected_type: DatasetType
    ) -> DatasetVersion:
        dataset = await self.repository.get(dataset_id, version)
        if dataset.type != expected_type:
            raise ValidationError(
                f"Dataset '{dataset_id}' is type '{dataset.type}', not '{expected_type}'",
                details={"dataset_type": dataset.type, "expected_type": expected_type},
            )
        return dataset

    async def upsert(self, dataset: DatasetVersionCreate) -> DatasetVersion:
        return await self.repository.upsert(dataset)
