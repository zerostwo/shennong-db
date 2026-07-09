from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from shennong_db.config import Settings
from shennong_db.db.metadata import dataset_versions, metadata
from shennong_db.errors import NotFoundError
from shennong_db.schemas.common import BackendKind, DatasetStatus, DatasetType
from shennong_db.schemas.datasets import DatasetVersion, DatasetVersionCreate


class DatasetRegistryRepository(ABC):
    @abstractmethod
    async def init(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def list(self, dataset_type: DatasetType | None = None) -> list[DatasetVersion]:
        raise NotImplementedError

    @abstractmethod
    async def get(self, dataset_id: str, version: str | None = None) -> DatasetVersion:
        raise NotImplementedError

    @abstractmethod
    async def upsert(self, dataset: DatasetVersionCreate) -> DatasetVersion:
        raise NotImplementedError


def _record_to_dataset(row: dict[str, Any]) -> DatasetVersion:
    return DatasetVersion(
        dataset_id=row["dataset_id"],
        type=DatasetType(row["type"]),
        backend=BackendKind(row["backend"]),
        version=row["version"],
        citation=row.get("citation"),
        storage_uri=row.get("storage_uri"),
        status=DatasetStatus(row["status"]),
        is_default=bool(row["is_default"]),
        schema_version=row.get("schema_version") or "1.0",
        metadata=row.get("metadata_json") or row.get("metadata") or {},
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


class InMemoryDatasetRegistryRepository(DatasetRegistryRepository):
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], DatasetVersion] = {}

    async def init(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def list(self, dataset_type: DatasetType | None = None) -> list[DatasetVersion]:
        items = list(self._items.values())
        if dataset_type is not None:
            items = [item for item in items if item.type == dataset_type]
        return sorted(items, key=lambda item: (item.dataset_id, item.version))

    async def get(self, dataset_id: str, version: str | None = None) -> DatasetVersion:
        candidates = [item for item in self._items.values() if item.dataset_id == dataset_id]
        if version is not None:
            item = self._items.get((dataset_id, version))
            if item is None:
                raise NotFoundError(f"Dataset '{dataset_id}' version '{version}' was not found")
            return item
        active = [item for item in candidates if item.status == DatasetStatus.active]
        defaults = [item for item in active if item.is_default]
        ordered = sorted(
            defaults or active or candidates, key=lambda item: item.created_at or datetime.min
        )
        if not ordered:
            raise NotFoundError(f"Dataset '{dataset_id}' was not found")
        return ordered[-1]

    async def upsert(self, dataset: DatasetVersionCreate) -> DatasetVersion:
        now = datetime.now(UTC)
        if dataset.is_default:
            for key, existing in list(self._items.items()):
                if existing.dataset_id == dataset.dataset_id:
                    self._items[key] = existing.model_copy(update={"is_default": False})

        existing = self._items.get((dataset.dataset_id, dataset.version))
        item = DatasetVersion(
            **dataset.model_dump(),
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        self._items[(dataset.dataset_id, dataset.version)] = item
        return item


class PostgresDatasetRegistryRepository(DatasetRegistryRepository):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine: AsyncEngine = create_async_engine(settings.metadata_url, pool_pre_ping=True)
        self._session = async_sessionmaker(self.engine, expire_on_commit=False)

    async def init(self) -> None:
        if not self.settings.auto_create_metadata_schema:
            return
        async with self.engine.begin() as conn:
            await conn.run_sync(metadata.create_all)

    async def close(self) -> None:
        await self.engine.dispose()

    async def list(self, dataset_type: DatasetType | None = None) -> list[DatasetVersion]:
        stmt = select(dataset_versions)
        if dataset_type is not None:
            stmt = stmt.where(dataset_versions.c.type == dataset_type.value)
        stmt = stmt.order_by(dataset_versions.c.dataset_id, dataset_versions.c.version)
        async with self._session() as session:
            result = await session.execute(stmt)
            return [_record_to_dataset(dict(row._mapping)) for row in result.fetchall()]

    async def get(self, dataset_id: str, version: str | None = None) -> DatasetVersion:
        stmt = select(dataset_versions).where(dataset_versions.c.dataset_id == dataset_id)
        if version is not None:
            stmt = stmt.where(dataset_versions.c.version == version)
        else:
            stmt = stmt.order_by(
                dataset_versions.c.is_default.desc(),
                dataset_versions.c.created_at.desc(),
            )
        stmt = stmt.limit(1)
        async with self._session() as session:
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            if version is None:
                raise NotFoundError(f"Dataset '{dataset_id}' was not found")
            raise NotFoundError(f"Dataset '{dataset_id}' version '{version}' was not found")
        return _record_to_dataset(dict(row._mapping))

    async def upsert(self, dataset: DatasetVersionCreate) -> DatasetVersion:
        values = dataset.model_dump(mode="json")
        values["metadata_json"] = values.pop("metadata")
        async with self._session() as session, session.begin():
            if dataset.is_default:
                await session.execute(
                    update(dataset_versions)
                    .where(dataset_versions.c.dataset_id == dataset.dataset_id)
                    .values(is_default=False)
                )
            stmt = insert(dataset_versions).values(**values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_dataset_versions_dataset_version",
                set_={
                    "type": stmt.excluded.type,
                    "backend": stmt.excluded.backend,
                    "citation": stmt.excluded.citation,
                    "storage_uri": stmt.excluded.storage_uri,
                    "status": stmt.excluded.status,
                    "is_default": stmt.excluded.is_default,
                    "schema_version": stmt.excluded.schema_version,
                    "metadata_json": stmt.excluded.metadata_json,
                    "updated_at": func.now(),
                },
            ).returning(dataset_versions)
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            raise RuntimeError("Dataset upsert did not return a row")
        return _record_to_dataset(dict(row._mapping))


def build_registry_repository(settings: Settings) -> DatasetRegistryRepository:
    if settings.registry_backend == "memory":
        return InMemoryDatasetRegistryRepository()
    return PostgresDatasetRegistryRepository(settings)
