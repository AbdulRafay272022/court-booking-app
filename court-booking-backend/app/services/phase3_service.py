"""audit 2026-10-28 Phase 3 items 3-6: points, short payments ("kam mila") and the dues they leave, no-show replies and the
"Pohanch gaya" GPS reading. Every behaviour is behind a default-OFF flag:

- player_points        50 points for a booking paid fully by transfer (any cash = 0); 500 points buy the venue's owner-funded
                       discount where the owner switched it on. Never below 0 (a deduction takes only what is there).
- short_payment_reply  completing a booking with money due asks the player "Total X, diye Y, baqi Z" -> "Sahi hai" /
                       "Ghalat hai". No reply in 24 h -> -20 + a message; the due stays. A reply is still taken any time
                       after that; +5 (once) only when it comes within 4 days of the notice. "Ghalat hai" at any time goes
                       to the owner (collect or waive). The -20 comes back when the player pays later or the owner waives.
- player_dues          an unsettled short payment is a DUE carried per venue: shown on the player's next booking approval
                       with the booking ID and a "done" button (bookings are not blocked), with "No-show X / kul bookings Y".
- noshow_reply         "Main aaya tha" on a no-show goes to the owner; "Pohanch gaya" stores ONE GPS reading compared with the
                       venue pin (200 m). A pin that is just the city centre fallback is not trusted.

Notifications go through NotificationService._audit_tier (push + web push + bell; WhatsApp only with whatsapp_templates on).
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.audit_phase3 import ArrivalCheck, NoShowReply, PointEntry, ShortPaymentClaim
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import User
from app.models.venue import Venue
from app.services.feature_flag_service import flag_on
from app.utils.timezone import format_pkr, format_time

logger = structlog.get_logger()

TRANSFER_POINTS = 50
REPLY_POINTS = 5
NO_REPLY_PENALTY = 20
REDEEM_POINTS = 500
REPLY_WINDOW = timedelta(hours=24)
# a reply after the 24 h is still taken; the +5 is given only while the reply comes within 4 days of the notice
REPLY_BONUS_WINDOW = timedelta(days=4)
# owner reverses a no-show, the rest came by transfer and the owner approves that screenshot as correct
NOSHOW_TRANSFER_POINTS = 10
NOSHOW_REVERSE_ORIGIN = "noshow_reverse"
DUE_DONE_ORIGIN = "due_done"
# what an old app build shows (it prints the server message) when its "Haan" on a no-show is refused
NOSHOW_REVERSAL_MESSAGE = "No-show hatane ke liye web dashboard istemal karein (naya app update jald)"
ARRIVAL_RADIUS_M = 200
# a venue pin this close to a city centre is the wizard's fallback pin, not the real place (packages/types CITY_CENTRES)
CITY_CENTRE_RADIUS_M = 300
CITY_CENTRES = {
    "karachi": (24.8607, 67.0011),
    "lahore": (31.5204, 74.3587),
    "islamabad": (33.6844, 73.0479),
    "rawalpindi": (33.5651, 73.0169),
    "faisalabad": (31.4504, 73.1350),
    "multan": (30.1575, 71.5249),
    "gujranwala": (32.1877, 74.1945),
    "peshawar": (34.0151, 71.5249),
    "kohat": (33.5871, 71.4432),
    "hyderabad": (25.3960, 68.3578),
}

POINTS_RULE_RU = (
    "Points: poori payment transfer se karo to har booking par 50 points. Koi bhi hissa cash mein ho to 0. "
    "500 points = Rs 500 ki chhoot (jis venue ne ye on kiya ho, raqam venue tay karta hai). Points kabhi 0 se kam nahi hote."
)
POINTS_RULE_EN = (
    "Points: pay the whole booking by transfer and get 50 points. Any part in cash = 0. 500 points = a Rs 500 discount at "
    "venues that switched it on (the venue sets the amount). Points never go below 0."
)
OPEN_STATUSES = ("awaiting_reply", "confirmed", "disputed", "no_reply")


def short_code(booking_id: uuid.UUID) -> str:
    return "KH-" + booking_id.hex[:8].upper()


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres (haversine)."""
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def pin_is_fallback(lat: float, lng: float) -> bool:
    return any(distance_m(lat, lng, c[0], c[1]) <= CITY_CENTRE_RADIUS_M for c in CITY_CENTRES.values())


def _err(code: str, message: str, http: int = status.HTTP_400_BAD_REQUEST) -> AppError:
    return AppError(http, code, message)


async def _require_flag(db: AsyncSession, key: str) -> None:
    if not await flag_on(db, key):
        raise _err(ErrorCode.FEATURE_DISABLED, "This feature is currently unavailable.", status.HTTP_403_FORBIDDEN)


