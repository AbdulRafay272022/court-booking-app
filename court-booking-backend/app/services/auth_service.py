from datetime import datetime, timedelta

import structlog
from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.user import OtpRequest, Session, User
from app.services.whatsapp_service import WhatsAppService
from app.utils.security import (
    generate_otp,
    generate_session_token,
    hash_otp,
    hash_token,
    token_expiry,
    utcnow,
    verify_otp,
)

logger = structlog.get_logger(__name__)


class AuthService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.whatsapp = WhatsAppService(settings)

    async def request_otp(self, phone: str) -> None:
        window_start = utcnow() - timedelta(minutes=self.settings.OTP_RATE_LIMIT_WINDOW_MINUTES)
        count_result = await self.db.execute(
            select(OtpRequest).where(OtpRequest.phone == phone, OtpRequest.created_at >= window_start)
        )
        if len(count_result.scalars().all()) >= self.settings.OTP_MAX_ATTEMPTS:
            raise AppError(
                status.HTTP_429_TOO_MANY_REQUESTS,
                ErrorCode.OTP_RATE_LIMITED,
                "Too many OTP requests. Please try again later.",
            )

        code = self.settings.DEV_FIXED_OTP if (self.settings.DEBUG and self.settings.DEV_FIXED_OTP) else generate_otp()
        otp = OtpRequest(
            phone=phone,
            otp_hash=hash_otp(code),
            expires_at=utcnow() + timedelta(minutes=self.settings.OTP_EXPIRE_MINUTES),
        )
        self.db.add(otp)
        await self.db.commit()

        try:
            await self.whatsapp.send_otp(phone, code)
        except Exception as exc:
            # WhatsApp is the only OTP channel (no SMS fallback) -- an
            # uncaught failure here would both burn a rate-limit slot for an
            # OTP that never arrived AND surface as a raw unhandled 500.
            # Delete the row so a delivery failure never counts against the
            # user's attempts, and report a distinct error.code the client
            # can render meaningfully instead of a generic error.
            logger.error("auth_service.otp_send_failed", phone=phone, error=str(exc))
            await self.db.delete(otp)
            await self.db.commit()
            raise AppError(
                status.HTTP_502_BAD_GATEWAY,
                ErrorCode.OTP_DELIVERY_FAILED,
                "Couldn't send the verification code right now. Please try again in a moment.",
            ) from exc

    async def verify_otp(
        self,
        phone: str,
        code: str,
        *,
        device_id: str | None = None,
        device_name: str | None = None,
        platform: str | None = None,
    ) -> tuple[User, str, datetime, bool]:
        """Returns (user, token, expires_at, is_new_user)."""
        result = await self.db.execute(
            select(OtpRequest)
            .where(
                OtpRequest.phone == phone,
                OtpRequest.is_used.is_(False),
                OtpRequest.expires_at > utcnow(),
            )
            .order_by(OtpRequest.created_at.desc())
            .limit(1)
        )
        otp = result.scalar_one_or_none()
        if otp is None:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.OTP_EXPIRED, "OTP expired or not found")
        if otp.attempts >= self.settings.OTP_MAX_ATTEMPTS:
            raise AppError(
                status.HTTP_429_TOO_MANY_REQUESTS, ErrorCode.OTP_RATE_LIMITED, "Too many failed attempts"
            )
        if not verify_otp(code, otp.otp_hash):
            otp.attempts += 1
            await self.db.commit()
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_OTP, "Invalid OTP")

        otp.is_used = True

        user = await self.db.scalar(select(User).where(User.phone == phone))
        is_new_user = user is None
        if user is None:
            user = User(phone=phone)
            self.db.add(user)
            await self.db.flush()

        token, expires_at = await self._create_session(user, device_id, device_name, platform)
        await self.db.commit()
        await self.db.refresh(user)

        return user, token, expires_at, is_new_user

    async def _create_session(
        self, user: User, device_id: str | None, device_name: str | None, platform: str | None
    ) -> tuple[str, datetime]:
        token = generate_session_token()
        expires_at = token_expiry(self.settings.SESSION_TOKEN_EXPIRE_DAYS)
        self.db.add(
            Session(
                user_id=user.id,
                token_hash=hash_token(token, self.settings.SESSION_TOKEN_SECRET),
                device_id=device_id,
                device_name=device_name,
                platform=platform,
                expires_at=expires_at,
            )
        )
        return token, expires_at

    async def get_session_from_token(self, token: str) -> Session | None:
        token_hash = hash_token(token, self.settings.SESSION_TOKEN_SECRET)
        result = await self.db.execute(
            select(Session).where(
                Session.token_hash == token_hash,
                Session.is_revoked.is_(False),
                Session.expires_at > utcnow(),
            )
        )
        return result.scalar_one_or_none()

    async def get_user_from_token(self, token: str) -> User | None:
        session = await self.get_session_from_token(token)
        if session is None:
            return None
        user = await self.db.get(User, session.user_id)
        if user is None or not user.is_active:
            return None
        session.last_active_at = utcnow()
        await self.db.commit()
        return user

    async def revoke_token(self, token: str, reason: str = "logout") -> None:
        session = await self.get_session_from_token(token)
        if session is not None:
            session.is_revoked = True
            session.revoked_reason = reason
            await self.db.commit()

    async def refresh_token(self, old_token: str) -> tuple[str, datetime]:
        session = await self.get_session_from_token(old_token)
        if session is None:
            raise AppError(
                status.HTTP_401_UNAUTHORIZED, ErrorCode.SESSION_EXPIRED, "Invalid or expired token"
            )
        user = await self.db.get(User, session.user_id)
        if user is None or not user.is_active:
            raise AppError(status.HTTP_401_UNAUTHORIZED, ErrorCode.SESSION_REVOKED, "Invalid session")

        session.is_revoked = True
        session.revoked_reason = "refreshed"
        token, expires_at = await self._create_session(
            user, session.device_id, session.device_name, session.platform
        )
        await self.db.commit()
        return token, expires_at
