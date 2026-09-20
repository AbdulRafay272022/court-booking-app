from datetime import datetime, timedelta

import structlog
from fastapi import status
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.audit import AuditLog
from app.models.user import LoginAttempt, OtpPurpose, OtpRequest, Session, User
from app.schemas.auth import SignupIn, UserUpdateIn
from app.services.whatsapp_service import WhatsAppService
from app.utils.security import (
    generate_otp,
    generate_session_token,
    hash_otp,
    hash_password,
    hash_token,
    token_expiry,
    utcnow,
    verify_otp,
    verify_password,
)

logger = structlog.get_logger(__name__)


class AuthService:
    """Section 26 auth model:

    - Signup = form + password, account created with `phone_verified_at IS NULL`,
      then an OTP proves phone ownership (`verify_signup_otp`) and only then a
      session is issued.
    - Login = phone + password. NOT OTP. Refused with
      PHONE_REVERIFICATION_REQUIRED if the phone was never verified or was last
      verified more than PHONE_VERIFICATION_TRUST_DAYS ago -- checked BEFORE the
      password, so the client can route to OTP instead of saying "wrong password".
    - OTP is now only ever a proof of phone possession (signup, re-verification,
      password reset). It never issues a session on its own, except right after a
      signup whose password the same person just chose.
    - Sessions last SESSION_TOKEN_EXPIRE_HOURS and are kept alive by /auth/refresh.
    """

    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.whatsapp = WhatsAppService(settings)

    # ------------------------------------------------------------------ OTP

    async def _issue_otp(self, phone: str, purpose: OtpPurpose, *, user_id=None) -> None:
        window_start = utcnow() - timedelta(minutes=self.settings.OTP_RATE_LIMIT_WINDOW_MINUTES)
        count = await self.db.scalar(
            select(func.count()).select_from(OtpRequest).where(
                OtpRequest.phone == phone, OtpRequest.created_at >= window_start
            )
        )
        if (count or 0) >= self.settings.OTP_MAX_ATTEMPTS:
            raise AppError(
                status.HTTP_429_TOO_MANY_REQUESTS,
                ErrorCode.OTP_RATE_LIMITED,
                "Too many OTP requests. Please try again later.",
            )

        code = self.settings.DEV_FIXED_OTP if (self.settings.DEBUG and self.settings.DEV_FIXED_OTP) else generate_otp()
        otp = OtpRequest(
            phone=phone,
            purpose=purpose,
            user_id=user_id,
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
            logger.error("auth_service.otp_send_failed", phone=phone, purpose=purpose.value, error=str(exc))
            await self.db.delete(otp)
            await self.db.commit()
            raise AppError(
                status.HTTP_502_BAD_GATEWAY,
                ErrorCode.OTP_DELIVERY_FAILED,
                "Couldn't send the verification code right now. Please try again in a moment.",
            ) from exc

    async def _consume_otp(
        self, phone: str, code: str, purposes: tuple[OtpPurpose, ...], *, user_id=None
    ) -> None:
        """Validates the latest live OTP for this phone+purpose and marks it
        used. Raises OTP_EXPIRED / OTP_RATE_LIMITED / INVALID_OTP; the caller
        commits."""
        conditions = [
            OtpRequest.phone == phone,
            OtpRequest.purpose.in_(purposes),
            OtpRequest.is_used.is_(False),
            OtpRequest.expires_at > utcnow(),
        ]
        if user_id is not None:
            conditions.append(OtpRequest.user_id == user_id)
        result = await self.db.execute(
            select(OtpRequest).where(*conditions).order_by(OtpRequest.created_at.desc()).limit(1)
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

    # --------------------------------------------------------------- signup

    async def signup(self, payload: SignupIn) -> None:
        user = await self.db.scalar(select(User).where(User.phone == payload.phone))
        password_hash = await hash_password(payload.password)

        if user is not None and user.phone_verified_at is not None:
            # A verified (or pre-Section-26) account owns this number. Never
            # overwrite it from an unauthenticated endpoint.
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.PHONE_ALREADY_REGISTERED,
                "An account with this phone number already exists. Log in, or reset your password.",
            )

        await self._claim_email(payload.email, for_user=user)

        if user is None:
            user = User(phone=payload.phone)
            self.db.add(user)
        # else: an abandoned, never-verified signup for this number. Whoever
        # finishes the OTP owns it, so let a retry overwrite it rather than
        # letting a stranger squat on someone else's number by signing up first.
        user.name = payload.name
        user.email = payload.email
        user.city = payload.city
        user.gender = payload.gender
        user.role = payload.user_role
        user.password_hash = password_hash
        user.phone_verified_at = None
        await self._commit_unique_email()

        await self._issue_otp(payload.phone, OtpPurpose.SIGNUP)

    async def verify_signup_otp(
        self,
        phone: str,
        code: str,
        *,
        device_id: str | None = None,
        device_name: str | None = None,
        platform: str | None = None,
    ) -> tuple[User, str, datetime]:
        user = await self.db.scalar(select(User).where(User.phone == phone))
        # Only a pending signup (password set, phone never verified) can be
        # completed here. Without this, an OTP alone -- which never checks a
        # password -- would be a way to mint a session for any account.
        if user is None or user.phone_verified_at is not None or user.password_hash is None:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.OTP_EXPIRED, "OTP expired or not found")

        await self._consume_otp(phone, code, (OtpPurpose.SIGNUP,))
        user.phone_verified_at = utcnow()
        token, expires_at = await self._create_session(user, device_id, device_name, platform)
        await self.db.commit()
        await self.db.refresh(user)
        return user, token, expires_at

    # ---------------------------------------------------------------- email

    async def _claim_email(self, email: str, *, for_user: User | None) -> None:
        """Makes `email` available to `for_user` (None = a brand-new account), or raises
        EMAIL_ALREADY_IN_USE. Case-insensitive, matching the unique index on lower(email).
        A holder that never verified its phone is an abandoned signup: it releases the email
        (NULLed and audited) instead of letting a stranger block someone else's address by
        signing up with it first -- same reasoning as the phone-squatting rule above."""
        query = select(User).where(func.lower(User.email) == email.lower())
        if for_user is not None:
            query = query.where(User.id != for_user.id)
        holder = await self.db.scalar(query)
        if holder is None:
            return
        if holder.phone_verified_at is not None:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.EMAIL_ALREADY_IN_USE,
                "That email address is already in use.",
            )
        self.db.add(
            AuditLog(
                entity_type="user",
                entity_id=holder.id,
                action="email_released_abandoned_signup",
                old_value={"email": holder.email},
                new_value={"email": None},
                actor_type="system",
            )
        )
        holder.email = None
        await self.db.flush()

    async def _commit_unique_email(self) -> None:
        """Commit, turning a lost race on the unique email index into the clean API error
        (not a raw IntegrityError). Anything else is re-raised."""
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            if "uq_users_email_lower" not in str(exc.orig):
                raise
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.EMAIL_ALREADY_IN_USE,
                "That email address is already in use.",
            ) from exc

    async def update_profile(self, user: User, payload: UserUpdateIn) -> User:
        """name / email / city / gender / avatar. Never phone or password (see UserUpdateIn)."""
        data = payload.model_dump(exclude_unset=True)
        new_email = data.get("email")
        if new_email and (user.email or "").lower() != new_email.lower():
            await self._claim_email(new_email, for_user=user)
        for field, value in data.items():
            setattr(user, field, value)
        await self._commit_unique_email()
        await self.db.refresh(user)
        return user

    # ----------------------------------------------------------- phone change

    async def request_phone_change(self, user: User, new_phone: str, password: str) -> None:
        """Step 1: re-authenticate with the current password, check the new number is free, and
        send a code TO THE NEW NUMBER. Nothing about the account changes yet -- an abandoned
        attempt leaves the original phone exactly as it was."""
        if user.password_hash is None:
            raise AppError(
                status.HTTP_403_FORBIDDEN, ErrorCode.PASSWORD_NOT_SET, "Set a password before changing your number."
            )
        # Wrong passwords here count toward the same lockout as login, so a stolen session can't
        # be used to guess the password through this endpoint.
        if await self._failed_login_count(user.phone) >= self.settings.LOGIN_MAX_FAILED_ATTEMPTS:
            raise AppError(
                status.HTTP_429_TOO_MANY_REQUESTS,
                ErrorCode.LOGIN_RATE_LIMITED,
                "Too many failed attempts. Please try again in a few minutes.",
            )
        if not await verify_password(password, user.password_hash):
            self.db.add(LoginAttempt(phone=user.phone))
            await self.db.commit()
            # 403, not 401: a 401 on an authenticated call reads as "session expired" to the clients.
            raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.INVALID_CREDENTIALS, "Incorrect password.")
        await self._clear_failed_logins(user.phone)

        if new_phone == user.phone:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "That is already your number.")
        holder = await self.db.scalar(select(User).where(User.phone == new_phone))
        if holder is not None and holder.phone_verified_at is not None:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.PHONE_ALREADY_REGISTERED,
                "An account with this phone number already exists.",
            )
        await self.db.commit()  # persists the cleared lockout before the OTP path commits/raises
        await self._issue_otp(new_phone, OtpPurpose.PHONE_CHANGE, user_id=user.id)

    async def verify_phone_change(self, user: User, new_phone: str, code: str) -> None:
        """Step 2: prove possession of the new number, then -- in ONE transaction -- move the
        account to it, mark it verified now, and end EVERY session (this one included). Any
        failure (wrong/expired code, number taken in the meantime) rolls back and leaves the
        original phone untouched."""
        old_phone = user.phone
        await self._consume_otp(new_phone, code, (OtpPurpose.PHONE_CHANGE,), user_id=user.id)

        holder = await self.db.scalar(select(User).where(User.phone == new_phone, User.id != user.id))
        if holder is not None:
            if holder.phone_verified_at is not None:
                await self.db.rollback()
                raise AppError(
                    status.HTTP_409_CONFLICT,
                    ErrorCode.PHONE_ALREADY_REGISTERED,
                    "An account with this phone number already exists.",
                )
            # An abandoned, never-verified signup on this number: whoever just proved possession owns it.
            await self.db.delete(holder)
            await self.db.flush()

        user.phone = new_phone
        user.phone_verified_at = utcnow()
        await self._revoke_all_sessions(user.id, reason="phone_changed")
        await self._clear_failed_logins(old_phone)
        await self._clear_failed_logins(new_phone)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.PHONE_ALREADY_REGISTERED,
                "An account with this phone number already exists.",
            ) from exc

    # ------------------------------------------------------------ re-verify

    async def request_reverification_otp(self, phone: str) -> None:
        """Send an OTP so a user whose phone isn't currently trusted can prove
        possession again. Silent (no OTP, no error) for an unknown phone, so it
        can't be used to test which numbers have accounts."""
        user = await self.db.scalar(select(User).where(User.phone == phone))
        if user is None:
            return
        # A pending (never-verified) signup asking for a code is finishing that
        # signup -- the "resend code" button -- so the code is a SIGNUP one,
        # which verify_signup_otp accepts. Anyone else is re-verifying.
        purpose = OtpPurpose.SIGNUP if user.phone_verified_at is None else OtpPurpose.REVERIFY
        await self._issue_otp(phone, purpose)

    async def reverify_phone(self, phone: str, code: str) -> None:
        """Marks the phone verified. Deliberately does NOT issue a session: an
        OTP proves possession of the phone, not knowledge of the password, so
        the client goes on to a normal password login."""
        user = await self.db.scalar(select(User).where(User.phone == phone))
        if user is None:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.OTP_EXPIRED, "OTP expired or not found")
        # SIGNUP too: an abandoned signup that comes back through login lands
        # here (PHONE_REVERIFICATION_REQUIRED), holding a SIGNUP-purpose code.
        await self._consume_otp(phone, code, (OtpPurpose.REVERIFY, OtpPurpose.SIGNUP))
        user.phone_verified_at = utcnow()
        await self.db.commit()

    def _phone_trusted(self, user: User) -> bool:
        if user.phone_verified_at is None:
            return False
        return utcnow() - user.phone_verified_at < timedelta(days=self.settings.PHONE_VERIFICATION_TRUST_DAYS)

    # ---------------------------------------------------------------- login

    async def _failed_login_count(self, phone: str) -> int:
        window_start = utcnow() - timedelta(minutes=self.settings.LOGIN_RATE_LIMIT_WINDOW_MINUTES)
        return (
            await self.db.scalar(
                select(func.count()).select_from(LoginAttempt).where(
                    LoginAttempt.phone == phone, LoginAttempt.created_at >= window_start
                )
            )
            or 0
        )

    async def _clear_failed_logins(self, phone: str) -> None:
        await self.db.execute(delete(LoginAttempt).where(LoginAttempt.phone == phone))

    async def login(
        self,
        phone: str,
        password: str,
        *,
        device_id: str | None = None,
        device_name: str | None = None,
        platform: str | None = None,
    ) -> tuple[User, str, datetime]:
        if await self._failed_login_count(phone) >= self.settings.LOGIN_MAX_FAILED_ATTEMPTS:
            raise AppError(
                status.HTTP_429_TOO_MANY_REQUESTS,
                ErrorCode.LOGIN_RATE_LIMITED,
                "Too many failed login attempts. Please try again in a few minutes, or reset your password.",
            )

        user = await self.db.scalar(select(User).where(User.phone == phone))

        if user is not None:
            # Phone-verification gate FIRST (spec): a stale/unverified phone
            # must route to OTP, not be told "wrong password".
            if not self._phone_trusted(user):
                raise AppError(
                    status.HTTP_403_FORBIDDEN,
                    ErrorCode.PHONE_REVERIFICATION_REQUIRED,
                    "Please verify your phone number to continue.",
                )
            if user.password_hash is None:
                # Pre-Section-26 account: there is nothing to check yet.
                raise AppError(
                    status.HTTP_403_FORBIDDEN,
                    ErrorCode.PASSWORD_NOT_SET,
                    "Set a password for your account to continue.",
                )

        # An unknown phone still pays for one hash check (verify_password does
        # a dummy verify for None) so the two failure modes take the same time.
        ok = await verify_password(password, user.password_hash if user is not None else None)
        if user is None or not ok:
            self.db.add(LoginAttempt(phone=phone))
            await self.db.commit()
            raise AppError(
                status.HTTP_401_UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS, "Invalid phone or password."
            )
        if not user.is_active:
            raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.FORBIDDEN, "This account has been suspended.")

        await self._clear_failed_logins(phone)
        token, expires_at = await self._create_session(user, device_id, device_name, platform)
        await self.db.commit()
        await self.db.refresh(user)
        return user, token, expires_at

    # ------------------------------------------------------- password reset

    async def request_password_reset(self, phone: str) -> None:
        """Also the path for pre-Section-26 accounts to SET their first password
        (PASSWORD_NOT_SET). Silent for an unknown phone (no enumeration)."""
        user = await self.db.scalar(select(User).where(User.phone == phone))
        if user is None:
            return
        await self._issue_otp(phone, OtpPurpose.PASSWORD_RESET)

    async def reset_password(self, phone: str, code: str, new_password: str) -> None:
        user = await self.db.scalar(select(User).where(User.phone == phone))
        if user is None:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.OTP_EXPIRED, "OTP expired or not found")
        await self._consume_otp(phone, code, (OtpPurpose.PASSWORD_RESET,))

        user.password_hash = await hash_password(new_password)
        # Passing the reset OTP proves possession of the phone just as well as
        # a signup/re-verification OTP, so it also refreshes the trust window
        # (otherwise a user resetting because they came back after a year would
        # be bounced straight into a second OTP).
        user.phone_verified_at = utcnow()
        await self._revoke_all_sessions(user.id, reason="password_reset")
        await self._clear_failed_logins(phone)
        await self.db.commit()

    # ------------------------------------------------------------- sessions

    async def _create_session(
        self, user: User, device_id: str | None, device_name: str | None, platform: str | None
    ) -> tuple[str, datetime]:
        token = generate_session_token()
        expires_at = token_expiry(hours=self.settings.SESSION_TOKEN_EXPIRE_HOURS)
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

    async def _revoke_all_sessions(self, user_id, *, reason: str) -> None:
        await self.db.execute(
            update(Session)
            .where(Session.user_id == user_id, Session.is_revoked.is_(False))
            .values(is_revoked=True, revoked_reason=reason)
        )

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
        """Rotates a still-valid session into a fresh one (new SESSION_TOKEN_EXPIRE_HOURS
        window). Clients call this proactively before expiry -- once the
        token has expired there is nothing left to refresh. Refresh does NOT
        outlive phone verification: past PHONE_VERIFICATION_TRUST_DAYS the
        chain ends and the user goes through OTP again, otherwise an
        always-active user would never be re-verified."""
        session = await self.get_session_from_token(old_token)
        if session is None:
            raise AppError(
                status.HTTP_401_UNAUTHORIZED, ErrorCode.SESSION_EXPIRED, "Invalid or expired token"
            )
        user = await self.db.get(User, session.user_id)
        if user is None or not user.is_active:
            raise AppError(status.HTTP_401_UNAUTHORIZED, ErrorCode.SESSION_REVOKED, "Invalid session")
        if not self._phone_trusted(user):
            session.is_revoked = True
            session.revoked_reason = "phone_reverification_required"
            await self.db.commit()
            raise AppError(
                status.HTTP_401_UNAUTHORIZED,
                ErrorCode.PHONE_REVERIFICATION_REQUIRED,
                "Please verify your phone number again.",
            )

        session.is_revoked = True
        session.revoked_reason = "refreshed"
        token, expires_at = await self._create_session(
            user, session.device_id, session.device_name, session.platform
        )
        await self.db.commit()
        return token, expires_at
