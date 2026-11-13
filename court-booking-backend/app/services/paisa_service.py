"""Ledger v2 "Paisa" read side (docs/design/LEDGER-V2-CONTRACT.md section 5): summary, bookings, one booking, day book,
players, Kaam. Every number comes from app.services.money (one function); nothing here re-derives money.

Scale note: a venue's bookings are loaded and filtered in Python (business days need the venue's overnight schedule); that is
fine at pilot size and keeps the business-day rule in one place.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_, select

from app.models.audit_phase3 import NoShowReply, PointEntry, ShortPaymentClaim
from app.models.booking import Booking, BookingStatus, CancelledBy
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.ledger_v2 import AdjustmentKind, BookingAdjustment, PlayerCredit
from app.models.payment import Payment
from app.models.payment_entry import EntryKind, PaymentEntry, PaymentMethod
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.services.money import Money, active_adjustments, load_money_many, Adj
from app.utils.business_day import business_date_for, venue_overnight_closes
from app.utils.timezone import utc_now

PERIODS = ("today", "yesterday", "this_week", "last_7", "last_30", "this_month", "last_3m", "last_6m", "last_1y", "all", "custom")
STATEMENT_ALWAYS = (BookingStatus.BOOKED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW, BookingStatus.CANCELLED)


def short_code(booking_id: uuid.UUID) -> str:
    from app.services.phase3_service import short_code as sc

    return sc(booking_id)


def _months_back(d: date, n: int) -> date:
    y, m = d.year, d.month - n
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, min(d.day, 28)) if d.day > 28 else date(y, m, d.day)


def period_range(period: str, today: date, start: date | None, end: date | None, first_day: date | None) -> tuple[date, date]:
    """The business-day range of a Muddat choice (default this_month)."""
    if period == "today":
        return today, today
    if period == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if period == "this_week":  # the whole week: bookings already made for later this week count too
        monday = today - timedelta(days=today.weekday())
        return monday, monday + timedelta(days=6)
    if period == "last_7":
        return today - timedelta(days=6), today
    if period == "last_30":
        return today - timedelta(days=29), today
    if period == "last_3m":
        return _months_back(today, 3) + timedelta(days=1), today
    if period == "last_6m":
        return _months_back(today, 6) + timedelta(days=1), today
    if period == "last_1y":
        return _months_back(today, 12) + timedelta(days=1), today
    if period == "all":
        return (first_day or today), today
    if period == "custom" and start and end:
        return (start, end) if start <= end else (end, start)
    nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    return today.replace(day=1), nxt - timedelta(days=1)  # this_month: the whole month (upcoming bookings included)


class Ctx:
    """One venue's money, loaded once per request."""

    def __init__(self, db, venue: Venue, court_ids: list[uuid.UUID] | None):
        self.db = db
        self.venue = venue
        self.court_filter = court_ids or None
        self.courts: dict[uuid.UUID, Court] = {}
        self.overnight: dict = {}
        self.bookings: list[Booking] = []
        self.money: dict[uuid.UUID, Money] = {}
        self.names: dict[uuid.UUID, str] = {}
        self.today: date = date.today()

    async def load(self, *, booking_ids: set[uuid.UUID] | None = None) -> "Ctx":
        courts = (await self.db.scalars(select(Court).where(Court.venue_id == self.venue.id))).all()
        self.courts = {c.id: c for c in courts}
        ids = [c.id for c in courts if self.court_filter is None or c.id in self.court_filter]
        self.overnight = await venue_overnight_closes(self.db, self.venue.id)
        self.today = business_date_for(utc_now(), self.overnight)
        q = select(Booking).where(Booking.court_id.in_(ids)) if ids else None
        if q is None:
            return self
        if booking_ids is not None:
            q = q.where(Booking.id.in_(booking_ids))
        self.bookings = list((await self.db.scalars(q.order_by(Booking.starts_at.desc()))).all())
        self.money = await load_money_many(self.db, self.bookings)
        players = {b.player_id for b in self.bookings if b.player_id}
        if players:
            for uid, name, phone in (await self.db.execute(select(User.id, User.name, User.phone).where(User.id.in_(players)))).all():
                self.names[uid] = name or phone
        return self

    def bdate(self, instant: datetime) -> date:
        return business_date_for(instant, self.overnight)

    def player(self, b: Booking) -> str:
        return b.player_name or (self.names.get(b.player_id) if b.player_id else None) or "Walk-in"

    def in_statement(self, b: Booking) -> bool:
        """Contract 1 + founder 13 Nov: holds / screenshots-in-review only when money was already approved on them; a hold
        that simply expired (system cancel, nothing ever paid) is not a booking for the statement."""
        m = self.money[b.id]
        if b.status in (BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED):
            return m.net != 0
        if b.status == BookingStatus.CANCELLED and b.cancelled_by == CancelledBy.SYSTEM and m.net == 0 and m.refunds == 0:
            return False
        return b.status in STATEMENT_ALWAYS

    def row(self, b: Booking) -> dict:
        m = self.money[b.id]
        c = self.courts.get(b.court_id)
        return {
            "booking_id": b.id, "short_code": short_code(b.id), "player": self.player(b), "phone": b.player_phone,
            "player_id": b.player_id, "court_id": b.court_id, "court": c.name if c else "", "court_sport": c.sport if c else None,
            "starts_at": b.starts_at, "ends_at": b.ends_at, "business_date": self.bdate(b.starts_at), "status": b.status.value,
            "source": b.source.value, "base_price": m.base_price, "deductions": m.deductions_total, "final": m.final,
            "received": m.net, "waived": m.waived, "balance": m.balance, "due": m.due, "due_at_slot": m.due_at_slot,
            "refund_due": m.refund_due, "money_status": m.status,
        }


