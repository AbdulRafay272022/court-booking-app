"""Ledger v2 "Paisa" API (docs/design/LEDGER-V2-CONTRACT.md section 5). All routes 404 while the flag ledger_v2 is off.

Reads: summary, bookings (+ CSV), one booking's money, day book (Len-den), players, Kaam. Writes that are new in v2:
adjustments (reduce price / waive) and their reversal, using credit, keeping an owed refund as credit, a player payment
spread over their oldest dues. Owner-only actions are enforced here and in ledger_v2 (403 OWNER_ONLY for staff).
"""

import csv
import io
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.dependencies import AppSettings, DbSession, RequireStaffCapable, require_feature
from app.errors import AppError, ErrorCode
from app.models.booking import Booking
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.ledger_v2 import BookingAdjustment
from app.models.payment_entry import PaymentMethod
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.services import ledger_v2 as lv2
from app.services import paisa_service as ps
from app.services.staff_service import resolve_owner_context, staff_can

router = APIRouter(prefix="/owners/paisa", tags=["paisa"], dependencies=[Depends(require_feature("ledger_v2"))])

CourtIds = Annotated[str | None, Query(description="comma-separated court ids")]


def _ids(raw: str | None) -> list[uuid.UUID] | None:
    if not raw:
        return None
    return [uuid.UUID(x) for x in raw.split(",") if x.strip()]


async def _venue(db, actor: User, venue_id: uuid.UUID | None, permission: str) -> tuple[User, Venue, set[str] | None]:
    """(owner, venue, staff permissions or None for owner/admin) after the access check."""
    owner, vid = await resolve_owner_context(db, actor, venue_id, permission)
    if vid is None:
        vid = await db.scalar(select(Venue.id).where(Venue.owner_id == owner.id).order_by(Venue.created_at).limit(1))
    venue = await db.get(Venue, vid) if vid else None
    if venue is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Venue not found")
    if actor.role == UserRole.OWNER and venue.owner_id != actor.id:
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
    perms = None
    if actor.role == UserRole.STAFF:
        perms = {p for p in ("view_ledger", "mark_refunds", "record_payments", "cancel_booking", "approve_payments")
                 if await staff_can(db, actor.id, venue.id, p)}
    return owner, venue, perms


async def _venue_any(db, actor: User, venue_id: uuid.UUID | None) -> tuple[User, Venue, set[str] | None]:
    """Kaam: view_ledger or (refund groups only) mark_refunds."""
    try:
        return await _venue(db, actor, venue_id, "view_ledger")
    except AppError as exc:
        if exc.code != ErrorCode.NOT_STAFF_PERMITTED:
            raise
        return await _venue(db, actor, venue_id, "mark_refunds")


async def _booking_of_venue(db, venue: Venue, booking_id: uuid.UUID) -> Booking:
    b = await db.get(Booking, booking_id)
    court = await db.get(Court, b.court_id) if b else None
    if b is None or court is None or court.venue_id != venue.id:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND, "Booking not found")
    return b


@router.get("/summary")
async def paisa_summary(db: DbSession, actor: RequireStaffCapable, venue_id: uuid.UUID | None = None, court_ids: CourtIds = None,
                        period: str = "this_month", date_from: date | None = Query(None, alias="from"),
                        date_to: date | None = Query(None, alias="to")) -> dict:
    _o, venue, _p = await _venue(db, actor, venue_id, "view_ledger")
    return await ps.summary(db, venue, _ids(court_ids), period, date_from, date_to)


async def _staff_filter(db, actor, venue, staff: uuid.UUID | None, act: str | None, d0, d1) -> set[uuid.UUID] | None:
    if not staff or not act:
        return None
    from app.services.staff_activity_service import staff_booking_ids

    return await staff_booking_ids(db, venue, d0, d1, staff, act)


@router.get("/bookings")
async def paisa_bookings(db: DbSession, actor: RequireStaffCapable, venue_id: uuid.UUID | None = None, court_ids: CourtIds = None,
                         period: str = "this_month", date_from: date | None = Query(None, alias="from"),
                         date_to: date | None = Query(None, alias="to"), q: str | None = None, money_status: str | None = None,
                         booking: uuid.UUID | None = None, staff: uuid.UUID | None = None, act: str | None = None,
                         page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=200)) -> dict:
    _o, venue, _p = await _venue(db, actor, venue_id, "view_ledger")
    only = None
    if staff and act:
        d0 = date_from
        only = await _staff_filter(db, actor, venue, staff, act, d0, date_to)
    return await ps.bookings(db, venue, _ids(court_ids), period, date_from, date_to, q=q, money_status=money_status,
                             booking=booking, only_ids=only, page=page, page_size=page_size)


