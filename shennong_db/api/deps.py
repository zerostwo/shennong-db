from fastapi import Request

from shennong_db.access.service import AccessService
from shennong_db.backends.router import BackendRouter
from shennong_db.cache import AsyncQueryCache
from shennong_db.config import Settings
from shennong_db.registry.service import DatasetRegistryService


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_registry(request: Request) -> DatasetRegistryService:
    return request.app.state.registry


def get_backend_router(request: Request) -> BackendRouter:
    return request.app.state.backend_router


def get_cache(request: Request) -> AsyncQueryCache:
    return request.app.state.query_cache


def get_access_service(request: Request) -> AccessService:
    return request.app.state.access_service
