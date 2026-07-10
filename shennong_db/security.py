from __future__ import annotations

import secrets
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, Header, HTTPException, Request, status

from shennong_db.api.deps import get_settings
from shennong_db.config import Settings
from shennong_db.errors import NotFoundError, ValidationError
from shennong_db.schemas.access import Principal, UserRole
from shennong_db.schemas.datasets import DatasetVersion, DatasetVersionCreate, DatasetVisibility


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token if scheme.lower() == "bearer" and token else None


async def get_principal(
    request: Request,
    settings: Settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_admin_key: str | None = Header(default=None, alias="X-Shennong-Admin-Key"),
) -> Principal:
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached
    if (
        settings.admin_api_key
        and x_admin_key
        and secrets.compare_digest(x_admin_key, settings.admin_api_key)
    ):
        principal = Principal(role=UserRole.admin, scopes=["*"])
    else:
        token = _bearer_token(authorization)
        principal = (
            await request.app.state.access_service.authenticate_token(token) if token else None
        ) or Principal()
    request.state.principal = principal
    return principal


async def require_admin(principal: Principal = Depends(get_principal)) -> Principal:
    if not principal.is_admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator authentication is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return principal


async def ensure_dataset_read(request: Request, dataset: DatasetVersion) -> Principal:
    principal = await get_principal(
        request,
        request.app.state.settings,
        request.headers.get("authorization"),
        request.headers.get("x-shennong-admin-key"),
    )
    if dataset.visibility == DatasetVisibility.public:
        return principal
    if await request.app.state.access_service.can_read_dataset(dataset.dataset_id, principal):
        return principal
    raise NotFoundError(f"Dataset '{dataset.dataset_id}' was not found")


def _assert_data_root_path(settings: Settings, value: str, *, field: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme and parsed.scheme != "file":
        raise ValidationError(
            "Only local server-side storage paths are allowed in this deployment.",
            details={"field": field, "storage_uri": value},
        )
    path_value = parsed.path if parsed.scheme == "file" else value
    path = Path(path_value)
    if not path.is_absolute():
        raise ValidationError(
            "Storage paths must be absolute server-side paths.",
            details={"field": field, "storage_uri": value},
        )
    root = Path(settings.local_data_root).resolve()
    resolved = path.resolve(strict=False)
    if not resolved.is_relative_to(root):
        raise ValidationError(
            "Storage paths must stay under SHENNONG_LOCAL_DATA_ROOT.",
            details={"field": field, "storage_uri": value, "local_data_root": str(root)},
        )


def validate_dataset_storage(settings: Settings, dataset: DatasetVersionCreate) -> None:
    if dataset.storage_uri:
        _assert_data_root_path(settings, dataset.storage_uri, field="storage_uri")
    for key, value in dataset.metadata.items():
        if key.endswith("_uri") and isinstance(value, str):
            _assert_data_root_path(settings, value, field=f"metadata.{key}")
    sources = dataset.metadata.get("source")
    if isinstance(sources, dict):
        for role, value in sources.items():
            if isinstance(value, str):
                _assert_data_root_path(settings, value, field=f"source.{role}")
