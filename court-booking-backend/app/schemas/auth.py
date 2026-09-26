import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.user import City, Gender, UserRole

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")
# QA #9: a Pakistani mobile in E.164 is +92 followed by a leading 3 and 9 more digits
# (national 03XXXXXXXXX). Enforced on the numbers a NEW verification can be started for
# (signup, request-otp), not on login/phone-change (login answers USER_NOT_FOUND anyway).
_PK_MOBILE = re.compile(r"^\+923\d{9}$")


def _normalize_phone(v: str) -> str:
    v = v.strip().replace(" ", "")
    if not v.startswith("+"):
        raise ValueError("phone must be in E.164 format, e.g. +923001234567")
    if not _E164.match(v):
        raise ValueError("phone must be in E.164 format, e.g. +923001234567")
    return v


def _normalize_pk_phone(v: str) -> str:
    v = _normalize_phone(v)
    if not _PK_MOBILE.match(v):
        raise ValueError("Enter a valid Pakistani mobile number, e.g. +923001234567")
    return v


class PhoneIn(BaseModel):
    """Base for every request that identifies an account by phone."""

    phone: str = Field(min_length=8, max_length=20)

    @field_validator("phone")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _normalize_phone(v)


# Kept under its old name: request-otp is now the "resend"/re-verification
# endpoint (see AuthService.request_reverification_otp), same request shape.
class OtpRequestIn(PhoneIn):
    @field_validator("phone")
    @classmethod
    def normalize_pk(cls, v: str) -> str:  # QA #9: PK mobile format
        return _normalize_pk_phone(v)


class OtpRequestOut(BaseModel):
    message: str = "OTP sent via WhatsApp"
    expires_in: int
    # QA #10: absolute server-side expiry so a fresh tab/page load can compute the remaining
    # countdown without relying on client sessionStorage.
    expires_at: datetime | None = None


class OtpStatusOut(BaseModel):
    """QA #10: lets the Verify screen show a correct countdown on a cold load. Reports the
    live OTP's expiry for a phone (null when there is none), computed server-side."""

    expires_at: datetime | None = None
    expires_in: int = 0


class DeviceInfoIn(BaseModel):
    device_id: str | None = None
    device_name: str | None = None
    platform: str | None = None  # android | ios | web


class SignupIn(PhoneIn):
    """Player and owner signup share one form and one endpoint; `role` is the
    toggle. Admin is deliberately not selectable here."""

    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    city: City
    gender: Gender
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(max_length=128)
    role: Literal["player", "owner"] = "player"

    @field_validator("phone")
    @classmethod
    def normalize_pk(cls, v: str) -> str:  # QA #9: PK mobile format
        return _normalize_pk_phone(v)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("name is too short")
        return v

    @field_validator("email")
    @classmethod
    def lower_email(cls, v: str) -> str:
        return v.strip().lower()

    @model_validator(mode="after")
    def passwords_match(self) -> "SignupIn":
        if self.password != self.confirm_password:
            raise ValueError("Passwords don't match")
        return self

    @property
    def user_role(self) -> UserRole:
        return UserRole(self.role)


class SignupOut(BaseModel):
    message: str = "Account created. We sent a verification code on WhatsApp."
    phone: str
    expires_in: int
    expires_at: datetime | None = None  # QA #10: absolute server-side expiry for the countdown


class VerifyOtpIn(PhoneIn, DeviceInfoIn):
    otp: str = Field(min_length=4, max_length=8)


class ReverifyIn(PhoneIn):
    otp: str = Field(min_length=4, max_length=8)


class LoginIn(PhoneIn, DeviceInfoIn):
    # No min_length here on purpose: a too-short password is just a wrong one
    # (INVALID_CREDENTIALS), not a 422 that tells an attacker the length rule.
    password: str = Field(min_length=1, max_length=128)


class PasswordResetRequestIn(PhoneIn):
    pass


class PasswordResetIn(PhoneIn):
    otp: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(max_length=128)

    @model_validator(mode="after")
    def passwords_match(self) -> "PasswordResetIn":
        if self.new_password != self.confirm_password:
            raise ValueError("Passwords don't match")
        return self


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    phone: str
    name: str | None
    email: str | None
    city: City | None
    gender: Gender | None
    role: UserRole
    avatar_url: str | None
    phone_verified_at: datetime | None
    reliability_score: float
    total_bookings: int
    total_no_shows: int
    total_rejections: int
    created_at: datetime


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: str | None
    device_name: str | None
    platform: str | None
    last_active_at: datetime
    expires_at: datetime
    created_at: datetime


class TokenResponse(BaseModel):
    token: str
    expires_at: datetime
    user: UserOut


class MeOut(BaseModel):
    user: UserOut
    session: SessionOut


class RefreshResponse(BaseModel):
    token: str
    expires_at: datetime


class MessageOut(BaseModel):
    message: str


class UserUpdateIn(BaseModel):
    """Profile edits: name, email, city, gender (and avatar). Deliberately NOT phone -- changing it
    is its own OTP-verified flow (request-phone-change / verify-phone-change) -- and NOT the
    password (that goes through forgot-password, never a second "old password" path). Unknown
    fields such as `phone` or `password_hash` are ignored, not applied."""

    name: str | None = Field(default=None, min_length=2, max_length=100)
    email: EmailStr | None = None
    city: City | None = None
    gender: Gender | None = None
    avatar_url: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("name is too short")
        return v

    @field_validator("email")
    @classmethod
    def lower_email(cls, v: str | None) -> str | None:
        return v.strip().lower() if v else v

    @model_validator(mode="after")
    def no_explicit_nulls(self) -> "UserUpdateIn":
        # Sending `"email": null` (or name/city/gender) would blank a required profile field.
        for field in ("name", "email", "city", "gender"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be empty")
        return self


class PhoneChangeRequestIn(BaseModel):
    new_phone: str = Field(min_length=8, max_length=20)
    # Re-authentication for a sensitive action: a stolen session alone must not be able to move
    # the account's phone (which would let its holder reset the password via the new number).
    password: str = Field(min_length=1, max_length=128)

    @field_validator("new_phone")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _normalize_phone(v)


class PhoneChangeVerifyIn(BaseModel):
    new_phone: str = Field(min_length=8, max_length=20)
    otp: str = Field(min_length=4, max_length=8)

    @field_validator("new_phone")
    @classmethod
    def normalize(cls, v: str) -> str:
        return _normalize_phone(v)


class PhoneChangeOut(BaseModel):
    message: str = "Phone number updated. Sign in again with your new number."
    phone: str
    sign_in_again: bool = True


class FCMTokenRegisterIn(BaseModel):
    token: str
    platform: str | None = None  # android | ios | web
