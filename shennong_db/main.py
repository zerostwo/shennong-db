from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from shennong_db.access.repository import build_access_repository
from shennong_db.access.service import AccessService
from shennong_db.api.routes import admin, auth, catalog, ingest, semantic
from shennong_db.backends.router import BackendRouter
from shennong_db.cache import AsyncQueryCache, InMemoryTTLCache, RedisQueryCache
from shennong_db.config import Settings
from shennong_db.errors import ShennongError
from shennong_db.jobs import InMemoryJobStore
from shennong_db.registry.repository import DatasetRegistryRepository, build_registry_repository
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.common import ErrorResponse, HealthResponse


def _build_cache(settings: Settings) -> AsyncQueryCache:
    if settings.redis_url and settings.environment != "test":
        return RedisQueryCache(settings.redis_url)
    return InMemoryTTLCache()


def create_app(
    *,
    settings: Settings | None = None,
    registry_repository: DatasetRegistryRepository | None = None,
    backend_router: BackendRouter | None = None,
    query_cache: AsyncQueryCache | None = None,
) -> FastAPI:
    runtime_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        repository = registry_repository or build_registry_repository(runtime_settings)
        registry = DatasetRegistryService(repository)
        await registry.init()
        access_repository = build_access_repository(runtime_settings)
        access_service = AccessService(access_repository)
        await access_service.init()
        router = backend_router or BackendRouter(settings=runtime_settings, registry=registry)
        cache = query_cache or _build_cache(runtime_settings)

        app.state.settings = runtime_settings
        app.state.registry = registry
        app.state.access_service = access_service
        app.state.backend_router = router
        app.state.query_cache = cache
        app.state.job_store = InMemoryJobStore()
        try:
            yield
        finally:
            await cache.close()
            await router.close()
            await registry.close()
            await access_service.close()

    app = FastAPI(
        title=runtime_settings.app_name,
        version=runtime_settings.app_version,
        docs_url="/docs" if runtime_settings.docs_enabled else None,
        redoc_url="/redoc" if runtime_settings.docs_enabled else None,
        openapi_url="/openapi.json" if runtime_settings.docs_enabled else None,
        lifespan=lifespan,
    )

    if runtime_settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[str(origin) for origin in runtime_settings.cors_origins],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.exception_handler(ShennongError)
    async def shennong_exception_handler(
        request: Request,
        exc: ShennongError,
    ) -> JSONResponse:
        del request
        body = ErrorResponse(error=exc.code, message=exc.message, details=exc.details)
        return JSONResponse(status_code=exc.status_code, content=body.model_dump(mode="json"))

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok", service=runtime_settings.app_name, version=runtime_settings.app_version
        )

    @app.get("/version", tags=["system"])
    async def version() -> dict[str, str]:
        return {
            "service": runtime_settings.app_name,
            "version": runtime_settings.app_version,
            "api": "v2",
        }

    @app.get(
        f"{runtime_settings.api_prefix}/health", response_model=HealthResponse, tags=["system"]
    )
    async def api_health() -> HealthResponse:
        return HealthResponse(
            status="ok", service=runtime_settings.app_name, version=runtime_settings.app_version
        )

    app.include_router(ingest.router, prefix=runtime_settings.api_prefix)
    app.include_router(catalog.router, prefix=runtime_settings.api_prefix)
    app.include_router(semantic.router, prefix=runtime_settings.api_prefix)
    app.include_router(auth.router, prefix=runtime_settings.api_prefix)
    app.include_router(admin.router, prefix=runtime_settings.api_prefix)
    return app


app = create_app()