def statement(ctx: Ctx, books: list[Booking]) -> dict:
    out = {"booking_amount": 0, "deductions": {k: 0 for k in AdjustmentKind.DEDUCTIONS}, "final": 0, "received": 0,
           "due": 0, "due_at_slot": 0, "waived": 0, "refund_due": 0}
    for b in books:
        m = ctx.money[b.id]
        out["booking_amount"] += m.base_price
        for k, v in m.deductions.items():
            out["deductions"][k] += v
        out["final"] += m.final
        out["received"] += m.net
        out["due"] += m.due
        out["due_at_slot"] += m.due_at_slot
        out["waived"] += m.waived
        out["refund_due"] += m.refund_due
    out["deductions"]["total"] = sum(v for k, v in out["deductions"].items() if k != "total")
    return out


async def _entries(db, booking_ids: list[uuid.UUID], start: date | None = None, end: date | None = None) -> list[tuple]:
    """(entry, bucket) for these bookings, bucket = the kind a correction counts under (the kind of what it reverses)."""
    if not booking_ids:
        return []
    q = select(PaymentEntry).where(PaymentEntry.booking_id.in_(booking_ids))
    if start is not None:
        q = q.where(PaymentEntry.money_business_date >= start, PaymentEntry.money_business_date <= end)
    rows = list((await db.scalars(q.order_by(PaymentEntry.created_at))).all())
    targets = {r.reverses_entry_id for r in rows if r.reverses_entry_id}
    kinds = {}
    if targets:
        kinds = dict((await db.execute(select(PaymentEntry.id, PaymentEntry.kind).where(PaymentEntry.id.in_(targets)))).all())
    out = []
    for e in rows:
        bucket = e.kind
        if e.kind == EntryKind.CORRECTION and e.reverses_entry_id and kinds.get(e.reverses_entry_id) not in (None, EntryKind.CORRECTION):
            bucket = kinds[e.reverses_entry_id]
        out.append((e, bucket))
    return out


def money_in(pairs: list[tuple]) -> dict:
    out = {"cash": 0, "transfer": 0, "other": 0, "refunds_paid": {"cash": 0, "transfer": 0, "other": 0, "total": 0},
           "credit_in": 0, "credit_out": 0, "net": 0}
    for e, bucket in pairs:
        method = {PaymentMethod.CASH_AT_VENUE: "cash", PaymentMethod.BANK_TRANSFER_PROOF: "transfer"}.get(e.method, "other")
        if bucket in (EntryKind.PAYMENT, EntryKind.CORRECTION):
            out[method] += e.amount_pkr
        elif bucket == EntryKind.REFUND:
            out["refunds_paid"][method] += -e.amount_pkr
            out["refunds_paid"]["total"] += -e.amount_pkr
        elif bucket == EntryKind.CREDIT_IN:
            out["credit_in"] += e.amount_pkr
        elif bucket == EntryKind.CREDIT_OUT:
            out["credit_out"] += -e.amount_pkr
    out["net"] = out["cash"] + out["transfer"] + out["other"] - out["refunds_paid"]["total"]
    return out


