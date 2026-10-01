"""Money-correctness batch (2026-10-02): approval credits the REAL amount paid, overpayment is capped with the
excess queued as a refund owed, owner cancels of paid bookings owe a refund, and partial refunds keep the dispute
open until the cumulative refunded amount reaches the owed amount. Exact PKR amounts throughout.

Fixture shape used by most tests: price 6000, FIXED advance 2500 (so "Paid in full" == 2500)."""
import csv
import io
from datetime import date, datetime, time, timedelta, timezone

from PIL import Image
from sqlalchemy import select

from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.court import CourtAdvanceType
from app.models.dispute import PaymentDispute
from app.models.payment_entry import PaymentEntry
from app.models.user import UserRole
from app.services.ai.base import PaymentExtraction


def _future_starts_at(days_ahead: int = 1) -> str:
    target = date.today() + timedelta(days=days_ahead)
    return f"{target.isoformat()}T10:00:00+00:00"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(10, 90, 200)).save(buf, format="PNG")
    return buf.getvalue()


async def _open_all_week(make_schedule, court) -> None:
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))


def _mock_upload(monkeypatch):
    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)
    monkeypatch.setattr("app.api.owners.upload_private_proof", fake_upload)


def _mock_ocr(monkeypatch, amount, **extra):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        kwargs = dict(amount=amount, reference=None, timestamp=None, confidence=0.9, raw_response={})
        kwargs.update(extra)
        return PaymentExtraction(**kwargs)

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)


class _Setup:
    pass


async def _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, phone_seed):
    s = _Setup()
    s.owner = await make_user(f"+92300710{phone_seed:04d}", role=UserRole.OWNER)
    s.customer = await make_user(f"+92300711{phone_seed:04d}", role=UserRole.PLAYER, name="Ali Raza")
    venue = await make_venue(s.owner)
    s.court = await make_court(venue, advance_type=CourtAdvanceType.FIXED, advance_value=2500)
    await _open_all_week(make_schedule, s.court)
    await make_pricing_rule(s.court, price_per_slot=6000)
    s.owner_headers = await make_auth_headers(s.owner)
    s.customer_headers = await make_auth_headers(s.customer)
    return s


async def _hold_and_submit(client, s) -> tuple[dict, dict]:
    held = await client.post(
        "/api/v1/bookings/hold",
        headers=s.customer_headers,
        json={"court_id": str(s.court.id), "starts_at": _future_starts_at()},
    )
    booking = held.json()["booking"]
    assert float(booking["advance_amount"]) == 2500.0 and float(booking["price"]) == 6000.0
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=s.customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_png()), "image/jpeg")},
    )
    assert submit.status_code == 201
    return booking, submit.json()["payment"]


async def _entries(db_session_factory, booking_id):
    async with db_session_factory() as session:
        rows = (
            await session.execute(
                select(PaymentEntry).where(PaymentEntry.booking_id == booking_id).order_by(PaymentEntry.created_at)
            )
        ).scalars().all()
        return [(e.amount_pkr, e.note) for e in rows]


async def _disputes(db_session_factory, booking_id):
    async with db_session_factory() as session:
        return (
            await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking_id))
        ).scalars().all()


async def test_player_paid_5000_of_6000_credits_5000(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 5000)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 1)
    booking, payment = await _hold_and_submit(client, s)

    approve = await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    assert approve.status_code == 200
    b = approve.json()["booking"]
    assert b["status"] == "booked" and b["amount_paid"] == 5000.0 and b["balance_due"] == 1000.0
    entries = await _entries(db_session_factory, booking["id"])
    assert [e[0] for e in entries] == [5000]
    # The audit note records expected, screenshot, paid and credited amounts.
    assert "Expected PKR 2,500" in entries[0][1] and "Screenshot showed PKR 5,000" in entries[0][1]
    assert "Credited PKR 5,000" in entries[0][1]
    assert await _disputes(db_session_factory, booking["id"]) == []


async def test_player_paid_500_credits_500_and_booking_is_booked_with_big_balance(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 500)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 2)
    booking, payment = await _hold_and_submit(client, s)

    approve = await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    b = approve.json()["booking"]
    assert b["status"] == "booked" and b["amount_paid"] == 500.0 and b["balance_due"] == 5500.0
    assert [e[0] for e in await _entries(db_session_factory, booking["id"])] == [500]


