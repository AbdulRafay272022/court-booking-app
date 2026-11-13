"""Ledger v2 backfill (docs/design/LEDGER-V2-CONTRACT.md 3.2). Run AFTER migration e6b2d4f8a913.

Idempotent and safe to re-run: every step only touches what it has not done yet (entries with no business day, bookings
with no base_price, bookings without the adjustment it would add, disputes without a backfilled entry). One transaction per
booking. `--dry-run` rolls everything back and still writes the report.

Steps, in this order (the order matters):
  1+2. every entry without a business day: its kind (from reverses_entry_id / the old note) and money_business_date (the
       venue's business day from TODAY's closing schedule); refund rows linked to their dispute / transfer / payment.
  3.   base_price + adjustments from the audit log: points_redeemed -> points; due_waived and a Khelo short-payment decision
       -> waived (the price the old code lowered is put back); noshow_reversed with a lower price -> price_reduced.
  5.   uncredited refunds (overpayment_excess, cancelled_payment_received): the money that came in becomes a payment entry and
       what was sent back a refund entry -- BEFORE step 6, so a cancel adjustment is computed on the right net.
  4.   old no-shows: a no_show adjustment for the unpaid rest (skipped, and reported, when an open due exists).
  6.   old cancels: a cancellation adjustment = final - (net - open refund remaining) (skipped when negative).
  7.   price = base - deductions; recompute amount_paid / balance_due.
  8.   report: docs/design/ledger-v2-backfill-report.md (per booking before/after, day-wise Mila / Wapas diye, entries whose
       business day differs from the calendar day, anything skipped).

DEV/LOCAL ONLY unless the founder says otherwise: refuses a non-localhost DATABASE_URL without --i-have-the-go.

    python scripts/ledger_v2_backfill.py [--dry-run]
"""

import argparse
import asyncio
import re
import sys
import uuid
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import AsyncSessionLocal  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.audit_phase3 import ShortPaymentClaim  # noqa: E402
from app.models.booking import Booking, BookingStatus  # noqa: E402
from app.models.court import Court  # noqa: E402
from app.models.dispute import PaymentDispute  # noqa: E402
from app.models.ledger_v2 import AdjustmentKind, BookingAdjustment  # noqa: E402
from app.models.payment import Payment  # noqa: E402
from app.models.payment_entry import EntryKind, PaymentEntry, PaymentMethod  # noqa: E402
from app.models.refund_flow import Escalation, RefundTransfer  # noqa: E402
from app.services.money import Money, load_money  # noqa: E402
from app.utils.business_day import business_date_for, venue_overnight_closes  # noqa: E402
from app.utils.timezone import pkt_date_of, utc_to_pkt_naive  # noqa: E402

UNCREDITED = ("overpayment_excess", "cancelled_payment_received")
REPORT = Path(__file__).resolve().parents[2] / "docs" / "design" / "ledger-v2-backfill-report.md"
_REF_RE = re.compile(r"^Refund paid \((?P<ref>.*?)\)")


def _i(x) -> int:
    return round(float(x or 0))


def old_kind(e: PaymentEntry) -> str:
    """The pre-v2 ledger's own reading of a row (owner_dashboard_service.ledger), for the before/after day report."""
    if e.reverses_entry_id is not None or (e.note or "").startswith("Booking completed"):
        return "correction"
    if e.amount_pkr < 0:
        return "refund"
    return "payment"


def classify(e: PaymentEntry) -> str:
    note = e.note or ""
    if e.reverses_entry_id is not None:
        return EntryKind.CORRECTION
    if note.startswith("Booking completed") and e.amount_pkr < 0:
        return EntryKind.CORRECTION
    if note.startswith("Refund taken back by Khelo"):
        return EntryKind.CORRECTION
    if note.startswith("Refund paid") or e.amount_pkr < 0:
        return EntryKind.REFUND
    return EntryKind.PAYMENT


