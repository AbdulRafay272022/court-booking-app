"""audit fixes 2026-10-31 (b): a balance / no-show-reversal transfer that staff approved at the venue but that never reached
the bank. No new table, no migration:

- the owner marks it in "Bank se mila lein" -> a reversing ledger entry (`reverses_entry_id` = the transfer's entry, the
  money is no longer counted) + audit row `bank.not_received` on that entry. The player is NOT messaged;
- it shows in red on "Staff ka kaam" under the staff member who approved the screenshot (the entry's `recorded_by`);
- the owner decides once (audit row `bank.not_received_decided`):
    staff  -> "Staff se wasool karein": an `other` ledger entry for the amount (the venue collects it from that staff member;
              the player owes nothing and hears nothing);
    player -> "Player se baqi maangein": the normal short-payment flow starts (Sahi hai / Ghalat hai, +5 / -20, carried due).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.audit import AuditLog
from app.models.booking import Booking
from app.models.court import Court
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import User, UserRole
from app.models.venue import Venue

MARKED = "bank.not_received"
DECIDED = "bank.not_received_decided"
REVERSAL_NOTE = "Bank mein nahi mila"
DECISIONS = ("staff", "player")


def is_balance_entry(entry: PaymentEntry) -> bool:
    """Only balance / no-show-reversal transfers (approved at the venue) can be marked; an advance stays as it is."""
    return entry.method == PaymentMethod.BANK_TRANSFER_PROOF and entry.amount_pkr > 0 and (entry.note or "").startswith("Balance")


async def _owned_entry(db: AsyncSession, actor: User, entry_id: uuid.UUID) -> tuple[PaymentEntry, Booking, Venue]:
    entry = await db.get(PaymentEntry, entry_id)
    booking = await db.get(Booking, entry.booking_id) if entry is not None else None
    court = await db.get(Court, booking.court_id) if booking is not None else None
    venue = await db.get(Venue, court.venue_id) if court is not None else None
    if entry is None or venue is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Payment entry not found")
    if actor.role != UserRole.OWNER or venue.owner_id != actor.id:
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Only the venue owner can do this.")
    return entry, booking, venue


async def states(db: AsyncSession, entry_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """entry id -> {marked_at, marked_by, decision, decided_at} for the entries marked "bank mein nahi mila"."""
    if not entry_ids:
        return {}
    rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.entity_type == "payment_entry", AuditLog.entity_id.in_(entry_ids), AuditLog.action.in_((MARKED, DECIDED)))
            .order_by(AuditLog.created_at)
        )
    ).scalars().all()
    out: dict[uuid.UUID, dict] = {}
    for a in rows:
        if a.action == MARKED:
            out[a.entity_id] = {"marked_at": a.created_at, "marked_by": a.actor_id, "decision": None, "decided_at": None}
        elif a.entity_id in out:
            out[a.entity_id]["decision"] = (a.new_value or {}).get("decision")
            out[a.entity_id]["decided_at"] = a.created_at
    return out


async def mark_not_received(db: AsyncSession, settings: Settings, actor: User, entry_id: uuid.UUID) -> dict:
    from app.services.audit_service import AuditService
    from app.services.payment_ledger_service import PaymentLedgerService

    entry, booking, _venue = await _owned_entry(db, actor, entry_id)
    if not is_balance_entry(entry):
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Only a balance transfer approved at the venue can be marked.")
    if entry.id in await states(db, [entry.id]):
        raise AppError(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_REVIEWED, "This transfer is already marked.")
    already_reversed = await db.scalar(select(PaymentEntry.id).where(PaymentEntry.reverses_entry_id == entry.id).limit(1))
    if already_reversed is not None:
        raise AppError(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_REVIEWED, "This transfer was already reversed.")
    reversal = await PaymentLedgerService(db).reverse_entry(entry.id, actor=actor, reason=REVERSAL_NOTE)
    await AuditService(db).log(
        actor_user_id=actor.id, actor_type=actor.role.value, action=MARKED, entity_type="payment_entry", entity_id=entry.id,
        new_value={"amount_pkr": entry.amount_pkr, "booking_id": str(booking.id), "approved_by": str(entry.recorded_by) if entry.recorded_by else None,
                   "reversal_id": str(reversal.id)},
    )
    await db.commit()
    return (await states(db, [entry.id]))[entry.id]


async def decide(db: AsyncSession, settings: Settings, actor: User, entry_id: uuid.UUID, decision: str) -> dict:
    from app.services.audit_service import AuditService
    from app.services.payment_ledger_service import PaymentLedgerService
    from app.services.phase3_service import start_short_round
    from app.utils.timezone import format_pkr

    if decision not in DECISIONS:
        raise AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, "decision must be staff or player")
    entry, booking, _venue = await _owned_entry(db, actor, entry_id)
    state = (await states(db, [entry.id])).get(entry.id)
    if state is None:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Mark this transfer as not received first.")
    if state["decision"] is not None:
        raise AppError(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_REVIEWED, "This was already decided.")
    staff = await db.get(User, entry.recorded_by) if entry.recorded_by else None
    if decision == "staff" and (staff is None or staff.role != UserRole.STAFF):
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "A staff member did not approve this transfer.")
    await AuditService(db).log(
        actor_user_id=actor.id, actor_type=actor.role.value, action=DECIDED, entity_type="payment_entry", entity_id=entry.id,
        new_value={"decision": decision, "amount_pkr": entry.amount_pkr, "staff_id": str(staff.id) if staff else None},
    )
    await db.commit()
    if decision == "staff":
        # the venue collects it from the staff member; the player's booking is settled again and the player hears nothing
        await PaymentLedgerService(db).record_entry(
            booking.id, amount_pkr=entry.amount_pkr, method=PaymentMethod.OTHER, recorded_by=actor,
            note=f"Staff se wasool: {staff.name or staff.phone} (bank mein nahi mila)",
        )
    else:
        booking = await db.get(Booking, booking.id)
        await db.refresh(booking)
        await start_short_round(
            db, settings, booking, actor,
            note=f"Aap ka transfer {format_pkr(entry.amount_pkr)} venue ke bank mein nahi mila.",
        )
    return (await states(db, [entry.id]))[entry.id]


async def for_venue(db: AsyncSession, venue_id: uuid.UUID, t0: datetime, t1: datetime) -> list[dict]:
    """"Staff ka kaam": every marked transfer still waiting for a decision, plus those marked in [t0, t1)."""
    rows = (
        await db.execute(
            select(AuditLog.entity_id)
            .join(PaymentEntry, PaymentEntry.id == AuditLog.entity_id)
            .join(Booking, Booking.id == PaymentEntry.booking_id)
            .join(Court, Court.id == Booking.court_id)
            .where(AuditLog.entity_type == "payment_entry", AuditLog.action == MARKED, Court.venue_id == venue_id)
        )
    ).scalars().all()
    st = await states(db, list(rows))
    keep = [eid for eid, s in st.items() if s["decision"] is None or t0 <= s["marked_at"] < t1]
    if not keep:
        return []
    entries = {e.id: e for e in (await db.execute(select(PaymentEntry).where(PaymentEntry.id.in_(keep)))).scalars()}
    bookings = {b.id: b for b in (await db.execute(select(Booking).where(Booking.id.in_({e.booking_id for e in entries.values()})))).scalars()}
    user_ids = {e.recorded_by for e in entries.values() if e.recorded_by} | {b.player_id for b in bookings.values() if b.player_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars()} if user_ids else {}
    from app.services.owner_overview_service import short_code

    out = []
    for eid in keep:
        e = entries[eid]
        b = bookings[e.booking_id]
        by = users.get(e.recorded_by) if e.recorded_by else None
        player = users.get(b.player_id) if b.player_id else None
        out.append(
            {
                "entry_id": e.id, "booking_id": b.id, "code": short_code(b.id),
                "player_name": b.player_name or (player.name if player else None),
                "amount_pkr": e.amount_pkr, "credited_at": e.created_at,
                "approved_by_id": e.recorded_by, "approved_by_name": (by.name or by.phone) if by else None,
                "approved_by_role": by.role.value if by else None,
                **st[eid],
            }
        )
    out.sort(key=lambda r: (r["decision"] is not None, -r["marked_at"].timestamp()))
    return out