async def _notify(db: AsyncSession, settings: Settings, user: User | None, event: str, title: str, body: str, *,
                  reference_id: uuid.UUID | None, template: str | None = None, params: list[str] | None = None,
                  buttons: list[tuple[str, str]] | None = None) -> None:
    """Best effort: a notification problem never fails the action that already committed."""
    if user is None:
        return
    try:
        from app.services.notification_service import NotificationService

        await NotificationService(db, settings)._audit_tier(
            user, event, title, body, reference_id=reference_id, template_name=template, template_params=params, buttons=buttons
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("phase3.notify_failed", event=event, error=type(exc).__name__)


async def _venue_of(db: AsyncSession, booking: Booking) -> tuple[Court | None, Venue | None]:
    court = await db.get(Court, booking.court_id)
    venue = await db.get(Venue, court.venue_id) if court is not None else None
    return court, venue


# ------------------------------------------------------------------ points


async def points_balance(db: AsyncSession, player_id: uuid.UUID) -> int:
    total = await db.scalar(select(func.coalesce(func.sum(PointEntry.delta), 0)).where(PointEntry.player_id == player_id))
    return max(int(total or 0), 0)


async def add_points(db: AsyncSession, player_id: uuid.UUID, booking_id: uuid.UUID | None, delta: int, reason: str,
                     note: str | None = None) -> int:
    """Append one entry and flush; returns the delta actually recorded (a deduction never takes the balance below 0, so it
    may be smaller; 0 = nothing recorded). The same (booking, reason) twice is refused by the unique index and returns 0."""
    if delta < 0:
        delta = -min(-delta, await points_balance(db, player_id))
    if delta == 0:
        return 0
    try:
        async with db.begin_nested():
            db.add(PointEntry(player_id=player_id, booking_id=booking_id, delta=delta, reason=reason, note=note))
    except IntegrityError:
        return 0
    return delta


async def maybe_award_transfer_points(db: AsyncSession, settings: Settings, booking: Booking) -> int:
    """50 points once the whole booking is paid and every rupee came by transfer (no cash, no manual 'other' entry)."""
    if booking.player_id is None or not await flag_on(db, "player_points"):
        return 0
    if booking.status not in (BookingStatus.BOOKED, BookingStatus.COMPLETED) or float(booking.balance_due or 0) > 0:
        return 0
    rows = (await db.execute(select(PaymentEntry.method, PaymentEntry.amount_pkr).where(PaymentEntry.booking_id == booking.id))).all()
    if not rows or any(m != PaymentMethod.BANK_TRANSFER_PROOF and amt > 0 for m, amt in rows):
        return 0
    got = await add_points(db, booking.player_id, booking.id, TRANSFER_POINTS, "transfer_booking")
    await db.commit()
    if got:
        player = await db.get(User, booking.player_id)
        bal = await points_balance(db, booking.player_id)
        code = short_code(booking.id)
        await _notify(
            db, settings, player, "player_points_reward", "Points mile",
            f"Mubarak! Booking {code} poori transfer se ada hui: +{got} points mile, kul {bal}. {POINTS_RULE_RU}",
            reference_id=booking.id, template="khelo_points_reward", params=[str(got), code, str(bal)],
        )
    return got


async def points_summary(db: AsyncSession, player: User) -> dict:
    entries = (
        await db.execute(select(PointEntry).where(PointEntry.player_id == player.id).order_by(PointEntry.created_at.desc()).limit(50))
    ).scalars().all()
    return {
        "enabled": await flag_on(db, "player_points"),
        "balance": await points_balance(db, player.id),
        "redeem_points": REDEEM_POINTS,
        "rule_text_ru": POINTS_RULE_RU,
        "rule_text_en": POINTS_RULE_EN,
        "entries": [
            {"id": e.id, "delta": e.delta, "reason": e.reason, "booking_id": e.booking_id,
             "code": short_code(e.booking_id) if e.booking_id else None, "created_at": e.created_at}
            for e in entries
        ],
    }


async def points_offer(db: AsyncSession, player: User, booking: Booking) -> dict:
    """What the booking screen shows: can this booking take the venue's points discount now?"""
    _court, venue = await _venue_of(db, booking)
    on = await flag_on(db, "player_points")
    bal = await points_balance(db, player.id) if on else 0
    discount = 0
    state = "off"
    if on and venue is not None:
        if booking.points_discount_pkr:
            state, discount = "used", booking.points_discount_pkr
        elif not venue.points_discount_enabled:
            state = "venue_off"
        else:
            discount = min(int(venue.points_discount_pkr), max(int(round(float(booking.price) - float(booking.amount_paid or 0))), 0))
            if booking.player_id != player.id or booking.status not in (BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED, BookingStatus.BOOKED) or booking.starts_at <= datetime.now(timezone.utc) or discount <= 0:
                state = "not_now"
            elif bal < REDEEM_POINTS:
                state = "not_enough"
            else:
                state = "available"
    return {"state": state, "balance": bal, "cost_points": REDEEM_POINTS, "discount_pkr": discount,
            "rule_text_ru": POINTS_RULE_RU, "rule_text_en": POINTS_RULE_EN}


async def redeem_points(db: AsyncSession, settings: Settings, player: User, booking_id: uuid.UUID) -> Booking:
    """Use 500 points for the venue's discount on this booking: the price (and so the balance) goes down by the venue's
    amount -- the owner funds it. Once per booking, before the slot starts."""
    from app.services.payment_ledger_service import recompute_payment_totals

    await _require_flag(db, "player_points")
    booking = await db.get(Booking, booking_id, with_for_update=True)
    if booking is None or booking.player_id != player.id:
        raise _err(ErrorCode.BOOKING_NOT_FOUND, "Booking not found", status.HTTP_404_NOT_FOUND)
    offer = await points_offer(db, player, booking)
    if offer["state"] != "available":
        msg = {"not_enough": "Not enough points yet.", "venue_off": "This venue has not switched on the points discount.",
               "used": "Points were already used on this booking."}.get(offer["state"], "Points can't be used on this booking now.")
        raise _err(ErrorCode.POINTS_NOT_AVAILABLE, msg)
    discount = offer["discount_pkr"]
    taken = await add_points(db, player.id, booking.id, -REDEEM_POINTS, "redeem", note=f"Rs {discount} discount")
    if taken != -REDEEM_POINTS:
        await db.rollback()
        raise _err(ErrorCode.POINTS_NOT_AVAILABLE, "Not enough points yet.")
    old_price = float(booking.price)
    booking.price = round(old_price - discount, 2)
    booking.points_discount_pkr = discount
    if float(booking.advance_amount) > float(booking.price):
        booking.advance_amount = booking.price
    await recompute_payment_totals(db, booking)
    from app.services.audit_service import AuditService

    await AuditService(db).log(
        actor_user_id=player.id, actor_type="player", action="booking.points_redeemed", entity_type="booking", entity_id=booking.id,
        old_value={"price": old_price}, new_value={"price": float(booking.price), "discount_pkr": discount, "points": REDEEM_POINTS},
    )
    await db.commit()
    await db.refresh(booking)
    return booking


async def return_points_for_dead_bookings(db: AsyncSession) -> int:
    """Points used on a booking that was then cancelled / expired come back (idempotent: one 'redeem_returned' per booking)."""
    rows = (
        await db.execute(
            select(PointEntry.player_id, PointEntry.booking_id, PointEntry.delta)
            .join(Booking, Booking.id == PointEntry.booking_id)
            .where(PointEntry.reason == "redeem", Booking.status == BookingStatus.CANCELLED)
        )
    ).all()
    n = 0
    for player_id, booking_id, delta in rows:
        if await add_points(db, player_id, booking_id, -delta, "redeem_returned"):
            n += 1
    await db.commit()
    return n


# ------------------------------------------------------------------ short payments / dues


async def dues_active(db: AsyncSession) -> bool:
    return await flag_on(db, "short_payment_reply") or await flag_on(db, "player_dues")


async def open_short_claim(db: AsyncSession, settings: Settings, booking: Booking, *, fresh_round: bool = False,
                           note: str | None = None) -> bool:
    """Called after a completion left money due. Opens (or refreshes) the claim; with short_payment_reply on, the player is
    asked "Sahi hai / Ghalat hai" (returns True so the caller does not also send the plain notice).
    `fresh_round` (a rejected balance screenshot, a transfer the bank never got): an existing claim starts over -- a new
    notice, a new 24 h, a new 4-day bonus window, reply and owner decision cleared. The +5 / -20 still happen at most once
    per booking (point_entries' unique index). `note` goes first in the notice ("Transfer ... qabool nahi hua: <reason>")."""
    if not await dues_active(db):
        return False
    _court, venue = await _venue_of(db, booking)
    if venue is None:
        return False
    total = int(round(float(booking.price)))
    paid = int(round(float(booking.amount_paid or 0)))
    due = max(total - paid, 0)
    if due <= 0:
        return False
    now = datetime.now(timezone.utc)
    claim = (await db.execute(select(ShortPaymentClaim).where(ShortPaymentClaim.booking_id == booking.id))).scalar_one_or_none()
    asking = await flag_on(db, "short_payment_reply") and booking.player_id is not None
    if claim is None:
        claim = ShortPaymentClaim(
            booking_id=booking.id, venue_id=venue.id, player_id=booking.player_id, total_pkr=total, paid_pkr=paid, due_pkr=due,
            status="awaiting_reply", reply_deadline_at=now + REPLY_WINDOW,
        )
        db.add(claim)
        fresh = True
    else:
        claim.total_pkr, claim.paid_pkr, claim.due_pkr = total, paid, due
        claim.resolved_at, claim.resolution = None, None
        fresh = False
        if fresh_round:
            claim.status, claim.reply_deadline_at = "awaiting_reply", now + REPLY_WINDOW
            claim.replied_at, claim.player_reason = None, None
            claim.owner_decision, claim.decided_by, claim.decided_at = None, None, None
            if claim.penalty_returned or not claim.penalty_applied:
                claim.penalty_applied, claim.penalty_returned = 0, False
            fresh = True
    await db.commit()
    if asking and fresh:
        player = await db.get(User, booking.player_id)
        code = short_code(booking.id)
        lead = f"{note} " if note else ""
        await _notify(
            db, settings, player, "player_short_ask", "Booking ka hisaab check karein",
            f"Booking {code}: {lead}Total {format_pkr(total)}, diye {format_pkr(paid)}, baqi {format_pkr(due)}. Sahi hai ya ghalat? "
            f"24 ghante mein jawab na diya to 20 points katenge. 4 din ke andar jawab dene par 5 points milenge.",
            reference_id=booking.id, template="khelo_short_payment",
            params=[code, format_pkr(total), format_pkr(paid), format_pkr(due)],
            buttons=[(f"short:{claim.id}:yes", "Sahi hai"), (f"short:{claim.id}:no", "Ghalat hai")],
        )
    return asking


def claim_out(claim: ShortPaymentClaim, booking: Booking | None = None) -> dict:
    return {
        "id": claim.id, "booking_id": claim.booking_id, "code": short_code(claim.booking_id), "venue_id": claim.venue_id,
        "player_id": claim.player_id, "total_pkr": claim.total_pkr, "paid_pkr": claim.paid_pkr,
        "due_pkr": int(round(float(booking.balance_due))) if booking is not None else claim.due_pkr,
        "status": claim.status, "reply_deadline_at": claim.reply_deadline_at, "replied_at": claim.replied_at,
        "player_reason": claim.player_reason, "penalty_applied": claim.penalty_applied, "penalty_returned": claim.penalty_returned,
        "owner_decision": claim.owner_decision, "resolved_at": claim.resolved_at, "resolution": claim.resolution,
        "player_name": booking.player_name if booking is not None else None,
        "starts_at": booking.starts_at if booking is not None else None,
        "created_at": claim.created_at,
        "bonus_until": notice_at(claim) + REPLY_BONUS_WINDOW if claim.reply_deadline_at else None,
    }


def notice_at(claim: ShortPaymentClaim) -> datetime:
    """When the player was (last) asked: the 24 h reply deadline is set from that moment (also on a fresh round)."""
    return claim.reply_deadline_at - REPLY_WINDOW


def can_reply_short(claim: ShortPaymentClaim) -> bool:
    """Not answered yet and not settled: the reply is taken before AND after the 24 h (no_reply)."""
    return claim.replied_at is None and claim.resolved_at is None and claim.status in ("awaiting_reply", "no_reply")


async def claim_for_booking(db: AsyncSession, booking_id: uuid.UUID) -> ShortPaymentClaim | None:
    return (await db.execute(select(ShortPaymentClaim).where(ShortPaymentClaim.booking_id == booking_id))).scalar_one_or_none()


async def reply_short(db: AsyncSession, settings: Settings, player: User, claim_id: uuid.UUID, answer: str,
                      reason: str | None) -> tuple[ShortPaymentClaim, int]:
    """"Sahi hai" / "Ghalat hai", taken any time until the due is settled (also after the 24 h penalty). Returns
    (claim, bonus points given): +5 once per booking, only when the reply comes within 4 days of the notice."""
    await _require_flag(db, "short_payment_reply")
    claim = await db.get(ShortPaymentClaim, claim_id, with_for_update=True)
    if claim is None or claim.player_id != player.id:
        raise _err(ErrorCode.NOT_FOUND, "Not found", status.HTTP_404_NOT_FOUND)
    if claim.replied_at is not None:
        raise _err(ErrorCode.ALREADY_REVIEWED, "You already answered this.", status.HTTP_409_CONFLICT)
    if not can_reply_short(claim):
        raise _err(ErrorCode.REPLY_WINDOW_CLOSED, "This balance is already settled.", status.HTTP_409_CONFLICT)
    now = datetime.now(timezone.utc)
    reason = (reason or "").strip() or None
    claim.replied_at = now
    claim.status = "confirmed" if answer == "yes" else "disputed"
    claim.player_reason = reason if answer == "no" else None
    bonus = 0
    if now <= notice_at(claim) + REPLY_BONUS_WINDOW:
        bonus = await add_points(db, player.id, claim.booking_id, REPLY_POINTS, "short_reply")
    await db.commit()
    await db.refresh(claim)
    if answer == "no":
        booking = await db.get(Booking, claim.booking_id)
        venue = await db.get(Venue, claim.venue_id)
        owner = await db.get(User, venue.owner_id) if venue is not None else None
        why = f" Wajah: {reason}" if reason else ""
        await _notify(
            db, settings, owner, "owner_short_dispute", "Player ne hisaab ghalat kaha",
            f"{(booking.player_name if booking else None) or 'Player'} ne booking {short_code(claim.booking_id)} ka baqi "
            f"{format_pkr(claim.due_pkr)} ghalat kaha.{why} Baqi raqam lein ya maaf karein.",
            reference_id=claim.booking_id,
        )
    return claim, bonus


async def _actor_can_record(db: AsyncSession, settings: Settings, actor: User, booking_id: uuid.UUID) -> Booking:
    from app.services.booking_service import BookingService

    return await BookingService(db, settings).require_accessible_booking(booking_id, actor, permission="record_payments")


async def _resolve(db: AsyncSession, settings: Settings, claim: ShortPaymentClaim, how: str) -> None:
    """Settle a due ("paid" / "waived") and give back the no-reply penalty if one was taken. Commits."""
    if claim.resolved_at is not None:
        return
    claim.resolved_at = datetime.now(timezone.utc)
    claim.resolution = how
    returned = 0
    if claim.penalty_applied and not claim.penalty_returned and claim.player_id:
        returned = await add_points(db, claim.player_id, claim.booking_id, claim.penalty_applied, "short_no_reply_returned")
        claim.penalty_returned = True
    await db.commit()
    player = await db.get(User, claim.player_id) if claim.player_id else None
    code = short_code(claim.booking_id)
    text = "clear ho gaya" if how == "paid" else "venue ne maaf kar diya"
    back = f" {returned} points wapas mil gaye." if returned else ""
    await _notify(
        db, settings, player, "player_due_resolved", "Baqi raqam clear",
        f"Booking {code} ka baqi {format_pkr(claim.due_pkr)} {text}.{back} Shukriya!",
        reference_id=claim.booking_id, template="khelo_due_resolved", params=[code, format_pkr(claim.due_pkr)],
    )


async def decide_short(db: AsyncSession, settings: Settings, actor: User, claim_id: uuid.UUID, decision: str) -> ShortPaymentClaim:
    """The owner's answer to "Ghalat hai": collect (the due stays and is carried) or waive (the price drops to what was paid)."""
    from app.services.audit_service import AuditService
    from app.services.payment_ledger_service import recompute_payment_totals

    claim = await db.get(ShortPaymentClaim, claim_id)
    if claim is None:
        raise _err(ErrorCode.NOT_FOUND, "Not found", status.HTTP_404_NOT_FOUND)
    booking = await _actor_can_record(db, settings, actor, claim.booking_id)
    if claim.status != "disputed" or claim.owner_decision is not None or claim.resolved_at is not None:
        raise _err(ErrorCode.ALREADY_REVIEWED, "This was already decided.", status.HTTP_409_CONFLICT)
    claim.owner_decision = decision
    claim.decided_by = actor.id
    claim.decided_at = datetime.now(timezone.utc)
    if decision == "waive":
        booking = await db.get(Booking, booking.id, with_for_update=True)
        old = float(booking.price)
        booking.price = round(float(booking.amount_paid or 0), 2)
        await recompute_payment_totals(db, booking)
        await AuditService(db).log(
            actor_user_id=actor.id, actor_type=actor.role.value, action="booking.due_waived", entity_type="booking",
            entity_id=booking.id, old_value={"price": old}, new_value={"price": float(booking.price), "claim_id": str(claim.id)},
        )
        await _resolve(db, settings, claim, "waived")
    else:
        await db.commit()
        player = await db.get(User, claim.player_id) if claim.player_id else None
        await _notify(
            db, settings, player, "player_short_decision", "Venue ne baqi raqam rakhi",
            f"Booking {short_code(claim.booking_id)}: venue ne baqi {format_pkr(claim.due_pkr)} sahi kaha. Agli dafa venue par de dein.",
            reference_id=claim.booking_id,
        )
    await db.refresh(claim)
    return claim


ProofUpload = tuple[bytes, str, str]  # (bytes, filename, content type), already validated by the API layer


async def mark_due_done(db: AsyncSession, settings: Settings, actor: User, claim_id: uuid.UUID, method: str = "cash",
                        proof: ProofUpload | None = None) -> ShortPaymentClaim:
    """The owner's "done" on a carried due. The booking price never changes here (only "waive" lowers it).
    cash     -> a new cash ledger entry dated today for the rest; the due is settled (0).
    transfer -> the screenshot goes through the balance-proof flow (Approvals, same checks); the due is settled when the
                owner approves it there (sync_claim_after_payment). Nothing is recorded before that."""
    from app.services.payment_ledger_service import PaymentLedgerService

    claim = await db.get(ShortPaymentClaim, claim_id)
    if claim is None:
        raise _err(ErrorCode.NOT_FOUND, "Not found", status.HTTP_404_NOT_FOUND)
    booking = await _actor_can_record(db, settings, actor, claim.booking_id)
    if claim.resolved_at is not None:
        raise _err(ErrorCode.ALREADY_REVIEWED, "This due is already settled.", status.HTTP_409_CONFLICT)
    rest = int(round(float(booking.balance_due or 0)))
    if method == "transfer":
        if proof is None:
            raise _err(ErrorCode.PROOF_REQUIRED, "A transfer needs the payment screenshot.")
        if rest <= 0:
            raise _err(ErrorCode.INVALID_BOOKING_STATE, "Nothing is due on this booking.")
        await _owner_balance_proof(db, settings, actor, booking, rest, proof, {"origin": DUE_DONE_ORIGIN, "claim_id": str(claim.id)})
        claim = await db.get(ShortPaymentClaim, claim_id)
        await db.refresh(claim)
        return claim
    if rest > 0:
        await PaymentLedgerService(db).record_entry(
            booking.id, amount_pkr=rest, method=PaymentMethod.CASH_AT_VENUE, recorded_by=actor, note="Purana baqi mila (due done)"
        )
    claim = await db.get(ShortPaymentClaim, claim_id)
    await _resolve(db, settings, claim, "paid")
    await db.refresh(claim)
    return claim


async def _owner_balance_proof(db: AsyncSession, settings: Settings, actor: User, booking: Booking, amount: int,
                               proof: ProofUpload, origin: dict) -> None:
    """A transfer the owner reports: the screenshot enters the balance-proof flow (OCR, duplicate and receiver checks, the
    Approvals card). It is credited only when someone approves it there."""
    from app.services.payment_service import PaymentService

    data, filename, content_type = proof
    await PaymentService(db, settings).submit_payment(
        booking, proof_bytes=data, filename=filename, content_type=content_type,
        owner_balance={"amount": amount, "origin": origin, "actor": actor},
    )


async def reverse_noshow(db: AsyncSession, settings: Settings, actor: User, booking_id: uuid.UUID, *, final_price: int,
                         received: int, method: str, proof: ProofUpload | None = None,
                         reply_id: uuid.UUID | None = None) -> Booking:
    """The owner takes back a no-show (after "Main aaya tha", or by hand). The owner states the final price, the money
    received now (on top of what is already recorded) and how it came. The full price is never assumed as cash:
    cash     -> one cash ledger entry for `received`;
    transfer -> the screenshot goes through the balance-proof flow and is credited only once approved there; approving it
                as correct gives the player +10 points (once per booking, flag player_points).
    The booking becomes completed. Money still due afterwards follows the normal "kam mila" path."""
    from app.services.audit_service import AuditService
    from app.services.booking_service import BookingService
    from app.services.payment_ledger_service import PaymentLedgerService, recompute_payment_totals

    service = BookingService(db, settings)
    booking = await service.require_accessible_booking(booking_id, actor, permission="record_payments")
    if booking.status != BookingStatus.NO_SHOW:
        raise _err(ErrorCode.INVALID_BOOKING_STATE, "This booking is not marked as a no-show.")
    paid = int(round(float(booking.amount_paid or 0)))
    if final_price < paid:
        raise _err(ErrorCode.VALIDATION_ERROR, f"The final price can't be less than what was already paid ({paid}).")
    room = final_price - paid
    if received < 0 or received > room:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, f"received_pkr must be between 0 and {room}",
                       details={"max": room})
    if method == "transfer" and received > 0 and proof is None:
        raise _err(ErrorCode.PROOF_REQUIRED, "A transfer needs the payment screenshot.")
    reply = None
    if reply_id is not None:
        reply = await db.get(NoShowReply, reply_id)
        if reply is None or reply.booking_id != booking.id:
            raise _err(ErrorCode.NOT_FOUND, "Not found", status.HTTP_404_NOT_FOUND)
        if reply.owner_decision is not None:
            raise _err(ErrorCode.ALREADY_REVIEWED, "This was already decided.", status.HTTP_409_CONFLICT)
    else:
        reply = (await db.execute(select(NoShowReply).where(NoShowReply.booking_id == booking.id))).scalar_one_or_none()
        if reply is not None and reply.owner_decision is not None:
            reply = None

    # the screenshot first: if it is refused (duplicate pending, bad image, storage), nothing else has changed
    if method == "transfer" and received > 0:
        await _owner_balance_proof(db, settings, actor, booking, received, proof, {"origin": NOSHOW_REVERSE_ORIGIN})
        booking = await db.get(Booking, booking_id)
        await db.refresh(booking)

    locked = await db.get(Booking, booking.id, with_for_update=True)
    old_price = float(locked.price)
    if int(round(old_price)) != final_price:
        locked.price = final_price
        if float(locked.advance_amount) > float(locked.price):
            locked.advance_amount = locked.price
        await recompute_payment_totals(db, locked)
    await AuditService(db).log(
        actor_user_id=actor.id, actor_type=actor.role.value, action="booking.noshow_reversed", entity_type="booking",
        entity_id=locked.id, old_value={"status": BookingStatus.NO_SHOW.value, "price": old_price},
        new_value={"price": final_price, "received_pkr": received, "method": method,
                   "reply_id": str(reply.id) if reply is not None else None},
    )
    if reply is not None:
        reply.owner_decision = "reverse"
        reply.decided_by = actor.id
        reply.decided_at = datetime.now(timezone.utc)
    await db.commit()
    if method == "cash" and received > 0:
        await PaymentLedgerService(db).record_entry(
            booking.id, amount_pkr=received, method=PaymentMethod.CASH_AT_VENUE, recorded_by=actor,
            note="No-show hataya: cash mila",
        )
    booking = await db.get(Booking, booking_id)
    await db.refresh(booking)
    booking = await service.mark_completed(booking, actor=actor)
    await db.refresh(booking)

    player = await db.get(User, booking.player_id) if booking.player_id else None
    code = short_code(booking.id)
    extra = " Transfer ka screenshot venue check kar raha hai." if method == "transfer" and received > 0 else ""
    await _notify(db, settings, player, "player_noshow_decision", "No-show par faisla",
                  f"Booking {code}: venue ne maan liya ke aap aaye the; no-show hata diya.{extra}", reference_id=booking.id)
    pending_transfer = method == "transfer" and received > 0
    if not pending_transfer and float(booking.balance_due or 0) > 0:
        from app.services.unsettled_notices import notify_unsettled

        asked = await open_short_claim(db, settings, booking)
        await notify_unsettled(db, settings, booking, actor, "short", short_pkr=int(round(float(booking.balance_due))),
                               player_notice=not asked)
    elif not pending_transfer:
        await maybe_award_transfer_points(db, settings, booking)
    return booking


