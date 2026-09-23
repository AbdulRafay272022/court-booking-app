import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.user import User
from app.models.venue import Venue, VenueStatus
from app.schemas.admin import (
    AdminBookingOut,
    AdminDashboardOut,
    AdminUserOut,
    DisputeOut,
    DisputeRejectionOut,
    FlaggedCheckinOut,
    PassiveOwnerVenueOut,
    RefundQueueEntryOut,
)
from app.services.audit_service import AuditService

REVENUE_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED)


class AdminService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditService(db)

    async def dashboard(self) -> AdminDashboardOut:
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)

        total_venues = await self.db.scalar(select(func.count(Venue.id))) or 0
        active_venues = await self.db.scalar(
            select(func.count(Venue.id)).where(Venue.status == VenueStatus.APPROVED, Venue.is_active.is_(True))
        ) or 0
        pending_approval = await self.db.scalar(
            select(func.count(Venue.id)).where(Venue.status == VenueStatus.PENDING)
        ) or 0
        total_bookings_today = await self.db.scalar(
            select(func.count(Booking.id)).where(
                Booking.starts_at >= today_start,
                Booking.starts_at < today_end,
                Booking.status != BookingStatus.CANCELLED,
            )
        ) or 0
        total_revenue_today = await self.db.scalar(
            select(func.coalesce(func.sum(Booking.amount_paid), 0)).where(
                Booking.starts_at >= today_start,
                Booking.starts_at < today_end,
                Booking.status.in_(REVENUE_STATUSES),
            )
        ) or 0
        total_users = await self.db.scalar(select(func.count(User.id))) or 0
        disputes_open = len(await self._dispute_player_ids())

        return AdminDashboardOut(
            total_venues=total_venues,
            active_venues=active_venues,
            pending_approval=pending_approval,
            total_bookings_today=total_bookings_today,
            total_revenue_today=float(total_revenue_today),
            total_users=total_users,
            disputes_open=disputes_open,
        )

    async def list_bookings(
        self,
        *,
        status_filter: BookingStatus | None = None,
        venue_id: uuid.UUID | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> list[AdminBookingOut]:
        query = (
            select(Booking, Court, Venue)
            .join(Court, Court.id == Booking.court_id)
            .join(Venue, Venue.id == Court.venue_id)
        )
        if status_filter is not None:
            query = query.where(Booking.status == status_filter)
        if venue_id is not None:
            query = query.where(Venue.id == venue_id)
        if date_from is not None:
            query = query.where(Booking.starts_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc))
        if date_to is not None:
            query = query.where(
                Booking.starts_at < datetime.combine(date_to, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
            )
        query = query.order_by(Booking.starts_at.desc()).offset(offset).limit(limit)

        result = await self.db.execute(query)
        return [
            AdminBookingOut(
                id=booking.id,
                court_id=court.id,
                court_name=court.name,
                venue_id=venue.id,
                venue_name=venue.name,
                player_name=booking.player_name,
                player_phone=booking.player_phone,
                starts_at=booking.starts_at,
                ends_at=booking.ends_at,
                status=booking.status,
                source=booking.source,
                price=float(booking.price),
                amount_paid=float(booking.amount_paid),
            )
            for booking, court, venue in result.all()
        ]

    async def list_users(
        self, *, search: str | None = None, flagged: bool | None = None, offset: int = 0, limit: int = 20
    ) -> list[AdminUserOut]:
        query = select(User)
        if search:
            like = f"%{search.lower()}%"
            query = query.where(or_(func.lower(User.phone).like(like), func.lower(User.name).like(like)))
        if flagged:
            query = query.where(User.total_rejections >= self.settings.DISPUTE_MIN_REJECTIONS)
        query = query.order_by(User.created_at.desc()).offset(offset).limit(limit)
        result = await self.db.execute(query)
        return [AdminUserOut.model_validate(u) for u in result.scalars().all()]

    async def _dispute_player_ids(self) -> list[uuid.UUID]:
        result = await self.db.execute(
            select(Booking.player_id)
            .join(Payment, Payment.booking_id == Booking.id)
            .where(Payment.review_verdict == "rejected", Booking.player_id.is_not(None))
            .group_by(Booking.player_id)
            .having(func.count(Payment.id) >= self.settings.DISPUTE_MIN_REJECTIONS)
        )
        return [row[0] for row in result.all()]

    async def list_disputes(self) -> list[DisputeOut]:
        """Players rejected >= DISPUTE_MIN_REJECTIONS times, platform-wide.

        Section 15.2 also describes a second criterion -- "player flagged the
        rejection as unfair" -- but there's no player-facing flow anywhere in
        this codebase for a player to raise that flag (no endpoint, no model
        field for it), so only the rejection-count leg is implemented here.
        Adding a genuine self-service dispute flag is a separate feature with
        its own contract, not something to fake with a spare boolean.
        """
        player_ids = await self._dispute_player_ids()
        disputes: list[DisputeOut] = []
        for player_id in player_ids:
            player = await self.db.get(User, player_id)
            if player is None:
                continue

            rejections_result = await self.db.execute(
                select(Payment, Booking, Court, Venue)
                .join(Booking, Booking.id == Payment.booking_id)
                .join(Court, Court.id == Booking.court_id)
                .join(Venue, Venue.id == Court.venue_id)
                .where(Payment.review_verdict == "rejected", Booking.player_id == player_id)
                .order_by(Payment.reviewed_at.desc())
            )
            rows = rejections_result.all()
            disputes.append(
                DisputeOut(
                    player_id=player_id,
                    player_name=player.name,
                    player_phone=player.phone,
                    rejection_count=len(rows),
                    recent_rejections=[
                        DisputeRejectionOut(
                            booking_id=booking.id,
                            court_name=court.name,
                            venue_name=venue.name,
                            reason=payment.rejection_reason,
                            rejected_at=payment.reviewed_at,
                        )
                        for payment, booking, court, venue in rows[:10]
                    ],
                )
            )
        return disputes

    async def list_flagged_checkins(self) -> list[FlaggedCheckinOut]:
        """Bookings whose check-in timestamp fell implausibly outside the
        booking's own window (BookingService._do_check_in sets
        checkin_flag_reason) -- a visibility aid for an admin to spot-check,
        not something that blocked the check-in itself. See finding #17 in
        AUDIT_FINDINGS.md."""
        result = await self.db.execute(
            select(Booking, Court, Venue)
            .join(Court, Court.id == Booking.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .where(Booking.checkin_flag_reason.is_not(None))
            .order_by(Booking.checked_in_at.desc())
        )
        return [
            FlaggedCheckinOut(
                booking_id=booking.id,
                court_name=court.name,
                venue_name=venue.name,
                player_name=booking.player_name,
                player_phone=booking.player_phone,
                starts_at=booking.starts_at,
                ends_at=booking.ends_at,
                checked_in_at=booking.checked_in_at,
                checked_in_by=booking.checked_in_by,
                flag_reason=booking.checkin_flag_reason,
            )
            for booking, court, venue in result.all()
        ]

    async def list_passive_owner_venues(self) -> list[PassiveOwnerVenueOut]:
        """Venues whose owner appears to be passively ignoring payment
        review -- payment_review_expired cancellations, which never set
        Payment.review_verdict, are invisible to list_disputes' explicit-
        rejection query (AUDIT_FINDINGS.md finding #14). An owner who never
        opens the approvals screen produces zero explicit rejections and
        thus zero flags there, even though every one of their players
        silently lost bookings -- likely the more common failure mode for
        untrained pilot venues than active rejection."""
        result = await self.db.execute(
            select(Venue, func.count(Booking.id).label("expired_count"))
            .join(Court, Court.venue_id == Venue.id)
            .join(Booking, Booking.court_id == Court.id)
            .where(Booking.cancellation_reason == "payment_review_expired")
            .group_by(Venue.id)
            .having(func.count(Booking.id) >= self.settings.DISPUTE_MIN_PASSIVE_EXPIRIES)
            .order_by(func.count(Booking.id).desc())
        )
        rows = result.all()
        venues: list[PassiveOwnerVenueOut] = []
        for venue, expired_count in rows:
            owner = await self.db.get(User, venue.owner_id)
            if owner is None:
                continue
            venues.append(
                PassiveOwnerVenueOut(
                    venue_id=venue.id,
                    venue_name=venue.name,
                    owner_name=owner.name,
                    owner_phone=owner.phone,
                    expired_review_count=expired_count,
                )
            )
        return venues

    async def list_refund_queue(self, *, include_resolved: bool = False) -> list[RefundQueueEntryOut]:
        """Bookings whose payment_submitted status expired on a proof that
        looked like a real, non-duplicate payment -- see finding #5 in
        AUDIT_FINDINGS.md and BookingService._flag_unclaimed_payments, which
        writes these rows. Distinct from list_disputes (rejection-count
        based, player-centric): this queue is booking-centric and exists so
        "player probably paid, got no booking" cases are never silently
        lost even if no admin ever manually reconciles the ledger."""
        query = (
            select(PaymentDispute, Payment, Booking, Court, Venue, User)
            .join(Payment, Payment.id == PaymentDispute.payment_id)
            .join(Booking, Booking.id == PaymentDispute.booking_id)
            .join(Court, Court.id == Booking.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .outerjoin(User, User.id == PaymentDispute.player_id)
            .order_by(PaymentDispute.created_at.desc())
        )
        if not include_resolved:
            query = query.where(PaymentDispute.resolved.is_(False))
        result = await self.db.execute(query)
        now = datetime.now(timezone.utc)
        overdue_cutoff = timedelta(days=self.settings.REFUND_OVERDUE_DAYS)
        return [
            RefundQueueEntryOut(
                id=dispute.id,
                booking_id=booking.id,
                payment_id=payment.id,
                player_id=dispute.player_id,
                player_name=player.name if player else None,
                player_phone=player.phone if player else booking.player_phone,
                court_name=court.name,
                venue_name=venue.name,
                amount_claimed=float(payment.amount_claimed) if payment.amount_claimed is not None else None,
                reason=dispute.reason,
                resolved=dispute.resolved,
                created_at=dispute.created_at,
                refund_amount=float(dispute.refund_amount) if dispute.refund_amount is not None else None,
                refund_status=dispute.refund_status,
                refunded_amount=float(dispute.refunded_amount) if dispute.refunded_amount is not None else None,
                refund_reference=dispute.refund_reference,
                refunded_at=dispute.refunded_at,
                refunded_by_user_id=dispute.refunded_by_user_id,
                # Derived at read time, not stored (this codebase's usual pattern for
                # anything computable from "now" -- see the availability engine): a
                # refund that's still owed and was flagged more than REFUND_OVERDUE_DAYS
                # ago needs an admin's attention regardless of what venue it's at.
                is_overdue=(
                    dispute.refund_status == "owed"
                    and (dispute.refund_amount or 0) > 0
                    and now - dispute.created_at >= overdue_cutoff
                ),
            )
            for dispute, payment, booking, court, venue, player in result.all()
        ]

    async def mark_refund_paid(
        self,
        dispute: PaymentDispute,
        *,
        actor: User,
        amount: float | None,
        reference: str,
        screenshot_key: str | None,
    ) -> PaymentDispute:
        """Section 32 Part 10. The one place a manual (no payment gateway)
        refund is actually recorded as paid. Uses the same atomic
        conditional-UPDATE guard as payment approve/reject and booking
        cancel/confirm (WHERE refund_status = 'owed') so a double-click on
        "Refunded" -- or two staff devices doing it at once -- can never
        double-process or double-notify: the loser gets a clean
        REFUND_ALREADY_MARKED, not silent corruption."""
        owed = float(dispute.refund_amount) if dispute.refund_amount is not None else 0.0
        target_amount = amount if amount is not None else owed
        if target_amount < 0:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Refund amount cannot be negative"
            )
        if target_amount > owed + 0.01:
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.REFUND_EXCEEDS_OWED_AMOUNT,
                f"Cannot mark PKR {target_amount:,.2f} as refunded -- only PKR {owed:,.2f} is owed on this booking.",
                details={"owed": owed, "attempted": target_amount},
            )
        result = await self.db.execute(
            update(PaymentDispute)
            .where(PaymentDispute.id == dispute.id, PaymentDispute.refund_status == "owed")
            .values(
                refund_status="refunded",
                refunded_amount=target_amount,
                refund_reference=reference,
                refund_screenshot_key=screenshot_key,
                refunded_by_user_id=actor.id,
                refunded_at=func.now(),
                resolved=True,
            )
            .returning(PaymentDispute.id)
        )
        if result.first() is None:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.REFUND_ALREADY_MARKED,
                "This refund has already been marked as paid",
            )
        await self.audit.log(
            actor_user_id=actor.id,
            actor_type=actor.role.value,
            action="refund.marked_paid",
            entity_type="payment_dispute",
            entity_id=dispute.id,
            old_value={"refund_status": "owed"},
            new_value={"refund_status": "refunded", "refunded_amount": target_amount, "reference": reference},
        )
        await self.db.commit()
        await self.db.refresh(dispute)
        return dispute

    async def suspend_user(self, user: User, reason: str, admin: User) -> User:
        # Best-effort idempotency check (finding #29): setting is_active=False
        # twice is harmless at the data level either way (no corruption is
        # possible from a race here, unlike the booking/payment state
        # machine), but a plain pre-check like this still catches the common
        # double-tap case and avoids cluttering the audit log with identical
        # duplicate rows for a compliance reviewer to puzzle over. Doesn't
        # claim to close a genuine simultaneous race -- that would need the
        # same atomic-UPDATE pattern as booking_service's, which isn't
        # justified here given how low-stakes a duplicate audit row is.
        if user.is_active is False:
            return user
        user.is_active = False
        user.suspension_reason = reason
        await self.audit.log(
            actor_user_id=admin.id,
            actor_type="admin",
            action="user.suspended",
            entity_type="user",
            entity_id=user.id,
            new_value={"reason": reason},
        )
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def unsuspend_user(self, user: User, admin: User) -> User:
        if user.is_active is True:
            return user
        user.is_active = True
        user.suspension_reason = None
        await self.audit.log(
            actor_user_id=admin.id,
            actor_type="admin",
            action="user.unsuspended",
            entity_type="user",
            entity_id=user.id,
        )
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def get_user(self, user_id: uuid.UUID) -> User:
        user = await self.db.get(User, user_id)
        if user is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "User not found")
        return user
