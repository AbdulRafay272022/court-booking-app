import uuid
from datetime import datetime

from sqlalchemy import CHAR, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class OwnerIdentity(UUIDPkMixin, TimestampMixin, Base):
    """An owner's CNIC (Round 2 Stage 2). The number is stored ONLY Fernet-encrypted (`cnic_encrypted`,
    `{"number": "<13 digits>"}` via app/utils/encryption.encrypt_json); `cnic_last4` is for masked display and
    `cnic_hash` (HMAC-SHA256 with CNIC_HASH_KEY) finds the same CNIC under another account without decrypting.
    The hash is deliberately NOT unique: a duplicate only adds the `duplicate_cnic` flag to both rows, never
    blocks. Photos live in the private bucket under owner-identity/{user_id}/."""

    __tablename__ = "owner_identity"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    cnic_encrypted: Mapped[dict] = mapped_column(JSONB, nullable=False)
    cnic_last4: Mapped[str] = mapped_column(CHAR(4), nullable=False)
    cnic_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False, index=True)
    front_key: Mapped[str] = mapped_column(String(512), nullable=False)
    back_key: Mapped[str] = mapped_column(String(512), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    flags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))

    user: Mapped["User"] = relationship(foreign_keys=[user_id])  # noqa: F821
