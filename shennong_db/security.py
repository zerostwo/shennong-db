from __future__ import annotations

import secrets
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, Header, HTTPException, Request, status

from shennong_db.api.deps import get_settings
from shennong_db.config import Settings
from shennong_db.errors import ValidationError
from shennong_db.schemas.datasets import DatasetVersionCreate


def _configured_admin_key(settings: Settings) -> str:
    key = settings.admin_api_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrative API is disabled because SHENNONG_ADMIN_API_KEY is not set.",
        )
    return key


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def _is_valid_admin_token(
    *,
    settings: Settings,
    authorization: str | None,
    x_admin_key: str | None,
) -> bool:
    configured = _configured_admin_key(settings)
    supplied = x_admin_key or _bearer_token(authorization)
    if not supplied:
        return False
    return secrets.compare_digest(supplied, configured)


def require_admin(
    settings: Settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_admin_key: str | None = Header(default=None, alias="X-Shennong-Admin-Key"),
) -> None:
    if not _is_valid_admin_token(
        settings=settings,
        authorization=authorization,
        x_admin_key=x_admin_key,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid Shennong admin API key is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_admin_request(request: Request) -> None:
    settings: Settings = request.app.state.settings
    if not _is_valid_admin_token(
        settings=settings,
        authorization=request.headers.get("authorization"),
        x_admin_key=request.headers.get("x-shennong-admin-key"),
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid Shennong admin API key is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


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
            details={
                "field": field,
                "storage_uri": value,
                "local_data_root": str(root),
            },
        )


def validate_dataset_storage(settings: Settings, dataset: DatasetVersionCreate) -> None:
    if dataset.storage_uri:
        _assert_data_root_path(settings, dataset.storage_uri, field="storage_uri")
    for key, value in dataset.metadata.items():
        if key.endswith("_uri") and isinstance(value, str):
            _assert_data_root_path(settings, value, field=f"metadata.{key}")
