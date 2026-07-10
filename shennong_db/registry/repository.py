from __future__ import annotations

import asyncio
import json
import sqlite3
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from shennong_db.config import Settings
from shennong_db.errors import NotFoundError
from shennong_db.schemas.common import BackendKind, DatasetStatus, DatasetType
from shennong_db.schemas.datasets import (
    AssetKind,
    AssetStatus,
    DatasetAsset,
    DatasetAssetCreate,
    DatasetVersion,
    DatasetVersionCreate,
    DatasetVisibility,
)


def _now() -> datetime:
    return datetime.now(UTC)


def _datetime(value: str | datetime | None) -> datetime | None:
    return datetime.fromisoformat(value) if isinstance(value, str) else value


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
        visibility=DatasetVisibility(row.get("visibility") or "public"),
        metadata=json.loads(row.get("metadata_json") or "{}")
        if isinstance(row.get("metadata_json"), str)
        else row.get("metadata_json") or {},
        created_at=_datetime(row.get("created_at")),
        updated_at=_datetime(row.get("updated_at")),
    )


def _record_to_asset(row: dict[str, Any]) -> DatasetAsset:
    return DatasetAsset(
        asset_id=row["asset_id"],
        dataset_id=row["dataset_id"],
        version=row["version"],
        role=row["role"],
        kind=AssetKind(row["kind"]),
        format=row["format"],
        storage_uri=row["storage_uri"],
        media_type=row.get("media_type"),
        compression=row.get("compression"),
        checksum=row.get("checksum"),
        size_bytes=row.get("size_bytes"),
        derived_from=row.get("derived_from"),
        status=AssetStatus(row.get("status") or "ready"),
        metadata=json.loads(row.get("metadata_json") or "{}")
        if isinstance(row.get("metadata_json"), str)
        else row.get("metadata_json") or {},
        created_at=_datetime(row.get("created_at")),
    )


class DatasetRegistryRepository(ABC):
    @abstractmethod
    async def init(self) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    async def list(self, dataset_type: DatasetType | None = None) -> list[DatasetVersion]: ...

    @abstractmethod
    async def get(self, dataset_id: str, version: str | None = None) -> DatasetVersion: ...

    @abstractmethod
    async def upsert(self, dataset: DatasetVersionCreate) -> DatasetVersion: ...

    @abstractmethod
    async def add_asset(
        self, dataset_id: str, version: str, asset: DatasetAssetCreate
    ) -> DatasetAsset: ...

    @abstractmethod
    async def list_assets(self, dataset_id: str, version: str) -> list[DatasetAsset]: ...

    @abstractmethod
    async def get_asset(self, asset_id: str) -> DatasetAsset: ...


class InMemoryDatasetRegistryRepository(DatasetRegistryRepository):
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], DatasetVersion] = {}
        self._assets: dict[str, DatasetAsset] = {}

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
            defaults or active or candidates, key=lambda item: item.updated_at or _now()
        )
        if not ordered:
            raise NotFoundError(f"Dataset '{dataset_id}' was not found")
        return ordered[-1]

    async def upsert(self, dataset: DatasetVersionCreate) -> DatasetVersion:
        now = _now()
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

    async def add_asset(
        self, dataset_id: str, version: str, asset: DatasetAssetCreate
    ) -> DatasetAsset:
        await self.get(dataset_id, version)
        existing = next(
            (
                item
                for item in self._assets.values()
                if item.dataset_id == dataset_id
                and item.version == version
                and item.role == asset.role
            ),
            None,
        )
        item = DatasetAsset(
            **asset.model_dump(),
            asset_id=existing.asset_id if existing else f"ast_{uuid4().hex}",
            dataset_id=dataset_id,
            version=version,
            created_at=existing.created_at if existing else _now(),
        )
        self._assets[item.asset_id] = item
        return item

    async def list_assets(self, dataset_id: str, version: str) -> list[DatasetAsset]:
        return sorted(
            [
                item
                for item in self._assets.values()
                if item.dataset_id == dataset_id and item.version == version
            ],
            key=lambda item: item.role,
        )

    async def get_asset(self, asset_id: str) -> DatasetAsset:
        item = self._assets.get(asset_id)
        if item is None:
            raise NotFoundError(f"Asset '{asset_id}' was not found")
        return item