@router.get("/bookings.csv")
async def paisa_bookings_csv(db: DbSession, actor: RequireStaffCapable, venue_id: uuid.UUID | None = None, court_ids: CourtIds = None,
                             period: str = "this_month", date_from: date | None = Query(None, alias="from"),
                             date_to: date | None = Query(None, alias="to"), q: str | None = None,
                             money_status: str | None = None) -> Response:
    _o, venue, _p = await _venue(db, actor, venue_id, "view_ledger")
    data = await ps.bookings(db, venue, _ids(court_ids), period, date_from, date_to, q=q, money_status=money_status, booking=None,
                             only_ids=None, page=1, page_size=100000)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["short_code", "business_date", "starts_at", "court", "player", "phone", "status", "money_status", "base_price",
            "deductions", "final", "received", "due", "due_at_slot", "waived", "refund_due"]
    w.writerow(cols)
    for r in data["items"]:
        w.writerow([r[c].isoformat() if hasattr(r[c], "isoformat") else r[c] for c in cols])
    t = data["totals"]
    w.writerow(["TOTAL", "", "", "", "", "", "", "", t["booking_amount"], t["deductions"]["total"], t["final"], t["received"], t["due"],
                t["due_at_slot"], t["waived"], t["refund_due"]])
    return Response(buf.getvalue(), media_type="text/csv")


@router.get("/bookings/{booking_id}")
async def paisa_booking(booking_id: uuid.UUID, db: DbSession, actor: RequireStaffCapable, venue_id: uuid.UUID | None = None) -> dict:
    _o, venue, perms = await _venue(db, actor, venue_id, "view_ledger")
    await _booking_of_venue(db, venue, booking_id)
    return await ps.booking_detail(db, venue, booking_id, actor, perms)


@router.get("/daybook")
async def paisa_daybook(db: DbSession, actor: RequireStaffCapable, venue_id: uuid.UUID | None = None, court_ids: CourtIds = None,
                        period: str = "this_month", date_from: date | None = Query(None, alias="from"),
                        date_to: date | None = Query(None, alias="to"),
                        show: Literal["money", "with_deductions", "deductions"] = "money", method: str | None = None,
                        person: uuid.UUID | None = None, kind: str | None = None) -> dict:
    _o, venue, _p = await _venue(db, actor, venue_id, "view_ledger")
    return await ps.daybook(db, venue, _ids(court_ids), period, date_from, date_to, show=show, method=method, person=person, kind=kind)


@router.get("/players")
async def paisa_players(db: DbSession, actor: RequireStaffCapable, venue_id: uuid.UUID | None = None, q: str | None = None) -> dict:
    _o, venue, _p = await _venue(db, actor, venue_id, "view_ledger")
    return await ps.players(db, venue, q)


@router.get("/tasks")
async def paisa_tasks(db: DbSession, settings: AppSettings, actor: RequireStaffCapable, venue_id: uuid.UUID | None = None,
                      date_: date | None = Query(None, alias="date"), court_ids: CourtIds = None) -> dict:
    owner, venue, perms = await _venue_any(db, actor, venue_id)
    return await ps.tasks(db, settings, owner, actor, venue, perms, date_=date_, court_ids=_ids(court_ids))


# --- writes -----------------------------------------------------------------------------------------------------------


class AdjustmentIn(BaseModel):
    kind: Literal["price_reduced", "waived"]
    amount_pkr: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=500)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class AmountIn(BaseModel):
    amount_pkr: int = Field(gt=0)


class PlayerPaymentIn(BaseModel):
    player_id: uuid.UUID | None = None
    phone: str | None = None
    amount_pkr: int = Field(gt=0)
    method: Literal["cash"] = "cash"
    business_date: date | None = None
    note: str | None = Field(default=None, max_length=500)
    excess_choice: Literal["refund", "credit"] | None = None


@router.post("/bookings/{booking_id}/adjustments", status_code=status.HTTP_201_CREATED)
async def paisa_add_adjustment(booking_id: uuid.UUID, payload: AdjustmentIn, db: DbSession, actor: RequireStaffCapable,
                               venue_id: uuid.UUID | None = None) -> dict:
    """Owner-only: "Raqam kam karein" (price_reduced, <= final) or "Maaf karein" (waived, <= due)."""
    lv2.require_owner(actor)
    _o, venue, perms = await _venue(db, actor, venue_id, "view_ledger")
    b = await _booking_of_venue(db, venue, booking_id)
    b = await db.get(Booking, b.id, with_for_update=True)
    from app.services.money import load_money

    m = await load_money(db, b)
    limit = m.final if payload.kind == "price_reduced" else max(m.final - m.net - m.waived, 0)
    if payload.amount_pkr > limit:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, f"At most PKR {limit:,} here.", details={"max": limit})
    await lv2.add_adjustment(db, b, payload.kind, payload.amount_pkr, reason=payload.reason, actor=actor)
    await lv2.sync_refund_disputes(db, b)
    await db.commit()
    return await ps.booking_detail(db, venue, b.id, actor, perms)


