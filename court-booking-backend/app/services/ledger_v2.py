"""Ledger v2 write-side helpers (docs/design/LEDGER-V2-CONTRACT.md sections 2, 4).

Everything that WRITES money under the v2 rules goes through here: adjustments (deductions / waivers) instead of editing the
price, the extra-money choice (refund or player credit), player credit, the refund-dispute sync after a correction, business
days on new entries, and the owner-only gate. The flag `ledger_v2` switches the new RULES (owner-only, extra money accepted,
late cancel, no-show charge); the data structure (adjustments, kinds, business days) is written whatever the flag says, so the
data never depends on when the flag was flipped.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, or_, select, update

from app.errors import AppError, ErrorCode
from app.models.booking import Booking
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.ledger_v2 import AdjustmentKind, BookingAdjustment, PlayerCredit
from app.models.payment_entry import EntryKind, PaymentEntry, PaymentMethod
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.services.money import active_adjustments, load_money, Adj
from app.utils.business_day import business_date_for, venue_overnight_closes

LEDGER_V2 = "ledger_v2"
UNCREDITED_REFUND_REASONS = ("overpayment_excess", "cancelled_payment_received")
DUPLICATE_WINDOW = timedelta(minutes=10)


async def v2_on(db) -> bool:
    from app.services.feature_flag_service import flag_on

    return await flag_on(db, LEDGER_V2)


def is_staff(actor: User | None) -> bool:
    return actor is not None and actor.role == UserRole.STAFF


def require_owner(actor: User | None) -> None:
    if is_staff(actor):
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.OWNER_ONLY, "Only the venue owner can do this.")


async def require_owner_v2(db, actor: User | None) -> None:
    """Owner-only money actions (contract 4.1) are enforced only while ledger_v2 is on; off, the old permissions apply."""
    if await v2_on(db):
        require_owner(actor)


async def venue_of(db, booking: Booking) -> Venue | None:
    court = await db.get(Court, booking.court_id)
    return await db.get(Venue, court.venue_id) if court is not None else None


async def venue_id_of(db, booking: Booking) -> uuid.UUID | None:
    return await db.scalar(select(Court.venue_id).where(Court.id == booking.court_id))


# --- business day -----------------------------------------------------------------------------------------------------


async def stamp_business_dates(db, booking: Booking) -> None:
    """Give every entry of this booking that has no business day its venue's business day (from when it was recorded).
    Called by recompute_payment_totals, so every writer gets it. Rows from before the backfill are left alone (the backfill
    owns them): only rows recorded in the last day are stamped here."""
    rows = (
        await db.execute(
            select(PaymentEntry.id, PaymentEntry.created_at).where(
                PaymentEntry.booking_id == booking.id, PaymentEntry.money_business_date.is_(None)
            )
        )
    ).all()
    if not rows:
        return
    now = datetime.now(timezone.utc)
    vid = await venue_id_of(db, booking)
    overnight = await venue_overnight_closes(db, vid) if vid else {}
    for eid, created in rows:
        at = created or now
        if now - at > timedelta(days=1):
            continue
        await db.execute(
            update(PaymentEntry).where(PaymentEntry.id == eid).values(money_business_date=business_date_for(at, overnight))
        )


async def today_business_date(db, booking: Booking) -> date:
    vid = await venue_id_of(db, booking)
    overnight = await venue_overnight_closes(db, vid) if vid else {}
    return business_date_for(datetime.now(timezone.utc), overnight)


async def check_business_date(db, booking: Booking, business_date: date | None, note: str | None) -> date | None:
    """A business day given by the owner: never after today's; before today needs a note (contract 2.1)."""
    if business_date is None:
        return None
    today = await today_business_date(db, booking)
    if business_date > today:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.BUSINESS_DATE_IN_FUTURE, "That business day has not come yet.",
                       details={"today": today.isoformat()})
    if business_date < today and not (note or "").strip():
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.BACKDATE_NOTE_REQUIRED,
                       "Write a note when you record money for an earlier day.")
    return business_date


async def check_duplicate(db, booking: Booking, amount: int, method: PaymentMethod, confirm: bool) -> None:
    """Same booking + amount + method within 10 minutes -> 409 POSSIBLE_DUPLICATE, unless confirmed (contract 2.8)."""
    if confirm:
        return
    since = datetime.now(timezone.utc) - DUPLICATE_WINDOW
    row = (
        await db.execute(
            select(PaymentEntry.id, PaymentEntry.created_at, PaymentEntry.recorded_by).where(
                PaymentEntry.booking_id == booking.id,
                PaymentEntry.amount_pkr == amount,
                PaymentEntry.method == method,
                PaymentEntry.kind == EntryKind.PAYMENT,
                PaymentEntry.created_at >= since,
            ).order_by(PaymentEntry.created_at.desc()).limit(1)
        )
    ).first()
    if row is not None:
        by = await db.get(User, row.recorded_by) if row.recorded_by else None
        raise AppError(
            status.HTTP_409_CONFLICT, ErrorCode.POSSIBLE_DUPLICATE,
            "The same amount was recorded on this booking a few minutes ago.",
            details={"entry_id": str(row.id), "recorded_at": row.created_at.isoformat(), "by": by.name if by else None},
        )