class SQLiteDatasetRegistryRepository(DatasetRegistryRepository):
    def __init__(self, settings: Settings) -> None:
        self.path = settings.sqlite_path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    async def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

        def initialize() -> None:
            with self._connect() as db:
                db.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS dataset_versions (
                      dataset_id TEXT NOT NULL,
                      version TEXT NOT NULL,
                      type TEXT NOT NULL,
                      backend TEXT NOT NULL,
                      citation TEXT,
                      storage_uri TEXT,
                      status TEXT NOT NULL,
                      is_default INTEGER NOT NULL DEFAULT 0,
                      schema_version TEXT NOT NULL DEFAULT '1.0',
                      visibility TEXT NOT NULL DEFAULT 'public',
                      metadata_json TEXT NOT NULL DEFAULT '{}',
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL,
                      PRIMARY KEY (dataset_id, version)
                    );
                    CREATE INDEX IF NOT EXISTS ix_dataset_versions_dataset
                      ON dataset_versions(dataset_id, is_default, updated_at);
                    CREATE TABLE IF NOT EXISTS dataset_assets (
                      asset_id TEXT PRIMARY KEY,
                      dataset_id TEXT NOT NULL,
                      version TEXT NOT NULL,
                      role TEXT NOT NULL,
                      kind TEXT NOT NULL,
                      format TEXT NOT NULL,
                      storage_uri TEXT NOT NULL,
                      media_type TEXT,
                      compression TEXT,
                      checksum TEXT,
                      size_bytes INTEGER,
                      derived_from TEXT,
                      status TEXT NOT NULL DEFAULT 'ready',
                      metadata_json TEXT NOT NULL DEFAULT '{}',
                      created_at TEXT NOT NULL,
                      UNIQUE(dataset_id, version, role),
                      FOREIGN KEY(dataset_id, version)
                        REFERENCES dataset_versions(dataset_id, version) ON DELETE CASCADE
                    );
                    """
                )

        await asyncio.to_thread(initialize)

    async def close(self) -> None:
        return None

    async def list(self, dataset_type: DatasetType | None = None) -> list[DatasetVersion]:
        def read() -> list[DatasetVersion]:
            query = "SELECT * FROM dataset_versions"
            params: tuple[str, ...] = ()
            if dataset_type is not None:
                query += " WHERE type = ?"
                params = (dataset_type.value,)
            query += " ORDER BY dataset_id, version"
            with self._connect() as db:
                return [_record_to_dataset(dict(row)) for row in db.execute(query, params)]

        return await asyncio.to_thread(read)

    async def get(self, dataset_id: str, version: str | None = None) -> DatasetVersion:
        def read() -> DatasetVersion:
            query = "SELECT * FROM dataset_versions WHERE dataset_id = ?"
            params: tuple[str, ...] = (dataset_id,)
            if version is not None:
                query += " AND version = ?"
                params = (dataset_id, version)
            else:
                query += " ORDER BY is_default DESC, updated_at DESC LIMIT 1"
            with self._connect() as db:
                row = db.execute(query, params).fetchone()
            if row is None:
                suffix = f" version '{version}'" if version else ""
                raise NotFoundError(f"Dataset '{dataset_id}'{suffix} was not found")
            return _record_to_dataset(dict(row))

        return await asyncio.to_thread(read)

    async def upsert(self, dataset: DatasetVersionCreate) -> DatasetVersion:
        def write() -> DatasetVersion:
            now = _now().isoformat()
            values = dataset.model_dump(mode="json")
            metadata_json = json.dumps(values.pop("metadata"), separators=(",", ":"))
            with self._connect() as db:
                if dataset.is_default:
                    db.execute(
                        "UPDATE dataset_versions SET is_default = 0 WHERE dataset_id = ?",
                        (dataset.dataset_id,),
                    )
                db.execute(
                    """
                    INSERT INTO dataset_versions (
                      dataset_id, version, type, backend, citation, storage_uri, status,
                      is_default, schema_version, visibility, metadata_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(dataset_id, version) DO UPDATE SET
                      type=excluded.type, backend=excluded.backend, citation=excluded.citation,
                      storage_uri=excluded.storage_uri, status=excluded.status,
                      is_default=excluded.is_default, schema_version=excluded.schema_version,
                      visibility=excluded.visibility, metadata_json=excluded.metadata_json,
                      updated_at=excluded.updated_at
                    """,
                    (
                        dataset.dataset_id,
                        dataset.version,
                        dataset.type.value,
                        dataset.backend.value,
                        dataset.citation,
                        dataset.storage_uri,
                        dataset.status.value,
                        int(dataset.is_default),
                        dataset.schema_version,
                        dataset.visibility.value,
                        metadata_json,
                        now,
                        now,
                    ),
                )
                row = db.execute(
                    "SELECT * FROM dataset_versions WHERE dataset_id = ? AND version = ?",
                    (dataset.dataset_id, dataset.version),
                ).fetchone()
            if row is None:
                raise RuntimeError("Dataset upsert did not return a row")
            return _record_to_dataset(dict(row))

        return await asyncio.to_thread(write)

    async def add_asset(
        self, dataset_id: str, version: str, asset: DatasetAssetCreate
    ) -> DatasetAsset:
        await self.get(dataset_id, version)

        def write() -> DatasetAsset:
            asset_id = f"ast_{uuid4().hex}"
            now = _now().isoformat()
            with self._connect() as db:
                existing = db.execute(
                    """SELECT asset_id, created_at FROM dataset_assets
                    WHERE dataset_id=? AND version=? AND role=?""",
                    (dataset_id, version, asset.role),
                ).fetchone()
                if existing:
                    asset_id = existing["asset_id"]
                    now = existing["created_at"]
                db.execute(
                    """
                    INSERT INTO dataset_assets (
                      asset_id, dataset_id, version, role, kind, format, storage_uri,
                      media_type, compression, checksum, size_bytes, derived_from,
                      status, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
                    ON CONFLICT(dataset_id, version, role) DO UPDATE SET
                      kind=excluded.kind, format=excluded.format, storage_uri=excluded.storage_uri,
                      media_type=excluded.media_type, compression=excluded.compression,
                      checksum=excluded.checksum, size_bytes=excluded.size_bytes,
                      derived_from=excluded.derived_from, status='ready',
                      metadata_json=excluded.metadata_json
                    """,
                    (
                        asset_id,
                        dataset_id,
                        version,
                        asset.role,
                        asset.kind.value,
                        asset.format,
                        asset.storage_uri,
                        asset.media_type,
                        asset.compression,
                        asset.checksum,
                        asset.size_bytes,
                        asset.derived_from,
                        json.dumps(asset.metadata, separators=(",", ":")),
                        now,
                    ),
                )
                row = db.execute(
                    "SELECT * FROM dataset_assets WHERE asset_id=?", (asset_id,)
                ).fetchone()
            if row is None:
                raise RuntimeError("Asset upsert did not return a row")
            return _record_to_asset(dict(row))

        return await asyncio.to_thread(write)

    async def list_assets(self, dataset_id: str, version: str) -> list[DatasetAsset]:
        def read() -> list[DatasetAsset]:
            with self._connect() as db:
                rows = db.execute(
                    "SELECT * FROM dataset_assets WHERE dataset_id=? AND version=? ORDER BY role",
                    (dataset_id, version),
                ).fetchall()
            return [_record_to_asset(dict(row)) for row in rows]

        return await asyncio.to_thread(read)

    async def get_asset(self, asset_id: str) -> DatasetAsset:
        def read() -> DatasetAsset:
            with self._connect() as db:
                row = db.execute(
                    "SELECT * FROM dataset_assets WHERE asset_id=?", (asset_id,)
                ).fetchone()
            if row is None:
                raise NotFoundError(f"Asset '{asset_id}' was not found")
            return _record_to_asset(dict(row))

        return await asyncio.to_thread(read)


def build_registry_repository(settings: Settings) -> DatasetRegistryRepository:
    if settings.registry_backend == "memory":
        return InMemoryDatasetRegistryRepository()
    return SQLiteDatasetRegistryRepository(settings)
