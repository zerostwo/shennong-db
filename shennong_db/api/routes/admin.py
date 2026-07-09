from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from shennong_db.access.service import AccessService
from shennong_db.api.deps import get_access_service
from shennong_db.schemas.access import (
    AccessBootstrapResponse,
    ApiTokenCreate,
    ApiTokenCreated,
    AuditEventListResponse,
    Organization,
    OrganizationCreate,
    OrganizationListResponse,
    Project,
    ProjectCreate,
    ProjectListResponse,
    UserCreate,
    UserListResponse,
    UserPublic,
)
from shennong_db.security import require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class BootstrapRequest(BaseModel):
    user: UserCreate
    organization: OrganizationCreate

    model_config = ConfigDict(extra="forbid")


@router.post("/bootstrap", response_model=AccessBootstrapResponse, status_code=201)
async def bootstrap_access(
    payload: BootstrapRequest,
    access: AccessService = Depends(get_access_service),
) -> AccessBootstrapResponse:
    return await access.bootstrap(user=payload.user, organization=payload.organization)


@router.post("/users", response_model=UserPublic, status_code=201)
async def create_user(
    payload: UserCreate,
    access: AccessService = Depends(get_access_service),
) -> UserPublic:
    return await access.create_user(payload)


@router.get("/users", response_model=UserListResponse)
async def list_users(access: AccessService = Depends(get_access_service)) -> UserListResponse:
    return UserListResponse(users=await access.list_users())


@router.post("/organizations", response_model=Organization, status_code=201)
async def create_organization(
    payload: OrganizationCreate,
    access: AccessService = Depends(get_access_service),
) -> Organization:
    return await access.create_organization(payload)


@router.get("/organizations", response_model=OrganizationListResponse)
async def list_organizations(
    access: AccessService = Depends(get_access_service),
) -> OrganizationListResponse:
    return OrganizationListResponse(organizations=await access.list_organizations())


@router.post("/projects", response_model=Project, status_code=201)
async def create_project(
    payload: ProjectCreate,
    access: AccessService = Depends(get_access_service),
) -> Project:
    return await access.create_project(payload)


@router.get("/projects", response_model=ProjectListResponse)
async def list_projects(
    org_id: str | None = Query(default=None),
    access: AccessService = Depends(get_access_service),
) -> ProjectListResponse:
    return ProjectListResponse(projects=await access.list_projects(org_id))


@router.post("/api-tokens", response_model=ApiTokenCreated, status_code=201)
async def create_api_token(
    payload: ApiTokenCreate,
    access: AccessService = Depends(get_access_service),
) -> ApiTokenCreated:
    return await access.create_api_token(payload)


@router.get("/audit-events", response_model=AuditEventListResponse)
async def list_audit_events(
    limit: int = Query(default=100, ge=1, le=1000),
    access: AccessService = Depends(get_access_service),
) -> AuditEventListResponse:
    return AuditEventListResponse(events=await access.list_audit_events(limit))
