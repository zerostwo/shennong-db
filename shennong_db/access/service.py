from __future__ import annotations

from typing import Any

from shennong_db.access.repository import AccessRepository
from shennong_db.schemas.access import (
    AccessBootstrapResponse,
    ApiTokenCreate,
    ApiTokenCreated,
    AuditEvent,
    MembershipCreate,
    MembershipRole,
    Organization,
    OrganizationCreate,
    Project,
    ProjectCreate,
    UserCreate,
    UserPublic,
)


class AccessService:
    def __init__(self, repository: AccessRepository) -> None:
        self.repository = repository

    async def init(self) -> None:
        await self.repository.init()

    async def close(self) -> None:
        await self.repository.close()

    async def bootstrap(
        self,
        *,
        user: UserCreate,
        organization: OrganizationCreate,
    ) -> AccessBootstrapResponse:
        created_user = await self.repository.create_user(user)
        created_org = await self.repository.create_organization(
            organization.model_copy(update={"owner_user_id": created_user.user_id})
        )
        membership = await self.repository.create_membership(
            MembershipCreate(
                org_id=created_org.org_id,
                user_id=created_user.user_id,
                role=MembershipRole.owner,
            )
        )
        await self.audit(
            action="access.bootstrap",
            resource_type="organization",
            resource_id=created_org.org_id,
            actor_user_id=created_user.user_id,
            metadata={"org_slug": created_org.slug, "user_email": str(created_user.email)},
        )
        return AccessBootstrapResponse(
            user=created_user,
            organization=created_org,
            membership=membership,
        )

    async def create_user(self, payload: UserCreate) -> UserPublic:
        user = await self.repository.create_user(payload)
        await self.audit(
            action="user.upsert",
            resource_type="user",
            resource_id=user.user_id,
            metadata={"email": str(user.email)},
        )
        return user

    async def list_users(self) -> list[UserPublic]:
        return await self.repository.list_users()

    async def create_organization(self, payload: OrganizationCreate) -> Organization:
        org = await self.repository.create_organization(payload)
        await self.audit(
            action="organization.upsert",
            resource_type="organization",
            resource_id=org.org_id,
            actor_user_id=payload.owner_user_id,
            metadata={"slug": org.slug},
        )
        if payload.owner_user_id:
            await self.repository.create_membership(
                MembershipCreate(
                    org_id=org.org_id,
                    user_id=payload.owner_user_id,
                    role=MembershipRole.owner,
                )
            )
        return org

    async def list_organizations(self) -> list[Organization]:
        return await self.repository.list_organizations()

    async def create_project(self, payload: ProjectCreate) -> Project:
        project = await self.repository.create_project(payload)
        await self.audit(
            action="project.upsert",
            resource_type="project",
            resource_id=project.project_id,
            metadata={"org_id": project.org_id, "slug": project.slug},
        )
        return project

    async def list_projects(self, org_id: str | None = None) -> list[Project]:
        return await self.repository.list_projects(org_id)

    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated:
        created = await self.repository.create_api_token(payload)
        await self.audit(
            action="api_token.create",
            resource_type="api_token",
            resource_id=created.data.token_id,
            actor_user_id=payload.user_id,
            metadata={"name": payload.name, "scopes": payload.scopes},
        )
        return created

    async def audit(
        self,
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        actor_user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditEvent:
        return await self.repository.record_audit_event(
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            actor_user_id=actor_user_id,
            metadata=metadata,
        )

    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]:
        return await self.repository.list_audit_events(limit)
