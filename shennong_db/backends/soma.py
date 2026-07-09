from __future__ import annotations

import json
import re
import time
from typing import Any

from shennong_db.backends.base import BackendQueryResult
from shennong_db.config import Settings
from shennong_db.errors import BackendCapabilityError, BackendUnavailableError, ValidationError
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.queries import SingleCellQuery, SpatialQuery

_FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _quote(value: Any) -> str:
    return json.dumps(value)


def _obs_filter_expression(filters: dict[str, Any]) -> str | None:
    clauses: list[str] = []
    for key, value in filters.items():
        if not _FIELD_RE.match(key):
            raise ValidationError(f"Unsafe SOMA obs filter field '{key}'")
        if isinstance(value, list):
            clauses.append(f"{key} in [{', '.join(_quote(item) for item in value)}]")
        else:
            clauses.append(f"{key} == {_quote(value)}")
    return " and ".join(clauses) if clauses else None


def _var_filter_expression(genes: list[str]) -> str:
    quoted = ", ".join(_quote(gene) for gene in genes)
    return f"feature_name in [{quoted}] or gene_symbol in [{quoted}]"


class SomaBackend:
    """TileDB-SOMA adapter for sparse single-cell and spatial matrix reads."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @staticmethod
    def _require_soma() -> Any:
        try:
            import tiledbsoma as soma
        except ImportError as exc:
            raise BackendUnavailableError(
                "TileDB-SOMA backend requires the 'tiledbsoma' Python package",
                details={"extra": "tiledb"},
            ) from exc
        return soma

    async def query_singlecell(
        self,
        dataset: DatasetVersion,
        query: SingleCellQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        return await self._query_matrix(dataset, query, limit=limit, offset=offset, spatial=False)

    async def query_spatial(
        self,
        dataset: DatasetVersion,
        query: SpatialQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        return await self._query_matrix(dataset, query, limit=limit, offset=offset, spatial=True)

    async def _query_matrix(
        self,
        dataset: DatasetVersion,
        query: SingleCellQuery | SpatialQuery,
        *,
        limit: int,
        offset: int,
        spatial: bool,
    ) -> BackendQueryResult:
        if not dataset.storage_uri:
            raise ValidationError("TileDB-SOMA datasets require storage_uri in the registry")
        soma = self._require_soma()
        started = time.perf_counter()
        measurement_name = dataset.metadata.get("measurement_name", "RNA")
        layer_name = query.layer or dataset.metadata.get("default_layer", "data")
        obs_filter = _obs_filter_expression(query.obs_filter)
        var_filter = _var_filter_expression(query.genes)

        with soma.Experiment.open(dataset.storage_uri) as experiment:
            axis_query = experiment.axis_query(
                measurement_name=measurement_name,
                obs_query=soma.AxisQuery(value_filter=obs_filter),
                var_query=soma.AxisQuery(value_filter=var_filter),
            )
            obs_rows = axis_query.obs().concat().to_pylist()
            var_rows = axis_query.var().concat().to_pylist()
            obs_by_joinid = {row["soma_joinid"]: row for row in obs_rows}
            var_by_joinid = {row["soma_joinid"]: row for row in var_rows}
            matrix_rows = axis_query.X(layer_name).tables().concat().to_pylist()

        rows: list[dict[str, Any]] = []
        for matrix_row in matrix_rows[offset : offset + limit]:
            obs = obs_by_joinid.get(matrix_row["soma_dim_0"], {})
            var = var_by_joinid.get(matrix_row["soma_dim_1"], {})
            row = {
                "dataset": dataset.dataset_id,
                "version": dataset.version,
                "cell_id": obs.get("cell_id") or obs.get("obs_id") or obs.get("soma_joinid"),
                "gene_symbol": var.get("gene_symbol")
                or var.get("feature_name")
                or var.get("var_id"),
                "value": matrix_row.get("soma_data"),
            }
            if query.embedding:
                row["embedding"] = query.embedding
            if spatial:
                row["x"] = obs.get("x") or obs.get("spatial_x")
                row["y"] = obs.get("y") or obs.get("spatial_y")
                if getattr(query, "region", None):
                    region = query.region or {}
                    x = float(row["x"])
                    y = float(row["y"])
                    if not (
                        region.get("x_min", float("-inf")) <= x <= region.get("x_max", float("inf"))
                        and region.get("y_min", float("-inf"))
                        <= y
                        <= region.get("y_max", float("inf"))
                    ):
                        continue
            rows.append(row)
        columns = (
            list(rows[0].keys())
            if rows
            else ["dataset", "version", "cell_id", "gene_symbol", "value"]
        )
        return BackendQueryResult(
            columns=columns,
            rows=rows,
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )

    async def query_expression(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("TileDB-SOMA backend does not serve bulk expression")

    async def query_survival(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("TileDB-SOMA backend does not serve survival data")

    async def query_eqtl(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        raise BackendCapabilityError("TileDB-SOMA backend does not serve eQTL summary statistics")
