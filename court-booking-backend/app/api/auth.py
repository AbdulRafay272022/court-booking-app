from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.dependencies import AppSettings, CurrentUser, DbSession
from app.errors import AppError, ErrorCode
from app.utils.client_ip import client_ip
from app.schemas.auth import (
    LoginIn,
    MeOut,
    MessageOut,
    OtpRequestIn,
    OtpRequestOut,
    OtpStatusOut,
    PasswordResetIn,
    PasswordResetRequestIn,
    PhoneChangeOut,
    PhoneChangeRequestIn,
    PhoneChangeVerifyIn,
    RefreshResponse,
    ReverifyIn,
    SessionOut,
    SignupIn,
    SignupOut,
    TokenResponse,
    UserOut,
    UserUpdateIn,
    VerifyOtpIn,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)


def _require_credentials(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> HTTPAuthorizationCredentials:
    if credentials is None:
        # QA #11: no Authorization header -> NOT_AUTHENTICATED (not SESSION_EXPIRED).
        raise AppError(status.HTTP_401_UNAUTHORIZED, ErrorCode.NOT_AUTHENTICATED, "Not authenticated")
    return credentials


def _service_with_ip(request: Request, db: DbSession, settings: AppSettings) -> AuthService:
    """AuthService carrying the caller's IP + the app.state per-IP throttles, for the
    endpoints that send OTPs (QA #3) or check the password (QA #4)."""
    return AuthService(
        db,
        settings,
        client_ip=client_ip(request),
        login_ip_limiter=request.app.state.login_ip_limiter,
        otp_ip_limiter=request.app.state.otp_ip_limiter,
    )


def _otp_expires_at(settings: AppSettings) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)


# ---- Signup ---------------------------------------------------------------


@router.post("/signup", response_model=SignupOut, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupIn, request: Request, db: DbSession, settings: AppSettings) -> SignupOut:
    """Creates the account (unverified) and sends the verification OTP. The
    account can't log in until `verify-signup-otp` succeeds."""
    await _service_with_ip(request, db, settings).signup(payload)
    return SignupOut(
        phone=payload.phone,
        expires_in=settings.OTP_EXPIRE_MINUTES * 60,
        expires_at=_otp_expires_at(settings),
    )


@router.post("/verify-signup-otp", response_model=TokenResponse)
async def verify_signup_otp(payload: VerifyOtpIn, db: DbSession, settings: AppSettings) -> TokenResponse:
    user, token, expires_at = await AuthService(db, settings).verify_signup_otp(
        payload.phone,
        payload.otp,
        device_id=payload.device_id,
        device_name=payload.device_name,
        platform=payload.platform,
    )
    return TokenResponse(token=token, expires_at=expires_at, user=UserOut.model_validate(user))


# ---- Login ----------------------------------------------------------------


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginIn, request: Request, db: DbSession, settings: AppSettings) -> TokenResponse:
    user, token, expires_at = await _service_with_ip(request, db, settings).login(
        payload.phone,
        payload.password,
        device_id=payload.device_id,
        device_name=payload.device_name,
        platform=payload.platform,
    )
    return TokenResponse(token=token, expires_at=expires_at, user=UserOut.model_validate(user))


# ---- Phone (re-)verification ----------------------------------------------


@router.post("/request-otp", response_model=OtpRequestOut)
async def request_otp(payload: OtpRequestIn, request: Request, db: DbSession, settings: AppSettings) -> OtpRequestOut:
    """Sends a re-verification OTP (also the "resend code" endpoint for a
    signup that hasn't been verified yet). Always answers 200 for a well-formed
    phone, whether or not an account exists (this endpoint stays non-enumerating;
    login/reset are the ones that reveal existence per QA #12 / NEW BUG 1)."""
    await _service_with_ip(request, db, settings).request_reverification_otp(payload.phone)
    return OtpRequestOut(expires_in=settings.OTP_EXPIRE_MINUTES * 60, expires_at=_otp_expires_at(settings))