async def award_noshow_transfer_points(db: AsyncSession, settings: Settings, actor: User, booking: Booking, payment) -> int:
    """The owner approved, as correct, the transfer screenshot sent with a no-show reversal: +10 points, once per booking,
    audited, with a notice ("+10 points mile, kul X"). Only with player_points on."""
    from app.services.audit_service import AuditService

    raw = payment.ocr_raw if isinstance(payment.ocr_raw, dict) else {}
    if raw.get("origin") != NOSHOW_REVERSE_ORIGIN or booking.player_id is None or not await flag_on(db, "player_points"):
        return 0
    got = await add_points(db, booking.player_id, booking.id, NOSHOW_TRANSFER_POINTS, "noshow_transfer_ok")
    if got:
        await AuditService(db).log(
            actor_user_id=actor.id, actor_type=actor.role.value, action="points.noshow_transfer_awarded", entity_type="booking",
            entity_id=booking.id, new_value={"points": got, "payment_id": str(payment.id)},
        )
    await db.commit()
    if got:
        player = await db.get(User, booking.player_id)
        bal = await points_balance(db, booking.player_id)
        code = short_code(booking.id)
        await _notify(
            db, settings, player, "player_points_reward", "Points mile",
            f"Booking {code}: venue ne aap ka transfer sahi maan liya: +{got} points mile, kul {bal}.",
            reference_id=booking.id, template="khelo_points_reward", params=[str(got), code, str(bal)],
        )
    return got


