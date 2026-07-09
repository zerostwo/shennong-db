from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserStatus(StrEnum):
    active = "active"
    disabled = "disabled"


class MembershipRole(StrEnum):
    owner = "owner"
    admin = "admin"
    curator = "curator"
    analyst = "analyst"
    viewer = "viewer"


class MembershipStatus(StrEnum):
    active = "active"
    invited = "invited"
    disabled = "disabled"


class ProjectVisibility(StrEnum):
    private = "private"
    lab = "lab"
    link = "link"
    public = "public"


class UserCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    display_name: str = Field(..., min_length=1, max_length=200)
    is_superuser: bool = False

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
    status: UserStatus = UserStatus.active
    is_superuser: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class OrganizationCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    owner_user_id: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("slug")
    @classmethod
    def normalize_slug(cls, value: str) -> str:
        slug = value.strip().lower()
        if not slug.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Slug may only contain letters, numbers, dashes, and underscores")
        return slug


class Organization(BaseModel):
    org_id: str
    slug: str
    name: str
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ProjectCreate(BaseModel):
    org_id: str = Field(..., min_length=1)
    slug: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    visibility: ProjectVisibility = ProjectVisibility.private

    model_config = ConfigDict(extra="forbid")

    @field_validator("slug")
    @classmethod
    def normalize_slug(cls, value: str) -> str:
        slug = value.strip().lower()
        if not slug.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Slug may only contain letters, numbers, dashes, and underscores")
        return slug


class Project(BaseModel):
    project_id: str
    org_id: str
    slug: str
    name: str
    description: str | None = None
    visibility: ProjectVisibility = ProjectVisibility.private
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MembershipCreate(BaseModel):
    org_id: str
    user_id: str
    role: MembershipRole = MembershipRole.viewer

    model_config = ConfigDict(extra="forbid")


class Membership(BaseModel):
    membership_id: str
    org_id: str
    user_id: str
    role: MembershipRole
    status: MembershipStatus = MembershipStatus.active
    created_at: datetime | None = None
    updated_at: datetime | None = None


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


class AuditEvent(BaseModel):
    event_id: str
    actor_user_id: str | None = None
    action: str
    resource_type: str
    resource_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class AccessBootstrapResponse(BaseModel):
    user: UserPublic
    organization: Organization
    membership: Membership


class UserListResponse(BaseModel):
    users: list[UserPublic]


class OrganizationListResponse(BaseModel):
    organizations: list[Organization]


class ProjectListResponse(BaseModel):
    projects: list[Project]


class AuditEventListResponse(BaseModel):
    events: list[AuditEvent]
