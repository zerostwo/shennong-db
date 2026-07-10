from shennong_db.access.repository import AccessRepository
from shennong_db.errors import ValidationError
from shennong_db.schemas.access import (
    ApiTokenCreate,
    ApiTokenCreated,
    AuditEvent,
    AuthResponse,
    DatasetGrant,
    Principal,
    UserCreate,
    UserPublic,
    UserRole,
    UserUpdate,
)


class AccessService:
    def __init__(self, repository: AccessRepository) -> None:
        self.repository = repository

    async def init(self) -> None:
        await self.repository.init()

    async def close(self) -> None:
        await self.repository.close()

    async def bootstrap(self, payload: UserCreate) -> AuthResponse:
        if await self.repository.user_count():
            raise ValidationError("ShennongDB has already been bootstrapped")
        user = await self.repository.create_user(
            payload.model_copy(update={"role": UserRole.admin})
        )
        token = await self.repository.create_api_token(
            ApiTokenCreate(user_id=user.user_id, name="bootstrap", scopes=["*"])
        )
        await self.audit(
            action="access.bootstrap",
            resource_type="user",
            resource_id=user.user_id,
            actor_user_id=user.user_id,
        )
        return AuthResponse(user=user, token=token)

    async def login(self, email: str, password: str, token_name: str) -> AuthResponse:
        user = await self.repository.authenticate_password(email, password)
        if user is None:
            raise ValidationError("Invalid email or password")
        token = await self.repository.create_api_token(
            ApiTokenCreate(user_id=user.user_id, name=token_name, scopes=["datasets:read"])
        )
        return AuthResponse(user=user, token=token)

    async def authenticate_token(self, token: str) -> Principal | None:
        return await self.repository.authenticate_token(token)

    async def create_user(self, payload: UserCreate) -> UserPublic:
        return await self.repository.create_user(payload)

    async def list_users(self) -> list[UserPublic]:
        return await self.repository.list_users()

    async def get_user(self, user_id: str) -> UserPublic:
        return await self.repository.get_user(user_id)

    async def update_user(self, user_id: str, payload: UserUpdate) -> UserPublic:
        return await self.repository.update_user(user_id, payload)

    async def create_api_token(self, payload: ApiTokenCreate) -> ApiTokenCreated:
        return await self.repository.create_api_token(payload)

    async def list_api_tokens(self, user_id: str | None = None):
        return await self.repository.list_api_tokens(user_id)

    async def revoke_api_token(self, token_id: str) -> None:
        await self.repository.revoke_api_token(token_id)

    async def grant_dataset(
        self, dataset_id: str, user_id: str, granted_by: str | None
    ) -> DatasetGrant:
        return await self.repository.grant_dataset(dataset_id, user_id, granted_by)

    async def revoke_dataset(self, dataset_id: str, user_id: str) -> None:
        await self.repository.revoke_dataset(dataset_id, user_id)

    async def list_dataset_grants(self, dataset_id: str) -> list[DatasetGrant]:
        return await self.repository.list_dataset_grants(dataset_id)

    async def can_read_dataset(self, dataset_id: str, principal: Principal) -> bool:
        if principal.is_admin:
            return True
        if "datasets:read" not in principal.scopes and "*" not in principal.scopes:
            return False
        return bool(
            principal.user_id
            and await self.repository.can_read_dataset(dataset_id, principal.user_id)
        )

    async def audit(self, **kwargs) -> AuditEvent:
        return await self.repository.record_audit_event(**kwargs)

    async def list_audit_events(self, limit: int = 100) -> list[AuditEvent]:
        return await self.repository.list_audit_events(limit)