async def sync_claim_after_payment(db: AsyncSession, settings: Settings, booking: Booking) -> None:
    """A later payment (e.g. an approved balance screenshot) that clears the balance settles the due too."""
    claim = await claim_for_booking(db, booking.id)
    if claim is not None and claim.resolved_at is None and float(booking.balance_due or 0) <= 0:
        await _resolve(db, settings, claim, "paid")


async def send_balance_receipt(db: AsyncSession, settings: Settings, booking: Booking, credited: int) -> None:
    """A balance / no-show-reversal screenshot approved at the venue: the normal receipt -- push + in-app always, WhatsApp
    (khelo_payment_receipt) only while whatsapp_templates is on. No "pay the rest by transfer" line: balance is paid at the
    venue."""
    if credited <= 0 or booking.player_id is None:
        return
    player = await db.get(User, booking.player_id)
    code = short_code(booking.id)
    paid, due = float(booking.amount_paid or 0), float(booking.balance_due or 0)
    await _notify(
        db, settings, player, "payment_receipt", "Payment mil gayi",
        f"Booking {code}: {format_pkr(credited)} mil gaye. Kul ada {format_pkr(paid)}, baqi {format_pkr(due)}. Shukriya!",
        reference_id=booking.id, template="khelo_payment_receipt",
        params=[code, format_pkr(credited), format_pkr(paid), format_pkr(due)],
    )


