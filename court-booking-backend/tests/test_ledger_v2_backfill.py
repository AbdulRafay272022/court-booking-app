"""Ledger v2 contract test 15: legacy-shaped data (scripts/ledger_v2_legacy_fixture.py) -> backfill -> every check passes
except the known walk-in bug case, and a second backfill changes nothing."""

import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import func, select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import ledger_v2_backfill as bf  # noqa: E402
import ledger_v2_check as ck  # noqa: E402
import ledger_v2_legacy_fixture as fx  # noqa: E402

from app.models.booking import Booking  # noqa: E402
from app.models.payment_entry import PaymentEntry  # noqa: E402
from app.services.money import load_money  # noqa: E402
from app.utils.timezone import pkt_date_of  # noqa: E402


async def _snapshot(db) -> tuple:
    entries = (await db.execute(select(func.count(PaymentEntry.id), func.sum(PaymentEntry.amount_pkr)))).one()
    adj = await db.scalar(text("select count(*) from booking_adjustments"))
    rows = (await db.execute(select(Booking.id, Booking.price, Booking.base_price, Booking.amount_paid, Booking.balance_due)
                             .order_by(Booking.id))).all()
    return tuple(entries), adj, tuple(rows)


async def test_backfill_then_check_then_idempotent(db_session):
    scenarios = await fx.build(db_session)
    by_key = {k: bid for k, bid, _ in scenarios}
    assert len(scenarios) == 23

    run, _meta, _days = await bf.run_backfill(db_session)
    assert [why for _bid, why in run.skipped] == [
        "no-show with an OPEN due of 4,000: no no_show adjustment added (your decision)"
    ]

    fails, totals, n = await ck.run_checks(db_session)
    assert n == 23
    bad = {c: v for c, v in fails.items() if v}
    assert list(bad) == ["C4"] and len(bad["C4"]) == 1 and "S16 Walkin 4000" in bad["C4"][0]
    assert totals["final"] == totals["net"] + totals["due"] + totals["due_at_slot"] + totals["waived"] - totals["refund_due"]

    async def money(key):
        b = await db_session.get(Booking, by_key[key])
        await db_session.refresh(b)
        return b, await load_money(db_session, b)

    b, m = await money("S04")  # waived: price restored, waiver separate, nothing due
    assert (float(b.price), m.base_price, m.waived, m.due) == (5000.0, 5000, 2000, 0)
    b, m = await money("S07")  # old no-show: advance kept
    assert (m.final, m.status) == (1000, "noshow_kept")
    b, m = await money("S15")  # refund taken back by Khelo -> owed again, no phantom payment
    assert (m.refund_due, m.payments) == (1000, 1000)
    b, m = await money("S12")  # uncredited excess now in the ledger, refunded
    assert (m.payments, m.refunds, m.refund_due) == (5500, 500, 0)
    b, m = await money("S14")  # money on an expired booking: received, owed back
    assert (m.final, m.net, m.refund_due, m.status) == (0, 2000, 2000, "cancel_refund")
    b, m = await money("S21")  # points + waive on one booking
    assert (m.base_price, m.deductions["points"], m.final, m.waived, m.due) == (6000, 500, 5500, 1500, 0)

    # the 1:00 AM cash on the overnight venue belongs to the previous business day
    rows = (await db_session.scalars(select(PaymentEntry).where(PaymentEntry.booking_id == by_key["S02"],
                                                                PaymentEntry.amount_pkr == 4000))).all()
    assert len(rows) == 1 and rows[0].kind == "payment"
    assert rows[0].money_business_date == pkt_date_of(rows[0].created_at) - timedelta(days=1)

    before = await _snapshot(db_session)
    run2, _m2, _d2 = await bf.run_backfill(db_session)
    assert dict(run2.counts) == {}
    assert await _snapshot(db_session) == before