async def test_owner_edited_amount_overrides_the_screenshot_amount(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 500)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 3)
    booking, payment = await _hold_and_submit(client, s)

    approve = await client.post(
        f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers, json={"amount_pkr": 2500}
    )
    b = approve.json()["booking"]
    assert b["amount_paid"] == 2500.0 and b["balance_due"] == 3500.0
    entries = await _entries(db_session_factory, booking["id"])
    assert [e[0] for e in entries] == [2500]
    assert "Screenshot showed PKR 500" in entries[0][1] and "Paid PKR 2,500" in entries[0][1]

    # A non-positive amount is a validation error, not a silent default.
    # (the payment is already approved here, so use a fresh check on the schema alone)
    bad = await client.post(
        f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers, json={"amount_pkr": 0}
    )
    assert bad.status_code == 422


async def test_overpayment_7000_caps_ledger_at_price_and_queues_1000_refund(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 7000)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 4)
    booking, payment = await _hold_and_submit(client, s)

    approve = await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    b = approve.json()["booking"]
    assert b["amount_paid"] == 6000.0 and b["balance_due"] == 0.0
    entries = await _entries(db_session_factory, booking["id"])
    assert [e[0] for e in entries] == [6000]
    assert "Excess PKR 1,000" in entries[0][1]

    disputes = await _disputes(db_session_factory, booking["id"])
    assert len(disputes) == 1
    assert disputes[0].reason == "overpayment_excess"
    assert float(disputes[0].refund_amount) == 1000.0 and disputes[0].refund_status == "owed"

    # It shows on the owner's "Refunds to pay" list ...
    rows = (await client.get("/api/v1/owners/refunds", headers=s.owner_headers)).json()
    row = next(r for r in rows if r["booking_id"] == booking["id"])
    assert row["refund_amount"] == 1000.0 and row["remaining_amount"] == 1000.0
    assert row["reason"] == "overpayment_excess"

    # ... and refunding the excess does NOT subtract from the ledger (that money was never credited).
    marked = await client.post(
        f"/api/v1/owners/refunds/{row['id']}/mark-refunded", headers=s.owner_headers, data={"reference": "JC-1"}
    )
    assert marked.status_code == 200 and marked.json()["refund_status"] == "refunded"
    assert [e[0] for e in await _entries(db_session_factory, booking["id"])] == [6000]
    async with db_session_factory() as session:
        assert float((await session.get(Booking, booking["id"])).amount_paid) == 6000.0


async def test_paid_exactly_the_advance_credits_2500(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 2500)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 5)
    booking, payment = await _hold_and_submit(client, s)
    approve = await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    b = approve.json()["booking"]
    assert b["amount_paid"] == 2500.0 and b["balance_due"] == 3500.0
    assert [e[0] for e in await _entries(db_session_factory, booking["id"])] == [2500]
    assert await _disputes(db_session_factory, booking["id"]) == []


async def test_unreadable_screenshot_defaults_to_the_expected_advance(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, None)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 6)
    booking, payment = await _hold_and_submit(client, s)
    assert payment["ocr_verdict"] == "unreadable"
    approve = await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    assert approve.json()["booking"]["amount_paid"] == 2500.0
    assert [e[0] for e in await _entries(db_session_factory, booking["id"])] == [2500]


async def test_auto_approve_credits_the_ocr_amount(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    """Auto-approve only triggers within tolerance (5%) of the advance: a screenshot of 2600 (4% over 2500)
    auto-approves and credits 2600, not the fixed 2500."""
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 2600, payer_name="Ali Raza", timestamp=datetime.now(timezone.utc).isoformat())
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 7)
    async with db_session_factory() as session:
        from app.models.venue import Venue

        venue = await session.get(Venue, s.court.venue_id)
        venue.auto_approve_enabled = True
        venue.auto_approve_min_bookings = 1
        for i in range(2):
            session.add(
                Booking(
                    court_id=s.court.id, player_id=s.customer.id,
                    starts_at=datetime.now(timezone.utc) - timedelta(days=i + 10),
                    ends_at=datetime.now(timezone.utc) - timedelta(days=i + 10) + timedelta(hours=1),
                    price=6000, amount_paid=6000, status=BookingStatus.COMPLETED,
                )
            )
        await session.commit()
    booking, payment = await _hold_and_submit(client, s)
    assert payment["auto_approved"] is True
    entries = await _entries(db_session_factory, booking["id"])
    assert [e[0] for e in entries] == [2600]
    assert "auto-approved" in entries[0][1]
    async with db_session_factory() as session:
        b = await session.get(Booking, booking["id"])
        assert float(b.amount_paid) == 2600.0 and float(b.balance_due) == 3400.0


