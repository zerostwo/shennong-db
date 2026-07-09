from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from shennong_db.backends.base import BackendQueryResult
from shennong_db.errors import BackendCapabilityError, BackendUnavailableError, ValidationError
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.queries import SingleCellQuery


class TenxH5Backend:
    """Lazy reader for 10x Genomics feature-barcode HDF5 matrices."""

    def __init__(self) -> None:
        self._feature_cache: dict[str, dict[str, Any]] = {}
        self._barcode_cache: dict[str, list[str]] = {}

    async def query_singlecell(
        self,
        dataset: DatasetVersion,
        query: SingleCellQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        started = time.perf_counter()
        h5py = self._require_h5py()
        path = self._path(dataset)
        features = self._features(h5py, path)
        barcodes = self._barcodes(h5py, path)
        feature_rows = self._resolve_features(features, query.genes)
        cell_positions = self._cell_positions(barcodes, query.obs_filter)

        rows: list[dict[str, Any]] = []
        total_cells = len(cell_positions)
        if total_cells == 0:
            return BackendQueryResult(
                columns=["dataset", "version", "cell_id", "gene_id", "gene_symbol", "value"],
                rows=[],
                elapsed_ms=(time.perf_counter() - started) * 1000,
            )

        start = offset
        stop = offset + limit
        with h5py.File(path, "r") as handle:
            matrix = handle["matrix"]
            for feature_index, feature in enumerate(feature_rows):
                gene_start = feature_index * total_cells
                gene_stop = gene_start + total_cells
                if gene_stop <= start:
                    continue
                if gene_start >= stop:
                    break
                values = self._gene_values(
                    matrix=matrix,
                    gene_position=feature["position"],
                    n_cells=len(barcodes),
                )
                for local_index, cell_position in enumerate(cell_positions):
                    global_index = gene_start + local_index
                    if global_index < start:
                        continue
                    if global_index >= stop:
                        break
                    cell_id = barcodes[cell_position]
                    rows.append(
                        {
                            "dataset": dataset.dataset_id,
                            "version": dataset.version,
                            "cell_id": cell_id,
                            "sample_id": dataset.metadata.get("sample_id") or dataset.dataset_id,
                            "gene_id": feature["gene_id"],
                            "gene_symbol": feature["gene_symbol"],
                            "value": float(values[cell_position]),
                        }
                    )

        return BackendQueryResult(
            columns=list(rows[0].keys()) if rows else [],
            rows=rows,
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )

    async def get_values(
        self,
        dataset: DatasetVersion,
        field: str,
        *,
        limit: int = 1000,
    ) -> list[str]:
        h5py = self._require_h5py()
        path = self._path(dataset)
        normalized = {
            "feature": "gene_symbol",
            "feature_id": "gene_id",
            "feature_symbol": "gene_symbol",
            "gene": "gene_symbol",
            "observation_id": "cell_id",
            "sample": "sample_id",
        }.get(field, field)
        if normalized in {"cell_id", "barcode"}:
            return self._barcodes(h5py, path)[:limit]
        if normalized == "sample_id":
            return [str(dataset.metadata.get("sample_id") or dataset.dataset_id)]
        features = self._features(h5py, path)
        if normalized == "gene_id":
            return [row["gene_id"] for row in features["rows"][:limit]]
        if normalized == "gene_symbol":
            return [row["gene_symbol"] for row in features["rows"][:limit]]
        return []

    async def query_expression(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("10x H5 backend does not serve bulk expression")

    async def query_survival(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("10x H5 backend does not serve survival data")

    async def query_spatial(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("10x H5 backend does not serve spatial data")

    async def query_eqtl(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("10x H5 backend does not serve eQTL data")

    @staticmethod
    def _require_h5py() -> Any:
        try:
            import h5py
        except ImportError as exc:
            raise BackendUnavailableError(
                "10x H5 backend requires the 'h5py' Python package",
                details={"dependency": "h5py"},
            ) from exc
        return h5py

    @staticmethod
    def _path(dataset: DatasetVersion) -> Path:
        if not dataset.storage_uri:
            raise ValidationError("10x H5 datasets require storage_uri in the registry")
        path = Path(dataset.storage_uri)
        if not path.exists():
            raise ValidationError(
                f"10x H5 file does not exist: {path}",
                details={"storage_uri": dataset.storage_uri},
            )
        return path

    def _barcodes(self, h5py: Any, path: Path) -> list[str]:
        cache_key = str(path)
        if cache_key in self._barcode_cache:
            return self._barcode_cache[cache_key]
        with h5py.File(path, "r") as handle:
            barcodes = [self._decode(value) for value in handle["matrix/barcodes"][:]]
        self._barcode_cache[cache_key] = barcodes
        return barcodes

    def _features(self, h5py: Any, path: Path) -> dict[str, Any]:
        cache_key = str(path)
        if cache_key in self._feature_cache:
            return self._feature_cache[cache_key]
        with h5py.File(path, "r") as handle:
            group = handle["matrix/features"]
            ids = [self._decode(value) for value in group["id"][:]]
            names = [self._decode(value) for value in group["name"][:]]
        rows = [
            {"position": position, "gene_id": gene_id, "gene_symbol": gene_symbol}
            for position, (gene_id, gene_symbol) in enumerate(zip(ids, names, strict=True))
        ]
        by_id = {row["gene_id"]: row for row in rows}
        by_symbol: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            by_symbol.setdefault(row["gene_symbol"], []).append(row)
        result = {"rows": rows, "by_id": by_id, "by_symbol": by_symbol}
        self._feature_cache[cache_key] = result
        return result

    @staticmethod
    def _decode(value: Any) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    @staticmethod
    def _resolve_features(features: dict[str, Any], genes: list[str]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        missing: list[str] = []
        for gene in genes:
            if gene in features["by_id"]:
                rows.append(features["by_id"][gene])
                continue
            if gene in features["by_symbol"]:
                rows.extend(features["by_symbol"][gene])
                continue
            missing.append(gene)
        if missing:
            raise ValidationError(
                "Requested gene(s) are not present in the 10x H5 file",
                details={"genes": missing},
            )
        return rows

    @staticmethod
    def _cell_positions(barcodes: list[str], obs_filter: dict[str, Any]) -> list[int]:
        requested = (
            obs_filter.get("cell_id")
            or obs_filter.get("barcode")
            or obs_filter.get("observation_id")
        )
        if requested is None:
            return list(range(len(barcodes)))
        if not isinstance(requested, list):
            requested = [requested]
        wanted = {str(value) for value in requested}
        return [position for position, barcode in enumerate(barcodes) if barcode in wanted]

    @staticmethod
    def _gene_values(matrix: Any, gene_position: int, n_cells: int) -> list[float]:
        values = [0.0] * n_cells
        data = matrix["data"]
        indices = matrix["indices"]
        indptr = matrix["indptr"]
        for cell_position in range(n_cells):
            start = int(indptr[cell_position])
            stop = int(indptr[cell_position + 1])
            if start == stop:
                continue
            cell_indices = indices[start:stop]
            matches = (cell_indices == gene_position).nonzero()[0]
            if len(matches):
                values[cell_position] = float(data[start + int(matches[0])])
        return values
