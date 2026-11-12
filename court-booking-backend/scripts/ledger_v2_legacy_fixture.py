"""DEV ONLY. Builds pre-ledger-v2 data the way the OLD code wrote it (same notes, audit actions, methods, disputes), so the
ledger v2 backfill + check can be run on a local DB that has no real history (docs/design/LEDGER-V2-CONTRACT.md 3.2/3.3).

Each scenario is one booking at venue "LV2 Overnight" (open 6 PM - 4 AM every day) or "LV2 Day" (8 AM - 11 PM). Rows are
written directly with explicit created_at; every write mirrors a specific old writer (named in the comment). Refuses to run
against anything but a localhost database, and does nothing if the fixture venues already exist.

    python scripts/ledger_v2_legacy_fixture.py
"""

import asyncio
import sys
import uuid
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import AsyncSessionLocal  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.audit_phase3 import ShortPaymentClaim  # noqa: E402
from app.models.booking import Booking, BookingSource, BookingStatus, CancelledBy  # noqa: E402
from app.models.court import Court  # noqa: E402
from app.models.dispute import PaymentDispute  # noqa: E402
from app.models.payment import Payment  # noqa: E402
from app.models.payment_entry import PaymentEntry, PaymentMethod  # noqa: E402
from app.models.refund_flow import Escalation, RefundTransfer  # noqa: E402
from app.models.schedule import ScheduleTemplate  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.models.venue import Venue, VenueStatus  # noqa: E402
from app.utils.timezone import naive_pkt_to_utc  # noqa: E402

TODAY = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=5)  # naive PKT now


def pkt(days_ago: int, hh: int, mm: int = 0) -> datetime:
    """An aware UTC instant for PKT wall time `days_ago` days before today at hh:mm."""
    d = (TODAY - timedelta(days=days_ago)).date()
    return naive_pkt_to_utc(datetime(d.year, d.month, d.day, hh, mm))


class F:
    def __init__(self, db):
        self.db = db
        self.slot = 0
        self.scenarios: list[tuple[str, uuid.UUID, str]] = []

    async def booking(self, court, name, price, status, start, *, hours=1, cancelled_by=None, player=None, points=0,
                      advance=0, source=BookingSource.WALKIN) -> Booking:
        b = Booking(
            court_id=court.id, player_id=player.id if player else None, starts_at=start, ends_at=start + timedelta(hours=hours),
            status=status, source=source, player_name=name, price=price, advance_amount=advance,
            cancelled_by=cancelled_by, points_discount_pkr=points,
        )
        self.db.add(b)
        await self.db.flush()
        return b

    async def entry(self, b, amount, method, at, note=None, by=None, reverses=None) -> PaymentEntry:
        e = PaymentEntry(booking_id=b.id, amount_pkr=amount, method=method, note=note, recorded_by=by.id if by else None,
                         reverses_entry_id=reverses)
        self.db.add(e)
        await self.db.flush()
        e.created_at = at
        return e

    async def audit(self, entity_type, entity_id, action, old, new, at, actor=None):
        a = AuditLog(entity_type=entity_type, entity_id=entity_id, action=action, old_value=old, new_value=new,
                     actor_id=actor.id if actor else None, actor_type=actor.role.value if actor else "system")
        self.db.add(a)
        await self.db.flush()
        a.created_at = at

    async def settle(self, b):
        """What recompute_payment_totals did (old rule: balance = price - paid)."""
        await self.db.flush()
        total = sum(e.amount_pkr for e in (await self.db.scalars(select(PaymentEntry).where(PaymentEntry.booking_id == b.id))).all())
        b.amount_paid = total
        b.balance_due = max(float(b.price) - total, 0.0)

    def note(self, key, b, text):
        self.scenarios.append((key, b.id, text))


