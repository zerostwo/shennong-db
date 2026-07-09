from __future__ import annotations

import asyncio
import csv
import json
from pathlib import Path
from typing import Any

from shennong_db.config import Settings
from shennong_db.registry.repository import build_registry_repository
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.datasets import DatasetVersion, DatasetVersionCreate


async def register_dataset(settings: Settings, dataset: DatasetVersionCreate) -> DatasetVersion:
    repository = build_registry_repository(settings)
    registry = DatasetRegistryService(repository)
    await registry.init()
    try:
        return await registry.upsert(dataset)
    finally:
        await registry.close()


async def init_metadata_schema(settings: Settings) -> None:
    repository = build_registry_repository(settings)
    registry = DatasetRegistryService(repository)
    await registry.init()
    await registry.close()


async def init_clickhouse_schema(settings: Settings, sql_path: Path) -> None:
    import clickhouse_connect

    client = await clickhouse_connect.get_async_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_username,
        password=settings.clickhouse_password,
        database=settings.clickhouse_database,
        secure=settings.clickhouse_secure,
    )
    try:
        statements = [
            statement.strip()
            for statement in sql_path.read_text(encoding="utf-8").split(";")
            if statement.strip()
        ]
        for statement in statements:
            await client.command(statement)
    finally:
        close_result = client.close()
        if hasattr(close_result, "__await__"):
            await close_result


async def load_clickhouse_csv(
    settings: Settings,
    *,
    table: str,
    csv_path: Path,
    chunk_size: int = 50_000,
) -> int:
    import clickhouse_connect

    client = await clickhouse_connect.get_async_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_username,
        password=settings.clickhouse_password,
        database=settings.clickhouse_database,
        secure=settings.clickhouse_secure,
    )
    inserted = 0
    try:
        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                raise ValueError(f"{csv_path} has no header row")
            columns = list(reader.fieldnames)
            chunk: list[list[Any]] = []
            for row in reader:
                chunk.append([row[column] for column in columns])
                if len(chunk) >= chunk_size:
                    await client.insert(table, chunk, column_names=columns)
                    inserted += len(chunk)
                    chunk.clear()
            if chunk:
                await client.insert(table, chunk, column_names=columns)
                inserted += len(chunk)
        return inserted
    finally:
        close_result = client.close()
        if hasattr(close_result, "__await__"):
            await close_result


def build_xena_matrix_index(matrix_path: Path, index_path: Path | None = None) -> Path:
    if matrix_path.suffix == ".gz":
        raise ValueError("Xena row-offset indexes require an uncompressed matrix file")
    target = index_path or Path(f"{matrix_path}.idx.json")
    with matrix_path.open("rb") as handle:
        header = handle.readline().decode("utf-8", errors="replace").rstrip("\n").split("\t")
        if len(header) < 2:
            raise ValueError(f"{matrix_path} does not look like a gene x sample matrix")
        offsets: dict[str, int] = {}
        while True:
            offset = handle.tell()
            line = handle.readline()
            if not line:
                break
            gene_id = line.split(b"\t", 1)[0].decode("utf-8", errors="replace")
            offsets[gene_id] = offset
    target.write_text(
        json.dumps({"samples": header[1:], "offsets": offsets}, separators=(",", ":")),
        encoding="utf-8",
    )
    return target


def run(coro: Any) -> Any:
    return asyncio.run(coro)
