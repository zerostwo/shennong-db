from pathlib import Path

import typer

from shennong_db.config import Settings
from shennong_db.ingest.loaders import (
    build_xena_matrix_index,
    init_clickhouse_schema,
    init_metadata_schema,
    load_clickhouse_csv,
    register_dataset,
    run,
)
from shennong_db.ingest.manifest import load_manifest

app = typer.Typer(help="Shennong Data Server ingestion CLI.")
clickhouse_app = typer.Typer(help="ClickHouse bulk/survival/eQTL loaders.")
schema_app = typer.Typer(help="Initialize storage schemas.")
xena_app = typer.Typer(help="UCSC Xena wide-matrix loaders and index builders.")
app.add_typer(clickhouse_app, name="clickhouse")
app.add_typer(schema_app, name="schema")
app.add_typer(xena_app, name="xena")


@app.command("register")
def register(
    manifest: Path = typer.Argument(
        ..., exists=True, dir_okay=False, help="JSON/YAML ingestion manifest."
    ),
) -> None:
    """Register or update one dataset version in the PostgreSQL metadata registry."""

    settings = Settings()
    payload = load_manifest(manifest)
    dataset = run(register_dataset(settings, payload.dataset))
    typer.echo(
        f"registered {dataset.dataset_id}@{dataset.version} ({dataset.type}, {dataset.backend})"
    )


@schema_app.command("metadata")
def schema_metadata() -> None:
    """Create PostgreSQL registry tables if auto-create is enabled."""

    run(init_metadata_schema(Settings()))
    typer.echo("metadata schema ready")


@schema_app.command("clickhouse")
def schema_clickhouse(
    sql_file: Path = typer.Option(
        Path("sql/clickhouse.sql"),
        exists=True,
        dir_okay=False,
        help="ClickHouse schema SQL file.",
    ),
) -> None:
    """Create ClickHouse analytical tables."""

    run(init_clickhouse_schema(Settings(), sql_file))
    typer.echo("clickhouse schema ready")


@clickhouse_app.command("load-csv")
def clickhouse_load_csv(
    table: str = typer.Option(..., help="Target ClickHouse table."),
    csv_file: Path = typer.Option(
        ..., exists=True, dir_okay=False, help="CSV file with table columns."
    ),
    chunk_size: int = typer.Option(50_000, min=1, help="Rows per ClickHouse insert batch."),
    manifest: Path | None = typer.Option(
        None,
        exists=True,
        dir_okay=False,
        help="Optional manifest to register after load succeeds.",
    ),
) -> None:
    """Chunk-load a CSV into ClickHouse without routing through PostgreSQL."""

    settings = Settings()
    inserted = run(
        load_clickhouse_csv(settings, table=table, csv_path=csv_file, chunk_size=chunk_size)
    )
    typer.echo(f"inserted {inserted} rows into {table}")
    if manifest:
        payload = load_manifest(manifest)
        dataset = run(register_dataset(settings, payload.dataset))
        typer.echo(f"registered {dataset.dataset_id}@{dataset.version}")


@xena_app.command("index-matrix")
def xena_index_matrix(
    matrix_file: Path = typer.Option(
        ..., exists=True, dir_okay=False, help="Uncompressed Xena gene x sample TSV matrix."
    ),
    index_file: Path | None = typer.Option(
        None,
        dir_okay=False,
        help="Output index path. Defaults to MATRIX.idx.json.",
    ),
) -> None:
    """Build a row-offset index so gene-level Xena queries can seek directly."""

    target = build_xena_matrix_index(matrix_file, index_file)
    typer.echo(f"wrote {target}")
