"""Ledger v2: the ONE place a booking's money is worked out (docs/design/LEDGER-V2-CONTRACT.md section 1).

    base_price  = bookings.base_price (the booking's original amount)
    deductions  = active adjustments of kind points / no_show / cancellation / price_reduced
    final       = base_price - deductions                       (= bookings.price; never minus a waiver)
    waived      = active adjustments of kind waived            (NOT a deduction)
    net         = SUM(payment_entries.amount_pkr)               (payments + credit spent - refunds - credit out, corrections signed)
    balance     = final - net - waived
    balance > 0 : played / no-show / cancelled -> due;  upcoming / attendance pending -> due_at_slot
    balance < 0 : refund_due = -balance

so final == net + due + due_at_slot + waived - refund_due for every booking and every set of bookings.

`compute_money` is pure (unit-tested without a database). `load_money` / `load_money_many` read what it needs. Every screen,
CSV, badge and the backfill check use this; nothing else derives these numbers. This read path is NOT behind the ledger_v2
flag: once a waived booking's price is restored, everything must subtract the waiver or that booking would show a due again.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.booking import Booking, BookingStatus
from app.models.ledger_v2 import AdjustmentKind, BookingAdjustment
from app.models.payment_entry import EntryKind, PaymentEntry
from app.utils.timezone import utc_now

# statuses whose positive balance is a real "due" now (the slot happened, or the booking ended another way)
DUE_NOW_STATUSES = (BookingStatus.COMPLETED, BookingStatus.NO_SHOW, BookingStatus.CANCELLED)

MONEY_STATUSES = (
    "unpaid", "paid_full", "part_paid", "attendance_pending", "advance_paid", "noshow_kept", "cancel_kept", "cancel_clear",
    "cancel_refund", "refund_due", "disputed",
)


@dataclass(frozen=True)
class Adj:
    id: uuid.UUID
    kind: str
    amount: int
    reverses: uuid.UUID | None = None


@dataclass(frozen=True)
class Entry:
    kind: str
    amount: int


@dataclass
class Money:
    base_price: int
    deductions: dict[str, int]
    deductions_total: int
    final: int
    waived: int
    net: int
    payments: int          # kind payment (incl. their corrections)
    refunds: int           # money paid back out (positive number; refund rows net of their reversals)
    credit_in: int
    credit_out: int        # positive number
    balance: int
    due: int
    due_at_slot: int
    refund_due: int
    status: str = "unpaid"
    extra: dict = field(default_factory=dict)


def active_adjustments(adjs: list[Adj]) -> list[Adj]:
    """Adjustments still in force: a reversed row and the row that reverses it both drop out."""
    reversed_ids = {a.reverses for a in adjs if a.reverses is not None}
    return [a for a in adjs if a.reverses is None and a.id not in reversed_ids]


def _int(x) -> int:
    return round(float(x or 0))


def compute_money(
    *,
    price: float,
    base_price: float | None,
    status: BookingStatus | str,
    ends_at: datetime | None,
    entries: list[Entry],
    adjustments: list[Adj],
    disputed: bool = False,
    now: datetime | None = None,
) -> Money:
    st = BookingStatus(status) if not isinstance(status, BookingStatus) else status
    live = active_adjustments(adjustments)
    deductions = {k: 0 for k in AdjustmentKind.DEDUCTIONS}
    waived = 0
    for a in live:
        if a.kind == AdjustmentKind.WAIVED:
            waived += a.amount
        elif a.kind in deductions:
            deductions[a.kind] += a.amount
    deductions_total = sum(deductions.values())
    # before the backfill reaches a row base_price is NULL and no adjustment exists, so base = price
    base = _int(base_price) if base_price is not None else _int(price) + deductions_total
    final = base - deductions_total

    by_kind: dict[str, int] = defaultdict(int)
    for e in entries:
        by_kind[e.kind] += e.amount
    net = sum(by_kind.values())
    balance = final - net - waived

    due = due_at_slot = refund_due = 0
    if balance > 0:
        if st in DUE_NOW_STATUSES:
            due = balance
        else:
            due_at_slot = balance
    elif balance < 0:
        refund_due = -balance

    m = Money(
        base_price=base,
        deductions=deductions,
        deductions_total=deductions_total,
        final=final,
        waived=waived,
        net=net,
        payments=by_kind[EntryKind.PAYMENT] + by_kind[EntryKind.CORRECTION],
        refunds=-by_kind[EntryKind.REFUND],
        credit_in=by_kind[EntryKind.CREDIT_IN],
        credit_out=-by_kind[EntryKind.CREDIT_OUT],
        balance=balance,
        due=due,
        due_at_slot=due_at_slot,
        refund_due=refund_due,
    )
    m.status = money_status(m, st, ends_at, disputed=disputed, now=now)
    return m


def money_status(m: Money, status: BookingStatus, ends_at: datetime | None, *, disputed: bool, now: datetime | None) -> str:
    """The booking's money pill (contract 1.1). First match wins, in the contract's order."""
    now = now or utc_now()
    if disputed:
        return "disputed"
    if status == BookingStatus.CANCELLED:
        if m.refund_due > 0:
            return "cancel_refund"
        if m.net == 0:
            return "cancel_clear"
        return "cancel_kept"
    if status == BookingStatus.NO_SHOW and m.balance <= 0:
        return "noshow_kept"
    if m.refund_due > 0:
        return "refund_due"
    if m.net == 0 and m.balance > 0:
        return "unpaid"
    if status == BookingStatus.BOOKED and ends_at is not None and ends_at <= now:
        return "attendance_pending"
    if m.due > 0:
        return "part_paid"
    if m.due_at_slot > 0 and m.net > 0:
        return "advance_paid"
    return "paid_full"


# --- loading -------------------------------------------------------------------------------------------------------------


async def _entries_by_booking(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Entry]]:
    out: dict[uuid.UUID, list[Entry]] = defaultdict(list)
    if not ids:
        return out
    # a correction counts under the kind of the row it reverses: undoing a refund (Khelo took it back) lowers "refunds",
    # it is not money received; a correction with no target (an old "Booking completed" fix) stays a payment correction
    target = aliased(PaymentEntry)
    bucket = case(
        (and_(PaymentEntry.kind == EntryKind.CORRECTION, target.kind.is_not(None), target.kind != EntryKind.CORRECTION), target.kind),
        else_=PaymentEntry.kind,
    )
    rows = (
        await db.execute(
            select(PaymentEntry.booking_id, bucket, func.sum(PaymentEntry.amount_pkr))
            .outerjoin(target, target.id == PaymentEntry.reverses_entry_id)
            .where(PaymentEntry.booking_id.in_(ids))
            .group_by(PaymentEntry.booking_id, bucket)
        )
    ).all()
    for bid, kind, total in rows:
        out[bid].append(Entry(kind=kind, amount=int(total or 0)))
    return out


async def _adjustments_by_booking(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Adj]]:
    out: dict[uuid.UUID, list[Adj]] = defaultdict(list)
    if not ids:
        return out
    rows = (
        await db.execute(
            select(
                BookingAdjustment.booking_id,
                BookingAdjustment.id,
                BookingAdjustment.kind,
                BookingAdjustment.amount_pkr,
                BookingAdjustment.reverses_adjustment_id,
            ).where(BookingAdjustment.booking_id.in_(ids))
        )
    ).all()
    for bid, aid, kind, amount, rev in rows:
        out[bid].append(Adj(id=aid, kind=kind, amount=int(amount), reverses=rev))
    return out


async def _disputed_ids(db: AsyncSession, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    from app.models.audit_phase3 import ShortPaymentClaim

    if not ids:
        return set()
    rows = await db.scalars(
        select(ShortPaymentClaim.booking_id).where(
            ShortPaymentClaim.booking_id.in_(ids),
            ShortPaymentClaim.status == "disputed",
            ShortPaymentClaim.owner_decision.is_(None),
            ShortPaymentClaim.resolved_at.is_(None),
        )
    )
    return set(rows.all())


async def load_money_many(db: AsyncSession, bookings: list[Booking], now: datetime | None = None) -> dict[uuid.UUID, Money]:
    ids = [b.id for b in bookings]
    entries = await _entries_by_booking(db, ids)
    adjs = await _adjustments_by_booking(db, ids)
    disputed = await _disputed_ids(db, ids)
    return {
        b.id: compute_money(
            price=float(b.price),
            base_price=float(b.base_price) if b.base_price is not None else None,
            status=b.status,
            ends_at=b.ends_at,
            entries=entries.get(b.id, []),
            adjustments=adjs.get(b.id, []),
            disputed=b.id in disputed,
            now=now,
        )
        for b in bookings
    }


async def load_money(db: AsyncSession, booking: Booking, now: datetime | None = None) -> Money:
    return (await load_money_many(db, [booking], now))[booking.id]


def waived_sql(booking_id_col):
    """SQL: active waivers on the booking in `booking_id_col` (a correlated scalar, 0 when none). For read paths that sum
    `price - amount_paid` in SQL; a reversed waiver and its reversal both drop out."""
    rev = aliased(BookingAdjustment)
    return (
        select(func.coalesce(func.sum(BookingAdjustment.amount_pkr), 0))
        .where(
            BookingAdjustment.booking_id == booking_id_col,
            BookingAdjustment.kind == AdjustmentKind.WAIVED,
            BookingAdjustment.reverses_adjustment_id.is_(None),
            ~select(rev.id).where(rev.reverses_adjustment_id == BookingAdjustment.id).exists(),
        )
        .correlate_except(BookingAdjustment, rev)
        .scalar_subquery()
    )


async def owed_now(db: AsyncSession, booking: Booking) -> int:
    """price - paid - active waivers, floored at 0: what the player still owes on this booking (flag-free read path)."""
    return max(round(float(booking.price) - float(booking.amount_paid or 0)) - await waived_total(db, booking.id), 0)


async def waived_total(db: AsyncSession, booking_id: uuid.UUID) -> int:
    """Active waivers on one booking (used by recompute_payment_totals; flag-free)."""
    adjs = (await _adjustments_by_booking(db, [booking_id])).get(booking_id, [])
    return sum(a.amount for a in active_adjustments(adjs) if a.kind == AdjustmentKind.WAIVED)


async def deductions_total(db: AsyncSession, booking_id: uuid.UUID) -> int:
    adjs = (await _adjustments_by_booking(db, [booking_id])).get(booking_id, [])
    return sum(a.amount for a in active_adjustments(adjs) if a.kind in AdjustmentKind.DEDUCTIONS)
