import uuid
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.booking import LIVE_BOOKING_STATUSES, Booking, BookingSource, BookingStatus, CancelledBy
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.waitlist import WaitlistEntry
from app.models.user import User, UserRole
from app.services.audit_service import AuditService
from app.services.availability_service import AvailabilityService
from app.services.payment_ledger_service import recompute_payment_totals
from app.services.venue_timers import hold_minutes_for, payment_deadline_for
from app.services.availability_service import GRID_MINUTES
from app.utils.timezone import format_when, utc_now

logger = structlog.get_logger(__name__)

# Which channel a player-initiated hold came through. `create_hold` is reached from three places (the HTTP hold
# endpoint, the in-app AI chat tool, and the WhatsApp webhook + its AI tool). The WhatsApp webhook sets this for the
# duration of its handler so every hold made under it is recorded as source=whatsapp without threading a parameter
# through the AI service. Default APP. (No schema change: `bookings.source` and its 'whatsapp' value already exist.)
booking_source_ctx: ContextVar[BookingSource] = ContextVar("booking_source_ctx", default=BookingSource.APP)


def recompute_reliability(user: User) -> None:
    """No fixed formula was specified; this is a simple, monotonic penalty
    that keeps the score in [0, 1] and moves it the right direction for the
    tests that check it drops after a no-show or rejection."""
    score = 1.0 - (0.15 * user.total_no_shows + 0.05 * user.total_rejections)
    user.reliability_score = round(max(0.0, min(1.0, score)), 2)