async def summary(db, venue: Venue, court_ids, period: str, start: date | None, end: date | None) -> dict:
    ctx = await Ctx(db, venue, court_ids).load()
    first = min((ctx.bdate(b.starts_at) for b in ctx.bookings), default=None)
    d0, d1 = period_range(period, ctx.today, start, end, first)
    now = utc_now()
    right = {"due": 0, "due_count": 0, "refund_due": 0, "refund_count": 0, "advance_received": 0, "advance_count": 0,
             "player_credit": 0, "pending_approval": 0, "pending_count": 0}
    for b in ctx.bookings:
        m = ctx.money[b.id]
        if m.due > 0:
            right["due"] += m.due
            right["due_count"] += 1
        if m.refund_due > 0:
            right["refund_due"] += m.refund_due
            right["refund_count"] += 1
        if b.status in (BookingStatus.BOOKED, BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED) and b.ends_at > now and m.net > 0:
            right["advance_received"] += m.net
            right["advance_count"] += 1
    right["player_credit"] = int(await db.scalar(select(func.coalesce(func.sum(PlayerCredit.delta_pkr), 0)).where(PlayerCredit.venue_id == venue.id)) or 0)
    ids_all = [b.id for b in ctx.bookings]
    if ids_all:
        pend = (await db.execute(select(func.count(Payment.id), func.coalesce(func.sum(func.coalesce(Payment.amount_claimed, Payment.ocr_amount)), 0))
                                 .where(Payment.booking_id.in_(ids_all), Payment.review_verdict.is_(None), Payment.proof_key.is_not(None)))).one()
        right["pending_count"], right["pending_approval"] = int(pend[0]), round(float(pend[1] or 0))
    books = [b for b in ctx.bookings if ctx.in_statement(b) and d0 <= ctx.bdate(b.starts_at) <= d1]
    counts = {"bookings": len(books), "played": sum(1 for b in books if b.status == BookingStatus.COMPLETED),
              "no_show": sum(1 for b in books if b.status == BookingStatus.NO_SHOW),
              "cancelled": sum(1 for b in books if b.status == BookingStatus.CANCELLED)}
    pairs = await _entries(db, ids_all, d0, d1)
    out = {"right_now": right, "range": {"from": d0, "to": d1, "period": period if period in PERIODS else "this_month"},
           "counts": counts, "statement": statement(ctx, books), "money_in": money_in(pairs), "by_month": []}
    if (d1 - d0).days >= 40:
        months: dict[str, dict] = defaultdict(lambda: {"final": 0, "received": 0, "due": 0, "refund_due": 0, "net_in": 0})
        for b in books:
            m = ctx.money[b.id]
            k = ctx.bdate(b.starts_at).strftime("%Y-%m")
            months[k]["final"] += m.final
            months[k]["received"] += m.net
            months[k]["due"] += m.due
            months[k]["refund_due"] += m.refund_due
        for e, bucket in pairs:
            k = e.money_business_date.strftime("%Y-%m")
            if bucket in (EntryKind.PAYMENT, EntryKind.CORRECTION, EntryKind.REFUND):
                months[k]["net_in"] += e.amount_pkr
        out["by_month"] = [{"month": k, **v} for k, v in sorted(months.items(), reverse=True)]
    return out


