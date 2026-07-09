from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from shennong_db.errors import BackendUnavailableError
from shennong_db.schemas.datasets import DatasetVersion
from shennong_db.schemas.queries import (
    EqtlQuery,
    ExpressionQuery,
    SingleCellQuery,
    SpatialQuery,
    SurvivalQuery,
)


@dataclass(frozen=True)
class BackendQueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    elapsed_ms: float


class AnalyticalBackend(Protocol):
    async def query_expression(
        self,
        dataset: DatasetVersion,
        query: ExpressionQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise NotImplementedError

    async def query_survival(
        self,
        dataset: DatasetVersion,
        query: SurvivalQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise NotImplementedError

    async def query_singlecell(
        self,
        dataset: DatasetVersion,
        query: SingleCellQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise NotImplementedError

    async def query_spatial(
        self,
        dataset: DatasetVersion,
        query: SpatialQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise NotImplementedError

    async def query_eqtl(
        self,
        dataset: DatasetVersion,
        query: EqtlQuery,
        *,
        limit: int,
        offset: int,
    ) -> BackendQueryResult:
        raise NotImplementedError


class UnavailableBackend:
    def __init__(self, backend_name: str, reason: str = "Backend is not configured") -> None:
        self.backend_name = backend_name
        self.reason = reason

    def _raise(self) -> None:
        raise BackendUnavailableError(
            f"{self.backend_name} backend is unavailable",
            details={"backend": self.backend_name, "reason": self.reason},
        )

    async def query_expression(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        self._raise()

    async def query_survival(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        self._raise()

    async def query_singlecell(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        self._raise()

    async def query_spatial(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        self._raise()

    async def query_eqtl(self, *args: Any, **kwargs: Any) -> BackendQueryResult:
        self._raise()
