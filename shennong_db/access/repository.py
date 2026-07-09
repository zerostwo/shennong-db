from __future__ import annotations

import hashlib
import secrets
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from shennong_db.config import Settings
from shennong_db.db.metadata import (
    api_tokens,
    audit_events,
    memberships,
    metadata,
    organizations,
    projects,
    users,
)
from shennong_db.errors import NotFoundError
from shennong_db.schemas.access import (
    ApiToken,
    ApiTokenCreate,
    ApiTokenCreated,
    AuditEvent,
    Membership,
    MembershipCreate,
    MembershipRole,
    MembershipStatus,
    Organization,
    OrganizationCreate,
    Project,
    ProjectCreate,
    UserCreate,
    UserPublic,
    UserStatus,
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _record_to_user(row: dict[str, Any]) -> UserPublic:
    return UserPublic(
        user_id=row["user_id"],
        email=row["email"],
        display_name=row["display_name"],
        status=UserStatus(row["status"]),
        is_superuser=bool(row["is_superuser"]),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _record_to_org(row: dict[str, Any]) -> Organization:
    return Organization(
        org_id=row["org_id"],
        slug=row["slug"],
        name=row["name"],
        created_by=row.get("created_by"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _record_to_project(row: dict[str, Any]) -> Project:
    return Project(
        project_id=row["project_id"],
        org_id=row["org_id"],
        slug=row["slug"],
        name=row["name"],
        description=row.get("description"),
        visibility=row["visibility"],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _record_to_membership(row: dict[str, Any]) -> Membership:
    return Membership(
        membership_id=row["membership_id"],
        org_id=row["org_id"],
        user_id=row["user_id"],
        role=MembershipRole(row["role"]),
        status=MembershipStatus(row["status"]),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


def _record_to_token(row: dict[str, Any]) -> ApiToken:
    return ApiToken(
        token_id=row["token_id"],
        user_id=row["user_id"],
        name=row["name"],
        scopes=row.get("scopes") or [],
        expires_at=row.get("expires_at"),
        revoked_at=row.get("revoked_at"),
        last_used_at=row.get("last_used_at"),
        created_at=row.get("created_at"),
    )


def _record_to_audit(row: dict[str, Any]) -> AuditEvent:
    return AuditEvent(
        event_id=row["event_id"],
        actor_user_id=row.get("actor_user_id"),
        action=row["action"],
        resource_type=row["resource_type"],
        resource_id=row["resource_id"],
        metadata=row.get("metadata_json") or {},
        created_at=row.get("created_at"),
    )


class AccessRepository(ABC):
    @abstractmethod
    async def init(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def create_user(self, payload: UserCreate) -> UserPublic:
        raise NotImplementedError

    @abstractmethod
    async def list_users(self) -> list[UserPublic]:
        raise NotImplementedError

    @abstractmethod
    async def get_user(self, user_id: str) -> UserPublic:
        raise NotImplementedError

    @abstractmethod
    async def create_organization(self, payload: OrganizationCreate) -> Organization:
        raise NotImplementedError

    @abstractmethod
    async def list_organizations(self) -> list[Organization]:
        raise NotImplementedError

    @abstractmethod
    async def create_project(self, payload: ProjectCreate) -> Project:
        raise NotImplementedError

    @abstractmethod
    async def list_projects(self, org_id: str | None = None) -> list[Project]:
        raise NotImplementedError

    @abstractmethod
    async def create_membership(self, payload: MembershipCreate) -> Membership:
        raise NotImplementedError

    @abstractmethod
    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated:
        raise NotImplementedError

    @abstractmethod
    async def record_audit_event(
        self,
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        actor_user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditEvent:
        raise NotImplementedError

    @abstractmethod
    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]:
        raise NotImplementedError


class InMemoryAccessRepository(AccessRepository):
    def __init__(self) -> None:
        self._users: dict[str, UserPublic] = {}
        self._orgs: dict[str, Organization] = {}
        self._projects: dict[str, Project] = {}
        self._memberships: dict[str, Membership] = {}
        self._tokens: dict[str, ApiToken] = {}
        self._audits: list[AuditEvent] = []

    async def init(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def create_user(self, payload: UserCreate) -> UserPublic:
        now = datetime.now(UTC)
        existing = next(
            (user for user in self._users.values() if user.email == payload.email),
            None,
        )
        if existing is not None:
            return existing
        user = UserPublic(
            user_id=_new_id("usr"),
            email=payload.email,
            display_name=payload.display_name,
            status=UserStatus.active,
            is_superuser=payload.is_superuser,
            created_at=now,
            updated_at=now,
        )
        self._users[user.user_id] = user
        return user

    async def list_users(self) -> list[UserPublic]:
        return sorted(self._users.values(), key=lambda item: item.email)

    async def get_user(self, user_id: str) -> UserPublic:
        user = self._users.get(user_id)
        if user is None:
            raise NotFoundError(f"User '{user_id}' was not found")
        return user

    async def create_organization(self, payload: OrganizationCreate) -> Organization:
        now = datetime.now(UTC)
        existing = next((org for org in self._orgs.values() if org.slug == payload.slug), None)
        if existing is not None:
            return existing
        org = Organization(
            org_id=_new_id("org"),
            slug=payload.slug,
            name=payload.name,
            created_by=payload.owner_user_id,
            created_at=now,
            updated_at=now,
        )
        self._orgs[org.org_id] = org
        return org

    async def list_organizations(self) -> list[Organization]:
        return sorted(self._orgs.values(), key=lambda item: item.slug)

    async def create_project(self, payload: ProjectCreate) -> Project:
        now = datetime.now(UTC)
        project = Project(
            project_id=_new_id("prj"),
            org_id=payload.org_id,
            slug=payload.slug,
            name=payload.name,
            description=payload.description,
            visibility=payload.visibility,
            created_at=now,
            updated_at=now,
        )
        self._projects[project.project_id] = project
        return project

    async def list_projects(self, org_id: str | None = None) -> list[Project]:
        items = list(self._projects.values())
        if org_id is not None:
            items = [item for item in items if item.org_id == org_id]
        return sorted(items, key=lambda item: (item.org_id, item.slug))

    async def create_membership(self, payload: MembershipCreate) -> Membership:
        now = datetime.now(UTC)
        existing = next(
            (
                membership
                for membership in self._memberships.values()
                if membership.org_id == payload.org_id and membership.user_id == payload.user_id
            ),
            None,
        )
        if existing is not None:
            return existing
        membership = Membership(
            membership_id=_new_id("mem"),
            org_id=payload.org_id,
            user_id=payload.user_id,
            role=payload.role,
            status=MembershipStatus.active,
            created_at=now,
            updated_at=now,
        )
        self._memberships[membership.membership_id] = membership
        return membership

    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated:
        await self.get_user(payload.user_id)
        token = f"shn_{secrets.token_urlsafe(32)}"
        now = datetime.now(UTC)
        item = ApiToken(
            token_id=_new_id("tok"),
            user_id=payload.user_id,
            name=payload.name,
            scopes=payload.scopes,
            expires_at=payload.expires_at,
            created_at=now,
        )
        self._tokens[item.token_id] = item
        return ApiTokenCreated(token=token, data=item)

    async def record_audit_event(
        self,
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        actor_user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            event_id=_new_id("evt"),
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata=metadata or {},
            created_at=datetime.now(UTC),
        )
        self._audits.append(event)
        return event

    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]:
        return list(reversed(self._audits[-limit:]))


class PostgresAccessRepository(AccessRepository):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine: AsyncEngine = create_async_engine(settings.metadata_url, pool_pre_ping=True)
        self._session = async_sessionmaker(self.engine, expire_on_commit=False)

    async def init(self) -> None:
        if not self.settings.auto_create_metadata_schema:
            return
        async with self.engine.begin() as conn:
            await conn.run_sync(metadata.create_all)

    async def close(self) -> None:
        await self.engine.dispose()

    async def create_user(self, payload: UserCreate) -> UserPublic:
        values = {
            "user_id": _new_id("usr"),
            "email": str(payload.email),
            "display_name": payload.display_name,
            "status": UserStatus.active.value,
            "is_superuser": payload.is_superuser,
        }
        async with self._session() as session, session.begin():
            stmt = insert(users).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=[users.c.email],
                set_={
                    "display_name": stmt.excluded.display_name,
                    "is_superuser": stmt.excluded.is_superuser,
                },
            ).returning(users)
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            raise RuntimeError("User create did not return a row")
        return _record_to_user(dict(row._mapping))

    async def list_users(self) -> list[UserPublic]:
        async with self._session() as session:
            result = await session.execute(select(users).order_by(users.c.email))
            return [_record_to_user(dict(row._mapping)) for row in result.fetchall()]

    async def get_user(self, user_id: str) -> UserPublic:
        async with self._session() as session:
            result = await session.execute(select(users).where(users.c.user_id == user_id))
            row = result.fetchone()
        if row is None:
            raise NotFoundError(f"User '{user_id}' was not found")
        return _record_to_user(dict(row._mapping))

    async def create_organization(self, payload: OrganizationCreate) -> Organization:
        values = {
            "org_id": _new_id("org"),
            "slug": payload.slug,
            "name": payload.name,
            "created_by": payload.owner_user_id,
        }
        async with self._session() as session, session.begin():
            stmt = insert(organizations).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=[organizations.c.slug],
                set_={"name": stmt.excluded.name},
            ).returning(organizations)
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            raise RuntimeError("Organization create did not return a row")
        return _record_to_org(dict(row._mapping))

    async def list_organizations(self) -> list[Organization]:
        async with self._session() as session:
            result = await session.execute(select(organizations).order_by(organizations.c.slug))
            return [_record_to_org(dict(row._mapping)) for row in result.fetchall()]

    async def create_project(self, payload: ProjectCreate) -> Project:
        values = {
            "project_id": _new_id("prj"),
            "org_id": payload.org_id,
            "slug": payload.slug,
            "name": payload.name,
            "description": payload.description,
            "visibility": payload.visibility.value,
        }
        async with self._session() as session, session.begin():
            stmt = insert(projects).values(**values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_projects_org_slug",
                set_={
                    "name": stmt.excluded.name,
                    "description": stmt.excluded.description,
                    "visibility": stmt.excluded.visibility,
                },
            ).returning(projects)
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            raise RuntimeError("Project create did not return a row")
        return _record_to_project(dict(row._mapping))

    async def list_projects(self, org_id: str | None = None) -> list[Project]:
        stmt = select(projects)
        if org_id is not None:
            stmt = stmt.where(projects.c.org_id == org_id)
        stmt = stmt.order_by(projects.c.org_id, projects.c.slug)
        async with self._session() as session:
            result = await session.execute(stmt)
            return [_record_to_project(dict(row._mapping)) for row in result.fetchall()]

    async def create_membership(self, payload: MembershipCreate) -> Membership:
        values = {
            "membership_id": _new_id("mem"),
            "org_id": payload.org_id,
            "user_id": payload.user_id,
            "role": payload.role.value,
            "status": MembershipStatus.active.value,
        }
        async with self._session() as session, session.begin():
            stmt = insert(memberships).values(**values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_memberships_org_user",
                set_={"role": stmt.excluded.role, "status": stmt.excluded.status},
            ).returning(memberships)
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            raise RuntimeError("Membership create did not return a row")
        return _record_to_membership(dict(row._mapping))

    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated:
        await self.get_user(payload.user_id)
        token = f"shn_{secrets.token_urlsafe(32)}"
        values = {
            "token_id": _new_id("tok"),
            "user_id": payload.user_id,
            "name": payload.name,
            "token_hash": _token_hash(token),
            "scopes": payload.scopes,
            "expires_at": payload.expires_at,
        }
        async with self._session() as session, session.begin():
            stmt = insert(api_tokens).values(**values).returning(api_tokens)
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            raise RuntimeError("API token create did not return a row")
        return ApiTokenCreated(token=token, data=_record_to_token(dict(row._mapping)))

    async def record_audit_event(
        self,
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        actor_user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditEvent:
        values = {
            "event_id": _new_id("evt"),
            "actor_user_id": actor_user_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "metadata_json": metadata or {},
        }
        async with self._session() as session, session.begin():
            stmt = insert(audit_events).values(**values).returning(audit_events)
            result = await session.execute(stmt)
            row = result.fetchone()
        if row is None:
            raise RuntimeError("Audit event create did not return a row")
        return _record_to_audit(dict(row._mapping))

    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]:
        stmt = select(audit_events).order_by(audit_events.c.created_at.desc()).limit(limit)
        async with self._session() as session:
            result = await session.execute(stmt)
            return [_record_to_audit(dict(row._mapping)) for row in result.fetchall()]


def build_access_repository(settings: Settings) -> AccessRepository:
    if settings.registry_backend == "memory":
        return InMemoryAccessRepository()
    return PostgresAccessRepository(settings)