@router.post("/adjustments/{adjustment_id}/reverse")
async def paisa_reverse_adjustment(adjustment_id: uuid.UUID, payload: ReasonIn, db: DbSession, actor: RequireStaffCapable,
                                   venue_id: uuid.UUID | None = None) -> dict:
    lv2.require_owner(actor)
    _o, venue, perms = await _venue(db, actor, venue_id, "view_ledger")
    adj = await db.get(BookingAdjustment, adjustment_id)
    if adj is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Not found")
    await _booking_of_venue(db, venue, adj.booking_id)
    if adj.kind not in ("price_reduced", "waived"):
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Use the no-show / cancel flows for this one.")
    await lv2.reverse_adjustment(db, adj, actor=actor, reason=payload.reason)
    await db.commit()
    return await ps.booking_detail(db, venue, adj.booking_id, actor, perms)


@router.post("/bookings/{booking_id}/credit/use")
async def paisa_use_credit(booking_id: uuid.UUID, payload: AmountIn, db: DbSession, actor: RequireStaffCapable,
                           venue_id: uuid.UUID | None = None) -> dict:
    lv2.require_owner(actor)
    _o, venue, perms = await _venue(db, actor, venue_id, "view_ledger")
    b = await _booking_of_venue(db, venue, booking_id)
    b = await db.get(Booking, b.id, with_for_update=True)
    await lv2.use_credit(db, b, payload.amount_pkr, actor=actor)
    await db.commit()
    return await ps.booking_detail(db, venue, b.id, actor, perms)


@router.post("/refunds/{dispute_id}/keep-as-credit")
async def paisa_keep_as_credit(dispute_id: uuid.UUID, payload: AmountIn, db: DbSession, actor: RequireStaffCapable,
                               venue_id: uuid.UUID | None = None) -> dict:
    """Owner-only "Jama rakhein": an owed refund (or part of it) goes into the player's credit instead."""
    lv2.require_owner(actor)
    _o, venue, perms = await _venue(db, actor, venue_id, "view_ledger")
    d = await db.get(PaymentDispute, dispute_id)
    if d is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Refund not found")
    await _booking_of_venue(db, venue, d.booking_id)
    await lv2.keep_refund_as_credit(db, d, payload.amount_pkr, actor=actor)
    await db.commit()
    return await ps.booking_detail(db, venue, d.booking_id, actor, perms)


@router.post("/players/payment")
async def paisa_player_payment(payload: PlayerPaymentIn, db: DbSession, actor: RequireStaffCapable,
                               venue_id: uuid.UUID | None = None) -> dict:
    """Cash from a player against their open dues, oldest booking first (contract 5.5). A transfer is recorded on the
    booking with its screenshot (it goes to Approvals)."""
    from app.services.payment_ledger_service import PaymentLedgerService

    _o, venue, perms = await _venue(db, actor, venue_id, "view_ledger")
    if actor.role == UserRole.STAFF and (perms is None or "record_payments" not in perms):
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_STAFF_PERMITTED, "Your account isn't allowed to do this.")
    data = await ps.players(db, venue, None)
    group = next((g for g in data["items"] if (payload.player_id and g["key"]["player_id"] == payload.player_id)
                  or (not payload.player_id and payload.phone and g["key"]["phone"] == payload.phone)), None)
    if group is None or not group["open_bookings"]:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Nothing is due from this player.")
    left = payload.amount_pkr
    allocations = []
    books = group["open_bookings"]
    for i, ob in enumerate(books):
        if left <= 0:
            break
        last = i == len(books) - 1
        part = left if last else min(left, ob["due"])
        await PaymentLedgerService(db).record_entry(
            ob["booking_id"], amount_pkr=part, method=PaymentMethod.CASH_AT_VENUE, recorded_by=actor,
            note=payload.note or "Player se baqi mila (Players)", business_date=payload.business_date,
            excess_choice=payload.excess_choice if last else None, confirm_duplicate=True, v2=True,
        )
        allocations.append({"booking_id": ob["booking_id"], "short_code": ob["short_code"], "amount": part})
        left -= part
    return {"allocations": allocations}
