import enum
import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class StaffPermissionKey(str, enum.Enum):
    """The individual owner actions an owner can grant to a staff member
    (Section 32 Part 12, Layer 2). A staff account with the STAFF role can only
    do an action if it has the matching permission row for that venue AND the
    relevant global feature flag is ON (the flag gate runs for everyone, so a
    globally-off feature can never be reached via a staff grant).

    Owner-only actions deliberately NOT in this vocabulary (never grantable to
    staff): create a venue, edit bank details, manage staff."""

    APPROVE_PAYMENTS = "approve_payments"        # approve/reject a payment, view proof
    RECORD_PAYMENTS = "record_payments"          # record/reverse a payment ledger entry [split_payments]
    CHECK_IN = "check_in"                        # check in / mark no-show
    WALKIN = "walkin"                            # create a walk-in booking
    CANCEL_BOOKING = "cancel_booking"            # owner-side cancel a booking
    EDIT_COURT_SETTINGS = "edit_court_settings"  # schedule / pricing / blackouts / court add-edit
    MANAGE_PHOTOS = "manage_photos"              # upload/reorder venue & court photos [photos]
    RESPOND_REVIEWS = "respond_reviews"          # reply to a review [reviews]
    MARK_REFUNDS = "mark_refunds"                # list/mark refunds paid [refunds]
    VIEW_LEDGER = "view_ledger"                  # dashboard: today / pending / ledger / digest
    VIEW_GROWTH = "view_growth"                  # growth suggestions [growth_suggestions]


class StaffMember(UUIDPkMixin, TimestampMixin, Base):
    """A staff/manager account attached to ONE of an owner's venues. The
    employing owner is venues.owner_id of `venue_id`. One staff user may have a
    row per venue (unique per (staff_user_id, venue_id)); scoping is venue-level
    (the staff user can act on every court in that venue, subject to their
    permissions). Deactivating (is_active=False) blocks access immediately and
    the caller revokes the staff user's sessions."""

    __tablename__ = "staff_members"
    __table_args__ = (
        UniqueConstraint("staff_user_id", "venue_id", name="uq_staff_user_venue"),
    )

    staff_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    permissions: Mapped[list["StaffPermission"]] = relationship(
        back_populates="staff_member", cascade="all, delete-orphan", lazy="selectin"
    )
    staff_user: Mapped["User"] = relationship(foreign_keys=[staff_user_id])  # noqa: F821
    venue: Mapped["Venue"] = relationship()  # noqa: F821


class StaffPermission(Base):
    """A single granted permission for a staff member. Presence of a row = the
    permission is granted; toggling off deletes the row. `permission` holds a
    StaffPermissionKey value (plain String, not a pg enum, so the vocabulary can
    grow without a migration)."""

    __tablename__ = "staff_permissions"

    staff_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("staff_members.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission: Mapped[str] = mapped_column(String(50), primary_key=True)

    staff_member: Mapped["StaffMember"] = relationship(back_populates="permissions")
