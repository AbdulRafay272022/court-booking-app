"""audit 2026-10-28 Phase 3 (all behind default-OFF flags; migration a9d4e7b2c813):

- PointEntry: the player's points ledger (append-only; the balance is the sum, never below 0 -- a deduction is recorded at the
  amount actually taken). 50 per booking paid fully by transfer, +5 for answering a short-payment message, -20 for not
  answering it in 24 h (given back later), -N when points are used for a venue discount.
- ShortPaymentClaim: a booking completed with money still due ("kam mila"). The player answers "Sahi hai" / "Ghalat hai";
  an open claim (resolved_at null) is a DUE the venue carries to the player's next booking approval.
- NoShowReply: the player said "Main aaya tha" on a no-show.
- ArrivalCheck: ONE GPS reading when the player pressed "Pohanch gaya", compared with the venue pin.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPkMixin


class PointEntry(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "point_entries"

    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=True)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # transfer_booking | short_reply | short_no_reply | short_no_reply_returned | redeem | redeem_returned
    reason: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # each award / penalty happens at most once per booking (an insert that would repeat one fails and is skipped)
    __table_args__ = (
        Index("uq_point_entries_booking_reason", "booking_id", "reason", unique=True, postgresql_where=text("booking_id IS NOT NULL")),
    )


class ShortPaymentClaim(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "short_payment_claims"

    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, unique=True)
    venue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("venues.id"), nullable=False, index=True)
    player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    total_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    paid_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    due_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    # awaiting_reply | confirmed (Sahi hai) | disputed (Ghalat hai) | no_reply
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="awaiting_reply")
    reply_deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    player_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    penalty_applied: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # points actually taken (0..20)
    penalty_returned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    owner_decision: Mapped[str | None] = mapped_column(String(10), nullable=True)  # collect | waive
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # set when the due is settled: paid (owner pressed "done" / the balance reached 0) or waived
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(10), nullable=True)  # paid | waived


class NoShowReply(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "noshow_replies"

    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, unique=True)
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_decision: Mapped[str | None] = mapped_column(String(10), nullable=True)  # keep | reverse
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArrivalCheck(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "arrival_checks"

    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, unique=True)
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    verdict: Mapped[str] = mapped_column(String(20), nullable=False)  # near | far | pin_unreliable