async def bookings(db, venue: Venue, court_ids, period: str, start, end, *, q: str | None, money_status: str | None,
                   booking: uuid.UUID | None, only_ids: set[uuid.UUID] | None, page: int, page_size: int) -> dict:
    ctx = await Ctx(db, venue, court_ids).load()
    first = min((ctx.bdate(b.starts_at) for b in ctx.bookings), default=None)
    d0, d1 = period_range(period, ctx.today, start, end, first)
    term = (q or "").strip().lower()
    digits = "".join(ch for ch in term if ch.isdigit())
    all_dates = bool(term) and (len(digits) >= 4 or term.startswith("kh"))
    rows = []
    for b in ctx.bookings:
        if booking is not None:
            if b.id != booking:
                continue
        else:
            if only_ids is not None and b.id not in only_ids:
                continue
            if not all_dates and not (d0 <= ctx.bdate(b.starts_at) <= d1):
                continue
            if not ctx.in_statement(b):
                continue
            if term:
                hay = " ".join([ctx.player(b).lower(), (b.player_phone or ""), short_code(b.id).lower()])
                if term not in hay and not (digits and digits in "".join(ch for ch in (b.player_phone or "") if ch.isdigit())):
                    continue
            if money_status and ctx.money[b.id].status != money_status:
                continue
        rows.append(b)
    total = len(rows)
    page_rows = rows[(page - 1) * page_size: page * page_size]
    return {"range": {"from": d0, "to": d1}, "total": total, "page": page, "page_size": page_size, "search_all_dates": all_dates,
            "totals": statement(ctx, rows), "items": [ctx.row(b) for b in page_rows]}


async def booking_detail(db, venue: Venue, booking_id: uuid.UUID, actor: User, perms: set[str] | None) -> dict:
    from app.services.ledger_v2 import credit_balance, credit_key

    ctx = await Ctx(db, venue, None).load(booking_ids={booking_id})
    if not ctx.bookings:
        return {}
    b = ctx.bookings[0]
    m = ctx.money[b.id]
    owner = actor.role != UserRole.STAFF
    can = (lambda p: owner or (perms is not None and p in perms))
    adjs = list((await db.scalars(select(BookingAdjustment).where(BookingAdjustment.booking_id == b.id).order_by(BookingAdjustment.created_at))).all())
    live = {a.id for a in active_adjustments([Adj(a.id, a.kind, a.amount_pkr, a.reverses_adjustment_id) for a in adjs])}
    pairs = await _entries(db, [b.id])
    reversed_ids = {e.reverses_entry_id for e, _ in pairs if e.reverses_entry_id}
    users = {u.id: u for u in (await db.scalars(select(User).where(User.id.in_(
        {e.recorded_by for e, _ in pairs if e.recorded_by} | {a.created_by for a in adjs if a.created_by})))).all()} if (pairs or adjs) else {}
    who = (lambda uid: (users[uid].name or users[uid].phone) if uid in users else None)
    history = []
    for e, bucket in pairs:
        history.append({"at": e.created_at, "business_date": e.money_business_date, "type": "entry", "kind": e.kind, "bucket": bucket,
                        "method": e.method.value, "amount": e.amount_pkr, "by": who(e.recorded_by), "note": e.note, "id": e.id,
                        "reversible": owner and e.kind == EntryKind.PAYMENT and e.amount_pkr > 0 and e.id not in reversed_ids})
    for a in adjs:
        history.append({"at": a.created_at, "business_date": ctx.bdate(a.created_at), "type": "adjustment", "kind": a.kind,
                        "bucket": a.kind, "method": None, "amount": -a.amount_pkr if a.reverses_adjustment_id is None else a.amount_pkr,
                        "by": who(a.created_by), "note": a.reason, "id": a.id, "reverses": a.reverses_adjustment_id,
                        "reversible": owner and a.id in live and a.kind in (AdjustmentKind.PRICE_REDUCED, AdjustmentKind.WAIVED)})
    history.sort(key=lambda h: h["at"])
    claim = await db.scalar(select(ShortPaymentClaim).where(ShortPaymentClaim.booking_id == b.id))
    key = credit_key(b)
    credit = await credit_balance(db, venue.id, key[0], key[1]) if key else 0
    owed = max(m.final - m.net - m.waived, 0)
    live_status = b.status in (BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED, BookingStatus.BOOKED)
    actions = []
    if can("record_payments") and b.status != BookingStatus.CANCELLED:
        actions.append("record_payment")
    if owner and claim is not None and claim.status == "disputed" and claim.owner_decision is None and claim.resolved_at is None:
        actions += ["collect", "waive"]
    elif owner and m.due > 0:
        actions.append("waive")
    if owner and m.final > 0 and b.status != BookingStatus.CANCELLED:
        actions.append("reduce_price")
    if m.refund_due > 0 and can("mark_refunds"):
        actions.append("refund")
    if owner and m.refund_due > 0 and key is not None:
        actions.append("credit")
    if owner and credit > 0 and owed > 0:
        actions.append("use_credit")
    if owner and b.status == BookingStatus.NO_SHOW:
        actions.append("reverse_noshow")
    if live_status and can("cancel_booking"):
        actions.append("cancel")
    noshow_adj = sum(a.amount_pkr for a in adjs if a.id in live and a.kind == AdjustmentKind.NO_SHOW)
    pending = (await db.execute(select(Payment.id, Payment.amount_claimed, Payment.ocr_amount, Payment.created_at)
                                .where(Payment.booking_id == b.id, Payment.review_verdict.is_(None), Payment.proof_key.is_not(None)))).all()
    open_refunds = (await db.scalars(select(PaymentDispute).where(PaymentDispute.booking_id == b.id, PaymentDispute.resolved.is_(False),
                                                                  PaymentDispute.refund_amount > 0))).all()
    deductions = [{"id": a.id, "kind": a.kind, "amount": a.amount_pkr, "reason": a.reason, "by": who(a.created_by), "at": a.created_at,
                   "reversible": owner and a.kind in (AdjustmentKind.PRICE_REDUCED,)}
                  for a in adjs if a.id in live and a.kind in AdjustmentKind.DEDUCTIONS]
    waivers = [{"id": a.id, "kind": a.kind, "amount": a.amount_pkr, "reason": a.reason, "by": who(a.created_by), "at": a.created_at,
                "reversible": owner} for a in adjs if a.id in live and a.kind == AdjustmentKind.WAIVED]
    return {
        "booking": ctx.row(b),
        "calc": {"booking_amount": m.base_price, "deductions": deductions, "deductions_total": m.deductions_total, "final": m.final,
                 "received": m.net, "payments": m.payments, "refunds": m.refunds, "credit_in": m.credit_in, "credit_out": m.credit_out,
                 "waived": m.waived, "waivers": waivers, "balance": m.balance, "due": m.due, "due_at_slot": m.due_at_slot,
                 "refund_due": m.refund_due},
        "dispute": ({"status": claim.status, "player_reason": claim.player_reason, "owner_decision": claim.owner_decision,
                     "claim_id": claim.id, "resolved": claim.resolved_at is not None} if claim else None),
        "open_refunds": [{"dispute_id": d.id, "reason": d.reason, "remaining": max(round(float(d.refund_amount or 0) - float(d.refunded_amount or 0)), 0)}
                         for d in open_refunds],
        "pending_screenshots": [{"payment_id": p[0], "amount": round(float(p[1] or p[2] or 0)), "at": p[3]} for p in pending],
        "history": history,
        "actions": actions,
        "credit_available": credit,
        "can_credit": owner and key is not None,
        "owed": owed,
        "final_if_noshow_undone": m.final + noshow_adj,
    }