# --- adjustments ------------------------------------------------------------------------------------------------------


async def _adjs(db, booking_id: uuid.UUID) -> list[Adj]:
    rows = (await db.execute(select(BookingAdjustment.id, BookingAdjustment.kind, BookingAdjustment.amount_pkr,
                                    BookingAdjustment.reverses_adjustment_id)
                             .where(BookingAdjustment.booking_id == booking_id))).all()
    return [Adj(id=r[0], kind=r[1], amount=int(r[2]), reverses=r[3]) for r in rows]


async def ensure_base_price(db, booking: Booking) -> None:
    """base_price = price + the deductions already in force, the first time anything touches it (contract 1)."""
    if booking.base_price is None:
        live = active_adjustments(await _adjs(db, booking.id))
        booking.base_price = round(float(booking.price)) + sum(a.amount for a in live if a.kind in AdjustmentKind.DEDUCTIONS)


async def apply_price(db, booking: Booking) -> None:
    """price = base_price - active deductions. The only writer of bookings.price after creation (via recompute)."""
    await ensure_base_price(db, booking)
    live = active_adjustments(await _adjs(db, booking.id))
    deductions = sum(a.amount for a in live if a.kind in AdjustmentKind.DEDUCTIONS)
    booking.price = max(round(float(booking.base_price)) - deductions, 0)


async def add_adjustment(db, booking: Booking, kind: str, amount: int, *, reason: str | None, actor: User | None,
                         short_claim_id: uuid.UUID | None = None, recompute: bool = True) -> BookingAdjustment:
    from app.services.payment_ledger_service import recompute_payment_totals

    if amount <= 0:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Amount must be greater than zero")
    await ensure_base_price(db, booking)
    adj = BookingAdjustment(booking_id=booking.id, kind=kind, amount_pkr=amount, reason=reason,
                            created_by=actor.id if actor else None, short_claim_id=short_claim_id)
    db.add(adj)
    await db.flush()
    if recompute:
        await recompute_payment_totals(db, booking)
    return adj


async def reverse_adjustment(db, adj: BookingAdjustment, *, actor: User | None, reason: str) -> BookingAdjustment:
    from app.services.payment_ledger_service import recompute_payment_totals

    if adj.reverses_adjustment_id is not None:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "A reversal cannot be reversed.")
    done = await db.scalar(select(BookingAdjustment.id).where(BookingAdjustment.reverses_adjustment_id == adj.id))
    if done:
        raise AppError(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_REVIEWED, "This was already undone.")
    booking = await db.get(Booking, adj.booking_id, with_for_update=True)
    rev = BookingAdjustment(booking_id=adj.booking_id, kind=adj.kind, amount_pkr=adj.amount_pkr, reason=reason,
                            created_by=actor.id if actor else None, reverses_adjustment_id=adj.id)
    db.add(rev)
    await db.flush()
    await recompute_payment_totals(db, booking)
    return rev


async def active_of_kind(db, booking_id: uuid.UUID, kind: str) -> list[BookingAdjustment]:
    live_ids = {a.id for a in active_adjustments(await _adjs(db, booking_id)) if a.kind == kind}
    if not live_ids:
        return []
    return list((await db.scalars(select(BookingAdjustment).where(BookingAdjustment.id.in_(live_ids)))).all())


# --- player credit ----------------------------------------------------------------------------------------------------


def credit_key(booking: Booking) -> tuple[uuid.UUID | None, str | None] | None:
    """Who holds credit for this booking: the account, else the phone; None when neither (then only 'refund')."""
    if booking.player_id is None and not booking.player_phone:
        return None
    return booking.player_id, booking.player_phone


async def credit_balance(db, venue_id: uuid.UUID, player_id: uuid.UUID | None, phone: str | None) -> int:
    if player_id is None and not phone:
        return 0
    if player_id is not None and not phone:
        user = await db.get(User, player_id)
        phone = user.phone if user else None
    conds = []
    if player_id is not None:
        conds.append(PlayerCredit.player_id == player_id)
    if phone:
        conds.append(PlayerCredit.phone == phone)
    total = await db.scalar(
        select(func.coalesce(func.sum(PlayerCredit.delta_pkr), 0)).where(PlayerCredit.venue_id == venue_id, or_(*conds))
    )
    return int(total or 0)