async def test_approval_card_says_paid_in_full_overpaid_or_underpaid(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    expectations = {
        2500: ("paid_in_full", "Paid in full", 2500, 3500),
        5000: ("overpaid", "Overpaid by PKR 2,500", 5000, 1000),
        7000: ("overpaid", "Overpaid by PKR 4,500", 6000, 0),  # total after approval is capped at the price
        500: ("underpaid", "Underpaid by PKR 2,000", 500, 5500),
    }
    for seed, (ocr_amount, (status, text, total_after, balance_after)) in enumerate(expectations.items(), start=10):
        _mock_ocr(monkeypatch, ocr_amount)
        s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, seed)
        await _hold_and_submit(client, s)
        rows = (await client.get("/api/v1/owners/pending-approvals", headers=s.owner_headers)).json()
        assert len(rows) == 1
        checks = rows[0]["checks"]
        assert checks["payment_status"] == status
        assert checks["payment_status_text"] == text
        assert checks["paid_amount"] == ocr_amount and checks["expected_amount"] == 2500
        assert checks["total_after_approval"] == total_after
        assert checks["balance_after_approval"] == balance_after
        assert f"Balance due at the venue: PKR {balance_after:,}." in checks["balance_text"]


async def test_ledger_json_and_csv_show_real_amounts_and_refund_label(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 5000)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 20)
    booking, payment = await _hold_and_submit(client, s)
    await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=s.owner_headers, json={"reason": "court flooded"}
    )
    assert cancel.status_code == 200
    row = next(r for r in (await client.get("/api/v1/owners/refunds", headers=s.owner_headers)).json()
               if r["booking_id"] == booking["id"])
    await client.post(
        f"/api/v1/owners/refunds/{row['id']}/mark-refunded", headers=s.owner_headers,
        data={"reference": "JC-77", "amount": "2000"},
    )

    today = date.today()
    params = {"start_date": (today - timedelta(days=1)).isoformat(), "end_date": (today + timedelta(days=3)).isoformat()}
    ledger = (await client.get("/api/v1/owners/ledger", headers=s.owner_headers, params=params)).json()
    mine = [e for e in ledger["entries"] if e["booking_id"] == booking["id"]]
    assert [(e["label"], e["entry_type"], e["amount_pkr"], e["running_total"]) for e in mine] == [
        ("Payment", "payment", 5000, 5000),
        ("Refund", "refund", -2000, 3000),
    ]
    assert "JC-77" in mine[1]["note"]
    # Remaining owed (5000 - 2000), not the booking's amount_paid.
    assert ledger["summary"]["cancelled_refund_pending"] == 3000.0

    csv_resp = await client.get(
        "/api/v1/owners/ledger/export", headers=s.owner_headers, params={**params, "format": "csv"}
    )
    rows = list(csv.reader(io.StringIO(csv_resp.text)))
    assert rows[0][4] == "type" and rows[0][-1] == "note"
    assert (rows[1][4], rows[1][6]) == ("Payment", "5000")
    assert (rows[2][4], rows[2][6]) == ("Refund", "-2000") and "JC-77" in rows[2][-1]


async def test_owner_cancel_of_paid_booking_creates_refund_of_the_real_amount(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 5000)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 21)
    booking, payment = await _hold_and_submit(client, s)
    await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)

    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=s.owner_headers, json={"reason": "maintenance"}
    )
    assert cancel.status_code == 200 and cancel.json()["booking"]["cancelled_by"] == "owner"
    disputes = await _disputes(db_session_factory, booking["id"])
    assert len(disputes) == 1
    assert disputes[0].reason == "owner_cancelled_paid_booking"
    assert float(disputes[0].refund_amount) == 5000.0 and disputes[0].refund_status == "owed"
    assert str(disputes[0].payment_id) == payment["id"]