TAKE_BACK_REASONS = {"transfer_booking": "transfer_booking_taken_back", "noshow_transfer_ok": "noshow_transfer_taken_back"}


async def take_back_transfer_points(db: AsyncSession, actor: User, booking: Booking, entry: PaymentEntry) -> tuple[int, int]:
    """"Bank mein nahi mila" + "Player se baqi maangein": the points that transfer earned are taken back -- the 50 for a
    booking paid fully by transfer (it no longer is) and the +10 when the transfer was a no-show reversal. Never below 0
    (add_points), once per booking and reason, audited. Returns (points taken, balance after). Commits."""
    from app.models.payment import Payment
    from app.services.audit_service import AuditService

    if booking.player_id is None:
        return 0, 0
    given = {
        p.reason: p.delta
        for p in (
            await db.execute(select(PointEntry).where(PointEntry.booking_id == booking.id, PointEntry.reason.in_(tuple(TAKE_BACK_REASONS))))
        ).scalars()
    }
    if "noshow_transfer_ok" in given:
        # only when THIS entry came from the no-show-reversal screenshot (the approval that wrote it, same approver, just before)
        payment = (
            await db.execute(
                select(Payment)
                .where(Payment.booking_id == booking.id, Payment.review_verdict == "approved", Payment.reviewed_by == entry.recorded_by,
                       Payment.reviewed_at <= entry.created_at)
                .order_by(Payment.reviewed_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        raw = payment.ocr_raw if payment is not None and isinstance(payment.ocr_raw, dict) else {}
        if raw.get("origin") != NOSHOW_REVERSE_ORIGIN:
            given.pop("noshow_transfer_ok")
    taken = 0
    for reason, delta in given.items():
        if delta > 0:
            taken += -await add_points(db, booking.player_id, booking.id, -delta, TAKE_BACK_REASONS[reason],
                                       note=f"Bank mein nahi mila ({entry.id})")
    if taken:
        await AuditService(db).log(
            actor_user_id=actor.id, actor_type=actor.role.value, action="points.bank_missing_taken_back", entity_type="booking",
            entity_id=booking.id, new_value={"points": taken, "entry_id": str(entry.id), "reasons": sorted(given)},
        )
    await db.commit()
    return taken, await points_balance(db, booking.player_id)


async def start_short_round(db: AsyncSession, settings: Settings, booking: Booking, actor: User | None, *, note: str,
                            plain_notice: bool = True) -> bool:
    """audit fixes 2026-10-31 (b, c): money the venue counted on did not come (a rejected balance / no-show-reversal
    screenshot, a transfer the bank never got). Exactly the short-payment flow: notice with total / paid / due and `note`,
    "Sahi hai / Ghalat hai", +5 within 4 days, -20 after 24 h without a reply, "Ghalat hai" to the owner, the due carried to
    the next booking. Returns True when the player was asked. With the reply flag off and `plain_notice`, the plain
    "baqi hai" notice goes out instead."""
    asked = await open_short_claim(db, settings, booking, fresh_round=True, note=note)
    if not asked and plain_notice and actor is not None and float(booking.balance_due or 0) > 0:
        from app.services.unsettled_notices import notify_unsettled

        await notify_unsettled(db, settings, booking, actor, "short", short_pkr=int(round(float(booking.balance_due))))
    return asked


async def run_short_payment_job(db: AsyncSession, settings: Settings, now: datetime | None = None) -> dict:
    """Every few minutes: an unanswered "Sahi hai / Ghalat hai" past its 24 h -> no_reply, -20 points (only what is there),
    and a message with the booking ID. Also gives back points used on bookings that died."""
    now = now or datetime.now(timezone.utc)
    penalised = 0
    if await flag_on(db, "short_payment_reply"):
        claims = (
            await db.execute(
                select(ShortPaymentClaim).where(ShortPaymentClaim.status == "awaiting_reply", ShortPaymentClaim.reply_deadline_at < now)
            )
        ).scalars().all()
        for claim in claims:
            claim.status = "no_reply"
            taken = 0
            if claim.player_id:
                taken = -await add_points(db, claim.player_id, claim.booking_id, -NO_REPLY_PENALTY, "short_no_reply")
            claim.penalty_applied = max(claim.penalty_applied or 0, taken)
            await db.commit()
            penalised += 1
            player = await db.get(User, claim.player_id) if claim.player_id else None
            code = short_code(claim.booking_id)
            await _notify(
                db, settings, player, "player_points_deducted", "Points kat gaye",
                f"Booking {code} ke baqi {format_pkr(claim.due_pkr)} par 24 ghante mein jawab nahi aaya, is liye {taken} points kat gaye. "
                f"Baqi raqam venue par de dein: points wapas mil jayenge. Hisaab ghalat ho to ab bhi 'Ghalat hai' bata sakte hain.",
                reference_id=claim.booking_id, template="khelo_points_deducted", params=[code, str(taken), "jawab nahi diya"],
            )
    returned = await return_points_for_dead_bookings(db)
    return {"penalised": penalised, "redeem_returned": returned}


async def open_dues_for(db: AsyncSession, venue_id: uuid.UUID, player_ids: set[uuid.UUID] | None = None) -> list[tuple[ShortPaymentClaim, Booking]]:
    q = (
        select(ShortPaymentClaim, Booking)
        .join(Booking, Booking.id == ShortPaymentClaim.booking_id)
        .where(ShortPaymentClaim.venue_id == venue_id, ShortPaymentClaim.resolved_at.is_(None))
        .order_by(ShortPaymentClaim.created_at)
    )
    if player_ids is not None:
        q = q.where(ShortPaymentClaim.player_id.in_(player_ids))
    return list((await db.execute(q)).all())


async def player_venue_stats(db: AsyncSession, venue_id: uuid.UUID, player_ids: set[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """No-shows and total bookings per player at one venue (for "No-show X / kul bookings Y" on the approval card)."""
    if not player_ids:
        return {}
    rows = (
        await db.execute(
            select(
                Booking.player_id,
                func.count(Booking.id).filter(Booking.status.in_((BookingStatus.BOOKED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW))),
                func.count(Booking.id).filter(Booking.status == BookingStatus.NO_SHOW),
            )
            .join(Court, Court.id == Booking.court_id)
            .where(Court.venue_id == venue_id, Booking.player_id.in_(player_ids))
            .group_by(Booking.player_id)
        )
    ).all()
    return {pid: {"total_bookings": int(total), "no_shows": int(ns)} for pid, total, ns in rows}


async def list_dues(db: AsyncSession, settings: Settings, actor: User, venue_id: uuid.UUID) -> list[dict]:
    from app.services.venue_service import VenueService

    await VenueService(db, settings).require_owned_venue(venue_id, actor, permission="view_ledger")
    return [claim_out(c, b) for c, b in await open_dues_for(db, venue_id)]


# ------------------------------------------------------------------ no-show reply + arrival GPS


async def _venue_point(db: AsyncSession, venue_id: uuid.UUID) -> tuple[float, float] | None:
    row = (await db.execute(select(func.ST_Y(Venue.location), func.ST_X(Venue.location)).where(Venue.id == venue_id))).first()
    return (float(row[0]), float(row[1])) if row and row[0] is not None else None


async def record_arrival(db: AsyncSession, player: User, booking_id: uuid.UUID, lat: float, lng: float, accuracy_m: float | None) -> ArrivalCheck:
    """ONE GPS reading for "Pohanch gaya", from an hour before the start until the end of the slot."""
    await _require_flag(db, "noshow_reply")
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.player_id != player.id:
        raise _err(ErrorCode.BOOKING_NOT_FOUND, "Booking not found", status.HTTP_404_NOT_FOUND)
    now = datetime.now(timezone.utc)
    if booking.status not in (BookingStatus.BOOKED, BookingStatus.COMPLETED) or not (booking.starts_at - timedelta(hours=1) <= now <= booking.ends_at):
        raise _err(ErrorCode.ARRIVAL_WINDOW_CLOSED, "You can say you arrived from an hour before the start until the end of the slot.")
    court = await db.get(Court, booking.court_id)
    pin = await _venue_point(db, court.venue_id) if court else None
    dist = distance_m(lat, lng, pin[0], pin[1]) if pin else None
    if pin is None or pin_is_fallback(*pin):
        verdict = "pin_unreliable"
    else:
        verdict = "near" if dist is not None and dist <= ARRIVAL_RADIUS_M else "far"
    check = ArrivalCheck(booking_id=booking.id, player_id=player.id, latitude=lat, longitude=lng, accuracy_m=accuracy_m,
                         distance_m=round(dist, 1) if dist is not None else None, verdict=verdict)
    db.add(check)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _err(ErrorCode.ALREADY_REVIEWED, "Your arrival was already recorded for this booking.", status.HTTP_409_CONFLICT)
    await db.refresh(check)
    return check


async def reply_noshow(db: AsyncSession, settings: Settings, player: User, booking_id: uuid.UUID, note: str | None) -> NoShowReply:
    await _require_flag(db, "noshow_reply")
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.player_id != player.id:
        raise _err(ErrorCode.BOOKING_NOT_FOUND, "Booking not found", status.HTTP_404_NOT_FOUND)
    if booking.status != BookingStatus.NO_SHOW:
        raise _err(ErrorCode.INVALID_BOOKING_STATE, "This booking is not marked as a no-show.")
    reply = NoShowReply(booking_id=booking.id, player_id=player.id, note=(note or "").strip() or None)
    db.add(reply)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _err(ErrorCode.ALREADY_REVIEWED, "You already answered this no-show.", status.HTTP_409_CONFLICT)
    await db.refresh(reply)
    court, venue = await _venue_of(db, booking)
    owner = await db.get(User, venue.owner_id) if venue is not None else None
    arrival = (await db.execute(select(ArrivalCheck).where(ArrivalCheck.booking_id == booking.id))).scalar_one_or_none()
    gps = {"near": " GPS ke mutabiq player venue par tha.", "far": " GPS ke mutabiq player venue se door tha."}.get(
        arrival.verdict if arrival else "", ""
    )
    why = f" Unhon ne likha: {reply.note}" if reply.note else ""
    await _notify(
        db, settings, owner, "owner_noshow_reply", "Player ne kaha: main aaya tha",
        f"{booking.player_name or 'Player'} ne booking {short_code(booking.id)} ({court.name if court else ''}, "
        f"{format_time(booking.starts_at)}) par kaha ke woh aaye the.{gps}{why}",
        reference_id=booking.id,
    )
    return reply


async def decide_noshow(db: AsyncSession, settings: Settings, actor: User, reply_id: uuid.UUID, decision: str) -> NoShowReply:
    """keep = the no-show stands. reverse is not taken here: it needs the price / received / method dialog
    (reverse_noshow, POST /owners/bookings/{id}/noshow-reverse), so the money is never guessed."""
    from app.services.booking_service import BookingService

    reply = await db.get(NoShowReply, reply_id)
    if reply is None:
        raise _err(ErrorCode.NOT_FOUND, "Not found", status.HTTP_404_NOT_FOUND)
    if decision == "reverse":
        raise _err(ErrorCode.NOSHOW_REVERSAL_REQUIRED, NOSHOW_REVERSAL_MESSAGE, status.HTTP_409_CONFLICT)
    service = BookingService(db, settings)
    try:
        booking = await service.require_accessible_booking(reply.booking_id, actor, permission="check_in")
    except AppError as exc:
        if exc.code != ErrorCode.NOT_STAFF_PERMITTED:
            raise
        booking = await service.require_accessible_booking(reply.booking_id, actor, permission="record_payments")
    if reply.owner_decision is not None:
        raise _err(ErrorCode.ALREADY_REVIEWED, "This was already decided.", status.HTTP_409_CONFLICT)
    reply.owner_decision = decision
    reply.decided_by = actor.id
    reply.decided_at = datetime.now(timezone.utc)
    await db.commit()
    player = await db.get(User, reply.player_id)
    await _notify(db, settings, player, "player_noshow_decision", "No-show par faisla",
                  f"Booking {short_code(reply.booking_id)}: venue ne no-show barqarar rakha.", reference_id=reply.booking_id)
    await db.refresh(reply)
    return reply


async def noshow_details(db: AsyncSession, booking_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """For no-show lists: the player's reply and the arrival verdict; `highlight` = GPS shows the player was there (red)."""
    if not booking_ids:
        return {}
    replies = {r.booking_id: r for r in (await db.execute(select(NoShowReply).where(NoShowReply.booking_id.in_(booking_ids)))).scalars()}
    arrivals = {a.booking_id: a for a in (await db.execute(select(ArrivalCheck).where(ArrivalCheck.booking_id.in_(booking_ids)))).scalars()}
    out = {}
    for bid in booking_ids:
        r, a = replies.get(bid), arrivals.get(bid)
        out[bid] = {
            "reply_id": r.id if r else None, "player_replied": r is not None, "player_note": r.note if r else None,
            "owner_decision": r.owner_decision if r else None,
            "arrival_verdict": a.verdict if a else None, "arrival_distance_m": a.distance_m if a else None,
            "highlight": bool(a and a.verdict == "near"),
        }
    return out


async def arrival_state(db: AsyncSession, player: User, booking: Booking) -> dict:
    """What the booking screen shows for "Pohanch gaya" / "Main aaya tha"."""
    on = await flag_on(db, "noshow_reply")
    if not on or booking.player_id != player.id:
        return {"enabled": False, "arrival": None, "can_arrive": False, "noshow_reply": None, "can_reply_noshow": False}
    a = (await db.execute(select(ArrivalCheck).where(ArrivalCheck.booking_id == booking.id))).scalar_one_or_none()
    r = (await db.execute(select(NoShowReply).where(NoShowReply.booking_id == booking.id))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    can_arrive = a is None and booking.status in (BookingStatus.BOOKED, BookingStatus.COMPLETED) and (
        booking.starts_at - timedelta(hours=1) <= now <= booking.ends_at
    )
    return {
        "enabled": True,
        "arrival": {"verdict": a.verdict, "distance_m": a.distance_m, "at": a.created_at} if a else None,
        "can_arrive": can_arrive,
        "noshow_reply": {"note": r.note, "owner_decision": r.owner_decision, "at": r.created_at} if r else None,
        "can_reply_noshow": r is None and booking.status == BookingStatus.NO_SHOW,
    }


async def player_short_state(db: AsyncSession, player: User, booking: Booking) -> dict | None:
    claim = await claim_for_booking(db, booking.id)
    if claim is None or claim.player_id != player.id:
        return None
    can = can_reply_short(claim) and await flag_on(db, "short_payment_reply")
    return {**claim_out(claim, booking), "can_reply": can}


# shared for the approvals card
async def approval_context(db: AsyncSession, venue_ids_by_player: dict[uuid.UUID, uuid.UUID]) -> dict[tuple[uuid.UUID, uuid.UUID], dict]:
    """(venue_id, player_id) -> {"dues": [...], "no_shows": n, "total_bookings": n}; empty when player_dues is off."""
    if not venue_ids_by_player or not await flag_on(db, "player_dues"):
        return {}
    out: dict[tuple[uuid.UUID, uuid.UUID], dict] = {}
    by_venue: dict[uuid.UUID, set[uuid.UUID]] = {}
    for pid, vid in venue_ids_by_player.items():
        by_venue.setdefault(vid, set()).add(pid)
    for vid, pids in by_venue.items():
        stats = await player_venue_stats(db, vid, pids)
        dues = await open_dues_for(db, vid, pids)
        for pid in pids:
            out[(vid, pid)] = {
                "dues": [claim_out(c, b) for c, b in dues if c.player_id == pid],
                **stats.get(pid, {"total_bookings": 0, "no_shows": 0}),
            }
    return out




# ------------------------------------------------------------------ item 9: dashboards


async def money_health(db: AsyncSession, venue_ids: list[uuid.UUID] | None = None) -> dict:
    """Points, dues and disputes in one block: for one venue's staff dashboard (venue_ids=[id]) or the whole platform (None).
    Read-only; counts whatever exists whether or not the flags are on (so nothing is hidden from the admin)."""
    claim_q = select(ShortPaymentClaim, Booking).join(Booking, Booking.id == ShortPaymentClaim.booking_id).where(
        ShortPaymentClaim.resolved_at.is_(None)
    )
    reply_q = (
        select(NoShowReply.id, Court.venue_id)
        .join(Booking, Booking.id == NoShowReply.booking_id)
        .join(Court, Court.id == Booking.court_id)
        .where(NoShowReply.owner_decision.is_(None))
    )
    points_q = (
        select(Court.venue_id, PointEntry.reason, func.sum(PointEntry.delta))
        .join(Booking, Booking.id == PointEntry.booking_id)
        .join(Court, Court.id == Booking.court_id)
        .group_by(Court.venue_id, PointEntry.reason)
    )
    if venue_ids is not None:
        claim_q = claim_q.where(ShortPaymentClaim.venue_id.in_(venue_ids))
        reply_q = reply_q.where(Court.venue_id.in_(venue_ids))
        points_q = points_q.where(Court.venue_id.in_(venue_ids))
    claims = (await db.execute(claim_q)).all()
    replies = (await db.execute(reply_q)).all()
    points = (await db.execute(points_q)).all()
    per: dict[uuid.UUID, dict] = {}

    def row(vid: uuid.UUID) -> dict:
        return per.setdefault(vid, {"venue_id": vid, "dues_open": 0, "dues_open_pkr": 0, "short_disputes_waiting": 0,
                                    "noshow_replies_waiting": 0, "points_awarded": 0, "points_used": 0})

    for c, b in claims:
        r = row(c.venue_id)
        r["dues_open"] += 1
        r["dues_open_pkr"] += int(round(float(b.balance_due or 0)))
        if c.status == "disputed" and c.owner_decision is None:
            r["short_disputes_waiting"] += 1
    for _rid, vid in replies:
        row(vid)["noshow_replies_waiting"] += 1
    for vid, reason, total in points:
        r = row(vid)
        if reason in ("transfer_booking", "short_reply"):
            r["points_awarded"] += int(total or 0)
        elif reason == "redeem":
            r["points_used"] += -int(total or 0)
    names = {}
    if per:
        names = {v.id: v.name for v in (await db.execute(select(Venue).where(Venue.id.in_(list(per))))).scalars()}
    venues = sorted(
        ({**r, "venue_name": names.get(r["venue_id"], "")} for r in per.values()),
        key=lambda r: (-r["short_disputes_waiting"] - r["noshow_replies_waiting"], -r["dues_open_pkr"]),
    )
    keys = ("dues_open", "dues_open_pkr", "short_disputes_waiting", "noshow_replies_waiting", "points_awarded", "points_used")
    return {"totals": {k: sum(r[k] for r in venues) for k in keys}, "venues": venues}
