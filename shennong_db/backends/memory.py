from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Any

from shennong_db.backends.base import BackendQueryResult
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.queries import (
    EqtlQuery,
    ExpressionQuery,
    SingleCellQuery,
    SpatialQuery,
    SurvivalQuery,
)


class InMemoryAnalyticalBackend:
    """Deterministic local backend for tests and example development."""

    def __init__(self) -> None:
        self.expression_rows: list[dict[str, Any]] = []
        self.survival_rows: list[dict[str, Any]] = []
        self.eqtl_rows: list[dict[str, Any]] = []
        self.singlecell_rows: list[dict[str, Any]] = []
        self.spatial_rows: list[dict[str, Any]] = []

    def seed(self, *, table: str, rows: Iterable[dict[str, Any]]) -> None:
        getattr(self, f"{table}_rows").extend(dict(row) for row in rows)

    @staticmethod
    def _page(rows: list[dict[str, Any]], limit: int, offset: int) -> list[dict[str, Any]]:
        return rows[offset : offset + limit]

    @staticmethod
    def _result(rows: list[dict[str, Any]], started: float) -> BackendQueryResult:
        columns = list(rows[0].keys()) if rows else []
        return BackendQueryResult(
            columns=columns,
            rows=rows,
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )

    async def query_expression(
        self,
        dataset: DatasetVersion,
        query: ExpressionQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        started = time.perf_counter()
        rows = [
            row
            for row in self.expression_rows
            if row.get("dataset") == dataset.dataset_id
            and row.get("version") == dataset.version
            and row.get("gene_symbol") in query.genes
            and (not query.cancer or row.get("cancer") in query.cancer)
            and (not query.group_name or row.get("group_name") in query.group_name)
            and (not query.sample_ids or row.get("sample_id") in query.sample_ids)
        ]
        if query.aggregation != "none":
            buckets: dict[tuple[Any, ...], list[float]] = {}
            for row in rows:
                key = (
                    row.get("dataset"),
                    row.get("version"),
                    row.get("gene_symbol"),
                    row.get("cancer"),
                    row.get("group_name"),
                )
                buckets.setdefault(key, []).append(float(row.get("value", 0)))
            aggregated = []
            for (ds, version, gene, cancer, group), values in buckets.items():
                if query.aggregation == "mean":
                    value = sum(values) / len(values)
                elif query.aggregation == "median":
                    ordered = sorted(values)
                    value = ordered[len(ordered) // 2]
                else:
                    value = sum(values)
                aggregated.append(
                    {
                        "dataset": ds,
                        "version": version,
                        "gene_symbol": gene,
                        "cancer": cancer,
                        "group_name": group,
                        "value": value,
                        "n": len(values),
                    }
                )
            rows = aggregated
        rows = sorted(
            rows, key=lambda row: (row.get("gene_symbol"), row.get("cancer"), row.get("sample_id"))
        )
        return self._result(self._page(rows, limit, offset), started)

    async def query_survival(
        self,
        dataset: DatasetVersion,
        query: SurvivalQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        started = time.perf_counter()
        rows = [
            row
            for row in self.survival_rows
            if row.get("dataset") == dataset.dataset_id
            and row.get("version") == dataset.version
            and (not query.cancer or row.get("cancer") in query.cancer)
            and (not query.sample_ids or row.get("sample_id") in query.sample_ids)
        ]
        return self._result(self._page(rows, limit, offset), started)

    async def query_eqtl(
        self,
        dataset: DatasetVersion,
        query: EqtlQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        started = time.perf_counter()
        rows = [
            row
            for row in self.eqtl_rows
            if row.get("dataset") == dataset.dataset_id
            and row.get("version") == dataset.version
            and (not query.genes or row.get("gene_symbol") in query.genes)
            and (not query.variants or row.get("variant_id") in query.variants)
            and (not query.tissue or row.get("tissue") in query.tissue)
            and (not query.phenotype or row.get("phenotype") == query.phenotype)
            and (query.pvalue_lte is None or float(row.get("pvalue", 1)) <= query.pvalue_lte)
        ]
        rows = sorted(
            rows, key=lambda row: (row.get("gene_symbol"), row.get("pvalue"), row.get("variant_id"))
        )
        return self._result(self._page(rows, limit, offset), started)

    async def query_singlecell(
        self,
        dataset: DatasetVersion,
        query: SingleCellQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        started = time.perf_counter()
        rows = [
            row
            for row in self.singlecell_rows
            if row.get("dataset") == dataset.dataset_id
            and row.get("version") == dataset.version
            and row.get("gene_symbol") in query.genes
        ]
        return self._result(self._page(rows, limit, offset), started)

    async def query_spatial(
        self,
        dataset: DatasetVersion,
        query: SpatialQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        started = time.perf_counter()
        rows = [
            row
            for row in self.spatial_rows
            if row.get("dataset") == dataset.dataset_id
            and row.get("version") == dataset.version
            and row.get("gene_symbol") in query.genes
        ]
        if query.region:
            region = query.region
            rows = [
                row
                for row in rows
                if region.get("x_min", float("-inf"))
                <= float(row.get("x", 0))
                <= region.get("x_max", float("inf"))
                and region.get("y_min", float("-inf"))
                <= float(row.get("y", 0))
                <= region.get("y_max", float("inf"))
            ]
        return self._result(self._page(rows, limit, offset), started)

    async def get_values(
        self,
        dataset: DatasetVersion,
        field: str,
        *,
        limit: int = 1000,
    ) -> list[str]:
        aliases = {
            "group": "group_name",
            "feature": "gene_symbol",
            "feature_id": "gene_symbol",
            "feature_symbol": "gene_symbol",
            "observation_id": "sample_id",
        }
        key = aliases.get(field, field)
        rows = [
            *self.expression_rows,
            *self.survival_rows,
            *self.eqtl_rows,
            *self.singlecell_rows,
            *self.spatial_rows,
        ]
        values = sorted(
            {
                str(row[key])
                for row in rows
                if row.get("dataset") == dataset.dataset_id
                and row.get("version") == dataset.version
                and row.get(key) not in {None, ""}
            }
        )
        return values[:limit]