@router.get("/otp-status", response_model=OtpStatusOut)
async def otp_status(phone: str, request: Request, db: DbSession, settings: AppSettings) -> OtpStatusOut:
    """QA #10: the live OTP's expiry for a phone, so a cold-loaded Verify screen shows a
    correct countdown. Returns nulls/0 when there is no live code."""
    from app.schemas.auth import _normalize_phone  # local: reuse the same normalizer

    expires_at = await _service_with_ip(request, db, settings).otp_status(_normalize_phone(phone))
    if expires_at is None:
        return OtpStatusOut(expires_at=None, expires_in=0)
    remaining = max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
    return OtpStatusOut(expires_at=expires_at, expires_in=remaining)


@router.post("/reverify-phone", response_model=MessageOut)
async def reverify_phone(payload: ReverifyIn, db: DbSession, settings: AppSettings) -> MessageOut:
    """Proves phone possession again. Does not log the user in -- the client
    follows up with a normal password login."""
    await AuthService(db, settings).reverify_phone(payload.phone, payload.otp)
    return MessageOut(message="Phone verified")


# ---- Password reset --------------------------------------------------------


@router.post("/request-password-reset", response_model=OtpRequestOut)
async def request_password_reset(
    payload: PasswordResetRequestIn, request: Request, db: DbSession, settings: AppSettings
) -> OtpRequestOut:
    await _service_with_ip(request, db, settings).request_password_reset(payload.phone)
    return OtpRequestOut(expires_in=settings.OTP_EXPIRE_MINUTES * 60, expires_at=_otp_expires_at(settings))


@router.post("/verify-password-reset", response_model=MessageOut)
async def verify_password_reset(
    payload: PasswordResetIn, request: Request, db: DbSession, settings: AppSettings
) -> MessageOut:
    """Sets the new password, ends every existing session for the account
    (other devices are logged out), and does not itself log anyone in."""
    await _service_with_ip(request, db, settings).reset_password(payload.phone, payload.otp, payload.new_password)
    return MessageOut(message="Password updated. Please log in with your new password.")


# ---- Session ----------------------------------------------------------------


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
async def update_me(payload: UserUpdateIn, user: CurrentUser, db: DbSession, settings: AppSettings) -> UserOut:
    """Edit name / email (must be unique) / city / gender / avatar. Phone and password are not
    editable here: phone has its own OTP flow below, the password goes through forgot-password."""
    updated = await AuthService(db, settings).update_profile(user, payload)
    return UserOut.model_validate(updated)


# ---- Phone number change (authenticated) ------------------------------------


@router.post("/request-phone-change", response_model=OtpRequestOut)
async def request_phone_change(
    payload: PhoneChangeRequestIn, request: Request, user: CurrentUser, db: DbSession, settings: AppSettings
) -> OtpRequestOut:
    """Re-authenticates with the current password and sends a code to the NEW number. The account
    is not touched until `verify-phone-change` succeeds."""
    await _service_with_ip(request, db, settings).request_phone_change(user, payload.new_phone, payload.password)
    return OtpRequestOut(expires_in=settings.OTP_EXPIRE_MINUTES * 60, expires_at=_otp_expires_at(settings))


@router.post("/verify-phone-change", response_model=PhoneChangeOut)
async def verify_phone_change(
    payload: PhoneChangeVerifyIn, user: CurrentUser, db: DbSession, settings: AppSettings, background: BackgroundTasks
) -> PhoneChangeOut:
    """Moves the account to the new number, marks it verified now, and ends EVERY session
    (including this one): the client must sign in again with the new number. Once that has
    committed, the OLD number gets a best-effort WhatsApp notice -- as a background task, so the
    response never waits on (or fails because of) the send."""
    service = AuthService(db, settings)
    old_phone = await service.verify_phone_change(user, payload.new_phone, payload.otp)
    background.add_task(service.notify_old_number_of_phone_change, old_phone, payload.new_phone)
    return PhoneChangeOut(phone=payload.new_phone)