async def daybook(db, venue: Venue, court_ids, period: str, start, end, *, show: str, method: str | None, person: uuid.UUID | None,
                  kind: str | None) -> dict:
    ctx = await Ctx(db, venue, court_ids).load()
    first = min((ctx.bdate(b.starts_at) for b in ctx.bookings), default=None)
    d0, d1 = period_range(period, ctx.today, start, end, first)
    by_id = {b.id: b for b in ctx.bookings}
    rows = []
    if show in ("money", "with_deductions"):
        for e, bucket in await _entries(db, list(by_id), d0, d1):
            m = {PaymentMethod.CASH_AT_VENUE: "cash", PaymentMethod.BANK_TRANSFER_PROOF: "transfer"}.get(e.method, "other")
            if method and m != method:
                continue
            if person and e.recorded_by != person:
                continue
            if kind and bucket != kind:
                continue
            rows.append({"type": "entry", "id": e.id, "at": e.created_at, "date": e.money_business_date, "kind": e.kind, "bucket": bucket,
                         "method": m, "amount": e.amount_pkr, "by_id": e.recorded_by, "booking": by_id[e.booking_id], "note": e.note})
    if show in ("with_deductions", "deductions") and not method:
        adjs = (await db.scalars(select(BookingAdjustment).where(BookingAdjustment.booking_id.in_(list(by_id))))).all() if by_id else []
        for a in adjs:
            d = ctx.bdate(a.created_at)
            if not (d0 <= d <= d1) or (person and a.created_by != person):
                continue
            if kind and a.kind != kind:
                continue
            rows.append({"type": "adjustment", "id": a.id, "at": a.created_at, "date": d, "kind": a.kind, "bucket": a.kind, "method": None,
                         "amount": -a.amount_pkr if a.reverses_adjustment_id is None else a.amount_pkr, "by_id": a.created_by,
                         "booking": by_id[a.booking_id], "note": a.reason})
    ids = {r["by_id"] for r in rows if r["by_id"]}
    users = {u.id: (u.name or u.phone) for u in (await db.scalars(select(User).where(User.id.in_(ids)))).all()} if ids else {}
    days: dict[date, list] = defaultdict(list)
    cash_by: dict[str, int] = defaultdict(int)
    tin = tout = 0
    for r in rows:
        b = r.pop("booking")
        r.update({"by": users.get(r.pop("by_id")) if r.get("by_id") else None, "booking_id": b.id, "short_code": short_code(b.id),
                  "player": ctx.player(b), "court": ctx.courts[b.court_id].name if b.court_id in ctx.courts else "",
                  "slot_business_date": ctx.bdate(b.starts_at), "booking_status": b.status.value})
        r.pop("by_id", None)
        days[r["date"]].append(r)
        if r["type"] == "entry" and r["bucket"] in (EntryKind.PAYMENT, EntryKind.CORRECTION, EntryKind.REFUND):
            if r["amount"] >= 0:
                tin += r["amount"]
            else:
                tout += -r["amount"]
            if r["method"] == "cash" and r["bucket"] in (EntryKind.PAYMENT, EntryKind.CORRECTION):
                cash_by[r["by"] or "System"] += r["amount"]
    out_days = []
    for d in sorted(days, reverse=True):
        lst = sorted(days[d], key=lambda r: r["at"], reverse=True)
        total = sum(r["amount"] for r in lst if r["type"] == "entry" and r["bucket"] in (EntryKind.PAYMENT, EntryKind.CORRECTION, EntryKind.REFUND))
        out_days.append({"date": d, "total": total, "rows": lst})
    return {"range": {"from": d0, "to": d1}, "days": out_days,
            "footer": {"in": tin, "out": tout, "net": tin - tout,
                       "cash_by": [{"name": k, "amount": v} for k, v in sorted(cash_by.items(), key=lambda kv: -kv[1]) if v]}}