class BookingService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditService(db)
        # audit 2026-10-28 item 10: the refund row the last cancel_booking() created (None = no refund owed)
        self.created_refund = None
        self.availability = AvailabilityService(db)

    async def _load_active_court(self, court_id: uuid.UUID) -> Court:
        court = await self.db.get(Court, court_id)
        if court is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Court not found")
        if not court.is_active:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_BOOKING_STATE, "Court is not currently bookable"
            )
        return court

    async def _require_approved_venue_for_court(self, court: Court):
        """Player-facing bookings only -- a venue still pending/rejected/
        changes-requested review shouldn't be publicly bookable even if
        someone has the court_id directly, though an owner's own in-person
        walk-in (create_walkin) is exempt, since that's their own venue."""
        from app.models.venue import Venue, VenueStatus

        from app.services.venue_visibility import is_public_for_players

        venue = await self.db.get(Venue, court.venue_id)
        # audit 2026-10-28 item 2: a soft-deleted venue (is_active=False, its courts left active) was still holdable by
        # court id. Same public rule as the venue page and availability (incl. the Phase 2 CNIC gate when it is on).
        if venue is None or venue.status != VenueStatus.APPROVED or not await is_public_for_players(self.db, venue):
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.VENUE_NOT_APPROVED, "This venue is not yet approved for bookings"
            )
        return venue

    async def _atomic_transition(
        self,
        booking: Booking,
        from_statuses: tuple[BookingStatus, ...],
        to_status: BookingStatus,
        **extra_values,
    ) -> bool:
        """Atomically move `booking` from one of `from_statuses` to
        `to_status` with a single conditional UPDATE ... WHERE status IN
        (...) -- the same "let the DB re-check at write time" pattern
        expire_stale_bookings already uses, applied to the single-row case.
        A plain SELECT-then-mutate-then-commit here would blindly overwrite
        whatever the row's real status became under a concurrent
        approve/reject/cancel; this re-evaluates the WHERE clause against
        the row's current committed value instead. Returns False (row left
        untouched, no commit) if `booking`'s live status wasn't one of
        `from_statuses` by the time this ran; refreshes `booking` in place
        on success."""
        result = await self.db.execute(
            update(Booking)
            .where(Booking.id == booking.id, Booking.status.in_(from_statuses))
            .values(status=to_status, **extra_values)
            .returning(Booking.id)
        )
        if result.first() is None:
            return False
        await self.db.refresh(booking)
        return True

    async def _insert_booking(self, booking: Booking) -> None:
        """The unique partial index one_live_booking_per_slot and the exclusion constraint
        no_overlapping_live_bookings (see the Booking model) are what actually prevent
        double-booking -- the first for the same start time, the second for ANY overlap, which
        is what multi-slot bookings need. This commit either succeeds or raises IntegrityError
        -- there is no separate locking step because none is needed.

        Owner Round 2 (B1): a hold whose time has run out is free at read time, but the index/constraint above still
        count it until the expiry job cancels it. So any expired hold overlapping the new booking is cancelled
        (system, hold_expired) in the SAME transaction, just before the insert: either both commit or neither."""
        released = await self._release_stale_holds(booking.court_id, booking.starts_at, booking.ends_at)
        self.db.add(booking)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            if "one_live_booking_per_slot" in str(exc.orig) or "no_overlapping_live_bookings" in str(exc.orig):
                raise AppError(
                    status.HTTP_409_CONFLICT,
                    ErrorCode.SLOT_ALREADY_TAKEN,
                    "This slot was just booked by someone else",
                ) from exc
            raise
        await self.db.refresh(booking)
        if released:
            await self._notify_released_holds(released)
        if booking.player_id is not None:
            # A player who now holds the slot no longer needs to be told when it opens up.
            await self.db.execute(
                update(WaitlistEntry)
                .where(
                    WaitlistEntry.court_id == booking.court_id,
                    WaitlistEntry.slot_starts_at == booking.starts_at,
                    WaitlistEntry.player_id == booking.player_id,
                    WaitlistEntry.is_active.is_(True),
                )
                .values(is_active=False)
            )
            await self.db.commit()

    _EXPIRED_HOLD_VALUES = dict(
        status=BookingStatus.CANCELLED,
        cancelled_by=CancelledBy.SYSTEM,
        cancellation_reason="hold_expired",
        held_until=None,
        payment_deadline=None,
    )

    async def _release_stale_holds(
        self, court_id: uuid.UUID, starts_at: datetime, ends_at: datetime
    ) -> list[tuple[uuid.UUID, uuid.UUID | None, datetime, datetime]]:
        """Cancel (not committed) every HELD booking on this court overlapping [starts_at, ends_at) whose hold time
        has passed. Returns (id, player_id, starts_at, ends_at) of each released hold."""
        result = await self.db.execute(
            update(Booking)
            .where(
                Booking.court_id == court_id,
                Booking.status == BookingStatus.HELD,
                Booking.held_until.is_not(None),
                Booking.held_until <= datetime.now(timezone.utc),
                Booking.starts_at < ends_at,
                Booking.ends_at > starts_at,
            )
            .values(**self._EXPIRED_HOLD_VALUES)
            .returning(Booking.id, Booking.player_id, Booking.starts_at, Booking.ends_at)
            .execution_options(synchronize_session=False)
        )
        released = [tuple(r) for r in result.all()]
        for booking_id, player_id, _s, _e in released:
            await self.audit.log(
                actor_user_id=player_id,
                actor_type="system",
                action="booking.expired",
                entity_type="booking",
                entity_id=booking_id,
                new_value={"status": BookingStatus.CANCELLED.value, "reason": "hold_expired", "released_for_new_booking": True},
            )
        return released

    async def _notify_released_holds(self, released: list) -> None:
        """Best effort: the player whose expired hold was just released gets the same "booking cancelled" message the
        expiry job would have sent."""
        from app.services.notification_service import NotificationService

        try:
            notifications = NotificationService(self.db, self.settings)
            for booking_id, player_id, starts_at, ends_at in released:
                booking = await self.db.get(Booking, booking_id)
                player = await self.db.get(User, player_id) if player_id else None
                court = await self.db.get(Court, booking.court_id) if booking is not None else None
                if player is not None and court is not None:
                    await notifications.notify_booking_cancelled(
                        user=player, court_name=court.name, starts_at=starts_at, ends_at=ends_at, reference_id=booking_id
                    )
        except Exception:  # noqa: BLE001 -- the new booking already committed; a message problem must not fail it
            logger.warning("booking_service.released_hold_notify_failed", exc_info=True)

    async def expire_hold_now(self, booking: Booking) -> bool:
        """Owner Round 2 (B1): move ONE hold whose time has passed to cancelled (system, hold_expired) right now,
        the same transition the expiry job makes. Returns False if it was not (or no longer) an expired hold."""
        ok = await self._atomic_transition(
            booking,
            from_statuses=(BookingStatus.HELD,),
            to_status=BookingStatus.CANCELLED,
            cancelled_by=CancelledBy.SYSTEM,
            cancellation_reason="hold_expired",
            held_until=None,
            payment_deadline=None,
        ) if booking.held_until is not None and booking.held_until <= datetime.now(timezone.utc) else False
        if not ok:
            return False
        await self.audit.log(
            actor_user_id=None,
            actor_type="system",
            action="booking.expired",
            entity_type="booking",
            entity_id=booking.id,
            new_value={"status": booking.status.value},
        )
        await self.db.commit()
        await self.db.refresh(booking)
        return True

    async def create_hold(
        self,
        player: User,
        court_id: uuid.UUID,
        starts_at: datetime,
        slot_count: int | None = None,
        player_name: str | None = None,
        source: BookingSource | None = None,
        *,
        legacy_units: bool = False,
        name_is_own: bool = False,
    ) -> Booking:
        """Hold `slot_count` consecutive 30-minute slots (Section 32 Part 4c: the grid is always 30 minutes; the court's
        slot length is the MINIMUM booking, so fewer than min_slots is refused; None = that minimum) as ONE booking priced
        across the whole range. `player_name` is the
        name the booking is made under when the player gave one in chat (their own, or a friend's); otherwise the
        account's name. `name_is_own` says that name is the player's OWN: it is then saved on the account (users.name) IF the
        account has none, in the same transaction as the hold -- so a name is only ever saved when the booking is actually
        confirmed (the hold is created), never for a mere proposal. Never overwrites a name, never saves a friend's
        (`name_is_own` False) -- callers pass a name already cleaned by app/services/player_name.py."""
        if starts_at.tzinfo is None:
            # The HTTP endpoint's Pydantic schema (BookingHoldIn) already
            # rejects a naive starts_at before it gets here, but this method
            # has two other entry points that build `starts_at` straight
            # from `datetime.fromisoformat()` with no such validation --
            # the AI chat's hold_slot tool and the WhatsApp button-reply
            # handler (both call create_hold directly). Comparing a naive
            # datetime against datetime.now(timezone.utc) below raises an
            # uncaught TypeError (a raw 500) without this guard. See
            # AUDIT_FINDINGS.md finding #26.
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.VALIDATION_ERROR,
                "starts_at must include a UTC offset (e.g. a trailing 'Z' or '+00:00')",
            )
        if starts_at <= datetime.now(timezone.utc):
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.SLOT_IN_PAST, "starts_at must be in the future")
        court = await self._load_active_court(court_id)
        venue = await self._require_approved_venue_for_court(court)

        # Every slot in the range must be on the court's real grid, free, and priced; the total is the sum
        # of each slot's own rate. (The pre-check gives a clear message; the database constraints still
        # decide any race.)
        # TRANSITION: `legacy_units` = an app build from before Part 4c; `slot_count` is already in 30-minute slots, only the
        # money keeps the old whole-slot-window pricing (see app/services/slot_compat.py).
        quote = await self.availability.quote_range(court, starts_at, slot_count, legacy_units=legacy_units)
        ends_at = quote.ends_at
        price, advance_amount = quote.price, quote.advance_amount

        booking = Booking(
            court_id=court_id,
            player_id=player.id,
            starts_at=starts_at,
            ends_at=ends_at,
            status=BookingStatus.HELD,
            source=source or booking_source_ctx.get(),
            player_name=player_name or player.name,
            player_phone=player.phone,
            price=price,
            advance_amount=advance_amount,
            balance_due=round(price - advance_amount, 2),
            # Round 2 Stage 2: the venue's own hold length (null = 15 min default). Every hold path -- app, AI chat,
            # WhatsApp -- comes through here.
            held_until=datetime.now(timezone.utc) + timedelta(minutes=hold_minutes_for(venue)),
        )
        if name_is_own and player_name and not (player.name or "").strip():
            # set BEFORE the insert so it is committed in the very same transaction as the hold: if the slot is taken the
            # insert rolls back and the name is not saved either
            player.name = player_name
        await self._insert_booking(booking)

        await self.audit.log(
            actor_user_id=player.id,
            actor_type="player",
            action="booking.held",
            entity_type="booking",
            entity_id=booking.id,
            new_value={"status": booking.status.value, "court_id": str(court_id)},
        )
        await self.db.commit()
        return booking

    async def create_walkin(
        self,
        *,
        court_id: uuid.UUID,
        starts_at: datetime,
        player_name: str,
        player_phone: str | None,
        amount_paid: float,
        recorded_by: User,
        method: PaymentMethod = PaymentMethod.CASH_AT_VENUE,
        slot_count: int | None = None,
        legacy_units: bool = False,
    ) -> Booking:
        """The owner/staff records a booking for a customer: `slot_count` consecutive 30-minute slots (None = the court's
        minimum) as ONE booking, validated and priced by the same quote_range as a player's hold (grid, closing time,
        blackouts, already-booked, the court's minimum booking time) but not limited by the player booking horizon.
        `player_name` is who it is for (required); `player_phone` (already normalized to +923XXXXXXXXX by the endpoint
        schema) links the booking to an existing account when one has that number, else the name/phone live on the row."""
        # No walk-ins in the past. The rule is on the 30-minute grid slot the booking STARTS in: a slot that has started but not
        # ended is "in progress" and still allowed (owners log people who have just arrived); a slot that has already ended
        # is refused. Instants are compared in UTC, which is the same instant as Pakistan time, so an overnight court's
        # 1:00 AM slot (which belongs to the previous schedule day) is judged by when it really happens, not by its date.
        if starts_at.tzinfo is not None and starts_at + timedelta(minutes=GRID_MINUTES) <= utc_now():
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.WALKIN_IN_PAST,
                "That time has already passed. A walk-in can be recorded for the slot happening now or a later one.",
            )
        court = await self._load_active_court(court_id)
        quote = await self.availability.quote_range(
            court, starts_at, slot_count, enforce_horizon=False, legacy_units=legacy_units
        )
        ends_at = quote.ends_at
        price = quote.price

        linked_player: User | None = None
        if player_phone:
            linked_player = await self.db.scalar(select(User).where(User.phone == player_phone))

        booking = Booking(
            court_id=court_id,
            player_id=linked_player.id if linked_player else None,
            starts_at=starts_at,
            ends_at=ends_at,
            status=BookingStatus.BOOKED,
            source=BookingSource.WALKIN,
            player_name=player_name,
            player_phone=player_phone,
            price=price,
            advance_amount=amount_paid,
        )
        await self._insert_booking(booking)

        # Section 32 Part 5: the walk-in's amount is a real payment_entries row (method defaults to cash at
        # the venue, the overwhelmingly common case), not a hand-set amount_paid column.
        amount_pkr = int(round(amount_paid))
        if amount_pkr > 0:
            self.db.add(
                PaymentEntry(
                    booking_id=booking.id,
                    amount_pkr=amount_pkr,
                    method=method,
                    recorded_by=recorded_by.id,
                    note="Walk-in booking",
                )
            )
            await self.db.flush()
            await recompute_payment_totals(self.db, booking)

        if linked_player is not None:
            linked_player.total_bookings += 1

        await self.audit.log(
            actor_user_id=recorded_by.id,
            actor_type=recorded_by.role.value,
            action="booking.walkin",
            entity_type="booking",
            entity_id=booking.id,
            new_value={"status": booking.status.value, "amount_paid": amount_paid},
        )
        await self.db.commit()
        return booking

    async def get_booking(self, booking_id: uuid.UUID) -> Booking:
        booking = await self.db.get(Booking, booking_id)
        if booking is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND, "Booking not found")
        return booking

    async def require_accessible_booking(
        self, booking_id: uuid.UUID, user: User, permission: str | None = None
    ) -> Booking:
        booking = await self.get_booking(booking_id)
        if user.role == UserRole.ADMIN:
            return booking
        if booking.player_id == user.id:
            return booking
        court = await self.db.get(Court, booking.court_id)
        if court is not None:
            from app.models.venue import Venue

            venue = await self.db.get(Venue, court.venue_id)
            if venue is not None:
                if venue.owner_id == user.id:
                    return booking
                # A STAFF user reaches a booking through the venue they staff, but
                # only for an action they hold the permission for (Part 12).
                if user.role == UserRole.STAFF and permission is not None:
                    from app.services.staff_service import is_active_staff_of_venue, staff_can

                    if await staff_can(self.db, user.id, venue.id, permission):
                        return booking
                    # Staff of THIS venue without the permission: say so clearly (QA
                    # round 2) instead of "not your booking". Staff of another venue
                    # still get NOT_YOUR_BOOKING below (nothing leaks about the booking).
                    if await is_active_staff_of_venue(self.db, user.id, venue.id):
                        raise AppError(
                            status.HTTP_403_FORBIDDEN,
                            ErrorCode.NOT_STAFF_PERMITTED,
                            "Your account isn't allowed to do this.",
                            details={"permission": permission},
                        )
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_YOUR_BOOKING, "Not your booking")

    async def cancel_booking(
        self, booking: Booking, cancelled_by: CancelledBy, reason: str | None, actor: User | None = None
    ) -> Booking:
        """Idempotent by design: a booking that's already CANCELLED is a
        safe no-op (same booking returned, unchanged) rather than a 400 --
        this matters because both the AI chat tool and a duplicate WhatsApp
        webhook delivery can plausibly call this twice with identical
        arguments (e.g. the caller retries after a timeout it thinks
        failed). Any other non-live status (completed/no_show) is still a
        genuine error, since there's nothing to make idempotent there."""
        if booking.status == BookingStatus.CANCELLED:
            return booking
        if booking.status not in LIVE_BOOKING_STATUSES:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_BOOKING_STATE, "Booking cannot be cancelled"
            )
        if cancelled_by == CancelledBy.PLAYER and booking.status == BookingStatus.BOOKED:
            await self._enforce_cancellation_policy(booking)
        old_status = booking.status
        ok = await self._atomic_transition(
            booking,
            from_statuses=LIVE_BOOKING_STATUSES,
            to_status=BookingStatus.CANCELLED,
            cancelled_by=cancelled_by,
            cancellation_reason=reason,
            held_until=None,
            payment_deadline=None,
        )
        if not ok:
            # booking.status was live a moment ago (checked above) but isn't
            # any more -- a concurrent request beat us to it. If that request
            # was itself a cancel, this call is still a safe no-op (this
            # method's own idempotency contract); anything else (e.g. a
            # no-show/completion mark landing in between) is a genuine
            # conflict, not something to silently paper over.
            await self.db.refresh(booking)
            if booking.status == BookingStatus.CANCELLED:
                return booking
            raise AppError(
                status.HTTP_409_CONFLICT, ErrorCode.INVALID_BOOKING_STATE, "Booking cannot be cancelled"
            )
        self.created_refund = None
        if old_status == BookingStatus.BOOKED:
            # Money-correctness fix: an OWNER cancelling a paid (booked) booking owes the player a refund
            # exactly like a player cancel does (previously only PLAYER cancels were flagged).
            self.created_refund = await self._flag_refund_for_voluntary_cancel(booking, cancelled_by)
        # audit 2026-10-28 item 8: the REAL person (owner / staff / admin / the player), not always the booking's player
        await self.audit.log(
            actor_user_id=actor.id if actor is not None else booking.player_id,
            actor_type=actor.role.value if actor is not None else cancelled_by.value,
            action="booking.cancelled",
            entity_type="booking",
            entity_id=booking.id,
            old_value={"status": old_status.value},
            new_value={"status": booking.status.value, "reason": reason, "cancelled_by": cancelled_by.value},
        )
        await self.db.commit()
        await self.db.refresh(booking)
        return booking

    async def _enforce_cancellation_policy(self, booking: Booking) -> None:
        """A player cancelling an already-PAID (booked) booking is gated by the VENUE's policy
        (Section 32 Part 4 -- one policy per venue, reversing Section 31's per-court policy):
        some venues don't allow it at all, others allow it up to a configured number of hours
        before start. Reads `venues.cancellation_*` only; the old per-court columns are deprecated
        and never consulted, so there is one source of truth. A plain pre-check, not the
        atomic-transition pattern -- this is a business-rule gate, not a concurrency-integrity
        concern (nothing bad happens if the policy changes between this check and the commit; the
        worst case is a cancel that was allowed a moment ago and no longer is, which is an
        acceptable, narrow race for a setting an owner rarely touches)."""
        from app.models.venue import Venue

        court = await self.db.get(Court, booking.court_id)
        if court is None:
            return
        venue = await self.db.get(Venue, court.venue_id)
        if venue is None:
            return
        if not venue.cancellation_allowed:
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.CANCELLATION_NOT_ALLOWED,
                "This venue doesn't allow cancelling a booking once it's paid for.",
            )
        if venue.cancellation_cutoff_hours is not None:
            cutoff_at = booking.starts_at - timedelta(hours=venue.cancellation_cutoff_hours)
            if datetime.now(timezone.utc) >= cutoff_at:
                raise AppError(
                    status.HTTP_400_BAD_REQUEST,
                    ErrorCode.CANCELLATION_WINDOW_CLOSED,
                    f"The cancellation window for this booking closed {format_when(cutoff_at)} "
                    f"({venue.cancellation_cutoff_hours}h before the booking).",
                    details={"cutoff_at": cutoff_at.isoformat(), "cutoff_hours": venue.cancellation_cutoff_hours},
                )

    async def _flag_refund_for_voluntary_cancel(
        self, booking: Booking, cancelled_by: CancelledBy = CancelledBy.PLAYER
    ) -> None:
        """Same underlying gap as _flag_unclaimed_payments (finding #5),
        for the voluntary-cancellation path (finding #13): a player who
        cancels a booking they already paid the advance on gets that money
        back only via an out-of-band conversation with the venue --
        nothing else here tracks that a refund is owed. Reuses the same
        payment_disputes queue/table rather than a parallel one."""
        payment = await self.db.scalar(
            select(Payment)
            .where(Payment.booking_id == booking.id, Payment.review_verdict == "approved")
            .order_by(Payment.reviewed_at.desc())
            .limit(1)
        )
        if payment is None:
            return None
        dispute = PaymentDispute(
                booking_id=booking.id,
                payment_id=payment.id,
                player_id=booking.player_id,
                reason=f"{cancelled_by.value}_cancelled_paid_booking",
                # Section 32 Part 10: a voluntary cancel that reaches this point already
                # passed _enforce_cancellation_policy, so it's always fully refundable --
                # there's no code path where a cancel succeeds "inside the cutoff" for a
                # partial/non-refundable amount to apply to (the cutoff blocks the cancel
                # outright instead). Refund owed = whatever was actually paid.
                # `booking.amount_paid` is the ledger sum (payment_entries), which since the money-correctness
                # fix is the REAL amount the player paid (capped at the price), cash entries included.
                refund_amount=booking.amount_paid,
            )
        self.db.add(dispute)
        return dispute

    async def confirm_booking(
        self,
        booking: Booking,
        recorded_by: User | None = None,
        amount_pkr: int | None = None,
        payment: Payment | None = None,
    ) -> Booking:
        """Called once an owner (or auto-approve) verifies the advance
        payment. Guarded by a conditional UPDATE (see _atomic_transition) so
        a double-tap approve, two concurrent approve requests, or an approve
        racing a cancel can never both take effect -- raises
        BOOKING_ALREADY_CANCELLED if the booking's live status has already
        moved past HELD/PAYMENT_SUBMITTED by the time this runs, instead of
        blindly overwriting whatever it actually is now.

        Section 32 Part 5: `amount_paid` is no longer set directly here -- it's always the sum of
        `payment_entries` (see `recompute_payment_totals`), so confirming a booking records a payment_entries
        row for the advance instead. `recorded_by` is the owner who approved the payment proof, or None for
        an auto-approval (nobody clicked anything)."""
        ok = await self._atomic_transition(
            booking,
            from_statuses=(BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED),
            to_status=BookingStatus.BOOKED,
            payment_deadline=None,
        )
        if not ok:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.BOOKING_ALREADY_CANCELLED,
                "This booking is no longer awaiting payment review",
            )
        # Money-correctness fix: credit what the player REALLY paid (`amount_pkr`: owner-confirmed, or the OCR
        # amount, resolved by PaymentService), not blindly the expected advance. Anything above the booking
        # price is capped in the ledger and the excess is queued as a refund owed (`overpayment_excess`).
        expected = int(round(float(booking.advance_amount)))
        paid = int(round(amount_pkr)) if amount_pkr is not None else expected
        price_int = int(round(float(booking.price)))
        credited = min(paid, price_int)
        excess = paid - credited
        if credited > 0:
            ocr_text = ""
            if payment is not None and payment.ocr_amount is not None:
                ocr_text = f" Screenshot showed PKR {int(round(float(payment.ocr_amount))):,}."
            excess_text = f" Excess PKR {excess:,} queued as a refund owed." if excess > 0 else ""
            self.db.add(
                PaymentEntry(
                    booking_id=booking.id,
                    amount_pkr=credited,
                    method=PaymentMethod.BANK_TRANSFER_PROOF,
                    recorded_by=recorded_by.id if recorded_by else None,
                    note=(
                        ("Advance payment approved." if recorded_by else "Advance payment auto-approved.")
                        + f" Expected PKR {expected:,}.{ocr_text} Paid PKR {paid:,}. Credited PKR {credited:,}.{excess_text}"
                    ),
                )
            )
            await self.db.flush()
            await recompute_payment_totals(self.db, booking)
        if excess > 0 and payment is not None:
            self.db.add(
                PaymentDispute(
                    booking_id=booking.id,
                    payment_id=payment.id,
                    player_id=booking.player_id,
                    reason="overpayment_excess",
                    refund_amount=excess,
                )
            )
        if booking.player_id is not None:
            player = await self.db.get(User, booking.player_id)
            if player is not None:
                player.total_bookings += 1
        await self.audit.log(
            # audit 2026-10-28 item 8: the owner/staff who approved (None = auto-approve, then the system)
            actor_user_id=recorded_by.id if recorded_by is not None else booking.player_id,
            actor_type=recorded_by.role.value if recorded_by is not None else "system",
            action="booking.confirmed",
            entity_type="booking",
            entity_id=booking.id,
            new_value={"status": booking.status.value},
        )
        await self.db.commit()
        await self.db.refresh(booking)
        return booking

    async def mark_payment_submitted(self, booking: Booking) -> Booking:
        """Guarded the same way as confirm_booking: only a booking that's
        still HELD can move to payment_submitted. A late/slow duplicate call
        for a booking that's already moved on (e.g. a second concurrent
        submit_payment's call landing after the first one was auto-approved
        straight to BOOKED) is silently a no-op instead of resetting an
        already-confirmed booking back to payment_submitted."""
        # Round 2 Stage 2: auto-cancel at the venue's effective minutes after the screenshot (null = the 120-minute
        # default = the old PAYMENT_REVIEW_HOURS); auto-cancel switched off = no deadline, the slot stays held.
        from app.models.venue import Venue

        court = await self.db.get(Court, booking.court_id)
        venue = await self.db.get(Venue, court.venue_id) if court is not None else None
        ok = await self._atomic_transition(
            booking,
            from_statuses=(BookingStatus.HELD,),
            to_status=BookingStatus.PAYMENT_SUBMITTED,
            held_until=None,
            payment_deadline=payment_deadline_for(venue, datetime.now(timezone.utc)),
        )
        if not ok:
            logger.warning(
                "booking_service.mark_payment_submitted_noop",
                booking_id=str(booking.id),
                actual_status=booking.status.value,
            )
            return booking
        await self.audit.log(
            actor_user_id=booking.player_id,
            actor_type="player",
            action="booking.payment_submitted",
            entity_type="booking",
            entity_id=booking.id,
            new_value={"status": booking.status.value},
        )
        await self.db.commit()
        await self.db.refresh(booking)
        return booking

    async def _do_check_in(self, booking: Booking, actor: str, actor_user: User | None = None) -> Booking:
        """Shared by the owner-scan (`check_in`) and player-self-scan
        (`check_in_self`) paths -- see finding #17 in AUDIT_FINDINGS.md.
        Idempotent: whichever happens first wins; a second attempt via
        either path is a safe no-op, not an error, consistent with this
        codebase's other idempotency conventions (cancel_booking,
        expire_stale_bookings)."""
        if booking.checked_in_at is not None:
            return booking
        if booking.status != BookingStatus.BOOKED:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_BOOKING_STATE, "Only booked slots can be checked in"
            )
        now = datetime.now(timezone.utc)
        booking.checked_in_at = now
        booking.checked_in_by = actor
        booking.status = BookingStatus.COMPLETED

        # Flag, don't block: an implausibly-timed check-in (well before the
        # slot starts, or well after it should have ended) is a signal for
        # an admin to spot-check, not a reason to reject the check-in --
        # same "flag, don't block" pattern as the passive-owner-inaction
        # signal (finding #14).
        grace = timedelta(minutes=self.settings.NO_SHOW_GRACE_MINUTES)
        if now < booking.starts_at - grace or now > booking.ends_at + grace:
            booking.checkin_flag_reason = "implausible_timing"

        await self.audit.log(
            # audit 2026-10-28 item 8: the owner/staff member who checked the player in (self check-in: the player)
            actor_user_id=actor_user.id if actor_user is not None else booking.player_id,
            actor_type=actor_user.role.value if actor_user is not None else actor,
            action="booking.checked_in",
            entity_type="booking",
            entity_id=booking.id,
            new_value={"status": booking.status.value, "checked_in_at": now.isoformat(), "checked_in_by": actor},
        )
        await self.db.commit()
        await self.db.refresh(booking)
        return booking

    async def check_in(self, booking: Booking, actor_user: User | None = None) -> Booking:
        """Owner (or staff with check_in) scans the player's QR from My Bookings."""
        return await self._do_check_in(booking, "owner", actor_user)

    async def check_in_self(self, booking: Booking, venue_qr_token: uuid.UUID) -> Booking:
        """Player scans a QR physically posted at the venue -- an
        alternative check-in path that, unlike `check_in`, requires the
        player's own physical presence at the venue rather than the
        owner's attention (see finding #17)."""
        from app.models.venue import Venue

        court = await self.db.get(Court, booking.court_id)
        venue = await self.db.get(Venue, court.venue_id) if court is not None else None
        if venue is None or venue.checkin_qr_token != venue_qr_token:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_CHECKIN_CODE, "Invalid venue check-in code"
            )
        return await self._do_check_in(booking, "player")

    async def owner_mark_no_show(self, booking: Booking, actor: User | None = None) -> Booking:
        """Round 2 Stage 2 (spec C.3): the owner (or staff with check-in / record-payments permission) says "Nahi
        aaye". Allowed from BOOKED only and only once the slot has ENDED (the expiry job no longer marks no-shows by
        itself). Audited with who/when. A wrong no-show is fixed with Haan/Nahi (no_show -> completed)."""
        if booking.status != BookingStatus.BOOKED:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_BOOKING_STATE, "Only booked slots can be marked no-show"
            )
        if datetime.now(timezone.utc) < booking.ends_at:
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.TOO_EARLY_FOR_NO_SHOW,
                "This booking's time has not ended yet",
                details={"ends_at": booking.ends_at.isoformat()},
            )
        return await self.mark_no_show(booking, actor=actor)

    async def mark_no_show(self, booking: Booking, actor: User | None = None) -> Booking:
        ok = await self._atomic_transition(
            booking, from_statuses=(BookingStatus.BOOKED,), to_status=BookingStatus.NO_SHOW
        )
        if not ok:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_BOOKING_STATE, "Only booked slots can be marked no-show"
            )
        if booking.player_id is not None:
            player = await self.db.get(User, booking.player_id)
            if player is not None:
                player.total_no_shows += 1
                recompute_reliability(player)
        await self.audit.log(
            actor_user_id=actor.id if actor is not None else booking.player_id,
            actor_type=actor.role.value if actor is not None else "system",
            action="booking.no_show",
            entity_type="booking",
            entity_id=booking.id,
            old_value={"status": BookingStatus.BOOKED.value},
            new_value={
                "status": booking.status.value,
                "marked_by": str(actor.id) if actor is not None else None,
                "marked_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self.db.commit()
        await self.db.refresh(booking)
        return booking

    async def mark_completed(self, booking: Booking, actor: User | None = None) -> Booking:
        """Round 2 Stage 2 (spec C.3): the owner's Haan/Nahi on a finished booking settles its status as COMPLETED,
        from BOOKED or from NO_SHOW (fixing an old automatic no-show; the player's no-show count is given back).
        `completed` is an existing booking_status value and no constraint/guard forbids these transitions; the
        slot stays taken for availability purposes only while live, and the slot has ended anyway. Idempotent on an
        already-completed booking. Audited with who/when."""
        if booking.status == BookingStatus.COMPLETED:
            return booking
        old = booking.status
        ok = await self._atomic_transition(
            booking, from_statuses=(BookingStatus.BOOKED, BookingStatus.NO_SHOW), to_status=BookingStatus.COMPLETED
        )
        if not ok:
            raise AppError(
                status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_BOOKING_STATE, "Only booked slots can be completed"
            )
        if old == BookingStatus.NO_SHOW and booking.player_id is not None:
            player = await self.db.get(User, booking.player_id)
            if player is not None and player.total_no_shows > 0:
                player.total_no_shows -= 1
                recompute_reliability(player)
        await self.audit.log(
            actor_user_id=actor.id if actor is not None else None,
            actor_type=actor.role.value if actor is not None else "system",
            action="booking.completed",
            entity_type="booking",
            entity_id=booking.id,
            old_value={"status": old.value},
            new_value={
                "status": booking.status.value,
                "marked_by": str(actor.id) if actor is not None else None,
                "marked_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await self.db.commit()
        await self.db.refresh(booking)
        return booking

    async def expire_stale_bookings(self) -> list[Booking]:
        """Cancel HELD bookings past their hold window and PAYMENT_SUBMITTED
        bookings the owner never actioned within the review window.

        Each branch is a single atomic `UPDATE ... WHERE status = <status>
        AND <deadline> < now() RETURNING *`, not a SELECT-then-mutate-then-
        commit. That distinction matters: a plain ORM SELECT, mutate in
        Python, then `commit()` issues its UPDATE keyed only on the primary
        key, so it blindly overwrites whatever the row's live status became
        in the meantime -- e.g. a payment submitted concurrently with this
        job run (HELD -> PAYMENT_SUBMITTED) would get silently cancelled
        instead of left for review, a lost-update race under READ COMMITTED.
        Keeping `status = <status>` in the UPDATE's own WHERE clause means
        Postgres re-checks it against the row's current committed value at
        write time (EvalPlanQual), so a status that moved out from under us
        is a no-op here, not a lost update -- the same "let the DB enforce
        it" pattern as `one_live_booking_per_slot`, just via a conditional
        UPDATE instead of a unique index."""
        now = datetime.now(timezone.utc)

        held_result = await self.db.execute(
            update(Booking)
            .where(
                Booking.status == BookingStatus.HELD,
                Booking.held_until.is_not(None),
                Booking.held_until < now,
            )
            .values(
                status=BookingStatus.CANCELLED,
                cancelled_by=CancelledBy.SYSTEM,
                cancellation_reason="hold_expired",
                held_until=None,
                payment_deadline=None,
            )
            .returning(Booking)
        )
        expired = list(held_result.scalars().all())

        review_result = await self.db.execute(
            update(Booking)
            .where(
                Booking.status == BookingStatus.PAYMENT_SUBMITTED,
                Booking.payment_deadline.is_not(None),
                Booking.payment_deadline < now,
            )
            .values(
                status=BookingStatus.CANCELLED,
                cancelled_by=CancelledBy.SYSTEM,
                cancellation_reason="payment_review_expired",
                held_until=None,
                payment_deadline=None,
            )
            .returning(Booking)
        )
        review_expired = list(review_result.scalars().all())
        expired.extend(review_expired)

        for booking in expired:
            await self.audit.log(
                actor_user_id=None,
                actor_type="system",
                action="booking.expired",
                entity_type="booking",
                entity_id=booking.id,
                new_value={"status": booking.status.value},
            )

        await self._flag_unclaimed_payments(review_expired)

        if expired:
            await self.db.commit()
        return expired

    async def _flag_unclaimed_payments(self, review_expired: list[Booking]) -> None:
        """A payment_submitted booking that expires because the owner never
        acted is not necessarily a no-op for the player: if the submitted
        proof's own OCR read looked like a genuine payment (not flagged as a
        duplicate, and not an outright amount mismatch), the player likely
        transferred real money and got nothing for it. Nothing in this
        codebase otherwise records that -- write a PaymentDispute row so an
        admin has a queue of these to chase down manually (see finding #5 in
        AUDIT_FINDINGS.md). A `mismatch` verdict is excluded on purpose: that
        shape of proof is exactly what a genuinely-wrong/no payment looks
        like, so there's nothing here worth an admin's time to chase."""
        if not review_expired:
            return
        booking_ids = [b.id for b in review_expired]
        result = await self.db.execute(
            select(Payment).where(
                Payment.booking_id.in_(booking_ids),
                Payment.review_verdict.is_(None),
                Payment.is_duplicate.is_(False),
                Payment.ocr_verdict.is_distinct_from("mismatch"),
            )
        )
        for payment in result.scalars().all():
            booking = next(b for b in review_expired if b.id == payment.booking_id)
            self.db.add(
                PaymentDispute(
                    booking_id=booking.id,
                    payment_id=payment.id,
                    player_id=booking.player_id,
                    reason="payment_review_expired",
                    # Section 32 Part 10: the payment was never approved (that's exactly
                    # why this queue exists), so `booking.amount_paid` is still 0 -- the
                    # player may well have transferred real money, but nothing in this
                    # app ever recorded it as paid. Refund owed is 0 by definition here;
                    # this is this codebase's real instance of a "non-refundable advance."
                    refund_amount=0,
                )
            )

    async def list_for_player(
        self, player_id: uuid.UUID, *, when: str = "all", offset: int = 0, limit: int = 20
    ) -> list[Booking]:
        query = select(Booking).where(Booking.player_id == player_id)
        now = datetime.now(timezone.utc)
        if when == "upcoming":
            query = query.where(Booking.starts_at >= now).order_by(Booking.starts_at.asc())
        elif when == "past":
            query = query.where(Booking.starts_at < now).order_by(Booking.starts_at.desc())
        else:
            query = query.order_by(Booking.starts_at.desc())
        result = await self.db.execute(query.offset(offset).limit(limit))
        return list(result.scalars().all())

    async def list_live_future_bookings_for_court(self, court_id: uuid.UUID) -> list[Booking]:
        """Live bookings (held/payment_submitted/booked) whose slot hasn't
        happened yet, for a specific court -- used when a court is
        deactivated (finding #27) to find who needs to be told, since
        deactivating a court doesn't touch these rows at all otherwise."""
        result = await self.db.execute(
            select(Booking).where(
                Booking.court_id == court_id,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
                Booking.starts_at > datetime.now(timezone.utc),
            )
        )
        return list(result.scalars().all())
