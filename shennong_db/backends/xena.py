from __future__ import annotations

import asyncio
import csv
import gzip
import json
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from shennong_db.backends.base import BackendQueryResult
from shennong_db.errors import ValidationError
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.queries import (
    EqtlQuery,
    ExpressionQuery,
    SingleCellQuery,
    SpatialQuery,
    SurvivalQuery,
)


class XenaExpressionBackend:
    """Lazy reader for UCSC Xena-style gene x sample expression matrices."""

    def __init__(self) -> None:
        self._gene_maps: dict[str, dict[str, Any]] = {}
        self._phenotypes: dict[str, dict[str, dict[str, str]]] = {}
        self._matrix_indexes: dict[str, dict[str, Any]] = {}

    async def query_expression(
        self,
        dataset: DatasetVersion,
        query: ExpressionQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        return await asyncio.to_thread(
            self._query_expression_sync,
            dataset,
            query,
            limit=limit,
            offset=offset,
        )

    async def get_values(
        self,
        dataset: DatasetVersion,
        field: str,
        *,
        limit: int = 1000,
    ) -> list[str]:
        return await asyncio.to_thread(self._get_values_sync, dataset, field, limit=limit)

    async def query_survival(
        self,
        dataset: DatasetVersion,
        query: SurvivalQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise ValidationError("Xena backend does not serve survival queries")

    async def query_singlecell(
        self,
        dataset: DatasetVersion,
        query: SingleCellQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise ValidationError("Xena backend does not serve single-cell queries")

    async def query_spatial(
        self,
        dataset: DatasetVersion,
        query: SpatialQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise ValidationError("Xena backend does not serve spatial queries")

    async def query_eqtl(
        self,
        dataset: DatasetVersion,
        query: EqtlQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise ValidationError("Xena backend does not serve eQTL queries")

    def _query_expression_sync(
        self,
        dataset: DatasetVersion,
        query: ExpressionQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        started = time.perf_counter()
        matrix_path = self._matrix_path(dataset)
        index = self._matrix_index(matrix_path)
        samples = index["samples"]
        sample_positions = self._matching_sample_positions(dataset, query, samples)
        genes = self._resolve_genes(dataset, query.genes, index)

        if query.aggregation == "none":
            rows = self._expression_rows(
                dataset,
                matrix_path,
                index,
                genes,
                sample_positions,
                limit=limit,
                offset=offset,
            )
        else:
            rows = self._aggregated_expression_rows(
                dataset,
                matrix_path,
                index,
                genes,
                sample_positions,
                aggregation=query.aggregation,
            )[offset : offset + limit]

        return BackendQueryResult(
            columns=list(rows[0].keys()) if rows else [],
            rows=rows,
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )

    def _expression_rows(
        self,
        dataset: DatasetVersion,
        matrix_path: Path,
        index: dict[str, Any],
        genes: list[dict[str, str]],
        sample_positions: list[int],
        *,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        phenotypes = self._phenotypes_for(dataset)
        rows: list[dict[str, Any]] = []
        seen = 0
        for gene in genes:
            values = self._read_gene_values(matrix_path, index, gene["gene_id"])
            for position in sample_positions:
                if seen < offset:
                    seen += 1
                    continue
                sample_id = index["samples"][position]
                row = self._base_expression_row(
                    dataset=dataset,
                    sample_id=sample_id,
                    gene_id=gene["gene_id"],
                    gene_symbol=gene["gene_symbol"],
                    value=float(values[position]),
                    phenotype=phenotypes.get(sample_id, {}),
                )
                rows.append(row)
                seen += 1
                if len(rows) >= limit:
                    return rows
        return rows

    def _aggregated_expression_rows(
        self,
        dataset: DatasetVersion,
        matrix_path: Path,
        index: dict[str, Any],
        genes: list[dict[str, str]],
        sample_positions: list[int],
        *,
        aggregation: str,
    ) -> list[dict[str, Any]]:
        phenotypes = self._phenotypes_for(dataset)
        rows: list[dict[str, Any]] = []
        for gene in genes:
            buckets: dict[tuple[str, str], list[float]] = {}
            phenotype_by_bucket: dict[tuple[str, str], dict[str, str]] = {}
            values = self._read_gene_values(matrix_path, index, gene["gene_id"])
            for position in sample_positions:
                sample_id = index["samples"][position]
                phenotype = phenotypes.get(sample_id, {})
                key = (phenotype.get("cancer", ""), phenotype.get("group_name", ""))
                buckets.setdefault(key, []).append(float(values[position]))
                phenotype_by_bucket.setdefault(key, phenotype)
            for key, bucket_values in sorted(buckets.items()):
                if aggregation == "mean":
                    value = sum(bucket_values) / len(bucket_values)
                elif aggregation == "median":
                    ordered = sorted(bucket_values)
                    value = ordered[len(ordered) // 2]
                else:
                    value = sum(bucket_values)
                phenotype = phenotype_by_bucket[key]
                row = self._base_expression_row(
                    dataset=dataset,
                    sample_id=None,
                    gene_id=gene["gene_id"],
                    gene_symbol=gene["gene_symbol"],
                    value=value,
                    phenotype=phenotype,
                )
                row["n"] = len(bucket_values)
                rows.append(row)
        return rows

    @staticmethod
    def _base_expression_row(
        *,
        dataset: DatasetVersion,
        sample_id: str | None,
        gene_id: str,
        gene_symbol: str,
        value: float,
        phenotype: dict[str, str],
    ) -> dict[str, Any]:
        row = {
            "dataset": dataset.dataset_id,
            "version": dataset.version,
            "sample_id": sample_id,
            "gene_id": gene_id,
            "gene_symbol": gene_symbol,
            "value": value,
        }
        for key in ("cancer", "group_name", "tissue", "study", "gender"):
            if phenotype.get(key):
                row[key] = phenotype[key]
        return row

    def _get_values_sync(self, dataset: DatasetVersion, field: str, *, limit: int) -> list[str]:
        matrix_path = self._matrix_path(dataset)
        index = self._matrix_index(matrix_path)
        normalized = {
            "feature": "gene_symbol",
            "feature_id": "gene_id",
            "feature_symbol": "gene_symbol",
            "gene": "gene_symbol",
            "observation_id": "sample_id",
            "sample": "sample_id",
            "group": "group_name",
        }.get(field, field)
        if normalized == "sample_id":
            return index["samples"][:limit]
        if normalized == "gene_id":
            return sorted(index["offsets"])[:limit]
        if normalized == "gene_symbol":
            mapping = self._gene_map_for(dataset)
            return sorted(mapping["symbol_to_ids"])[:limit]
        if normalized in {"cancer", "group_name", "tissue", "study", "gender"}:
            phenotypes = self._phenotypes_for(dataset)
            values = sorted({row[normalized] for row in phenotypes.values() if row.get(normalized)})
            return values[:limit]
        return []

    def _matrix_path(self, dataset: DatasetVersion) -> Path:
        if not dataset.storage_uri:
            raise ValidationError("Xena datasets require storage_uri")
        path = Path(dataset.storage_uri)
        if not path.exists():
            raise ValidationError(
                f"Xena matrix file does not exist: {path}",
                details={"storage_uri": dataset.storage_uri},
            )
        return path

    def _matrix_index(self, matrix_path: Path) -> dict[str, Any]:
        cache_key = str(matrix_path)
        if cache_key in self._matrix_indexes:
            return self._matrix_indexes[cache_key]
        index_path = Path(f"{matrix_path}.idx.json")
        if index_path.exists():
            index = json.loads(index_path.read_text(encoding="utf-8"))
        else:
            index = self._scan_matrix_index(matrix_path)
        self._matrix_indexes[cache_key] = index
        return index

    @staticmethod
    def _scan_matrix_index(matrix_path: Path) -> dict[str, Any]:
        if matrix_path.suffix == ".gz":
            with gzip.open(matrix_path, "rt", encoding="utf-8", errors="replace") as handle:
                header = handle.readline().rstrip("\n").split("\t")
                offsets = {line.split("\t", 1)[0]: None for line in handle if line}
        else:
            offsets: dict[str, int] = {}
            with matrix_path.open("rb") as handle:
                header = (
                    handle.readline()
                    .decode("utf-8", errors="replace")
                    .rstrip("\n")
                    .split("\t")
                )
                while True:
                    offset = handle.tell()
                    line = handle.readline()
                    if not line:
                        break
                    gene_id = line.split(b"\t", 1)[0].decode("utf-8", errors="replace")
                    offsets[gene_id] = offset
        return {"samples": header[1:], "offsets": offsets}

    def _read_gene_values(
        self,
        matrix_path: Path,
        index: dict[str, Any],
        gene_id: str,
    ) -> list[str]:
        offset = index["offsets"].get(gene_id)
        if offset is not None and matrix_path.suffix != ".gz":
            with matrix_path.open("rb") as handle:
                handle.seek(offset)
                line = handle.readline().decode("utf-8", errors="replace").rstrip("\n")
            parts = line.split("\t")
            if parts[0] != gene_id:
                raise ValidationError(
                    "Xena matrix index points to the wrong row",
                    details={"gene_id": gene_id, "observed": parts[0]},
                )
            return parts[1:]
        opener = gzip.open if matrix_path.suffix == ".gz" else open
        with opener(matrix_path, "rt", encoding="utf-8", errors="replace") as handle:
            handle.readline()
            for line in handle:
                if line.startswith(f"{gene_id}\t"):
                    return line.rstrip("\n").split("\t")[1:]
        raise ValidationError(f"Gene '{gene_id}' was not found in Xena matrix")

    def _resolve_genes(
        self,
        dataset: DatasetVersion,
        requested: Iterable[str],
        index: dict[str, Any],
    ) -> list[dict[str, str]]:
        mapping = self._gene_map_for(dataset)
        rows: list[dict[str, str]] = []
        missing: list[str] = []
        for gene in requested:
            if gene in index["offsets"]:
                rows.append(
                    {"gene_id": gene, "gene_symbol": mapping["id_to_symbol"].get(gene, gene)}
                )
                continue
            ids = mapping["symbol_to_ids"].get(gene)
            if ids:
                rows.extend({"gene_id": gene_id, "gene_symbol": gene} for gene_id in ids)
                continue
            missing.append(gene)
        if missing:
            raise ValidationError(
                "Requested gene(s) are not present in the Xena gene map",
                details={"genes": missing},
            )
        return rows

    def _gene_map_for(self, dataset: DatasetVersion) -> dict[str, Any]:
        uri = dataset.metadata.get("gene_map_uri")
        if not uri:
            return {"symbol_to_ids": {}, "id_to_symbol": {}}
        cache_key = str(uri)
        if cache_key in self._gene_maps:
            return self._gene_maps[cache_key]
        path = Path(uri)
        if not path.exists():
            raise ValidationError(f"Xena gene map does not exist: {path}")
        id_column = dataset.metadata.get("gene_id_column", "id")
        symbol_column = dataset.metadata.get("gene_symbol_column", "gene")
        symbol_to_ids: dict[str, list[str]] = {}
        id_to_symbol: dict[str, str] = {}
        with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                gene_id = row.get(id_column, "")
                symbol = row.get(symbol_column, "")
                if not gene_id or not symbol:
                    continue
                id_to_symbol[gene_id] = symbol
                symbol_to_ids.setdefault(symbol, []).append(gene_id)
        result = {"symbol_to_ids": symbol_to_ids, "id_to_symbol": id_to_symbol}
        self._gene_maps[cache_key] = result
        return result

    def _phenotypes_for(self, dataset: DatasetVersion) -> dict[str, dict[str, str]]:
        uri = dataset.metadata.get("phenotype_uri")
        if not uri:
            return {}
        cache_key = str(uri)
        if cache_key in self._phenotypes:
            return self._phenotypes[cache_key]
        path = Path(uri)
        if not path.exists():
            raise ValidationError(f"Xena phenotype file does not exist: {path}")
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8", errors="replace", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            rows = {
                row["sample"]: {
                    "cancer": row.get(
                        dataset.metadata.get("cancer_column", "detailed_category"), ""
                    ),
                    "group_name": row.get(dataset.metadata.get("group_column", "_sample_type"), ""),
                    "tissue": row.get(dataset.metadata.get("tissue_column", "_primary_site"), ""),
                    "study": row.get(dataset.metadata.get("study_column", "_study"), ""),
                    "gender": row.get(dataset.metadata.get("gender_column", "_gender"), ""),
                }
                for row in reader
                if row.get("sample")
            }
        self._phenotypes[cache_key] = rows
        return rows

    def _matching_sample_positions(
        self,
        dataset: DatasetVersion,
        query: ExpressionQuery,
        samples: list[str],
    ) -> list[int]:
        phenotypes = self._phenotypes_for(dataset)
        sample_filter = set(query.sample_ids or [])
        cancer_filter = set(query.cancer or [])
        group_filter = set(query.group_name or [])
        positions = []
        for position, sample_id in enumerate(samples):
            phenotype = phenotypes.get(sample_id, {})
            if sample_filter and sample_id not in sample_filter:
                continue
            if cancer_filter and phenotype.get("cancer") not in cancer_filter:
                continue
            if group_filter and phenotype.get("group_name") not in group_filter:
                continue
            positions.append(position)
        return positions