async def players(db, venue: Venue, q: str | None) -> dict:
    from app.services.phase3_service import money_health

    ctx = await Ctx(db, venue, None).load()
    groups: dict[str, dict] = {}
    for b in ctx.bookings:
        m = ctx.money[b.id]
        if m.due <= 0:
            continue
        key = f"p:{b.player_id}" if b.player_id else (f"t:{b.player_phone}" if b.player_phone else f"b:{b.id}")
        g = groups.setdefault(key, {"key": {"player_id": b.player_id, "phone": b.player_phone}, "name": ctx.player(b),
                                    "phone": b.player_phone, "due_total": 0, "credit": 0, "open_bookings": []})
        g["due_total"] += m.due
        g["open_bookings"].append({"booking_id": b.id, "short_code": short_code(b.id), "starts_at": b.starts_at,
                                   "slot_date": ctx.bdate(b.starts_at), "court": ctx.courts[b.court_id].name, "due": m.due,
                                   "money_status": m.status})
    # credit holders (even without a due)
    credits = (await db.execute(select(PlayerCredit.player_id, PlayerCredit.phone, func.sum(PlayerCredit.delta_pkr))
                                .where(PlayerCredit.venue_id == venue.id).group_by(PlayerCredit.player_id, PlayerCredit.phone))).all()
    for pid, phone, total in credits:
        if not total:
            continue
        key = f"p:{pid}" if pid else f"t:{phone}"
        if key not in groups:
            name = ctx.names.get(pid) if pid else None
            if pid and name is None:
                u = await db.get(User, pid)
                name = (u.name or u.phone) if u else None
            groups[key] = {"key": {"player_id": pid, "phone": phone}, "name": name or phone, "phone": phone, "due_total": 0,
                           "credit": 0, "open_bookings": []}
        groups[key]["credit"] += int(total)
    term = (q or "").strip().lower()
    out = []
    for g in groups.values():
        if term and term not in (g["name"] or "").lower() and term not in (g["phone"] or ""):
            continue
        g["open_bookings"].sort(key=lambda r: r["starts_at"])
        out.append(g)
    out.sort(key=lambda g: (g["due_total"] <= 0, -g["due_total"]))
    health = await money_health(db, [venue.id])
    t = (health or {}).get("totals", {})
    return {"points_awarded": t.get("points_awarded", 0), "points_used": t.get("points_used", 0), "items": out}