async def can_credit(db, booking: Booking, actor: User | None) -> bool:
    return credit_key(booking) is not None and not is_staff(actor)


async def move_to_credit(db, booking: Booking, amount: int, *, actor: User | None, note: str) -> PaymentEntry:
    """credit_out entry on the booking (-amount) + the same amount into the player's credit at this venue."""
    key = credit_key(booking)
    if key is None:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.CREDIT_NOT_AVAILABLE,
                       "This booking has no player account or phone to keep credit for.")
    vid = await venue_id_of(db, booking)
    e = PaymentEntry(booking_id=booking.id, amount_pkr=-amount, method=PaymentMethod.OTHER, kind=EntryKind.CREDIT_OUT,
                     recorded_by=actor.id if actor else None, note=note)
    db.add(e)
    await db.flush()
    db.add(PlayerCredit(venue_id=vid, player_id=key[0], phone=key[1], delta_pkr=amount, booking_id=booking.id, entry_id=e.id,
                        created_by=actor.id if actor else None, note=note))
    await db.flush()
    return e


async def use_credit(db, booking: Booking, amount: int, *, actor: User | None) -> PaymentEntry:
    """Spend the player's credit on this booking: credit_in entry (+) and player_credits (-). Caps: <= credit, <= owed."""
    from app.services.money import owed_now
    from app.services.payment_ledger_service import recompute_payment_totals

    key = credit_key(booking)
    vid = await venue_id_of(db, booking)
    have = await credit_balance(db, vid, key[0], key[1]) if key else 0
    owed = await owed_now(db, booking)
    if amount <= 0 or amount > have or amount > owed:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.CREDIT_NOT_AVAILABLE, "Not that much credit can be used here.",
                       details={"credit": have, "owed": owed})
    e = PaymentEntry(booking_id=booking.id, amount_pkr=amount, method=PaymentMethod.OTHER, kind=EntryKind.CREDIT_IN,
                     recorded_by=actor.id if actor else None, note="Jama se diya")
    db.add(e)
    await db.flush()
    db.add(PlayerCredit(venue_id=vid, player_id=key[0], phone=key[1], delta_pkr=-amount, booking_id=booking.id, entry_id=e.id,
                        created_by=actor.id if actor else None, note="Jama se diya"))
    await db.flush()
    await recompute_payment_totals(db, booking)
    return e


# --- extra money ------------------------------------------------------------------------------------------------------


async def excess_for(db, booking: Booking, amount: int) -> int:
    """How much of `amount` (about to be received) lands above what is still owed on the booking."""
    from app.services.money import owed_now

    owed = await owed_now(db, booking)
    m = await load_money(db, booking)
    if m.refund_due > 0:
        owed = 0
    return max(amount - owed, 0)


async def require_excess_choice(db, booking: Booking, excess: int, choice: str | None, actor: User | None) -> str | None:
    """Contract 2.4: money above the total needs a choice. Staff may only refund (credit is owner-only)."""
    if excess <= 0:
        return None
    allowed = await can_credit(db, booking, actor)
    if choice is None:
        raise AppError(status.HTTP_409_CONFLICT, ErrorCode.EXCESS_CHOICE_REQUIRED,
                       f"PKR {excess:,} is more than this booking's total. Refund it or keep it as the player's credit?",
                       details={"excess_pkr": excess, "can_credit": allowed})
    if choice not in ("refund", "credit"):
        raise AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, "excess_choice is refund or credit")
    if choice == "credit":
        require_owner(actor)
        if credit_key(booking) is None:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.CREDIT_NOT_AVAILABLE,
                           "This booking has no player account or phone to keep credit for.")
    return choice


async def settle_excess(db, booking: Booking, *, excess: int, choice: str, actor: User | None, source_entry: PaymentEntry,
                        payment_id: uuid.UUID | None = None) -> None:
    """The extra money is already in the ledger (source_entry). refund -> an overpayment_excess dispute linked to that entry
    (Kaam -> Wapas dena); credit -> moved into the player's credit."""
    if excess <= 0:
        return
    if choice == "credit":
        await move_to_credit(db, booking, excess, actor=actor, note="Zyada paisa: player ke jama mein")
        return
    d = PaymentDispute(booking_id=booking.id, payment_id=payment_id, player_id=booking.player_id, reason="overpayment_excess",
                       refund_amount=excess)
    db.add(d)
    await db.flush()
    source_entry.dispute_id = d.id  # marks the dispute as credited: its money IS in the ledger
    await db.flush()


async def dispute_is_credited(db, d: PaymentDispute) -> bool:
    """Was the money this refund returns credited to the ledger? Old overpayment_excess / cancelled_payment_received rows
    were not (unless the backfill or v2 linked a payment entry to them)."""
    if d.reason not in UNCREDITED_REFUND_REASONS:
        return True
    return bool(await db.scalar(select(PaymentEntry.id).where(PaymentEntry.dispute_id == d.id,
                                                              PaymentEntry.kind == EntryKind.PAYMENT).limit(1)))


