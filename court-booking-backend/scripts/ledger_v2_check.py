"""Ledger v2 check (docs/design/LEDGER-V2-CONTRACT.md 3.3), read-only. Run after scripts/ledger_v2_backfill.py.

The identity final = net + due + due_at_slot + waived - refund_due holds by definition, so the checks that can actually catch
something compare the money function with sources it does NOT read:

  C1  bookings.price == base_price - active deductions
  C2  bookings.amount_paid == SUM(payment_entries)
  C3  bookings.balance_due == max(final - net - waived, 0)
  C4  refund_due == SUM over unresolved payment_disputes of (refund_amount - refunded_amount)
  C5  an open short-payment claim's due_pkr == due (played bookings)
  C6  final >= 0, waived <= base_price, base_price set
  C7  identity per booking, and summed over all bookings
  C8  every refund entry has a dispute; every credit entry has a player_credits row
  C9  every entry has a business day and a known kind

Bookings that fail are listed (never fixed here) in docs/design/ledger-v2-check-report.md.

    python scripts/ledger_v2_check.py
"""

import asyncio
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.audit_phase3 import ShortPaymentClaim  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.dispute import PaymentDispute  # noqa: E402
from app.models.ledger_v2 import PlayerCredit  # noqa: E402
from app.models.payment_entry import EntryKind, PaymentEntry  # noqa: E402
from app.services.money import DUE_NOW_STATUSES, load_money_many  # noqa: E402

REPORT = Path(__file__).resolve().parents[2] / "docs" / "design" / "ledger-v2-check-report.md"
CHECKS = ("C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9")


def _i(x) -> int:
    return round(float(x or 0))


async def run_checks(db):
    """All checks with `db`; returns (fails by check, totals, number of bookings)."""
    fails: dict[str, list[str]] = defaultdict(list)
    totals = defaultdict(int)
    bookings = (await db.scalars(select(Booking).order_by(Booking.created_at))).all()
    money = await load_money_many(db, list(bookings))
    disputes: dict = defaultdict(int)
    for d in (await db.scalars(select(PaymentDispute).where(PaymentDispute.resolved.is_(False)))).all():
        disputes[d.booking_id] += max(_i(d.refund_amount) - _i(d.refunded_amount), 0)
    claims = {c.booking_id: c for c in (await db.scalars(select(ShortPaymentClaim).where(ShortPaymentClaim.resolved_at.is_(None)))).all()}
    sums = dict((await db.execute(select(PaymentEntry.booking_id, func.sum(PaymentEntry.amount_pkr)).group_by(PaymentEntry.booking_id))).all())

    for b in bookings:
        m = money[b.id]
        tag = f"`{str(b.id)[:8]}` {b.player_name or ''} ({b.status.value})"
        if _i(b.price) != m.final:
            fails["C1"].append(f"{tag}: price {_i(b.price):,} != base {m.base_price:,} - deductions {m.deductions_total:,} = {m.final:,}")
        if _i(b.amount_paid) != _i(sums.get(b.id, 0)):
            fails["C2"].append(f"{tag}: amount_paid {_i(b.amount_paid):,} != entries {_i(sums.get(b.id, 0)):,}")
        if _i(b.balance_due) != max(m.balance, 0):
            fails["C3"].append(f"{tag}: balance_due {_i(b.balance_due):,} != max(balance {m.balance:,}, 0)")
        owed = disputes.get(b.id, 0)
        if m.refund_due != owed:
            fails["C4"].append(f"{tag}: refund_due {m.refund_due:,} != open refund disputes {owed:,}")
        c = claims.get(b.id)
        if c is not None and b.status in DUE_NOW_STATUSES and c.due_pkr != m.due:
            fails["C5"].append(f"{tag}: open claim due {c.due_pkr:,} != due {m.due:,}")
        if m.final < 0 or m.waived > m.base_price or b.base_price is None:
            fails["C6"].append(f"{tag}: final {m.final:,}, waived {m.waived:,}, base_price {b.base_price}")
        if m.final != m.net + m.due + m.due_at_slot + m.waived - m.refund_due:
            fails["C7"].append(f"{tag}: identity broken")
        for k in ("final", "net", "due", "due_at_slot", "waived", "refund_due"):
            totals[k] += getattr(m, k)

    if totals["final"] != totals["net"] + totals["due"] + totals["due_at_slot"] + totals["waived"] - totals["refund_due"]:
        fails["C7"].append("identity broken on the sum of all bookings")

    for e in (await db.scalars(select(PaymentEntry).where(PaymentEntry.kind == EntryKind.REFUND, PaymentEntry.dispute_id.is_(None)))).all():
        fails["C8"].append(f"refund entry `{str(e.id)[:8]}` on booking `{str(e.booking_id)[:8]}` ({e.amount_pkr:,}) has no dispute")
    credit_entries = (await db.scalars(select(PaymentEntry.id).where(PaymentEntry.kind.in_((EntryKind.CREDIT_IN, EntryKind.CREDIT_OUT))))).all()
    have = set((await db.scalars(select(PlayerCredit.entry_id))).all())
    for eid in credit_entries:
        if eid not in have:
            fails["C8"].append(f"credit entry `{str(eid)[:8]}` has no player_credits row")
    for e in (await db.scalars(select(PaymentEntry).where(
        (PaymentEntry.money_business_date.is_(None)) | (PaymentEntry.kind.not_in(EntryKind.ALL))
    ))).all():
        fails["C9"].append(f"entry `{str(e.id)[:8]}`: kind {e.kind}, business day {e.money_business_date}")
    return fails, totals, len(bookings)


async def main() -> int:
    async with AsyncSessionLocal() as db:
        fails, totals, n = await run_checks(db)
    L = ["# Ledger v2 check report", "", f"{datetime.now():%Y-%m-%d %H:%M} · {n} bookings · read-only", ""]
    L += ["| check | nateeja |", "|---|---|"]
    for c in CHECKS:
        L.append(f"| {c} | {'OK' if not fails[c] else f'{len(fails[c])} fail'} |")
    L += ["", "Kul (sab bookings): " + ", ".join(f"{k} {v:,}" for k, v in totals.items()), ""]
    for c in CHECKS:
        if fails[c]:
            L += [f"## {c}", ""] + [f"- {x}" for x in fails[c]] + [""]
    REPORT.write_text("\n".join(L), encoding="utf-8")
    bad = sum(len(v) for v in fails.values())
    print(f"{n} bookings, {bad} failures; report: {REPORT}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
