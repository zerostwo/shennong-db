from __future__ import annotations

from collections.abc import Awaitable, Callable

from shennong_db.backends.base import AnalyticalBackend, BackendQueryResult, UnavailableBackend
from shennong_db.backends.clickhouse import ClickHouseBackend
from shennong_db.backends.memory import InMemoryAnalyticalBackend
from shennong_db.backends.soma import SomaBackend
from shennong_db.backends.tenx_h5 import TenxH5Backend
from shennong_db.backends.xena import XenaExpressionBackend
from shennong_db.config import Settings
from shennong_db.errors import BackendUnavailableError, ValidationError
from shennong_db.pagination import decode_cursor, encode_cursor
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.common import BackendKind, DatasetType, QueryResponse
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.queries import (
    EqtlQuery,
    ExpressionQuery,
    SingleCellQuery,
    SpatialQuery,
    SurvivalQuery,
)
from shennong_db.schemas.semantic import (
    DataModel,
    QueryMeta,
    QuerySpec,
    ReturnFormat,
    ReturnShape,
    SemanticQueryResponse,
)


class BackendRouter:
    def __init__(
        self,
        *,
        settings: Settings,
        registry: DatasetRegistryService,
        memory_backend: InMemoryAnalyticalBackend | None = None,
    ) -> None:
        self.settings = settings
        self.registry = registry
        self.memory_backend = memory_backend or InMemoryAnalyticalBackend()
        if settings.disable_external_backends:
            self.backends: dict[BackendKind, AnalyticalBackend] = {
                BackendKind.clickhouse: UnavailableBackend(
                    "clickhouse", "External backends disabled"
                ),
                BackendKind.tiledb_soma: UnavailableBackend(
                    "tiledb_soma", "External backends disabled"
                ),
                BackendKind.xena: XenaExpressionBackend(),
                BackendKind.tenx_h5: TenxH5Backend(),
                BackendKind.memory: self.memory_backend,
            }
        else:
            self.backends = {
                BackendKind.clickhouse: ClickHouseBackend(settings),
                BackendKind.tiledb_soma: SomaBackend(settings),
                BackendKind.xena: XenaExpressionBackend(),
                BackendKind.tenx_h5: TenxH5Backend(),
                BackendKind.memory: self.memory_backend,
            }

    async def close(self) -> None:
        for backend in self.backends.values():
            close = getattr(backend, "close", None)
            if close is None:
                continue
            result = close()
            if isinstance(result, Awaitable):
                await result

    def _backend_for(self, dataset: DatasetVersion) -> AnalyticalBackend:
        backend = self.backends.get(dataset.backend)
        if backend is None:
            raise BackendUnavailableError(
                f"Backend '{dataset.backend}' is not configured",
                details={"backend": dataset.backend},
            )
        return backend

    def _page_size(self, requested: int) -> int:
        return min(requested or self.settings.default_page_size, self.settings.max_page_size)

    async def _execute(
        self,
        *,
        dataset: DatasetVersion,
        query_limit: int,
        cursor: str | None,
        runner: Callable[[int, int], Awaitable[BackendQueryResult]],
    ) -> QueryResponse:
        page = decode_cursor(cursor)
        limit = self._page_size(query_limit)
        result = await runner(limit + 1, page.offset)
        truncated = len(result.rows) > limit
        rows = result.rows[:limit]
        return QueryResponse(
            dataset=dataset.dataset_id,
            version=dataset.version,
            backend=dataset.backend,
            columns=result.columns,
            rows=rows,
            row_count=len(rows),
            next_cursor=encode_cursor(page.offset + limit) if truncated else None,
            truncated=truncated,
            elapsed_ms=round(result.elapsed_ms, 3),
        )

    async def query_expression(self, query: ExpressionQuery) -> QueryResponse:
        dataset = await self.registry.resolve(
            query.dataset,
            query.version,
            DatasetType.bulk_expression,
        )
        backend = self._backend_for(dataset)
        return await self._execute(
            dataset=dataset,
            query_limit=query.limit,
            cursor=query.cursor,
            runner=lambda limit, offset: backend.query_expression(
                dataset,
                query,
                limit=limit,
                offset=offset,
            ),
        )

    async def query_survival(self, query: SurvivalQuery) -> QueryResponse:
        dataset = await self.registry.resolve(query.dataset, query.version, DatasetType.survival)
        backend = self._backend_for(dataset)
        return await self._execute(
            dataset=dataset,
            query_limit=query.limit,
            cursor=query.cursor,
            runner=lambda limit, offset: backend.query_survival(
                dataset, query, limit=limit, offset=offset
            ),
        )

    async def query_singlecell(self, query: SingleCellQuery) -> QueryResponse:
        dataset = await self.registry.resolve(query.dataset, query.version, DatasetType.single_cell)
        backend = self._backend_for(dataset)
        return await self._execute(
            dataset=dataset,
            query_limit=query.limit,
            cursor=query.cursor,
            runner=lambda limit, offset: backend.query_singlecell(
                dataset, query, limit=limit, offset=offset
            ),
        )

    async def query_spatial(self, query: SpatialQuery) -> QueryResponse:
        dataset = await self.registry.resolve(query.dataset, query.version, DatasetType.spatial)
        backend = self._backend_for(dataset)
        return await self._execute(
            dataset=dataset,
            query_limit=query.limit,
            cursor=query.cursor,
            runner=lambda limit, offset: backend.query_spatial(
                dataset, query, limit=limit, offset=offset
            ),
        )

    async def query_eqtl(self, query: EqtlQuery) -> QueryResponse:
        dataset = await self.registry.resolve(query.dataset, query.version, DatasetType.eqtl)
        backend = self._backend_for(dataset)
        return await self._execute(
            dataset=dataset,
            query_limit=query.limit,
            cursor=query.cursor,
            runner=lambda limit, offset: backend.query_eqtl(
                dataset, query, limit=limit, offset=offset
            ),
        )

    async def query(self, spec: QuerySpec) -> SemanticQueryResponse:
        if spec.return_spec.format != ReturnFormat.json:
            raise ValidationError(
                "Only JSON sync responses are currently supported by /v1/query",
                details={"requested_format": spec.return_spec.format},
            )
        if spec.return_spec.shape not in {ReturnShape.tidy, ReturnShape.table}:
            raise ValidationError(
                "Only tidy/table sync responses are currently supported by /v1/query",
                details={"requested_shape": spec.return_spec.shape},
            )
        dataset = await self.registry.get(spec.dataset, spec.version)
        if spec.data_model is not None:
            self._validate_data_model(dataset, spec.data_model)

        if dataset.type == DatasetType.bulk_expression:
            response = await self.query_expression(self._expression_query_from_spec(spec))
        elif dataset.type == DatasetType.survival:
            response = await self.query_survival(self._survival_query_from_spec(spec))
        elif dataset.type == DatasetType.single_cell:
            response = await self.query_singlecell(self._singlecell_query_from_spec(spec))
        elif dataset.type == DatasetType.spatial:
            response = await self.query_spatial(self._spatial_query_from_spec(spec))
        elif dataset.type == DatasetType.eqtl:
            response = await self.query_eqtl(self._eqtl_query_from_spec(spec))
        else:
            raise ValidationError(
                f"Dataset type '{dataset.type}' is not queryable",
                details={"dataset_type": dataset.type},
            )
        return self._semantic_response(spec, response, dataset.type)

    async def get_values(
        self,
        dataset_id: str,
        version: str | None,
        field: str,
        *,
        limit: int = 1000,
    ) -> list[str]:
        dataset = await self.registry.get(dataset_id, version)
        backend = self._backend_for(dataset)
        getter = getattr(backend, "get_values", None)
        if getter is None:
            return []
        values = getter(dataset, field, limit=limit)
        if isinstance(values, Awaitable):
            values = await values
        return list(values)

    @staticmethod
    def _validate_data_model(dataset: DatasetVersion, data_model: DataModel) -> None:
        expected = {
            DatasetType.bulk_expression: DataModel.bulk,
            DatasetType.survival: DataModel.clinical,
            DatasetType.single_cell: DataModel.single_cell,
            DatasetType.spatial: DataModel.spatial,
            DatasetType.eqtl: DataModel.qtl,
        }.get(dataset.type)
        if expected is None:
            raise ValidationError(
                f"Dataset type '{dataset.type}' is accessed through its asset manifest",
                details={"dataset_type": dataset.type},
            )
        if data_model != expected:
            raise ValidationError(
                f"Dataset '{dataset.dataset_id}' is data_model '{expected}', not '{data_model}'",
                details={"dataset": dataset.dataset_id, "expected_data_model": expected},
            )

    @staticmethod
    def _list_filter(value: object) -> list[str] | None:
        if value is None:
            return None
        if isinstance(value, list):
            return [str(item) for item in value]
        return [str(value)]

    def _expression_query_from_spec(self, spec: QuerySpec) -> ExpressionQuery:
        observations = spec.select.observations
        if not spec.select.features:
            raise ValidationError("Bulk expression queries require select.features")
        return ExpressionQuery(
            dataset=spec.dataset,
            version=spec.version,
            genes=spec.select.features,
            cancer=self._list_filter(observations.get("cancer")),
            group_name=self._list_filter(
                observations.get("group_name") or observations.get("group")
            ),
            sample_ids=self._list_filter(
                observations.get("sample_id") or observations.get("observation_id")
            ),
            aggregation=spec.options.aggregation,
            limit=spec.options.limit,
            cursor=spec.options.cursor,
        )

    def _survival_query_from_spec(self, spec: QuerySpec) -> SurvivalQuery:
        observations = spec.select.observations
        return SurvivalQuery(
            dataset=spec.dataset,
            version=spec.version,
            cancer=self._list_filter(observations.get("cancer")),
            sample_ids=self._list_filter(
                observations.get("sample_id") or observations.get("observation_id")
            ),
            covariates=[
                field for field in spec.select.fields if field not in {"sample_id", "cancer"}
            ],
            limit=spec.options.limit,
            cursor=spec.options.cursor,
        )

    def _singlecell_query_from_spec(self, spec: QuerySpec) -> SingleCellQuery:
        if not spec.select.features:
            raise ValidationError("Single-cell queries require select.features")
        return SingleCellQuery(
            dataset=spec.dataset,
            version=spec.version,
            genes=spec.select.features,
            obs_filter=spec.select.observations,
            layer=spec.layer,
            limit=spec.options.limit,
            cursor=spec.options.cursor,
        )

    def _spatial_query_from_spec(self, spec: QuerySpec) -> SpatialQuery:
        if not spec.select.features:
            raise ValidationError("Spatial queries require select.features")
        observations = dict(spec.select.observations)
        region = observations.pop("region", None)
        return SpatialQuery(
            dataset=spec.dataset,
            version=spec.version,
            genes=spec.select.features,
            obs_filter=observations,
            region=region if isinstance(region, dict) else None,
            layer=spec.layer,
            limit=spec.options.limit,
            cursor=spec.options.cursor,
        )

    def _eqtl_query_from_spec(self, spec: QuerySpec) -> EqtlQuery:
        observations = spec.select.observations
        return EqtlQuery(
            dataset=spec.dataset,
            version=spec.version,
            genes=spec.select.features or None,
            variants=self._list_filter(observations.get("variant_id")),
            tissue=self._list_filter(observations.get("tissue")),
            phenotype=observations.get("phenotype"),
            pvalue_lte=observations.get("pvalue_lte"),
            limit=spec.options.limit,
            cursor=spec.options.cursor,
        )

    def _semantic_response(
        self,
        spec: QuerySpec,
        response: QueryResponse,
        dataset_type: DatasetType,
    ) -> SemanticQueryResponse:
        if dataset_type == DatasetType.bulk_expression:
            rows = [self._semantic_expression_row(row, spec) for row in response.rows]
        elif dataset_type == DatasetType.survival:
            rows = [self._semantic_survival_row(row) for row in response.rows]
        elif dataset_type == DatasetType.eqtl:
            rows = [self._semantic_eqtl_row(row) for row in response.rows]
        else:
            rows = [self._semantic_matrix_row(row) for row in response.rows]
        return SemanticQueryResponse(
            data=rows,
            meta=QueryMeta(
                dataset=response.dataset,
                version=response.version,
                backend=response.backend,
                n_rows=response.row_count,
                columns=response.columns,
                next_cursor=response.next_cursor,
                truncated=response.truncated,
                elapsed_ms=response.elapsed_ms,
                cached=response.cached,
                return_format=spec.return_spec.format,
                return_shape=spec.return_spec.shape,
            ),
        )

    @staticmethod
    def _semantic_expression_row(row: dict, spec: QuerySpec) -> dict:
        group = row.get("group") or row.get("group_name")
        value = {
            "observation_id": row.get("sample_id") or row.get("observation_id"),
            "sample_id": row.get("sample_id"),
            "feature_id": row.get("gene_id") or row.get("gene_symbol"),
            "feature_symbol": row.get("gene_symbol"),
            "feature": row.get("gene_symbol"),
            "measure": spec.measure or "expression",
            "layer": spec.layer,
            "value": row.get("value"),
        }
        for key in ("cancer", "tissue"):
            if key in row:
                value[key] = row[key]
        if group is not None:
            value["group"] = group
        if "n" in row:
            value["n"] = row["n"]
        return value

    @staticmethod
    def _semantic_survival_row(row: dict) -> dict:
        return {
            "observation_id": row.get("sample_id") or row.get("observation_id"),
            "sample_id": row.get("sample_id"),
            "cancer": row.get("cancer"),
            "time": row.get("time"),
            "event": row.get("event"),
        }

    @staticmethod
    def _semantic_eqtl_row(row: dict) -> dict:
        observation = ":".join(
            str(part)
            for part in (row.get("variant_id"), row.get("gene_symbol"), row.get("tissue"))
            if part is not None
        )
        return {
            "observation_id": observation,
            "feature_id": row.get("gene_id") or row.get("gene_symbol"),
            "feature_symbol": row.get("gene_symbol"),
            "variant_id": row.get("variant_id"),
            "tissue": row.get("tissue"),
            "phenotype": row.get("phenotype"),
            "beta": row.get("beta"),
            "se": row.get("se"),
            "pvalue": row.get("pvalue"),
            "qvalue": row.get("qvalue"),
        }

    @staticmethod
    def _semantic_matrix_row(row: dict) -> dict:
        return {
            "observation_id": row.get("cell_id") or row.get("spot_id") or row.get("sample_id"),
            "feature_id": row.get("gene_id") or row.get("gene_symbol"),
            "feature_symbol": row.get("gene_symbol"),
            "value": row.get("value"),
            **{
                key: value
                for key, value in row.items()
                if key not in {"dataset", "version", "cell_id", "gene_id", "gene_symbol", "value"}
            },
        }
