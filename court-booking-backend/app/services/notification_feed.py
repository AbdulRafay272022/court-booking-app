"""Owner Round 2 (A6): the readable bell feed, `GET /users/me/notifications/feed` (docs/round2-contract.md).

notification_log stores one row per channel tried (push / whatsapp / sms), with the event_type and the id of the
thing it was about (`reference_id`) -- no message text, no payload. This module turns those rows into feed items:

1. GROUP: rows of the same event family and reference_id fold into ONE item when each is within 10 minutes of the
   group's previous row. The owner's payment escalation (push now, WhatsApp at ESCALATION_WHATSAPP_MINUTES, SMS at
   ESCALATION_SMS_MINUTES) is one event, so its rows fold whatever the gap (bounded by PAYMENT_REVIEW_HOURS).
2. KIND: every event_type the code emits maps to one normalized `kind` (EVENT_KINDS below; anything unknown is
   "other"). The client writes the sentence from kind + params (packages/types/src/notification-text.ts).
3. PARAMS: derived from reference_id in BULK -- at most one query per entity type for the whole page (bookings with
   their court/venue/player, latest payments, latest refund disputes, venues), never per row. Missing data is
   omitted, never invented; phone numbers are never included.
4. DELIVERIES: one entry per channel tried; "sent" if any row of that channel was sent, else "failed" (a skipped
   send, e.g. SMS with no provider configured, counts as failed).

Stage 2 gap: rows have no payload column, so events whose reference_id is not a booking/venue (premium billing
invoices, marketing announcements, the daily digest, the waitlist "slot reopened", admin "venue pending review")
can only show their kind, not amounts or names.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.notification import NotificationLog
from app.models.payment import Payment
from app.models.user import User
from app.models.venue import Venue
from app.models.waitlist import WaitlistEntry

GROUP_WINDOW = timedelta(minutes=10)
ESCALATION_SPAN = timedelta(hours=3)  # PAYMENT_REVIEW_HOURS (2h) plus slack: the ladder can't run longer
BATCH = 200

# event_type -> (kind, family, reference type, link kind)
# reference type: "booking" | "venue" | "waitlist" | "none". family: rows of one family + reference fold together.
EVENT_KINDS: dict[str, tuple[str, str, str, str]] = {
    # owner: payment waiting for approval (push at once, then the escalation ladder)
    "payment_submitted": ("payment_waiting", "payment_submitted", "booking", "approvals"),
    "payment_submitted_whatsapp": ("payment_waiting", "payment_submitted", "booking", "approvals"),
    "payment_submitted_sms": ("payment_waiting", "payment_submitted", "booking", "approvals"),
    "late_payment_proof": ("payment_waiting", "late_payment_proof", "booking", "approvals"),
    "owner_player_cancelled": ("player_cancelled", "owner_player_cancelled", "booking", "approvals"),
    "refund_owed": ("refund_owed", "refund_owed", "booking", "refunds"),
    "owner_new_booking": ("new_booking", "owner_new_booking", "booking", "booking"),
    "owner_daily_digest": ("daily_summary", "owner_daily_digest", "none", "overview"),
    "venue_approved": ("venue_approved", "venue_approved", "venue", "venue_status"),
    "venue_rejected": ("venue_rejected", "venue_rejected", "venue", "venue_status"),
    "venue_changes_requested": ("venue_changes", "venue_changes_requested", "venue", "venue_status"),
    # player
    "booking_confirmed": ("booking_confirmed", "booking_confirmed", "booking", "booking"),
    "booking_cancelled": ("booking_cancelled", "booking_cancelled", "booking", "booking"),
    "payment_rejected": ("payment_rejected", "payment_rejected", "booking", "booking"),
    "refund_paid": ("refund_sent", "refund_paid", "booking", "booking"),
    "booking_reminder": ("booking_reminder", "booking_reminder", "booking", "booking"),
    "hold_expiring": ("hold_expiring", "hold_expiring", "booking", "booking"),
    "slot_reopened": ("slot_freed", "slot_reopened", "waitlist", "none"),  # reference = waitlist entry id
    "court_deactivated": ("other", "court_deactivated", "booking", "booking"),
    # admin / premium billing / marketing: kind only (reference is an invoice / venue we don't resolve)
    "venue_pending_review": ("other", "venue_pending_review", "venue", "none"),
    "premium_renewal_reminder": ("other", "premium_renewal_reminder", "none", "none"),
    "premium_payment_overdue": ("other", "premium_payment_overdue", "none", "none"),
    "premium_feature_lapsed": ("other", "premium_feature_lapsed", "none", "none"),
    "premium_payment_approved": ("other", "premium_payment_approved", "none", "none"),
    "premium_payment_rejected": ("other", "premium_payment_rejected", "none", "none"),
    "tournament_announcement": ("other", "tournament_announcement", "none", "none"),
}
# Families whose rows always fold for one reference (the owner's payment escalation ladder).
ESCALATION_FAMILIES = {"payment_submitted"}
CHANNELS = ("push", "whatsapp", "sms", "web_push")


def classify(event_type: str) -> tuple[str, str, str, str]:
    return EVENT_KINDS.get(event_type, ("other", event_type, "none", "none"))


@dataclass
class _Group:
    family: str
    reference_id: uuid.UUID | None
    rows: list[NotificationLog] = field(default_factory=list)  # newest first

    @property
    def first(self) -> NotificationLog:
        return self.rows[-1]


def group_rows(rows: list[NotificationLog]) -> list[_Group]:
    """`rows` newest first. A row joins the open group of its family + reference when it is within GROUP_WINDOW of
    that group's oldest row so far (or, for the escalation ladder, within ESCALATION_SPAN). Rows without a
    reference never fold."""
    groups: list[_Group] = []
    open_groups: dict[tuple[str, uuid.UUID], _Group] = {}
    for row in rows:
        _kind, family, _ref, _link = classify(row.event_type)
        key = (family, row.reference_id) if row.reference_id is not None else None
        g = open_groups.get(key) if key is not None else None
        if g is not None:
            gap = g.first.created_at - row.created_at
            limit = ESCALATION_SPAN if family in ESCALATION_FAMILIES else GROUP_WINDOW
            if gap <= limit:
                g.rows.append(row)
                continue
        g = _Group(family=family, reference_id=row.reference_id, rows=[row])
        groups.append(g)
        if key is not None:
            open_groups[key] = g
    groups.sort(key=lambda gr: (gr.first.created_at, str(gr.first.id)), reverse=True)
    return groups


async def _fetch_groups(db: AsyncSession, user_id: uuid.UUID, need: int) -> tuple[list[_Group], bool]:
    """Read rows newest first in batches until `need` groups are certainly complete (no older row could still join
    them) or the log is exhausted. Returns (complete groups in order, more_exist)."""
    rows: list[NotificationLog] = []
    offset = 0
    exhausted = False
    while True:
        batch = list(
            (
                await db.execute(
                    select(NotificationLog)
                    .where(NotificationLog.user_id == user_id)
                    .order_by(NotificationLog.created_at.desc(), NotificationLog.id.desc())
                    .offset(offset)
                    .limit(BATCH)
                )
            )
            .scalars()
            .all()
        )
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < BATCH:
            exhausted = True
        groups = group_rows(rows)
        if exhausted:
            return groups, False
        oldest = rows[-1].created_at
        complete = [g for g in groups if g.first.created_at - ESCALATION_SPAN > oldest]
        if len(complete) >= need:
            return complete, True


def _deliveries(group: _Group) -> list[dict]:
    by_channel: dict[str, str] = {}
    for row in reversed(group.rows):
        channel = row.channel if row.channel in CHANNELS else None
        if channel is None:
            continue
        if row.status == "sent":
            by_channel[channel] = "sent"
        else:
            by_channel.setdefault(channel, "failed")
    order = {c: i for i, c in enumerate(CHANNELS)}
    return [{"channel": c, "status": s} for c, s in sorted(by_channel.items(), key=lambda kv: order[kv[0]])]


async def _resolve(db: AsyncSession, groups: list[_Group]) -> tuple[dict, dict, dict, dict]:
    """Bulk lookups for the page: bookings (with court, venue, player), latest payment per booking, latest refund
    dispute per booking, venues, waitlist slots (stored with the venues). At most five queries whatever the page
    size."""
    booking_ids: set[uuid.UUID] = set()
    venue_ids: set[uuid.UUID] = set()
    waitlist_ids: set[uuid.UUID] = set()
    payment_kinds = {"payment_waiting", "player_cancelled", "payment_rejected"}
    refund_kinds = {"refund_owed", "refund_sent"}
    need_payments: set[uuid.UUID] = set()
    need_refunds: set[uuid.UUID] = set()
    for g in groups:
        kind, _family, ref_type, _link = classify(g.first.event_type)
        if g.reference_id is None:
            continue
        if ref_type == "booking":
            booking_ids.add(g.reference_id)
            if kind in payment_kinds:
                need_payments.add(g.reference_id)
            if kind in refund_kinds:
                need_refunds.add(g.reference_id)
        elif ref_type == "venue":
            venue_ids.add(g.reference_id)
        elif ref_type == "waitlist":
            waitlist_ids.add(g.reference_id)

    bookings: dict = {}
    if booking_ids:
        result = await db.execute(
            select(Booking, Court.name, Court.sport, Venue.name, User.name)
            .join(Court, Court.id == Booking.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .outerjoin(User, User.id == Booking.player_id)
            .where(Booking.id.in_(booking_ids))
        )
        bookings = {b.id: (b, court_name, sport, venue_name, account) for b, court_name, sport, venue_name, account in result.all()}
    payments: dict = {}
    if need_payments:
        result = await db.execute(
            select(Payment)
            .where(Payment.booking_id.in_(need_payments))
            .distinct(Payment.booking_id)
            .order_by(Payment.booking_id, Payment.created_at.desc())
        )
        payments = {p.booking_id: p for p in result.scalars().all()}
    disputes: dict = {}
    if need_refunds:
        result = await db.execute(
            select(PaymentDispute)
            .where(PaymentDispute.booking_id.in_(need_refunds), func.coalesce(PaymentDispute.refund_amount, 0) > 0)
            .distinct(PaymentDispute.booking_id)
            .order_by(PaymentDispute.booking_id, PaymentDispute.created_at.desc())
        )
        disputes = {d.booking_id: d for d in result.scalars().all()}
    venues: dict = {}
    if venue_ids:
        result = await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))
        venues = {v.id: v for v in result.scalars().all()}
    if waitlist_ids:
        result = await db.execute(
            select(WaitlistEntry.id, WaitlistEntry.slot_starts_at, Court.name, Court.sport, Venue.name)
            .join(Court, Court.id == WaitlistEntry.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .where(WaitlistEntry.id.in_(waitlist_ids))
        )
        for wid, starts_at, court_name, sport, venue_name in result.all():
            venues[wid] = {"starts_at": starts_at, "court_name": court_name, "sport": sport, "venue_name": venue_name}
    return bookings, payments, disputes, venues


def _params(kind: str, ref_type: str, ref: uuid.UUID | None, bookings, payments, disputes, venues) -> dict:
    p: dict = {}
    if ref is None:
        return p
    if ref_type == "waitlist":
        slot = venues.get(ref)
        if isinstance(slot, dict):
            p.update({k: v for k, v in slot.items() if v is not None})
        return p
    if ref_type == "venue":
        venue = venues.get(ref)
        if venue is not None:
            p["venue_name"] = venue.name
            if kind in ("venue_rejected", "venue_changes") and venue.rejection_reason:
                p["reason"] = venue.rejection_reason
        return p
    if ref_type != "booking" or ref not in bookings:
        return p
    booking, court_name, sport, venue_name, account_name = bookings[ref]
    player_name = booking.player_name or account_name
    if player_name:
        p["player_name"] = player_name
    p["court_name"] = court_name
    if sport:
        p["sport"] = sport
    p["venue_name"] = venue_name
    p["starts_at"] = booking.starts_at
    p["ends_at"] = booking.ends_at
    amount: float | None = None
    if kind in ("payment_waiting", "player_cancelled"):
        pay = payments.get(ref)
        if pay is not None and pay.ocr_amount is not None:
            amount = float(pay.ocr_amount)
        else:
            amount = float(booking.advance_amount)
    elif kind == "payment_rejected":
        pay = payments.get(ref)
        if pay is not None and pay.rejection_reason:
            p["reason"] = pay.rejection_reason
    elif kind == "booking_confirmed":
        amount = float(booking.amount_paid)
    elif kind in ("new_booking",):
        amount = float(booking.price)
    elif kind == "hold_expiring":
        amount = float(booking.advance_amount)
    elif kind == "refund_owed":
        d = disputes.get(ref)
        if d is not None:
            amount = float(d.refund_amount or 0)
    elif kind == "refund_sent":
        d = disputes.get(ref)
        if d is not None and d.refunded_amount is not None:
            amount = float(d.refunded_amount)
    elif kind == "booking_cancelled":
        if booking.cancellation_reason:
            p["reason"] = booking.cancellation_reason
    if amount is not None:
        p["amount"] = amount
    return p


async def notification_feed(db: AsyncSession, user_id: uuid.UUID, page: int, page_size: int) -> dict:
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    start = (page - 1) * page_size
    groups, _more_rows = await _fetch_groups(db, user_id, start + page_size + 1)
    window = groups[start : start + page_size]
    has_more = len(groups) > start + page_size
    bookings, payments, disputes, venues = await _resolve(db, window)
    items = []
    for g in window:
        first = g.first
        kind, _family, ref_type, link_kind = classify(first.event_type)
        link: dict = {"kind": link_kind}
        if link_kind in ("approvals", "refunds", "booking") and ref_type == "booking" and g.reference_id in bookings:
            link["booking_id"] = g.reference_id
        elif link_kind == "booking":
            link = {"kind": "none"}
        items.append(
            {
                "id": first.id,
                "event_type": first.event_type,
                "kind": kind,
                "created_at": first.created_at,
                "params": _params(kind, ref_type, g.reference_id, bookings, payments, disputes, venues),
                "link": link,
                "deliveries": _deliveries(g),
            }
        )
    return {"items": items, "page": page, "page_size": page_size, "has_more": has_more}