async def tasks(db, settings, owner: User, actor: User, venue: Venue, perms: set[str] | None, *, date_: date | None, court_ids) -> dict:
    """Kaam (contract 5.6). mark_refunds-only staff get the refund groups only."""
    from app.services.owner_dashboard_service import OwnerDashboardService
    from app.services.phase3_service import list_dues
    from app.services.staff_activity_service import _activity

    is_staff = actor.role == UserRole.STAFF
    full = (not is_staff) or (perms is not None and "view_ledger" in perms)
    refunds_ok = (not is_staff) or (perms is not None and "mark_refunds" in perms)
    groups = []
    if full:
        dues = await list_dues(db, settings, owner, venue.id)
        decide = [d for d in dues if d.get("status") == "disputed" and not d.get("owner_decision")]
        collect = [d for d in dues if d.get("status") in ("no_reply", "confirmed") or d.get("owner_decision") == "collect"]
        act = await _activity(db, venue, utc_now().date() - timedelta(days=60), None)
        noshow = [n for n in act["no_shows"] if n.get("reply_id") and not n.get("owner_decision")]
        bank = [m for m in act["bank_missing"] if m.get("decision") is None]
        groups += [{"key": "short_decide", "count": len(decide), "items": decide},
                   {"key": "noshow_reply", "count": len(noshow), "items": noshow}]
    if refunds_ok:
        refunds = await OwnerDashboardService(db, settings).refunds_owed(owner, venue_id=venue.id, on_date=date_, court_ids=court_ids)
        not_got = [r for r in refunds if any(getattr(t, "player_response", None) == "not_received" and not getattr(t, "owner_reply", None)
                                             for t in (getattr(r, "transfers", None) or []))]
        now = datetime.now(timezone.utc)
        rem = [r for r in refunds]
        total = 0
        oldest = 0
        for r in rem:
            total += max(round(float(r.refund_amount or 0) - float(r.refunded_amount or 0)), 0)
            oldest = max(oldest, (now - r.created_at).days)
        groups += [{"key": "refund_due", "count": len(rem), "total": total, "oldest_days": oldest, "items": rem},
                   {"key": "refund_not_got", "count": len(not_got), "items": not_got}]
    if full:
        ctx = await Ctx(db, venue, None).load()
        now = utc_now()
        attendance = [ctx.row(b) for b in ctx.bookings if b.status == BookingStatus.BOOKED and b.ends_at <= now]
        pending = 0
        ids = [b.id for b in ctx.bookings]
        if ids:
            pending = int(await db.scalar(select(func.count(Payment.id)).where(Payment.booking_id.in_(ids), Payment.review_verdict.is_(None),
                                                                                Payment.proof_key.is_not(None))) or 0)
        groups += [{"key": "bank_check", "count": len(bank), "items": bank},
                   {"key": "screenshots", "count": pending, "items": []},
                   {"key": "attendance", "count": len(attendance), "items": attendance},
                   {"key": "due_collect", "count": len(collect), "items": collect}]
    order = ["short_decide", "noshow_reply", "refund_due", "refund_not_got", "bank_check", "screenshots", "attendance", "due_collect"]
    groups.sort(key=lambda g: order.index(g["key"]))
    total = sum(g["count"] for g in groups if g["key"] != "screenshots")
    return {"total": total, "groups": groups}