async def sync_refund_disputes(db, booking: Booking, *, note: str = "Ghalti theek ki gayi: itna wapas dena nahi") -> int:
    """After a correction lowered what is owed back, shrink / close the open refund disputes (newest first) so Kaam does not
    show a refund that is no longer due. Never grows a dispute. Only for credited disputes (money in the ledger). Returns
    the amount released."""
    m = await load_money(db, booking)
    open_ = list((await db.scalars(
        select(PaymentDispute).where(PaymentDispute.booking_id == booking.id, PaymentDispute.resolved.is_(False),
                                     PaymentDispute.refund_amount > 0).order_by(PaymentDispute.created_at.desc())
    )).all())
    open_ = [d for d in open_ if await dispute_is_credited(db, d)]
    remaining = sum(max(round(float(d.refund_amount or 0) - float(d.refunded_amount or 0)), 0) for d in open_)
    extra = remaining - m.refund_due
    released = 0
    for d in open_:
        if extra <= 0:
            break
        rem = max(round(float(d.refund_amount or 0) - float(d.refunded_amount or 0)), 0)
        cut = min(rem, extra)
        d.refund_amount = round(float(d.refund_amount) - cut, 2)
        if round(float(d.refund_amount) - float(d.refunded_amount or 0)) <= 0:
            d.resolved = True
            d.refund_status = "refunded" if float(d.refunded_amount or 0) > 0 else "closed"
            d.resolution_note = note
        extra -= cut
        released += cut
    await db.flush()
    return released


async def keep_refund_as_credit(db, d: PaymentDispute, amount: int, *, actor: User) -> PaymentEntry:
    """Owner's "Jama rakhein" on an owed refund: that much leaves the refund and goes to the player's credit."""
    from app.services.payment_ledger_service import recompute_payment_totals

    require_owner(actor)
    remaining = max(round(float(d.refund_amount or 0) - float(d.refunded_amount or 0)), 0)
    if amount <= 0 or amount > remaining:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.REFUND_EXCEEDS_OWED_AMOUNT,
                       f"Only PKR {remaining:,} is still owed back.", details={"remaining": remaining})
    booking = await db.get(Booking, d.booking_id, with_for_update=True)
    if not await dispute_is_credited(db, d):
        raise AppError(status.HTTP_409_CONFLICT, ErrorCode.CREDIT_NOT_AVAILABLE,
                       "This old refund's money was never in the ledger; record it as refunded instead.")
    e = await move_to_credit(db, booking, amount, actor=actor, note="Refund ki jagah player ke jama mein")
    d.refund_amount = round(float(d.refund_amount) - amount, 2)
    if round(float(d.refund_amount) - float(d.refunded_amount or 0)) <= 0:
        d.resolved = True
        d.refund_status = "refunded" if float(d.refunded_amount or 0) > 0 else "closed"
        d.resolution_note = "Player ke jama mein rakha"
    await db.flush()
    await recompute_payment_totals(db, booking)
    return e


KEEP_REASON = "Cancel: advance rakha"


async def advance_kept(db, bookings) -> dict:
    """booking id -> the advance a late cancel kept (contract 6.3: the player's "Cancel · advance rakha"). Only bookings
    with a live 'cancellation' adjustment written by a keep-the-advance cancel; the kept amount is what was paid."""
    from app.models.booking import BookingStatus
    from app.services.money import Adj, active_adjustments

    ids = [b.id for b in bookings if b.status == BookingStatus.CANCELLED]
    if not ids:
        return {}
    rows = (await db.scalars(select(BookingAdjustment).where(BookingAdjustment.booking_id.in_(ids)))).all()
    by_booking: dict = {}
    for a in rows:
        by_booking.setdefault(a.booking_id, []).append(a)
    out = {}
    paid = {b.id: b.amount_paid for b in bookings}
    for bid, adjs in by_booking.items():
        live = {x.id for x in active_adjustments([Adj(a.id, a.kind, a.amount_pkr, a.reverses_adjustment_id) for a in adjs])}
        if any(a.id in live and a.kind == AdjustmentKind.CANCELLATION and a.reason == KEEP_REASON for a in adjs):
            out[bid] = max(round(float(paid.get(bid) or 0)), 0)
    return out


async def booking_out(db, bookings):
    """BookingOut for the player's own screens, with advance_kept_pkr filled."""
    from app.schemas.booking import BookingOut

    kept = await advance_kept(db, bookings)
    outs = []
    for b in bookings:
        o = BookingOut.model_validate(b)
        o.advance_kept_pkr = kept.get(b.id, 0)
        outs.append(o)
    return outs
