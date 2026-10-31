"""Per-staff activity for the owner / admin staff dashboard (audit 2026-10-28 item 16). READ-ONLY.

Built only from what is already recorded -- no new table, no migration:
- `audit_log` (actor_id = who did it): booking.completion_marked (bookings marked; result "no" = a short payment, "kam mila"),
  booking.no_show, booking.checked_in, booking.walkin, refund.marked_paid;
- `payment_entries.recorded_by`: cash recorded (cash_at_venue) and transfers credited (bank_transfer_proof, the approver).

Everything is scoped to ONE venue (audit rows / entries whose booking is on one of its courts) and a Pakistan date range on
when the action happened. The owner's own actions are listed as a row too, so the totals add up.

Known gap (documented, not hidden): rows written before 2026-10-28 for owner/staff check-ins and cancels named the player,
not the staff member (fixed going forward by item 8); those old check-ins count under nobody.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError, ErrorCode
from app.models.audit import AuditLog
from app.models.booking import Booking
from app.models.court import Court
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.utils.timezone import pkt_time_to_utc, pkt_today

ACTIONS = ("booking.completion_marked", "booking.no_show", "booking.checked_in", "booking.walkin", "refund.marked_paid")
MAX_RANGE_DAYS = 92


async def _venue_for(db: AsyncSession, actor: User, venue_id: uuid.UUID | None) -> Venue:
    if actor.role == UserRole.ADMIN:
        if venue_id is None:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Please choose which venue.")
        venue = await db.get(Venue, venue_id)
    elif actor.role == UserRole.OWNER:
        query = select(Venue).where(Venue.owner_id == actor.id)
        if venue_id is not None:
            query = query.where(Venue.id == venue_id)
        venue = (await db.execute(query.order_by(Venue.created_at).limit(1))).scalar_one_or_none()
    else:
        # staff never see each other's numbers
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_STAFF_PERMITTED, "Your account isn't allowed to do this.")
    if venue is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
    return venue


def _range(date_from: date | None, date_to: date | None) -> tuple[date, date, datetime, datetime]:
    end = date_to or pkt_today()
    start = date_from or (end - timedelta(days=29))
    if start > end:
        start, end = end, start
    if (end - start).days > MAX_RANGE_DAYS:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, f"Pick at most {MAX_RANGE_DAYS} days.")
    return start, end, pkt_time_to_utc(start, time(0, 0)), pkt_time_to_utc(end + timedelta(days=1), time(0, 0))


def _empty_row(user: User | None, uid: uuid.UUID | None) -> dict:
    return {
        "user_id": uid,
        "name": (user.name if user else None) or (user.phone if user else None),
        "role": user.role.value if user else "unknown",
        "bookings_marked": 0,
        "no_shows": 0,
        "check_ins": 0,
        "walkins": 0,
        "short_payments": 0,
        "short_amount_pkr": 0,
        "cash_entries": 0,
        "cash_pkr": 0,
        "transfers": 0,
        "transfers_pkr": 0,
        "refunds_paid_pkr": 0,
        "total_recorded_pkr": 0,
        "bank_missing": 0,
        "bank_missing_pkr": 0,
        "bank_missing_open": 0,
    }


async def staff_activity(
    db: AsyncSession, actor: User, venue_id: uuid.UUID | None, date_from: date | None, date_to: date | None
) -> dict:
    venue = await _venue_for(db, actor, venue_id)
    start, end, t0, t1 = _range(date_from, date_to)
    venue_bookings = select(Booking.id).join(Court, Court.id == Booking.court_id).where(Court.venue_id == venue.id)

    audits = (
        await db.execute(
            select(AuditLog)
            .where(
                AuditLog.entity_type.in_(("booking", "payment_dispute", "dispute")),
                AuditLog.action.in_(ACTIONS),
                AuditLog.created_at >= t0,
                AuditLog.created_at < t1,
            )
            .order_by(AuditLog.created_at)
        )
    ).scalars().all()
    booking_ids = set((await db.execute(venue_bookings)).scalars().all())
    audits = [a for a in audits if a.entity_type != "booking" or a.entity_id in booking_ids]
    # refund.marked_paid points at a dispute; keep it only when that dispute's booking is at this venue
    dispute_rows = [a for a in audits if a.action == "refund.marked_paid"]
    if dispute_rows:
        from app.models.dispute import PaymentDispute

        ids = {a.entity_id for a in dispute_rows}
        ok = set(
            (
                await db.execute(select(PaymentDispute.id).where(PaymentDispute.id.in_(ids), PaymentDispute.booking_id.in_(booking_ids)))
            ).scalars().all()
        )
        audits = [a for a in audits if a.action != "refund.marked_paid" or a.entity_id in ok]

    entries = (
        await db.execute(
            select(PaymentEntry).where(
                PaymentEntry.booking_id.in_(venue_bookings),
                PaymentEntry.created_at >= t0,
                PaymentEntry.created_at < t1,
                PaymentEntry.recorded_by.is_not(None),
            )
        )
    ).scalars().all()

    # audit fixes 2026-10-31 (b): transfers marked "bank mein nahi mila", under the person who approved the screenshot
    from app.services.bank_missing_service import for_venue as bank_missing_for_venue

    bank_missing = await bank_missing_for_venue(db, venue.id, t0, t1)
    actor_ids = (
        {a.actor_id for a in audits if a.actor_id}
        | {e.recorded_by for e in entries if e.recorded_by}
        | {m["approved_by_id"] for m in bank_missing if m["approved_by_id"]}
    )
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all()} if actor_ids else {}
    # player-actor rows (self check-in, or pre-fix rows that named the player) are not staff activity
    def counted(uid: uuid.UUID | None) -> bool:
        u = users.get(uid) if uid else None
        return u is not None and u.role in (UserRole.OWNER, UserRole.STAFF, UserRole.ADMIN)

    rows: dict[uuid.UUID, dict] = {}

    def row(uid: uuid.UUID) -> dict:
        if uid not in rows:
            rows[uid] = _empty_row(users.get(uid), uid)
        return rows[uid]

    prices = {
        b.id: b
        for b in (
            await db.execute(select(Booking).where(Booking.id.in_({a.entity_id for a in audits if a.entity_type == "booking"})))
        ).scalars().all()
    } if audits else {}

    no_shows: list[dict] = []
    for a in audits:
        if not counted(a.actor_id):
            continue
        r = row(a.actor_id)
        if a.action == "booking.completion_marked":
            r["bookings_marked"] += 1
            value = a.new_value or {}
            if value.get("result") == "no":
                booking = prices.get(a.entity_id)
                received = int(value.get("received_pkr") or 0)
                short = max(int(round(float(booking.price))) - received, 0) if booking is not None else 0
                r["short_payments"] += 1
                r["short_amount_pkr"] += short
        elif a.action == "booking.no_show":
            r["no_shows"] += 1
            booking = prices.get(a.entity_id)
            no_shows.append({"booking_id": a.entity_id, "marked_at": a.created_at, "marked_by": a.actor_id, "booking": booking})
        elif a.action == "booking.checked_in":
            r["check_ins"] += 1
        elif a.action == "booking.walkin":
            r["walkins"] += 1
        elif a.action == "refund.marked_paid":
            r["refunds_paid_pkr"] += int(round(float((a.new_value or {}).get("this_payment") or 0)))

    for e in entries:
        if not counted(e.recorded_by):
            continue
        r = row(e.recorded_by)
        if e.method == PaymentMethod.CASH_AT_VENUE and e.amount_pkr > 0:
            r["cash_entries"] += 1
            r["cash_pkr"] += e.amount_pkr
        elif e.method == PaymentMethod.BANK_TRANSFER_PROOF and e.amount_pkr > 0:
            r["transfers"] += 1
            r["transfers_pkr"] += e.amount_pkr
    for m in bank_missing:
        if not counted(m["approved_by_id"]):
            continue
        r = row(m["approved_by_id"])
        r["bank_missing"] += 1
        r["bank_missing_pkr"] += m["amount_pkr"]
        if m["decision"] is None:
            r["bank_missing_open"] += 1
    for r in rows.values():
        r["total_recorded_pkr"] = r["cash_pkr"] + r["transfers_pkr"]

    court_names = {
        c.id: c.name for c in (await db.execute(select(Court).where(Court.venue_id == venue.id))).scalars().all()
    }
    player_ids = {n["booking"].player_id for n in no_shows if n["booking"] is not None and n["booking"].player_id}
    player_names = (
        {u.id: (u.name or u.phone) for u in (await db.execute(select(User).where(User.id.in_(player_ids)))).scalars().all()}
        if player_ids
        else {}
    )
    # audit Phase 3 item 6: the player's "Main aaya tha" and the GPS verdict ("near" = shown in red)
    from app.services.phase3_service import noshow_details

    details = await noshow_details(db, [n["booking_id"] for n in no_shows])
    no_show_out = []
    for n in sorted(no_shows, key=lambda x: x["marked_at"], reverse=True):
        b = n["booking"]
        by = users.get(n["marked_by"])
        no_show_out.append(
            {
                "booking_id": n["booking_id"],
                "player_name": (b.player_name or player_names.get(b.player_id)) if b is not None else None,
                "court_name": court_names.get(b.court_id) if b is not None else None,
                "starts_at": b.starts_at if b is not None else None,
                "marked_by_name": (by.name or by.phone) if by else None,
                "marked_by_role": by.role.value if by else None,
                "marked_at": n["marked_at"],
                **details.get(n["booking_id"], {}),
            }
        )
    ordered = sorted(rows.values(), key=lambda r: (r["role"] != "owner", (r["name"] or "").lower()))
    totals = {k: sum(r[k] for r in ordered) for k in _empty_row(None, None) if k not in ("user_id", "name", "role")}
    return {
        "venue_id": venue.id,
        "date_from": start,
        "date_to": end,
        "people": ordered,
        "totals": totals,
        "no_shows": no_show_out,
        "bank_missing": bank_missing,
    }
