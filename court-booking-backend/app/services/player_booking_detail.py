"""The player's own booking detail (audit 2026-10-28 item 4): everything one booking needs on one screen -- venue, court,
sport, time, duration, money (total / paid / due and every payment line), the status timeline, the cancellation policy and
the venue's contact. Read-only. The timeline reuses the owner detail's builder, without staff names (who at the venue did
what is the venue's business, not the player's)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.audit import AuditLog
from app.models.booking import BookingStatus
from app.models.court import Court
from app.models.payment_entry import PaymentEntry
from app.models.user import User
from app.models.venue import Venue
from app.schemas.booking import (
    BookingOut,
    PlayerBookingCourtOut,
    PlayerBookingDetailOut,
    PlayerBookingVenueOut,
    PlayerPaymentLineOut,
    PlayerRefundOut,
    PlayerRefundRequestOut,
    PlayerTimelineEventOut,
)
from app.services.booking_service import BookingService
from app.services.owner_overview_service import COMPLETION_ACTION, CONFIRMED_VALUES, OwnerOverviewService


async def player_booking_detail(db: AsyncSession, settings: Settings, user: User, booking_id: uuid.UUID) -> PlayerBookingDetailOut:
    booking = await BookingService(db, settings).require_accessible_booking(booking_id, user)
    court = await db.get(Court, booking.court_id)
    venue = await db.get(Venue, court.venue_id)
    overview = OwnerOverviewService(db, settings)
    payments, audit_rows, dispute, names = await overview._detail_parts(booking)

    cancel_log = next((a for a in reversed(audit_rows) if a.action in ("booking.cancelled", "booking.expired")), None)

    class _Cancel:  # the timeline builder only reads `.at`
        at = cancel_log.created_at if cancel_log else booking.updated_at

    cancellation = _Cancel() if booking.status == BookingStatus.CANCELLED else None
    completion_logs: list[AuditLog] = [a for a in audit_rows if a.action == COMPLETION_ACTION]
    if booking.status.value not in CONFIRMED_VALUES:
        completion_logs = []
    events = overview._timeline(
        booking, payments, audit_rows, dispute, cancellation, completion_logs, names, datetime.now(timezone.utc)
    )
    state, amount = await BookingService(db, settings).refund_request_state(booking)
    entries = (
        await db.execute(select(PaymentEntry).where(PaymentEntry.booking_id == booking.id).order_by(PaymentEntry.created_at))
    ).scalars().all()
    return PlayerBookingDetailOut(
        booking=BookingOut.model_validate(booking),
        venue=PlayerBookingVenueOut(
            id=venue.id,
            name=venue.name,
            slug=venue.slug,
            area=venue.area,
            city=venue.city,
            address=venue.address,
            phone=venue.phone,
            whatsapp=venue.whatsapp,
            cancellation_allowed=bool(venue.cancellation_allowed),
            cancellation_cutoff_hours=venue.cancellation_cutoff_hours,
        ),
        court=PlayerBookingCourtOut(id=court.id, name=court.name, sport=court.sport, is_indoor=bool(court.is_indoor)),
        duration_minutes=int((booking.ends_at - booking.starts_at).total_seconds() // 60),
        payments=[
            PlayerPaymentLineOut(at=e.created_at, amount=e.amount_pkr, method=e.method, is_reversal=e.reverses_entry_id is not None)
            for e in entries
        ],
        timeline=[PlayerTimelineEventOut(at=e.at, kind=e.kind, amount=e.amount, note=e.note) for e in events],
        refund_request=PlayerRefundRequestOut(state=state, amount=amount),
        refund=(
            PlayerRefundOut(
                amount=float(dispute.refund_amount or 0),
                status="owed" if dispute.refund_status == "owed" else "paid",
                paid_at=dispute.refunded_at,
            )
            if dispute is not None
            else None
        ),
    )
