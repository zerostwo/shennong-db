from __future__ import annotations

import re
import time
from typing import Any

from shennong_db.backends.base import BackendQueryResult
from shennong_db.config import Settings
from shennong_db.errors import BackendCapabilityError, ValidationError
from shennong_db.schemas.common import DatasetType
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.queries import EqtlQuery, ExpressionQuery, SurvivalQuery

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_identifier(value: str) -> str:
    if not _IDENTIFIER_RE.match(value):
        raise ValidationError(f"Unsafe field identifier '{value}'")
    return value


def _add_array_filter(
    clauses: list[str],
    parameters: dict[str, Any],
    *,
    column: str,
    name: str,
    values: list[str] | None,
) -> None:
    if values:
        clauses.append(f"{_safe_identifier(column)} IN {{{name}:Array(String)}}")
        parameters[name] = values


class ClickHouseBackend:
    """ClickHouse query adapter for bulk expression, survival, and eQTL data."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: Any | None = None

    async def _get_client(self) -> Any:
        if self._client is None:
            import clickhouse_connect

            self._client = await clickhouse_connect.get_async_client(
                host=self.settings.clickhouse_host,
                port=self.settings.clickhouse_port,
                username=self.settings.clickhouse_username,
                password=self.settings.clickhouse_password,
                database=self.settings.clickhouse_database,
                secure=self.settings.clickhouse_secure,
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and hasattr(self._client, "close"):
            close_result = self._client.close()
            if hasattr(close_result, "__await__"):
                await close_result

    async def _query(self, sql: str, parameters: dict[str, Any]) -> BackendQueryResult:
        client = await self._get_client()
        started = time.perf_counter()
        result = await client.query(sql, parameters=parameters)
        elapsed_ms = (time.perf_counter() - started) * 1000
        columns = list(result.column_names)
        rows = [dict(zip(columns, row, strict=False)) for row in result.result_rows]
        return BackendQueryResult(columns=columns, rows=rows, elapsed_ms=elapsed_ms)

    async def query_expression(
        self,
        dataset: DatasetVersion,
        query: ExpressionQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        table = _safe_identifier(self.settings.clickhouse_expression_table)
        clauses = ["dataset = {dataset:String}", "version = {version:String}"]
        parameters: dict[str, Any] = {
            "dataset": dataset.dataset_id,
            "version": dataset.version,
            "genes": query.genes,
            "limit": limit,
            "offset": offset,
        }
        _add_array_filter(
            clauses,
            parameters,
            column="gene_symbol",
            name="genes",
            values=query.genes,
        )
        _add_array_filter(clauses, parameters, column="cancer", name="cancer", values=query.cancer)
        _add_array_filter(
            clauses,
            parameters,
            column="group_name",
            name="group_name",
            values=query.group_name,
        )
        _add_array_filter(
            clauses,
            parameters,
            column="sample_id",
            name="sample_ids",
            values=query.sample_ids,
        )
        where_sql = " AND ".join(clauses)
        if query.aggregation == "none":
            sql = f"""
                SELECT dataset, version, sample_id, gene_symbol, cancer, group_name, value
                FROM {table}
                WHERE {where_sql}
                ORDER BY gene_symbol, cancer, sample_id
                LIMIT {{limit:UInt64}} OFFSET {{offset:UInt64}}
            """
        else:
            functions = {
                "mean": "avg(value)",
                "median": "median(value)",
                "sum": "sum(value)",
            }
            aggregate = functions[query.aggregation]
            sql = f"""
                SELECT
                    dataset,
                    version,
                    gene_symbol,
                    cancer,
                    group_name,
                    {aggregate} AS value,
                    count() AS n
                FROM {table}
                WHERE {where_sql}
                GROUP BY dataset, version, gene_symbol, cancer, group_name
                ORDER BY gene_symbol, cancer, group_name
                LIMIT {{limit:UInt64}} OFFSET {{offset:UInt64}}
            """
        return await self._query(sql, parameters)

    async def query_survival(
        self,
        dataset: DatasetVersion,
        query: SurvivalQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        table = _safe_identifier(self.settings.clickhouse_survival_table)
        time_field = _safe_identifier(query.time_field)
        event_field = _safe_identifier(query.event_field)
        covariates = [_safe_identifier(column) for column in query.covariates]
        selected = [
            "dataset",
            "version",
            "sample_id",
            "cancer",
            time_field,
            event_field,
            *covariates,
        ]
        clauses = ["dataset = {dataset:String}", "version = {version:String}"]
        parameters: dict[str, Any] = {
            "dataset": dataset.dataset_id,
            "version": dataset.version,
            "limit": limit,
            "offset": offset,
        }
        _add_array_filter(clauses, parameters, column="cancer", name="cancer", values=query.cancer)
        _add_array_filter(
            clauses,
            parameters,
            column="sample_id",
            name="sample_ids",
            values=query.sample_ids,
        )
        sql = f"""
            SELECT {", ".join(selected)}
            FROM {table}
            WHERE {" AND ".join(clauses)}
            ORDER BY cancer, sample_id
            LIMIT {{limit:UInt64}} OFFSET {{offset:UInt64}}
        """
        return await self._query(sql, parameters)

    async def query_eqtl(
        self,
        dataset: DatasetVersion,
        query: EqtlQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        table = _safe_identifier(self.settings.clickhouse_eqtl_table)
        clauses = ["dataset = {dataset:String}", "version = {version:String}"]
        parameters: dict[str, Any] = {
            "dataset": dataset.dataset_id,
            "version": dataset.version,
            "limit": limit,
            "offset": offset,
        }
        _add_array_filter(
            clauses, parameters, column="gene_symbol", name="genes", values=query.genes
        )
        _add_array_filter(
            clauses,
            parameters,
            column="variant_id",
            name="variants",
            values=query.variants,
        )
        _add_array_filter(clauses, parameters, column="tissue", name="tissue", values=query.tissue)
        if query.phenotype:
            clauses.append("phenotype = {phenotype:String}")
            parameters["phenotype"] = query.phenotype
        if query.pvalue_lte is not None:
            clauses.append("pvalue <= {pvalue_lte:Float64}")
            parameters["pvalue_lte"] = query.pvalue_lte
        sql = f"""
            SELECT
                dataset,
                version,
                gene_symbol,
                variant_id,
                tissue,
                phenotype,
                beta,
                se,
                pvalue,
                qvalue
            FROM {table}
            WHERE {" AND ".join(clauses)}
            ORDER BY gene_symbol, pvalue, variant_id
            LIMIT {{limit:UInt64}} OFFSET {{offset:UInt64}}
        """
        return await self._query(sql, parameters)

    async def get_values(
        self,
        dataset: DatasetVersion,
        field: str,
        *,
        limit: int = 1000,
    ) -> list[str]:
        table, column = self._values_table_and_column(dataset, field)
        sql = f"""
            SELECT DISTINCT {column} AS value
            FROM {table}
            WHERE dataset = {{dataset:String}} AND version = {{version:String}}
            ORDER BY value
            LIMIT {{limit:UInt64}}
        """
        result = await self._query(
            sql,
            {"dataset": dataset.dataset_id, "version": dataset.version, "limit": limit},
        )
        return [str(row["value"]) for row in result.rows if row.get("value") not in {None, ""}]

    def _values_table_and_column(self, dataset: DatasetVersion, field: str) -> tuple[str, str]:
        field_aliases = {
            "group": "group_name",
            "feature": "gene_symbol",
            "feature_id": "gene_symbol",
            "feature_symbol": "gene_symbol",
            "observation_id": "sample_id",
        }
        column = field_aliases.get(field, field)
        allowed = {
            DatasetType.bulk_expression: {
                "sample_id",
                "gene_symbol",
                "cancer",
                "group_name",
            },
            DatasetType.survival: {"sample_id", "cancer", "group_name"},
            DatasetType.eqtl: {"gene_symbol", "variant_id", "tissue", "phenotype"},
        }
        tables = {
            DatasetType.bulk_expression: self.settings.clickhouse_expression_table,
            DatasetType.survival: self.settings.clickhouse_survival_table,
            DatasetType.eqtl: self.settings.clickhouse_eqtl_table,
        }
        allowed_columns = allowed.get(dataset.type)
        if allowed_columns is None or column not in allowed_columns:
            raise ValidationError(
                f"Field '{field}' cannot be enumerated for dataset '{dataset.dataset_id}'",
                details={"field": field, "dataset_type": dataset.type},
            )
        return _safe_identifier(tables[dataset.type]), _safe_identifier(column)

    async def query_singlecell(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("ClickHouse backend does not serve single-cell matrices")

    async def query_spatial(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("ClickHouse backend does not serve spatial matrices")
