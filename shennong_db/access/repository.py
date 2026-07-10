from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import sqlite3
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from shennong_db.config import Settings
from shennong_db.errors import NotFoundError, ValidationError
from shennong_db.schemas.access import (
    ApiToken,
    ApiTokenCreate,
    ApiTokenCreated,
    AuditEvent,
    DatasetGrant,
    Principal,
    UserCreate,
    UserPublic,
    UserRole,
    UserStatus,
    UserUpdate,
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _now() -> datetime:
    return datetime.now(UTC)


def _datetime(value: str | datetime | None) -> datetime | None:
    return datetime.fromisoformat(value) if isinstance(value, str) else value


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _password_matches(password: str, encoded: str) -> bool:
    algorithm, salt, expected = encoded.split("$", 2)
    if algorithm != "scrypt":
        return False
    actual = _password_hash(password, bytes.fromhex(salt)).rsplit("$", 1)[1]
    return hmac.compare_digest(actual, expected)


def _user(row: dict[str, Any]) -> UserPublic:
    return UserPublic(
        user_id=row["user_id"],
        email=row["email"],
        display_name=row["display_name"],
        role=UserRole(row["role"]),
        status=UserStatus(row["status"]),
        created_at=_datetime(row.get("created_at")),
        updated_at=_datetime(row.get("updated_at")),
    )


def _token(row: dict[str, Any]) -> ApiToken:
    scopes = row.get("scopes_json") or "[]"
    return ApiToken(
        token_id=row["token_id"],
        user_id=row["user_id"],
        name=row["name"],
        scopes=json.loads(scopes) if isinstance(scopes, str) else scopes,
        expires_at=_datetime(row.get("expires_at")),
        revoked_at=_datetime(row.get("revoked_at")),
        last_used_at=_datetime(row.get("last_used_at")),
        created_at=_datetime(row.get("created_at")),
    )


class AccessRepository(ABC):
    @abstractmethod
    async def init(self) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    async def user_count(self) -> int: ...

    @abstractmethod
    async def create_user(self, payload: UserCreate) -> UserPublic: ...

    @abstractmethod
    async def list_users(self) -> list[UserPublic]: ...

    @abstractmethod
    async def get_user(self, user_id: str) -> UserPublic: ...

    @abstractmethod
    async def update_user(self, user_id: str, payload: UserUpdate) -> UserPublic: ...

    @abstractmethod
    async def authenticate_password(self, email: str, password: str) -> UserPublic | None: ...

    @abstractmethod
    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated: ...

    @abstractmethod
    async def list_api_tokens(self, user_id: str | None = None) -> list[ApiToken]: ...

    @abstractmethod
    async def revoke_api_token(self, token_id: str) -> None: ...

    @abstractmethod
    async def authenticate_token(self, token: str) -> Principal | None: ...

    @abstractmethod
    async def grant_dataset(
        self, dataset_id: str, user_id: str, granted_by: str | None
    ) -> DatasetGrant: ...

    @abstractmethod
    async def revoke_dataset(self, dataset_id: str, user_id: str) -> None: ...

    @abstractmethod
    async def list_dataset_grants(self, dataset_id: str) -> list[DatasetGrant]: ...

    @abstractmethod
    async def can_read_dataset(self, dataset_id: str, user_id: str) -> bool: ...

    @abstractmethod
    async def record_audit_event(
        self,
        *,
        action: str,
        resource_type: str,
        resource_id: str,
        actor_user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditEvent: ...

    @abstractmethod
    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]: ...


class InMemoryAccessRepository(AccessRepository):
    def __init__(self) -> None:
        self.users: dict[str, tuple[UserPublic, str]] = {}
        self.tokens: dict[str, tuple[ApiToken, str]] = {}
        self.grants: dict[tuple[str, str], DatasetGrant] = {}
        self.audits: list[AuditEvent] = []

    async def init(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def user_count(self) -> int:
        return len(self.users)

    async def create_user(self, payload: UserCreate) -> UserPublic:
        if any(user.email == payload.email for user, _ in self.users.values()):
            raise ValidationError("A user with this email already exists")
        now = _now()
        user = UserPublic(
            user_id=_new_id("usr"),
            email=payload.email,
            display_name=payload.display_name,
            role=payload.role,
            created_at=now,
            updated_at=now,
        )
        self.users[user.user_id] = (user, _password_hash(payload.password))
        return user

    async def list_users(self) -> list[UserPublic]:
        return sorted((user for user, _ in self.users.values()), key=lambda item: item.email)

    async def get_user(self, user_id: str) -> UserPublic:
        record = self.users.get(user_id)
        if record is None:
            raise NotFoundError(f"User '{user_id}' was not found")
        return record[0]

    async def update_user(self, user_id: str, payload: UserUpdate) -> UserPublic:
        user, password_hash = self.users.get(user_id) or (None, None)
        if user is None or password_hash is None:
            raise NotFoundError(f"User '{user_id}' was not found")
        changes = payload.model_dump(exclude_none=True, exclude={"password"})
        changes["updated_at"] = _now()
        updated = user.model_copy(update=changes)
        if payload.password:
            password_hash = _password_hash(payload.password)
        self.users[user_id] = (updated, password_hash)
        return updated

    async def authenticate_password(self, email: str, password: str) -> UserPublic | None:
        record = next(
            (item for item in self.users.values() if item[0].email == email.lower()), None
        )
        if record is None or not _password_matches(password, record[1]):
            return None
        return record[0] if record[0].status == UserStatus.active else None

    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated:
        await self.get_user(payload.user_id)
        plain = f"shn_{secrets.token_urlsafe(32)}"
        item = ApiToken(
            token_id=_new_id("tok"),
            user_id=payload.user_id,
            name=payload.name,
            scopes=payload.scopes,
            expires_at=payload.expires_at,
            created_at=_now(),
        )
        self.tokens[item.token_id] = (item, _token_hash(plain))
        return ApiTokenCreated(token=plain, data=item)

    async def list_api_tokens(self, user_id: str | None = None) -> list[ApiToken]:
        tokens = [item for item, _ in self.tokens.values()]
        if user_id:
            tokens = [item for item in tokens if item.user_id == user_id]
        return sorted(tokens, key=lambda item: item.created_at or _now(), reverse=True)

    async def revoke_api_token(self, token_id: str) -> None:
        record = self.tokens.get(token_id)
        if record is None:
            raise NotFoundError(f"Token '{token_id}' was not found")
        self.tokens[token_id] = (record[0].model_copy(update={"revoked_at": _now()}), record[1])

    async def authenticate_token(self, token: str) -> Principal | None:
        digest = _token_hash(token)
        record = next((item for item in self.tokens.values() if item[1] == digest), None)
        if record is None:
            return None
        item = record[0]
        if item.revoked_at or (item.expires_at and item.expires_at <= _now()):
            return None
        user = await self.get_user(item.user_id)
        if user.status != UserStatus.active:
            return None
        return Principal(role=user.role, user_id=user.user_id, email=user.email, scopes=item.scopes)

    async def grant_dataset(
        self, dataset_id: str, user_id: str, granted_by: str | None
    ) -> DatasetGrant:
        await self.get_user(user_id)
        grant = DatasetGrant(
            dataset_id=dataset_id, user_id=user_id, granted_by=granted_by, created_at=_now()
        )
        self.grants[(dataset_id, user_id)] = grant
        return grant

    async def revoke_dataset(self, dataset_id: str, user_id: str) -> None:
        self.grants.pop((dataset_id, user_id), None)

    async def list_dataset_grants(self, dataset_id: str) -> list[DatasetGrant]:
        return [grant for grant in self.grants.values() if grant.dataset_id == dataset_id]

    async def can_read_dataset(self, dataset_id: str, user_id: str) -> bool:
        return (dataset_id, user_id) in self.grants

    async def record_audit_event(self, **kwargs: Any) -> AuditEvent:
        event = AuditEvent(
            event_id=_new_id("evt"),
            created_at=_now(),
            metadata=kwargs.pop("metadata", None) or {},
            **kwargs,
        )
        self.audits.append(event)
        return event

    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]:
        return list(reversed(self.audits[-limit:]))


class SQLiteAccessRepository(AccessRepository):
    def __init__(self, settings: Settings) -> None:
        self.path = settings.sqlite_path

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    async def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

        def initialize() -> None:
            with self._connect() as db:
                db.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                      user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
                      display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
                      role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
                      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS api_tokens (
                      token_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
                      token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL,
                      expires_at TEXT, revoked_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL,
                      FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS dataset_grants (
                      dataset_id TEXT NOT NULL, user_id TEXT NOT NULL, granted_by TEXT,
                      created_at TEXT NOT NULL, PRIMARY KEY(dataset_id, user_id),
                      FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS audit_events (
                      event_id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT NOT NULL,
                      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
                      metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
                    );
                    """
                )

        await asyncio.to_thread(initialize)

    async def close(self) -> None:
        return None

    async def user_count(self) -> int:
        def count() -> int:
            with self._connect() as db:
                return int(db.execute("SELECT COUNT(*) FROM users").fetchone()[0])

        return await asyncio.to_thread(count)

    async def create_user(self, payload: UserCreate) -> UserPublic:
        def write() -> UserPublic:
            now = _now().isoformat()
            values = (
                _new_id("usr"),
                payload.email,
                payload.display_name,
                _password_hash(payload.password),
                payload.role.value,
                UserStatus.active.value,
                now,
                now,
            )
            try:
                with self._connect() as db:
                    db.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values)
                    row = db.execute("SELECT * FROM users WHERE user_id=?", (values[0],)).fetchone()
            except sqlite3.IntegrityError as exc:
                raise ValidationError("A user with this email already exists") from exc
            return _user(dict(row))

        return await asyncio.to_thread(write)

    async def list_users(self) -> list[UserPublic]:
        def read() -> list[UserPublic]:
            with self._connect() as db:
                return [
                    _user(dict(row)) for row in db.execute("SELECT * FROM users ORDER BY email")
                ]

        return await asyncio.to_thread(read)

    async def get_user(self, user_id: str) -> UserPublic:
        def read() -> UserPublic:
            with self._connect() as db:
                row = db.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
            if row is None:
                raise NotFoundError(f"User '{user_id}' was not found")
            return _user(dict(row))

        return await asyncio.to_thread(read)

    async def update_user(self, user_id: str, payload: UserUpdate) -> UserPublic:
        await self.get_user(user_id)

        def write() -> UserPublic:
            fields = payload.model_dump(exclude_none=True)
            password = fields.pop("password", None)
            if password:
                fields["password_hash"] = _password_hash(password)
            fields = {
                key: value.value if isinstance(value, (UserRole, UserStatus)) else value
                for key, value in fields.items()
            }
            fields["updated_at"] = _now().isoformat()
            assignments = ", ".join(f"{key}=?" for key in fields)
            with self._connect() as db:
                db.execute(
                    f"UPDATE users SET {assignments} WHERE user_id=?",  # noqa: S608
                    (*fields.values(), user_id),
                )
                row = db.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
            return _user(dict(row))

        return await asyncio.to_thread(write)

    async def authenticate_password(self, email: str, password: str) -> UserPublic | None:
        def read() -> UserPublic | None:
            with self._connect() as db:
                row = db.execute("SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone()
            if (
                row is None
                or row["status"] != UserStatus.active.value
                or not _password_matches(password, row["password_hash"])
            ):
                return None
            return _user(dict(row))

        return await asyncio.to_thread(read)

    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated:
        await self.get_user(payload.user_id)

        def write() -> ApiTokenCreated:
            plain = f"shn_{secrets.token_urlsafe(32)}"
            now = _now().isoformat()
            values = (
                _new_id("tok"),
                payload.user_id,
                payload.name,
                _token_hash(plain),
                json.dumps(payload.scopes),
                payload.expires_at.isoformat() if payload.expires_at else None,
                None,
                None,
                now,
            )
            with self._connect() as db:
                db.execute("INSERT INTO api_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", values)
                row = db.execute(
                    "SELECT * FROM api_tokens WHERE token_id=?", (values[0],)
                ).fetchone()
            return ApiTokenCreated(token=plain, data=_token(dict(row)))

        return await asyncio.to_thread(write)

    async def list_api_tokens(self, user_id: str | None = None) -> list[ApiToken]:
        def read() -> list[ApiToken]:
            query = "SELECT * FROM api_tokens"
            params: tuple[str, ...] = ()
            if user_id:
                query += " WHERE user_id=?"
                params = (user_id,)
            query += " ORDER BY created_at DESC"
            with self._connect() as db:
                return [_token(dict(row)) for row in db.execute(query, params)]

        return await asyncio.to_thread(read)

    async def revoke_api_token(self, token_id: str) -> None:
        def write() -> None:
            with self._connect() as db:
                cursor = db.execute(
                    "UPDATE api_tokens SET revoked_at=? WHERE token_id=?",
                    (_now().isoformat(), token_id),
                )
            if cursor.rowcount == 0:
                raise NotFoundError(f"Token '{token_id}' was not found")

        await asyncio.to_thread(write)

    async def authenticate_token(self, token: str) -> Principal | None:
        def read() -> Principal | None:
            now = _now()
            with self._connect() as db:
                row = db.execute(
                    """SELECT t.*, u.email, u.role, u.status FROM api_tokens t
                    JOIN users u ON u.user_id=t.user_id WHERE t.token_hash=?""",
                    (_token_hash(token),),
                ).fetchone()
                if row is None or row["revoked_at"] or row["status"] != "active":
                    return None
                expires = _datetime(row["expires_at"])
                if expires and expires <= now:
                    return None
                db.execute(
                    "UPDATE api_tokens SET last_used_at=? WHERE token_id=?",
                    (now.isoformat(), row["token_id"]),
                )
            return Principal(
                role=UserRole(row["role"]),
                user_id=row["user_id"],
                email=row["email"],
                scopes=json.loads(row["scopes_json"]),
            )

        return await asyncio.to_thread(read)

    async def grant_dataset(
        self, dataset_id: str, user_id: str, granted_by: str | None
    ) -> DatasetGrant:
        await self.get_user(user_id)

        def write() -> DatasetGrant:
            now = _now().isoformat()
            with self._connect() as db:
                db.execute(
                    """INSERT INTO dataset_grants VALUES (?, ?, ?, ?)
                    ON CONFLICT(dataset_id,user_id) DO UPDATE SET granted_by=excluded.granted_by""",
                    (dataset_id, user_id, granted_by, now),
                )
            return DatasetGrant(
                dataset_id=dataset_id,
                user_id=user_id,
                granted_by=granted_by,
                created_at=_datetime(now),
            )

        return await asyncio.to_thread(write)

    async def revoke_dataset(self, dataset_id: str, user_id: str) -> None:
        def write() -> None:
            with self._connect() as db:
                db.execute(
                    "DELETE FROM dataset_grants WHERE dataset_id=? AND user_id=?",
                    (dataset_id, user_id),
                )

        await asyncio.to_thread(write)

    async def list_dataset_grants(self, dataset_id: str) -> list[DatasetGrant]:
        def read() -> list[DatasetGrant]:
            with self._connect() as db:
                rows = db.execute(
                    "SELECT * FROM dataset_grants WHERE dataset_id=? ORDER BY user_id",
                    (dataset_id,),
                ).fetchall()
            return [DatasetGrant(**dict(row)) for row in rows]

        return await asyncio.to_thread(read)

    async def can_read_dataset(self, dataset_id: str, user_id: str) -> bool:
        def read() -> bool:
            with self._connect() as db:
                return (
                    db.execute(
                        "SELECT 1 FROM dataset_grants WHERE dataset_id=? AND user_id=?",
                        (dataset_id, user_id),
                    ).fetchone()
                    is not None
                )

        return await asyncio.to_thread(read)

    async def record_audit_event(self, **kwargs: Any) -> AuditEvent:
        def write() -> AuditEvent:
            event = AuditEvent(
                event_id=_new_id("evt"),
                created_at=_now(),
                metadata=kwargs.get("metadata") or {},
                actor_user_id=kwargs.get("actor_user_id"),
                action=kwargs["action"],
                resource_type=kwargs["resource_type"],
                resource_id=kwargs["resource_id"],
            )
            with self._connect() as db:
                db.execute(
                    "INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        event.event_id,
                        event.actor_user_id,
                        event.action,
                        event.resource_type,
                        event.resource_id,
                        json.dumps(event.metadata),
                        event.created_at.isoformat(),
                    ),
                )
            return event

        return await asyncio.to_thread(write)

    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]:
        def read() -> list[AuditEvent]:
            with self._connect() as db:
                rows = db.execute(
                    "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
            return [
                AuditEvent(
                    event_id=row["event_id"],
                    actor_user_id=row["actor_user_id"],
                    action=row["action"],
                    resource_type=row["resource_type"],
                    resource_id=row["resource_id"],
                    metadata=json.loads(row["metadata_json"]),
                    created_at=_datetime(row["created_at"]),
                )
                for row in rows
            ]

        return await asyncio.to_thread(read)


def build_access_repository(settings: Settings) -> AccessRepository:
    if settings.registry_backend == "memory":
        return InMemoryAccessRepository()
    return SQLiteAccessRepository(settings)
