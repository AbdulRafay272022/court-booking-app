import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserRole


class OtpRequestIn(BaseModel):
    phone: str = Field(min_length=8, max_length=20)

    @field_validator("phone")
    @classmethod
    def normalize(cls, v: str) -> str:
        v = v.strip().replace(" ", "")
        if not v.startswith("+"):
            raise ValueError("phone must be in E.164 format, e.g. +923001234567")
        return v


class OtpRequestOut(BaseModel):
    message: str = "OTP sent via WhatsApp"
    expires_in: int


class OtpVerifyIn(BaseModel):
    phone: str
    otp: str = Field(min_length=4, max_length=8)
    device_id: str | None = None
    device_name: str | None = None
    platform: str | None = None  # android | ios | web


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    phone: str
    name: str | None
    role: UserRole
    avatar_url: str | None
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
    is_new_user: bool


class MeOut(BaseModel):
    user: UserOut
    session: SessionOut


class RefreshResponse(BaseModel):
    token: str
    expires_at: datetime


class MessageOut(BaseModel):
    message: str


class UserUpdateIn(BaseModel):
    name: str | None = None
    avatar_url: str | None = None


class FCMTokenRegisterIn(BaseModel):
    token: str
    platform: str | None = None  # android | ios | web
