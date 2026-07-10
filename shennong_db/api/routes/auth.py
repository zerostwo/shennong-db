from fastapi import APIRouter, Depends, HTTPException, status

from shennong_db.access.service import AccessService
from shennong_db.api.deps import get_access_service
from shennong_db.errors import ValidationError
from shennong_db.schemas.access import AuthResponse, LoginRequest, Principal, UserCreate
from shennong_db.security import get_principal

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/bootstrap", response_model=AuthResponse, status_code=201)
async def bootstrap(
    payload: UserCreate, access: AccessService = Depends(get_access_service)
) -> AuthResponse:
    return await access.bootstrap(payload)


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest, access: AccessService = Depends(get_access_service)
) -> AuthResponse:
    try:
        return await access.login(payload.email, payload.password, payload.token_name)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message) from exc


@router.get("/me", response_model=Principal)
async def me(principal: Principal = Depends(get_principal)) -> Principal:
    return principal
