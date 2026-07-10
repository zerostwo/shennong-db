from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserRole(StrEnum):
    admin = "admin"
    user = "user"
    guest = "guest"


class UserStatus(StrEnum):
    active = "active"
    disabled = "disabled"


class UserCreate(BaseModel):
    email: str
    display_name: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=10, max_length=256)
    role: UserRole = UserRole.user

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise ValueError("Invalid email address")
        return email


class UserPublic(BaseModel):
    user_id: str
    email: str
    display_name: str
    role: UserRole
    status: UserStatus = UserStatus.active
    created_at: datetime | None = None
    updated_at: datetime | None = None


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    password: str | None = Field(default=None, min_length=10, max_length=256)
    role: UserRole | None = None
    status: UserStatus | None = None

    model_config = ConfigDict(extra="forbid")


class LoginRequest(BaseModel):
    email: str
    password: str
    token_name: str = "login"


class ApiTokenCreate(BaseModel):
    user_id: str
    name: str = Field(..., min_length=1, max_length=200)
    scopes: list[str] = Field(default_factory=lambda: ["datasets:read"])
    expires_at: datetime | None = None

    model_config = ConfigDict(extra="forbid")


class ApiToken(BaseModel):
    token_id: str
    user_id: str
    name: str
    scopes: list[str]
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    last_used_at: datetime | None = None
    created_at: datetime | None = None


class ApiTokenCreated(BaseModel):
    token: str = Field(..., description="Plain token returned once. Store it securely.")
    data: ApiToken


class AuthResponse(BaseModel):
    user: UserPublic
    token: ApiTokenCreated


class Principal(BaseModel):
    role: UserRole = UserRole.guest
    user_id: str | None = None
    email: str | None = None
    scopes: list[str] = Field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.admin


class DatasetGrant(BaseModel):
    dataset_id: str
    user_id: str
    granted_by: str | None = None
    created_at: datetime | None = None


class AuditEvent(BaseModel):
    event_id: str
    actor_user_id: str | None = None
    action: str
    resource_type: str
    resource_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class UserListResponse(BaseModel):
    users: list[UserPublic]


class ApiTokenListResponse(BaseModel):
    tokens: list[ApiToken]


class DatasetGrantListResponse(BaseModel):
    grants: list[DatasetGrant]


class AuditEventListResponse(BaseModel):
    events: list[AuditEvent]
