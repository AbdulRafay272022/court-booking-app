from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.dependencies import AppSettings, CurrentUser, DbSession
from app.schemas.auth import (
    MeOut,
    MessageOut,
    OtpRequestIn,
    OtpRequestOut,
    OtpVerifyIn,
    RefreshResponse,
    SessionOut,
    TokenResponse,
    UserOut,
    UserUpdateIn,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)


def _require_credentials(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> HTTPAuthorizationCredentials:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials


@router.post("/request-otp", response_model=OtpRequestOut)
async def request_otp(payload: OtpRequestIn, db: DbSession, settings: AppSettings) -> OtpRequestOut:
    service = AuthService(db, settings)
    await service.request_otp(payload.phone)
    return OtpRequestOut(expires_in=settings.OTP_EXPIRE_MINUTES * 60)


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(payload: OtpVerifyIn, db: DbSession, settings: AppSettings) -> TokenResponse:
    service = AuthService(db, settings)
    user, token, expires_at, is_new_user = await service.verify_otp(
        payload.phone,
        payload.otp,
        device_id=payload.device_id,
        device_name=payload.device_name,
        platform=payload.platform,
    )
    return TokenResponse(
        token=token, expires_at=expires_at, user=UserOut.model_validate(user), is_new_user=is_new_user
    )


@router.post("/logout", response_model=MessageOut)
async def logout(
    db: DbSession,
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_require_credentials)],
) -> MessageOut:
    await AuthService(db, settings).revoke_token(credentials.credentials, reason="logout")
    return MessageOut(message="Logged out")


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(
    db: DbSession,
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_require_credentials)],
) -> RefreshResponse:
    token, expires_at = await AuthService(db, settings).refresh_token(credentials.credentials)
    return RefreshResponse(token=token, expires_at=expires_at)


@router.get("/me", response_model=MeOut)
async def get_me(
    db: DbSession,
    settings: AppSettings,
    user: CurrentUser,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_require_credentials)],
) -> MeOut:
    session = await AuthService(db, settings).get_session_from_token(credentials.credentials)
    return MeOut(user=UserOut.model_validate(user), session=SessionOut.model_validate(session))


@router.patch("/me", response_model=UserOut)
async def update_me(payload: UserUpdateIn, user: CurrentUser, db: DbSession) -> UserOut:
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)