async def build(db) -> list[tuple[str, uuid.UUID, str]]:
    """Writes the scenarios with `db` and commits; returns (key, booking id, text). Empty if already present."""
    if await db.scalar(select(Venue).where(Venue.name == "LV2 Overnight")):
        return []
    f = F(db)
    owner = User(phone="+923009990001", role=UserRole.OWNER, name="LV2 Owner", phone_verified_at=datetime.now(timezone.utc))
    staff = User(phone="+923009990002", role=UserRole.STAFF, name="LV2 Staff", phone_verified_at=datetime.now(timezone.utc))
    admin = User(phone="+923009990003", role=UserRole.ADMIN, name="LV2 Admin", phone_verified_at=datetime.now(timezone.utc))
    p1 = User(phone="+923009990011", role=UserRole.PLAYER, name="Bilal", phone_verified_at=datetime.now(timezone.utc))
    p2 = User(phone="+923009990012", role=UserRole.PLAYER, name="Sana", phone_verified_at=datetime.now(timezone.utc))
    db.add_all([owner, staff, admin, p1, p2])
    await db.flush()
    vn = Venue(owner_id=owner.id, name="LV2 Overnight", slug=f"lv2-overnight-{uuid.uuid4().hex[:6]}", address="x", city="Karachi",
               location="SRID=4326;POINT(67.0 24.8)", sports=["padel"], status=VenueStatus.APPROVED,
               cancellation_allowed=True, cancellation_cutoff_hours=6)
    vd = Venue(owner_id=owner.id, name="LV2 Day", slug=f"lv2-day-{uuid.uuid4().hex[:6]}", address="x", city="Karachi",
               location="SRID=4326;POINT(67.1 24.9)", sports=["padel"], status=VenueStatus.APPROVED,
               cancellation_allowed=True, cancellation_cutoff_hours=6)
    db.add_all([vn, vd])
    await db.flush()
    cn = Court(venue_id=vn.id, name="Night Court", sport="padel", slot_minutes=60)
    cn2 = Court(venue_id=vn.id, name="Night Court 2", sport="padel", slot_minutes=60)
    cd = Court(venue_id=vd.id, name="Day Court", sport="padel", slot_minutes=60)
    db.add_all([cn, cn2, cd])
    await db.flush()
    for dow in range(7):
        db.add(ScheduleTemplate(court_id=cn.id, day_of_week=dow, open_time=time(18, 0), close_time=time(4, 0), closes_next_day=True))
        db.add(ScheduleTemplate(court_id=cn2.id, day_of_week=dow, open_time=time(18, 0), close_time=time(2, 0), closes_next_day=True))
        db.add(ScheduleTemplate(court_id=cd.id, day_of_week=dow, open_time=time(8, 0), close_time=time(23, 0), closes_next_day=False))
    await db.flush()
    C, T, O = PaymentMethod.CASH_AT_VENUE, PaymentMethod.BANK_TRANSFER_PROOF, PaymentMethod.OTHER

    # S01 partly paid, completed, open short claim (no reply) -- record_entry + open_short_claim
    b = await f.booking(cd, "S01 Partly", 5000, BookingStatus.COMPLETED, pkt(20, 10))
    await f.entry(b, 3000, T, pkt(21, 15), "Advance credited at approval", by=owner)
    await f.settle(b)
    db.add(ShortPaymentClaim(booking_id=b.id, venue_id=vd.id, total_pkr=5000, paid_pkr=3000, due_pkr=2000, status="no_reply",
                             reply_deadline_at=pkt(19, 10)))
    f.note("S01", b, "partly paid (3,000 / 5,000), completed, open due 2,000")

    # S02 paid in two parts, the 2nd at 1:00 AM PKT on the overnight venue (business day = previous day)
    b = await f.booking(cn, "S02 Two parts", 6000, BookingStatus.COMPLETED, pkt(10, 23))
    await f.entry(b, 2000, T, pkt(11, 14), "Advance credited at approval")
    await f.entry(b, 4000, C, pkt(9, 1, 0), "Balance received", by=staff)  # 1:00 AM, belongs to the night before
    await f.settle(b)
    f.note("S02", b, "two payments; the 4,000 cash at 1:00 AM PKT belongs to the previous business day")

    # S03 points redeemed (phase3.redeem_points: price lowered, points_discount_pkr set, audit booking.points_redeemed)
    b = await f.booking(cd, "S03 Points", 4500, BookingStatus.BOOKED, pkt(-3, 18), player=p1, points=500)
    await f.audit("booking", b.id, "booking.points_redeemed", {"price": 5000.0},
                  {"price": 4500.0, "discount_pkr": 500, "points": 500}, pkt(2, 12), p1)
    await f.entry(b, 1000, T, pkt(2, 13), "Advance credited at approval")
    await f.settle(b)
    f.note("S03", b, "points 500 off a 5,000 booking, 1,000 advance, upcoming")

    # S04 owner waived a disputed due (decide_short waive: price -> paid, audit booking.due_waived)
    b = await f.booking(cd, "S04 Waived", 3000, BookingStatus.COMPLETED, pkt(15, 11), player=p1)
    await f.entry(b, 3000, C, pkt(15, 12), "Booking completed: cash", by=owner)
    claim = ShortPaymentClaim(booking_id=b.id, venue_id=vd.id, player_id=p1.id, total_pkr=5000, paid_pkr=3000, due_pkr=2000,
                              status="disputed", reply_deadline_at=pkt(14, 12), owner_decision="waive", decided_by=owner.id,
                              decided_at=pkt(13, 9), resolved_at=pkt(13, 9), resolution="waived")
    db.add(claim)
    await db.flush()
    await f.audit("booking", b.id, "booking.due_waived", {"price": 5000.0}, {"price": 3000.0, "claim_id": str(claim.id)},
                  pkt(13, 9), owner)
    await f.settle(b)
    f.note("S04", b, "5,000 booking, 3,000 paid, owner waived 2,000 (old code set price to 3,000)")

    # S05 Khelo escalation decided for the player on a short payment (refund_flow _apply_player_win: price -> paid)
    b = await f.booking(cd, "S05 Khelo waive", 2500, BookingStatus.COMPLETED, pkt(12, 12), player=p2)
    await f.entry(b, 2500, T, pkt(13, 16), "Advance credited at approval")
    claim = ShortPaymentClaim(booking_id=b.id, venue_id=vd.id, player_id=p2.id, total_pkr=4000, paid_pkr=2500, due_pkr=1500,
                              status="disputed", reply_deadline_at=pkt(11, 12), owner_decision="collect",
                              resolved_at=pkt(9, 10), resolution="waived")
    db.add(claim)
    await db.flush()
    esc = Escalation(kind="short_payment", source_id=claim.id, booking_id=b.id, venue_id=vd.id, player_id=p2.id,
                     status="decided", admin_decision="player", admin_note="Player sahi")
    db.add(esc)
    await db.flush()
    await f.audit("escalation", esc.id, "escalation.decided", None,
                  {"kind": "short_payment", "decision": "player", "note": "Player sahi", "price_before": 4000.0, "price_after": 2500.0},
                  pkt(9, 10), admin)
    await f.settle(b)
    f.note("S05", b, "4,000 booking, 2,500 paid, Khelo decided for the player (old code set price to 2,500)")

    # S06 no-show taken back with a lower final price (reverse_noshow: price 5000 -> 4000, cash 3000)
    b = await f.booking(cd, "S06 Noshow reversed", 4000, BookingStatus.COMPLETED, pkt(8, 13), player=p1)
    await f.entry(b, 1000, T, pkt(9, 11), "Advance credited at approval")
    await f.audit("booking", b.id, "booking.noshow_reversed", {"status": "no_show", "price": 5000.0},
                  {"price": 4000, "received_pkr": 3000, "method": "cash", "reply_id": None}, pkt(7, 10), owner)
    await f.entry(b, 3000, C, pkt(7, 10), "No-show hataya: cash mila", by=owner)
    await f.settle(b)
    f.note("S06", b, "no-show reversed at a final price of 4,000 (was 5,000), 1,000 + 3,000 paid")

    # S07 old no-show (advance kept, rest ignored by the old Lena baqi)
    b = await f.booking(cd, "S07 Noshow", 5000, BookingStatus.NO_SHOW, pkt(6, 14), player=p2)
    await f.entry(b, 1000, T, pkt(7, 11), "Advance credited at approval")
    await f.settle(b)
    f.note("S07", b, "no-show, 1,000 advance of 5,000")

    # S08 no-show with an OPEN short claim (owner chased the rest) -> backfill must NOT add a no_show adjustment
    b = await f.booking(cd, "S08 Noshow chased", 5000, BookingStatus.NO_SHOW, pkt(5, 15), player=p1)
    await f.entry(b, 1000, T, pkt(6, 11), "Advance credited at approval")
    await f.settle(b)
    db.add(ShortPaymentClaim(booking_id=b.id, venue_id=vd.id, player_id=p1.id, total_pkr=5000, paid_pkr=1000, due_pkr=4000,
                             status="awaiting_reply", reply_deadline_at=pkt(4, 15)))
    f.note("S08", b, "no-show with an open due of 4,000 (expected in the check list: needs your decision)")

    # S09 player cancelled before the cutoff, refund owed (_flag_refund_for_voluntary_cancel)
    b = await f.booking(cd, "S09 Cancel owed", 5000, BookingStatus.CANCELLED, pkt(-2, 16), cancelled_by=CancelledBy.PLAYER, player=p2)
    await f.entry(b, 500, T, pkt(3, 12), "Advance credited at approval")
    await f.settle(b)
    db.add(PaymentDispute(booking_id=b.id, player_id=p2.id, reason="player_cancelled_paid_booking", refund_amount=500))
    f.note("S09", b, "player cancelled, 500 refund owed")

    # S10 cancelled, refund paid in full (admin_service.mark_refund_paid: negative OTHER entry + transfer row)
    b = await f.booking(cd, "S10 Cancel refunded", 5000, BookingStatus.CANCELLED, pkt(-1, 17), cancelled_by=CancelledBy.OWNER, player=p1)
    await f.entry(b, 1000, T, pkt(4, 12), "Advance credited at approval")
    d = PaymentDispute(booking_id=b.id, player_id=p1.id, reason="owner_cancelled_paid_booking", refund_amount=1000,
                       refunded_amount=1000, refund_status="refunded", resolved=True, refund_reference="REF10",
                       refunded_at=pkt(2, 15), refunded_by_user_id=owner.id)
    db.add(d)
    await db.flush()
    db.add(RefundTransfer(dispute_id=d.id, booking_id=b.id, amount=1000, reference="REF10", sent_by=owner.id))
    await f.entry(b, -1000, O, pkt(2, 15), "Refund paid (REF10)", by=owner)
    await f.settle(b)
    f.note("S10", b, "owner cancelled, 1,000 refunded in full")

    # S11 cancelled, refund paid in part
    b = await f.booking(cd, "S11 Cancel partial", 5000, BookingStatus.CANCELLED, pkt(-1, 19), cancelled_by=CancelledBy.PLAYER, player=p2)
    await f.entry(b, 1000, T, pkt(5, 12), "Advance credited at approval")
    d = PaymentDispute(booking_id=b.id, player_id=p2.id, reason="player_cancelled_paid_booking", refund_amount=1000,
                       refunded_amount=600, refund_status="owed", refund_reference="REF11", refunded_at=pkt(1, 15))
    db.add(d)
    await db.flush()
    db.add(RefundTransfer(dispute_id=d.id, booking_id=b.id, amount=600, reference="REF11", sent_by=owner.id))
    await f.entry(b, -600, O, pkt(1, 15), "Refund paid (REF11) -- partial, PKR 400 still owed", by=owner)
    await f.settle(b)
    f.note("S11", b, "cancelled, 1,000 paid, 600 refunded, 400 still owed")

    # S12 overpayment_excess, refunded (approve with money above the price: ledger capped, excess only on the dispute)
    b = await f.booking(cd, "S12 Excess refunded", 5000, BookingStatus.COMPLETED, pkt(18, 12), player=p1)
    pay = Payment(booking_id=b.id, amount_claimed=5500, ocr_amount=5500, review_verdict="approved", reviewed_at=pkt(19, 10))
    db.add(pay)
    await db.flush()
    await f.entry(b, 5000, T, pkt(19, 10), "Advance credited at approval", by=owner)
    d = PaymentDispute(booking_id=b.id, payment_id=pay.id, player_id=p1.id, reason="overpayment_excess", refund_amount=500,
                       refunded_amount=500, refund_status="refunded", resolved=True, refund_reference="REF12",
                       refunded_at=pkt(17, 11))
    db.add(d)
    await db.flush()
    db.add(RefundTransfer(dispute_id=d.id, booking_id=b.id, amount=500, reference="REF12", sent_by=owner.id))
    await f.settle(b)
    f.note("S12", b, "player sent 5,500 on 5,000; 500 refunded (old ledger never saw the 500)")

    # S13 overpayment_excess still owed
    b = await f.booking(cn, "S13 Excess owed", 5000, BookingStatus.COMPLETED, pkt(16, 20), player=p2)
    pay = Payment(booking_id=b.id, amount_claimed=5300, ocr_amount=5300, review_verdict="approved", reviewed_at=pkt(16, 2))
    db.add(pay)
    await db.flush()
    await f.entry(b, 5000, T, pkt(16, 2), "Advance credited at approval", by=owner)  # 2 AM: previous business day
    db.add(PaymentDispute(booking_id=b.id, payment_id=pay.id, player_id=p2.id, reason="overpayment_excess", refund_amount=300))
    await f.settle(b)
    f.note("S13", b, "5,300 on 5,000 approved at 2:00 AM; 300 still owed back")

    # S14 cancelled_payment_received: screenshot on an expired booking, owner said money came (nothing in the ledger)
    b = await f.booking(cd, "S14 Expired paid", 5000, BookingStatus.CANCELLED, pkt(9, 18), cancelled_by=CancelledBy.SYSTEM, player=p1)
    pay = Payment(booking_id=b.id, amount_claimed=2000, ocr_amount=2000, review_verdict="acknowledged", reviewed_at=pkt(10, 9))
    db.add(pay)
    await db.flush()
    db.add(PaymentDispute(booking_id=b.id, payment_id=pay.id, player_id=p1.id, reason="cancelled_payment_received", refund_amount=2000))
    await f.settle(b)
    f.note("S14", b, "expired booking, 2,000 received (acknowledged), 2,000 owed back")

    # S15 refund paid then taken back by Khelo (player did not receive it)
    b = await f.booking(cd, "S15 Refund reopened", 5000, BookingStatus.CANCELLED, pkt(-1, 21), cancelled_by=CancelledBy.PLAYER, player=p2)
    await f.entry(b, 1000, T, pkt(8, 12), "Advance credited at approval")
    d = PaymentDispute(booking_id=b.id, player_id=p2.id, reason="player_cancelled_paid_booking", refund_amount=1000,
                       refunded_amount=0, refund_status="owed", refund_reference="REF15", refunded_at=pkt(6, 15))
    db.add(d)
    await db.flush()
    t = RefundTransfer(dispute_id=d.id, booking_id=b.id, amount=1000, reference="REF15", sent_by=owner.id,
                       player_response="not_received")
    db.add(t)
    await db.flush()
    await f.entry(b, -1000, O, pkt(6, 15), "Refund paid (REF15)", by=owner)
    esc = Escalation(kind="refund", source_id=t.id, booking_id=b.id, venue_id=vd.id, player_id=p2.id, status="decided",
                     admin_decision="player", admin_note="Nahi mila")
    db.add(esc)
    await db.flush()
    await f.entry(b, 1000, O, pkt(4, 11), f"Refund taken back by Khelo: the player did not receive it (escalation {str(esc.id)[:8].upper()})", by=admin)
    await f.settle(b)
    f.note("S15", b, "1,000 refunded, then Khelo took it back (player did not get it) -> 1,000 owed again")

    # S16 the walk-in bug: 4,000 accepted on a 2,000 booking (create_walkin has no cap)
    b = await f.booking(cd, "S16 Walkin 4000", 2000, BookingStatus.COMPLETED, pkt(3, 20))
    await f.entry(b, 4000, C, pkt(3, 20), "Walk-in booking", by=staff)
    await f.settle(b)
    f.note("S16", b, "walk-in 2,000 with 4,000 recorded (bug 1) -> 2,000 owed back, no dispute row (expected in the check list)")

    # S17 completion correction downward ("Booking completed" adjust_total_paid: negative OTHER entry)
    b = await f.booking(cd, "S17 Completion fix", 5000, BookingStatus.COMPLETED, pkt(2, 9))
    await f.entry(b, 3000, C, pkt(2, 9), "Walk-in booking", by=staff)
    await f.entry(b, -2000, O, pkt(2, 11), "Booking completed: owner says PKR 1,000 received", by=owner)
    await f.settle(b)
    db.add(ShortPaymentClaim(booking_id=b.id, venue_id=vd.id, total_pkr=5000, paid_pkr=1000, due_pkr=4000, status="no_reply",
                             reply_deadline_at=pkt(1, 11)))
    f.note("S17", b, "3,000 recorded then corrected down to 1,000 at completion; 4,000 due")

    # S18 a payment reversed ("Ghalti theek karein": reverse_entry)
    b = await f.booking(cn2, "S18 Reversed", 3000, BookingStatus.BOOKED, pkt(-4, 21))
    e = await f.entry(b, 2000, C, pkt(1, 22), "Balance received", by=staff)
    await f.entry(b, -2000, C, pkt(0, 0, 30), "Wrong booking", by=owner, reverses=e.id)  # 12:30 AM
    await f.entry(b, 1000, T, pkt(0, 9), "Advance credited at approval")
    await f.settle(b)
    f.note("S18", b, "2,000 recorded then reversed at 12:30 AM (overnight venue); 1,000 advance; upcoming")

    # S19 a held booking, nothing paid
    b = await f.booking(cd, "S19 Held", 4000, BookingStatus.HELD, pkt(-5, 12), player=p1, source=BookingSource.APP)
    await f.settle(b)
    f.note("S19", b, "held, unpaid")

    # S20 upcoming, advance only
    b = await f.booking(cd, "S20 Advance", 5000, BookingStatus.BOOKED, pkt(-6, 12), player=p2, source=BookingSource.APP)
    await f.entry(b, 1000, T, pkt(0, 11), "Advance credited at approval")
    await f.settle(b)
    f.note("S20", b, "upcoming, 1,000 advance of 5,000")

    # S21 points AND waived on one booking (points 500 off 6,000, then 1,500 of the rest waived)
    b = await f.booking(cd, "S21 Points+waive", 4000, BookingStatus.COMPLETED, pkt(25, 12), player=p1, points=500)
    await f.audit("booking", b.id, "booking.points_redeemed", {"price": 6000.0}, {"price": 5500.0, "discount_pkr": 500, "points": 500},
                  pkt(27, 10), p1)
    await f.entry(b, 4000, T, pkt(26, 10), "Advance credited at approval")
    claim = ShortPaymentClaim(booking_id=b.id, venue_id=vd.id, player_id=p1.id, total_pkr=5500, paid_pkr=4000, due_pkr=1500,
                              status="disputed", reply_deadline_at=pkt(24, 12), owner_decision="waive", decided_by=owner.id,
                              decided_at=pkt(23, 9), resolved_at=pkt(23, 9), resolution="waived")
    db.add(claim)
    await db.flush()
    await f.audit("booking", b.id, "booking.due_waived", {"price": 5500.0}, {"price": 4000.0, "claim_id": str(claim.id)}, pkt(23, 9), owner)
    await f.settle(b)
    f.note("S21", b, "6,000 booking, 500 points, 4,000 paid, 1,500 waived")

    # S22 venue cancelled a cash booking, refund owed, no proof (payment_id NULL)
    b = await f.booking(cd, "S22 Venue cancel cash", 3000, BookingStatus.CANCELLED, pkt(-2, 20), cancelled_by=CancelledBy.OWNER)
    await f.entry(b, 3000, C, pkt(2, 19), "Walk-in booking", by=staff)
    await f.settle(b)
    db.add(PaymentDispute(booking_id=b.id, reason="owner_cancelled_paid_booking", refund_amount=3000))
    f.note("S22", b, "venue cancelled a 3,000 cash walk-in; 3,000 owed back")

    # S23 cancelled, never paid
    b = await f.booking(cd, "S23 Cancel unpaid", 4000, BookingStatus.CANCELLED, pkt(-3, 9), cancelled_by=CancelledBy.SYSTEM, player=p2,
                        source=BookingSource.APP)
    await f.settle(b)
    f.note("S23", b, "cancelled (hold expired), nothing paid")

    await db.commit()
    return f.scenarios


async def main() -> None:
    url = get_settings().DATABASE_URL
    if "localhost" not in url and "127.0.0.1" not in url:
        sys.exit("refusing: DATABASE_URL is not a localhost database")
    async with AsyncSessionLocal() as db:
        scenarios = await build(db)
    if not scenarios:
        print("fixture already present; nothing done")
        return
    out = Path(__file__).resolve().parent / "ledger_v2_fixture_scenarios.tsv"
    out.write_text("\n".join(f"{k}\t{bid}\t{t}" for k, bid, t in scenarios) + "\n", encoding="utf-8")
    print(f"created {len(scenarios)} scenario bookings; list in {out.name}")


if __name__ == "__main__":
    asyncio.run(main())