async def test_player_cancel_of_paid_booking_refunds_the_real_amount_not_the_advance(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 5000)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 22)
    booking, payment = await _hold_and_submit(client, s)
    await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=s.customer_headers, json={"reason": "plans changed"}
    )
    assert cancel.status_code == 200
    disputes = await _disputes(db_session_factory, booking["id"])
    assert len(disputes) == 1 and disputes[0].reason == "player_cancelled_paid_booking"
    assert float(disputes[0].refund_amount) == 5000.0


async def test_owner_rejecting_a_payment_creates_no_refund_and_no_ledger_entry(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    """Decision: a rejected proof was never credited (no ledger row), so there is nothing in the ledger to
    refund; the reject path is unchanged (the owner tells the player out of band). Documented, not changed."""
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 5000)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 23)
    booking, payment = await _hold_and_submit(client, s)
    rej = await client.post(
        f"/api/v1/payments/{payment['id']}/reject", headers=s.owner_headers, json={"reason": "no money received"}
    )
    assert rej.status_code == 200
    assert await _entries(db_session_factory, booking["id"]) == []
    assert await _disputes(db_session_factory, booking["id"]) == []


async def test_partial_refunds_keep_the_dispute_open_until_fully_refunded(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    _mock_ocr(monkeypatch, 5000)
    s = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, 24)
    booking, payment = await _hold_and_submit(client, s)
    await client.post(f"/api/v1/payments/{payment['id']}/approve", headers=s.owner_headers)
    await client.post(f"/api/v1/bookings/{booking['id']}/cancel", headers=s.owner_headers, json={"reason": "x"})
    row = next(r for r in (await client.get("/api/v1/owners/refunds", headers=s.owner_headers)).json()
               if r["booking_id"] == booking["id"])
    assert row["refund_amount"] == 5000.0 and row["remaining_amount"] == 5000.0
    url = f"/api/v1/owners/refunds/{row['id']}/mark-refunded"

    first = await client.post(url, headers=s.owner_headers, data={"reference": "part-1", "amount": "2000"})
    assert first.status_code == 200
    body = first.json()
    assert body["refund_status"] == "owed" and body["refunded_amount"] == 2000.0 and body["remaining_amount"] == 3000.0
    d = (await _disputes(db_session_factory, booking["id"]))[0]
    assert d.resolved is False and d.refund_status == "owed" and float(d.refunded_amount) == 2000.0

    # Still on the "to pay" list, now showing the remaining amount.
    row2 = next(r for r in (await client.get("/api/v1/owners/refunds", headers=s.owner_headers)).json()
                if r["booking_id"] == booking["id"])
    assert row2["remaining_amount"] == 3000.0 and row2["refunded_amount"] == 2000.0

    # Over-refunding the REMAINING amount is rejected (3001 > 3000), and changes nothing.
    over = await client.post(url, headers=s.owner_headers, data={"reference": "too much", "amount": "3001"})
    assert over.status_code == 400 and over.json()["error"]["code"] == "REFUND_EXCEEDS_OWED_AMOUNT"
    d = (await _disputes(db_session_factory, booking["id"]))[0]
    assert float(d.refunded_amount) == 2000.0 and d.resolved is False

    second = await client.post(url, headers=s.owner_headers, data={"reference": "part-2", "amount": "3000"})
    assert second.status_code == 200
    body = second.json()
    assert body["refund_status"] == "refunded" and body["refunded_amount"] == 5000.0 and body["remaining_amount"] == 0.0
    d = (await _disputes(db_session_factory, booking["id"]))[0]
    assert d.resolved is True and d.refund_status == "refunded"

    # Closed: a further mark is the clean "already marked" error.
    third = await client.post(url, headers=s.owner_headers, data={"reference": "again", "amount": "1"})
    assert third.status_code == 409

    # Ledger nets to zero with correct signs: +5000, -2000, -3000.
    entries = await _entries(db_session_factory, booking["id"])
    assert [e[0] for e in entries] == [5000, -2000, -3000]
    assert sum(e[0] for e in entries) == 0
    assert "partial" in entries[1][1] and "3,000 still owed" in entries[1][1]
    async with db_session_factory() as session:
        assert float((await session.get(Booking, booking["id"])).amount_paid) == 0.0
