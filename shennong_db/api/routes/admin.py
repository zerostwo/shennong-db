from fastapi import APIRouter, Depends, Query, Response, status

from shennong_db.access.service import AccessService
from shennong_db.api.deps import get_access_service, get_registry
from shennong_db.registry.service import DatasetRegistryService
from shennong_db.schemas.access import (
    ApiTokenCreate,
    ApiTokenCreated,
    ApiTokenListResponse,
    AuditEventListResponse,
    DatasetGrant,
    DatasetGrantListResponse,
    Principal,
    UserCreate,
    UserListResponse,
    UserPublic,
    UserUpdate,
)
from shennong_db.security import require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.post("/users", response_model=UserPublic, status_code=201)
async def create_user(
    payload: UserCreate,
    principal: Principal = Depends(require_admin),
    access: AccessService = Depends(get_access_service),
) -> UserPublic:
    user = await access.create_user(payload)
    await access.audit(
        action="user.create",
        resource_type="user",
        resource_id=user.user_id,
        actor_user_id=principal.user_id,
    )
    return user


@router.get("/users", response_model=UserListResponse)
async def list_users(access: AccessService = Depends(get_access_service)) -> UserListResponse:
    return UserListResponse(users=await access.list_users())


@router.get("/users/{user_id}", response_model=UserPublic)
async def get_user(user_id: str, access: AccessService = Depends(get_access_service)) -> UserPublic:
    return await access.get_user(user_id)


@router.patch("/users/{user_id}", response_model=UserPublic)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    principal: Principal = Depends(require_admin),
    access: AccessService = Depends(get_access_service),
) -> UserPublic:
    user = await access.update_user(user_id, payload)
    await access.audit(
        action="user.update",
        resource_type="user",
        resource_id=user_id,
        actor_user_id=principal.user_id,
    )
    return user


@router.post("/tokens", response_model=ApiTokenCreated, status_code=201)
async def create_api_token(
    payload: ApiTokenCreate,
    principal: Principal = Depends(require_admin),
    access: AccessService = Depends(get_access_service),
) -> ApiTokenCreated:
    token = await access.create_api_token(payload)
    await access.audit(
        action="token.create",
        resource_type="api_token",
        resource_id=token.data.token_id,
        actor_user_id=principal.user_id,
    )
    return token


@router.get("/tokens", response_model=ApiTokenListResponse)
async def list_api_tokens(
    user_id: str | None = Query(default=None),
    access: AccessService = Depends(get_access_service),
) -> ApiTokenListResponse:
    return ApiTokenListResponse(tokens=await access.list_api_tokens(user_id))


@router.delete("/tokens/{token_id}", status_code=204)
async def revoke_api_token(
    token_id: str,
    principal: Principal = Depends(require_admin),
    access: AccessService = Depends(get_access_service),
) -> Response:
    await access.revoke_api_token(token_id)
    await access.audit(
        action="token.revoke",
        resource_type="api_token",
        resource_id=token_id,
        actor_user_id=principal.user_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/datasets/{dataset_id}/grants/{user_id}", response_model=DatasetGrant)
async def grant_dataset(
    dataset_id: str,
    user_id: str,
    principal: Principal = Depends(require_admin),
    access: AccessService = Depends(get_access_service),
    registry: DatasetRegistryService = Depends(get_registry),
) -> DatasetGrant:
    await registry.get(dataset_id)
    grant = await access.grant_dataset(dataset_id, user_id, principal.user_id)
    await access.audit(
        action="dataset.grant",
        resource_type="dataset",
        resource_id=dataset_id,
        actor_user_id=principal.user_id,
        metadata={"user_id": user_id},
    )
    return grant


@router.delete("/datasets/{dataset_id}/grants/{user_id}", status_code=204)
async def revoke_dataset(
    dataset_id: str,
    user_id: str,
    principal: Principal = Depends(require_admin),
    access: AccessService = Depends(get_access_service),
) -> Response:
    await access.revoke_dataset(dataset_id, user_id)
    await access.audit(
        action="dataset.grant_revoke",
        resource_type="dataset",
        resource_id=dataset_id,
        actor_user_id=principal.user_id,
        metadata={"user_id": user_id},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/datasets/{dataset_id}/grants", response_model=DatasetGrantListResponse)
async def list_dataset_grants(
    dataset_id: str, access: AccessService = Depends(get_access_service)
) -> DatasetGrantListResponse:
    return DatasetGrantListResponse(grants=await access.list_dataset_grants(dataset_id))


@router.get("/audit-events", response_model=AuditEventListResponse)
async def list_audit_events(
    limit: int = Query(default=100, ge=1, le=1000),
    access: AccessService = Depends(get_access_service),
) -> AuditEventListResponse:
    return AuditEventListResponse(events=await access.list_audit_events(limit))
