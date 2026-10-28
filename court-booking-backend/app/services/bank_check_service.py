"""audit 2026-10-28 Phase 3 item 2: the owner's daily "bank se mila lein" list -- every transfer credited on one Pakistan day
(advance or balance screenshots approved, bank_transfer_proof ledger entries), to tick off against the bank statement. Read-only."""

from __future__ import annotations

import uuid
from datetime import date, time, timedelta

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError, ErrorCode
from app.models.booking import Booking
from app.models.court import Court
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.utils.timezone import pkt_time_to_utc, pkt_today


async def bank_check(db: AsyncSession, actor: User, venue_id: uuid.UUID | None, day: date | None) -> dict:
    from app.services.owner_overview_service import short_code
    from app.services.staff_service import staffed_venue_ids

    day = day or pkt_today()
    if actor.role == UserRole.STAFF:
        allowed = await staffed_venue_ids(db, actor.id, "view_ledger")
        if venue_id is None or venue_id not in allowed:
            raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_STAFF_PERMITTED, "Your account isn't allowed to do this.")
        venue = await db.get(Venue, venue_id)
    elif actor.role == UserRole.ADMIN:
        if venue_id is None:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Please choose which venue.")
        venue = await db.get(Venue, venue_id)
    else:
        q = select(Venue).where(Venue.owner_id == actor.id)
        if venue_id is not None:
            q = q.where(Venue.id == venue_id)
        venue = (await db.execute(q.order_by(Venue.created_at).limit(1))).scalar_one_or_none()
    if venue is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
    t0, t1 = pkt_time_to_utc(day, time(0, 0)), pkt_time_to_utc(day + timedelta(days=1), time(0, 0))
    rows = (
        await db.execute(
            select(PaymentEntry, Booking, Court)
            .join(Booking, Booking.id == PaymentEntry.booking_id)
            .join(Court, Court.id == Booking.court_id)
            .where(
                Court.venue_id == venue.id,
                PaymentEntry.method == PaymentMethod.BANK_TRANSFER_PROOF,
                PaymentEntry.amount_pkr > 0,
                PaymentEntry.created_at >= t0,
                PaymentEntry.created_at < t1,
            )
            .order_by(PaymentEntry.created_at)
        )
    ).all()
    user_ids = {e.recorded_by for e, _b, _c in rows if e.recorded_by} | {b.player_id for _e, b, _c in rows if b.player_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()} if user_ids else {}
    items = []
    for entry, booking, court in rows:
        player = users.get(booking.player_id) if booking.player_id else None
        by = users.get(entry.recorded_by) if entry.recorded_by else None
        items.append(
            {
                "entry_id": entry.id,
                "booking_id": booking.id,
                "code": short_code(booking.id),
                "player_name": booking.player_name or (player.name if player else None),
                "court_name": court.name,
                "starts_at": booking.starts_at,
                "amount_pkr": entry.amount_pkr,
                "credited_at": entry.created_at,
                "approved_by": (by.name or by.phone) if by else "auto",
                "kind": "balance" if (entry.note or "").startswith("Balance") else "advance",
            }
        )
    return {"venue_id": venue.id, "date": day, "items": items, "total_pkr": sum(i["amount_pkr"] for i in items)}