class Run:
    def __init__(self, db, dry: bool):
        self.db = db
        self.dry = dry
        self.overnight: dict[uuid.UUID, dict] = {}
        self.venue_of_court: dict[uuid.UUID, uuid.UUID] = {}
        self.log: dict[uuid.UUID, list[str]] = defaultdict(list)
        self.skipped: list[tuple[uuid.UUID, str]] = []
        self.shifted: list[tuple] = []
        self.before: dict[uuid.UUID, dict] = {}
        self.days_before: dict[date, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self.counts: dict[str, int] = defaultdict(int)

    async def venue_id(self, court_id: uuid.UUID) -> uuid.UUID:
        if court_id not in self.venue_of_court:
            self.venue_of_court[court_id] = (await self.db.get(Court, court_id)).venue_id
        return self.venue_of_court[court_id]

    async def biz(self, court_id: uuid.UUID, at: datetime) -> date:
        vid = await self.venue_id(court_id)
        if vid not in self.overnight:
            self.overnight[vid] = await venue_overnight_closes(self.db, vid)
        return business_date_for(at, self.overnight[vid])

    async def add_entry(self, b: Booking, amount: int, method, kind: str, at: datetime, note: str, **links) -> PaymentEntry:
        e = PaymentEntry(booking_id=b.id, amount_pkr=amount, method=method, kind=kind, note=note, backfilled=True,
                         money_business_date=await self.biz(b.court_id, at), **links)
        self.db.add(e)
        await self.db.flush()
        e.created_at = at
        await self.db.flush()
        self.counts[f"entry_added_{kind}"] += 1
        return e

    def add_adj(self, b: Booking, kind: str, amount: int, reason: str, **kw) -> None:
        self.db.add(BookingAdjustment(booking_id=b.id, kind=kind, amount_pkr=amount, reason=reason, backfilled=True, **kw))
        self.counts[f"adjustment_{kind}"] += 1
        self.log[b.id].append(f"+ {kind} {amount:,} ({reason})")

    # ---- step 1+2 ----------------------------------------------------------------------------------------------------
    async def entries(self, b: Booking) -> None:
        rows = (await self.db.scalars(
            select(PaymentEntry).where(PaymentEntry.booking_id == b.id).order_by(PaymentEntry.created_at, PaymentEntry.id)
        )).all()
        for e in rows:
            if e.money_business_date is not None:
                continue
            cal = pkt_date_of(e.created_at)
            k_old = old_kind(e)
            if k_old == "refund":
                self.days_before[cal]["wapas_diye"] += -e.amount_pkr
            elif k_old == "payment":
                self.days_before[cal]["mila"] += e.amount_pkr
            else:
                self.days_before[cal]["theek_ki"] += e.amount_pkr
            e.kind = classify(e)
            e.money_business_date = await self.biz(b.court_id, e.created_at)
            if e.money_business_date != cal:
                self.shifted.append((str(e.id), str(e.booking_id), e.amount_pkr, utc_to_pkt_naive(e.created_at), cal, e.money_business_date))
            self.counts[f"entry_kind_{e.kind}"] += 1
        await self.db.flush()
        # link refunds to their dispute / transfer / the payment they return, and Khelo take-backs to the refund they undo
        payments = [e for e in rows if e.kind == EntryKind.PAYMENT and e.amount_pkr > 0]
        disputes = (await self.db.scalars(select(PaymentDispute).where(PaymentDispute.booking_id == b.id))).all()
        transfers = (await self.db.scalars(select(RefundTransfer).where(RefundTransfer.booking_id == b.id))).all()
        used_transfers = {e.refund_transfer_id for e in rows if e.refund_transfer_id}
        for e in rows:
            if e.kind == EntryKind.REFUND and e.dispute_id is None:
                m = _REF_RE.match(e.note or "")
                ref = m.group("ref") if m else None
                d = next((d for d in disputes if ref and d.refund_reference == ref), None) or (disputes[0] if len(disputes) == 1 else None)
                if d is not None:
                    e.dispute_id = d.id
                t = next((t for t in transfers if t.id not in used_transfers and _i(t.amount) == -e.amount_pkr
                          and (ref is None or t.reference == ref)), None)
                if t is not None:
                    e.refund_transfer_id = t.id
                    used_transfers.add(t.id)
                before = [p for p in payments if p.created_at <= e.created_at]
                if before:
                    e.refund_of_entry_id = before[-1].id
                if d is None:
                    self.skipped.append((b.id, f"refund entry {e.amount_pkr:,} on {pkt_date_of(e.created_at)} has no matching dispute"))
            if e.kind == EntryKind.CORRECTION and (e.note or "").startswith("Refund taken back by Khelo") and e.reverses_entry_id is None:
                target = next((r for r in rows if r.kind == EntryKind.REFUND and r.amount_pkr == -e.amount_pkr
                               and r.created_at <= e.created_at), None)
                if target is not None:
                    e.reverses_entry_id = target.id
                    e.dispute_id = target.dispute_id
                else:
                    self.skipped.append((b.id, "Khelo take-back with no refund entry to undo"))
        await self.db.flush()

    # ---- step 3 ------------------------------------------------------------------------------------------------------
    async def adjustments_from_audit(self, b: Booking) -> None:
        if b.base_price is not None:
            return
        events = (await self.db.scalars(
            select(AuditLog).where(
                AuditLog.entity_type == "booking", AuditLog.entity_id == b.id,
                AuditLog.action.in_(("booking.points_redeemed", "booking.due_waived", "booking.noshow_reversed")),
            ).order_by(AuditLog.created_at, AuditLog.id)
        )).all()
        escs = (await self.db.scalars(select(Escalation.id).where(Escalation.booking_id == b.id, Escalation.kind == "short_payment"))).all()
        if escs:
            events = sorted(
                list(events) + list((await self.db.scalars(
                    select(AuditLog).where(AuditLog.entity_type == "escalation", AuditLog.entity_id.in_(escs),
                                           AuditLog.action == "escalation.decided")
                )).all()),
                key=lambda a: (a.created_at, a.id),
            )
        price_now = _i(b.price)
        points = waived = reduced = 0
        first_old: int | None = None
        for a in events:
            old, new = a.old_value or {}, a.new_value or {}
            if a.action == "booking.points_redeemed":
                amt = _i(new.get("discount_pkr")) or (_i(old.get("price")) - _i(new.get("price")))
                if first_old is None:
                    first_old = _i(old.get("price"))
                if amt > 0:
                    points += amt
                    self.add_adj(b, AdjustmentKind.POINTS, amt, "backfill: points (audit booking.points_redeemed)")
            elif a.action == "booking.due_waived":
                amt = _i(old.get("price")) - _i(new.get("price"))
                if first_old is None:
                    first_old = _i(old.get("price"))
                if amt > 0:
                    waived += amt
                    claim = new.get("claim_id")
                    self.add_adj(b, AdjustmentKind.WAIVED, amt, "backfill: owner waived the due (audit booking.due_waived)",
                                 short_claim_id=uuid.UUID(claim) if claim else None)
            elif a.action == "escalation.decided":
                if new.get("decision") != "player" or new.get("price_before") is None:
                    continue
                amt = _i(new.get("price_before")) - _i(new.get("price_after"))
                if first_old is None:
                    first_old = _i(new.get("price_before"))
                if amt > 0:
                    waived += amt
                    self.add_adj(b, AdjustmentKind.WAIVED, amt, "backfill: Khelo decided for the player (audit escalation.decided)")
            elif a.action == "booking.noshow_reversed":
                o, n = _i(old.get("price")), _i(new.get("price"))
                if first_old is None:
                    first_old = o
                if n < o:
                    reduced += o - n
                    self.add_adj(b, AdjustmentKind.PRICE_REDUCED, o - n, "backfill: final price set when the no-show was taken back")
                elif n > o:
                    self.skipped.append((b.id, f"no-show taken back at a HIGHER price ({o:,} -> {n:,}); base_price includes the rise"))
        # the old code lowered price on a waiver; a waiver is not part of the price, so put it back
        final_now = price_now + waived
        base = final_now + points + reduced
        if first_old is not None and first_old != base:
            self.skipped.append((b.id, f"base from history {first_old:,} != rebuilt base {base:,} (other price changes?)"))
        b.base_price = base
        b.price = final_now
        if points or waived or reduced:
            self.log[b.id].append(f"base_price {base:,}")

    # ---- step 5 ------------------------------------------------------------------------------------------------------
    async def uncredited_refunds(self, b: Booking) -> None:
        disputes = (await self.db.scalars(
            select(PaymentDispute).where(PaymentDispute.booking_id == b.id, PaymentDispute.reason.in_(UNCREDITED),
                                         PaymentDispute.refund_amount > 0)
        )).all()
        for d in disputes:
            # already credited (by an earlier backfill run, by v2, or step 6a linked the payment that brought it)
            done = await self.db.scalar(select(PaymentEntry.id).where(PaymentEntry.dispute_id == d.id,
                                                                      PaymentEntry.kind == EntryKind.PAYMENT).limit(1))
            if done:
                continue
            pay = await self.db.get(Payment, d.payment_id) if d.payment_id else None
            came_at = (pay.reviewed_at if pay and pay.reviewed_at else None) or d.created_at
            pin = await self.add_entry(
                b, _i(d.refund_amount), PaymentMethod.BANK_TRANSFER_PROOF, EntryKind.PAYMENT, came_at,
                f"backfill: money received above what was credited ({d.reason})", dispute_id=d.id,
            )
            self.log[b.id].append(f"+ payment {_i(d.refund_amount):,} ({d.reason}, was never in the ledger)")
            transfers = (await self.db.scalars(
                select(RefundTransfer).where(RefundTransfer.dispute_id == d.id).order_by(RefundTransfer.created_at)
            )).all()
            sent = 0
            last = None
            for t in transfers:
                at = d.refunded_at if (len(transfers) == 1 and d.refunded_at) else t.created_at
                last = await self.add_entry(
                    b, -_i(t.amount), PaymentMethod.BANK_TRANSFER_PROOF, EntryKind.REFUND, at,
                    f"backfill: refund paid ({t.reference or 'no reference'})", dispute_id=d.id, refund_transfer_id=t.id,
                    refund_of_entry_id=pin.id,
                )
                sent += _i(t.amount)
            if not transfers and _i(d.refunded_amount) > 0:
                last = await self.add_entry(
                    b, -_i(d.refunded_amount), PaymentMethod.BANK_TRANSFER_PROOF, EntryKind.REFUND, d.refunded_at or d.updated_at,
                    f"backfill: refund paid ({d.refund_reference or 'no reference'})", dispute_id=d.id, refund_of_entry_id=pin.id,
                )
                sent = _i(d.refunded_amount)
            if sent:
                self.log[b.id].append(f"+ refund -{sent:,} ({d.reason})")
            back = sent - _i(d.refunded_amount)
            if back > 0 and last is not None:  # Khelo took (part of) it back; the old code wrote no entry for these reasons
                await self.add_entry(
                    b, back, PaymentMethod.BANK_TRANSFER_PROOF, EntryKind.CORRECTION, d.updated_at,
                    "backfill: refund taken back by Khelo", dispute_id=d.id, reverses_entry_id=last.id,
                )
                self.log[b.id].append(f"+ correction {back:,} (refund taken back)")

    # ---- step 4 ------------------------------------------------------------------------------------------------------
    async def old_noshow(self, b: Booking) -> None:
        if b.status != BookingStatus.NO_SHOW:
            return
        if await self.db.scalar(select(BookingAdjustment.id).where(BookingAdjustment.booking_id == b.id,
                                                                   BookingAdjustment.kind == AdjustmentKind.NO_SHOW)):
            return
        m = await load_money(self.db, b)
        if m.balance <= 0:
            return
        open_claim = await self.db.scalar(select(ShortPaymentClaim.id).where(
            ShortPaymentClaim.booking_id == b.id, ShortPaymentClaim.resolved_at.is_(None)))
        if open_claim:
            self.skipped.append((b.id, f"no-show with an OPEN due of {m.balance:,}: no no_show adjustment added (your decision)"))
            return
        self.add_adj(b, AdjustmentKind.NO_SHOW, m.balance, "backfill: old no-show, advance kept, rest not charged")

    # ---- step 6 ------------------------------------------------------------------------------------------------------
    async def old_cancel(self, b: Booking) -> None:
        if b.status != BookingStatus.CANCELLED:
            return
        if await self.db.scalar(select(BookingAdjustment.id).where(BookingAdjustment.booking_id == b.id,
                                                                   BookingAdjustment.kind == AdjustmentKind.CANCELLATION)):
            return
        await self.db.flush()
        m = await load_money(self.db, b)
        disputes = (await self.db.scalars(select(PaymentDispute).where(PaymentDispute.booking_id == b.id,
                                                                       PaymentDispute.resolved.is_(False)))).all()
        remaining = sum(max(_i(d.refund_amount) - _i(d.refunded_amount), 0) for d in disputes)
        amount = m.final - (m.net - remaining)
        if amount < 0:
            self.skipped.append((b.id, f"cancel: final {m.final:,} < net {m.net:,} - owed back {remaining:,}; no adjustment"))
            return
        if amount > 0:
            self.add_adj(b, AdjustmentKind.CANCELLATION, amount,
                         "backfill: cancelled, refund owed" if remaining else "backfill: cancelled")

    # ---- step 6a -----------------------------------------------------------------------------------------------------
    async def excess_without_dispute(self, b: Booking) -> None:
        """Founder 13 Nov: money above the total with no refund row (the walk-in 4,000 on 2,000 bug) gets an overpayment_excess
        dispute for the difference, linked to the payment that brought it, so it shows in Kaam -> Wapas dena. Often a typing
        mistake: reversing that payment shrinks / closes this dispute (sync_refund_disputes)."""
        if b.status == BookingStatus.CANCELLED:
            return
        await self.db.flush()
        m = await load_money(self.db, b)
        if m.refund_due <= 0:
            return
        disputes = (await self.db.scalars(select(PaymentDispute).where(PaymentDispute.booking_id == b.id,
                                                                       PaymentDispute.resolved.is_(False)))).all()
        remaining = sum(max(_i(d.refund_amount) - _i(d.refunded_amount), 0) for d in disputes)
        gap = m.refund_due - remaining
        if gap <= 0:
            return
        source = await self.db.scalar(
            select(PaymentEntry).where(PaymentEntry.booking_id == b.id, PaymentEntry.kind == EntryKind.PAYMENT,
                                       PaymentEntry.amount_pkr > 0, PaymentEntry.dispute_id.is_(None))
            .order_by(PaymentEntry.amount_pkr.desc(), PaymentEntry.created_at).limit(1)
        )
        d = PaymentDispute(booking_id=b.id, player_id=b.player_id, reason="overpayment_excess", refund_amount=gap,
                           resolution_note="backfill: zyada paisa darj hua (shayad typing ki ghalti)")
        self.db.add(d)
        await self.db.flush()
        if source is not None:
            source.dispute_id = d.id
        self.counts["dispute_added_overpayment_excess"] += 1
        self.log[b.id].append(f"+ refund dispute {gap:,} (zyada paisa, dispute nahi tha)")

    # ---- step 7 ------------------------------------------------------------------------------------------------------
    async def finish(self, b: Booking) -> Money:
        from app.services.payment_ledger_service import recompute_payment_totals

        await self.db.flush()
        m = await load_money(self.db, b)
        b.price = m.final
        await recompute_payment_totals(self.db, b)
        return m

    async def one(self, b: Booking) -> None:
        self.before[b.id] = {"price": _i(b.price), "paid": _i(b.amount_paid), "due": _i(b.balance_due)}
        await self.entries(b)
        await self.adjustments_from_audit(b)
        await self.uncredited_refunds(b)
        await self.db.flush()
        await self.old_noshow(b)
        await self.db.flush()
        await self.old_cancel(b)
        await self.excess_without_dispute(b)
        m = await self.finish(b)
        self.before[b.id]["after"] = m


async def run_backfill(db, dry: bool = False):
    """Runs every step on every booking with `db`; returns (run, {booking: (name, status)}, day-wise after)."""
    ids = (await db.scalars(select(Booking.id).order_by(Booking.created_at))).all()
    run = Run(db, dry)
    bookings_meta: dict[uuid.UUID, tuple[str, str]] = {}
    for bid in ids:
        b = await db.get(Booking, bid, with_for_update=True)
        bookings_meta[bid] = (b.player_name or "", b.status.value)
        try:
            await run.one(b)
            if dry:
                await db.flush()
            else:
                await db.commit()
        except Exception as exc:  # one booking failing must not stop the rest
            await db.rollback()
            run.skipped.append((bid, f"ERROR {type(exc).__name__}: {exc}"))
    # day-wise after (new kinds, business day)
    days_after: dict[date, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for e in (await db.scalars(select(PaymentEntry))).all():
        if e.money_business_date is None:
            continue
        key = {"payment": "mila", "refund": "wapas_diye"}.get(e.kind, "theek_ki" if e.kind == "correction" else e.kind)
        days_after[e.money_business_date][key] += -e.amount_pkr if e.kind == "refund" else e.amount_pkr
    if dry:
        await db.rollback()
    return run, bookings_meta, days_after


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--i-have-the-go", action="store_true", help="required for a non-localhost database")
    args = ap.parse_args()
    url = get_settings().DATABASE_URL
    if "localhost" not in url and "127.0.0.1" not in url and not args.i_have_the_go:
        sys.exit("refusing: not a localhost database (production needs the founder's go: --i-have-the-go)")

    async with AsyncSessionLocal() as db:
        run, bookings_meta, days_after = await run_backfill(db, args.dry_run)
        write_report(run, bookings_meta, days_after, args.dry_run)
    print(f"done ({'dry run, rolled back' if args.dry_run else 'committed'}); report: {REPORT}")


def write_report(run: Run, meta, days_after, dry: bool) -> None:
    L: list[str] = []
    L.append("# Ledger v2 backfill report")
    L.append("")
    L.append(f"{datetime.now().strftime('%Y-%m-%d %H:%M')} · {'DRY RUN (rolled back)' if dry else 'committed'} · local/dev DB only")
    L.append("")
    L.append("## Kya bana")
    L.append("")
    L.append("| cheez | ginti |")
    L.append("|---|---|")
    for k in sorted(run.counts):
        L.append(f"| {k} | {run.counts[k]} |")
    L.append("")
    L.append("## Har booking: pehle → baad")
    L.append("")
    L.append("| booking | naam | status | price pehle → Final | paid pehle → net | baqi pehle → due / slot par / wapas | waived | pill | kya bana |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for bid, row in run.before.items():
        m: Money | None = row.get("after")
        if m is None:
            continue
        name, st = meta[bid]
        changed = run.log.get(bid, [])
        L.append(
            f"| `{str(bid)[:8]}` | {name} | {st} | {row['price']:,} → {m.final:,} | {row['paid']:,} → {m.net:,} | "
            f"{row['due']:,} → {m.due:,} / {m.due_at_slot:,} / {m.refund_due:,} | {m.waived:,} | {m.status} | "
            f"{'; '.join(changed) if changed else '—'} |"
        )
    L.append("")
    L.append("## Din-wise farq (Mila / Wapas diye)")
    L.append("")
    L.append("Pehle = purana ledger (calendar din, purani pehchaan). Baad = business day + nayi `kind`.")
    L.append("")
    L.append("| din | Mila pehle | Mila baad | Wapas diye pehle | Wapas diye baad | theek ki pehle | theek ki baad |")
    L.append("|---|---|---|---|---|---|---|")
    for d in sorted(set(run.days_before) | set(days_after)):
        a, z = run.days_before.get(d, {}), days_after.get(d, {})
        cells = [a.get("mila", 0), z.get("mila", 0), a.get("wapas_diye", 0), z.get("wapas_diye", 0), a.get("theek_ki", 0), z.get("theek_ki", 0)]
        mark = " **farq**" if (cells[0], cells[2], cells[4]) != (cells[1], cells[3], cells[5]) else ""
        L.append(f"| {d}{mark} | " + " | ".join(f"{c:,}" for c in cells) + " |")
    L.append("")
    L.append("## Entries jin ka business day calendar din se alag aaya")
    L.append("")
    L.append("Aaj ke closing schedule se. Jahan schedule baad mein badla ho, wahan yeh din ghalat ho sakta hai.")
    L.append("")
    if run.shifted:
        L.append("| entry | booking | raqam | waqt (PKT) | calendar din | business day |")
        L.append("|---|---|---|---|---|---|")
        for eid, bid, amount, local, cal, biz in run.shifted:
            L.append(f"| `{eid[:8]}` | `{bid[:8]}` | {amount:,} | {local:%Y-%m-%d %H:%M} | {cal} | {biz} |")
    else:
        L.append("Koi nahi.")
    L.append("")
    L.append("## Jo chhoda gaya / dhyan do")
    L.append("")
    if run.skipped:
        for bid, why in run.skipped:
            L.append(f"- `{str(bid)[:8]}` {meta.get(bid, ('', ''))[0]}: {why}")
    else:
        L.append("Kuch nahi.")
    L.append("")
    REPORT.write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
