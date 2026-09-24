"""Section 32 Part 10: manual (no payment gateway) refund tracking.

Reuses the existing `payment_disputes` table/queue (Section 23 finding #5, Section 24 finding #13)
rather than a parallel one -- these tests extend the coverage already in test_payments.py/test_jobs.py
for how those rows get created, focused on the new refund_amount/refund_status machinery.

Cutoff-policy decision locked in for this part (owner's call, 2026-09-24): `_enforce_cancellation_policy`
still hard-blocks a cancel outright once inside the cutoff or when the venue disallows it -- there is no
code path where a cancel "succeeds inside the cutoff" for a partial/non-refundable amount to apply to.
So refund_amount is always simply `booking.amount_paid` whenever a cancel is actually permitted to go
through, and the spec's "non-refundable advance" case is the already-reachable payment_review_expired
path, where nothing was ever approved as paid (refund_amount = 0) -- see
test_payment_review_expired_dispute_has_zero_refund_amount below.
"""
import io
from datetime import date, datetime, time, timedelta, timezone

from PIL import Image

from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.user import UserRole
from app.services.admin_service import AdminService


def _future_starts_at(days_ahead: int = 1) -> str:
    target = date.today() + timedelta(days=days_ahead)
    return f"{target.isoformat()}T10:00:00+00:00"


def _sample_png_bytes(color=(80, 160, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=color).save(buf, format="PNG")
    return buf.getvalue()


async def _hold_booking(client, court, headers, days_ahead: int = 1) -> dict:
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at(days_ahead)},
    )
    return resp.json()["booking"]


async def _open_all_week(make_schedule, court) -> None:
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))


def _mock_upload(monkeypatch):
    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)
    monkeypatch.setattr("app.api.owners.upload_private_proof", fake_upload)


async def _book_pay_approve_cancel(client, court, owner_headers, customer_headers, days_ahead: int = 1) -> dict:
    """A player pays only the ADVANCE (not the full price) and cancels outside any cutoff --
    this is the "partial refund" shape the spec asks for: refund_amount ends up equal to the
    advance actually paid, not the court's full price."""
    booking = await _hold_booking(client, court, customer_headers, days_ahead=days_ahead)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    payment_id = submit.json()["payment"]["id"]
    approve = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers)
    assert approve.json()["booking"]["status"] == "booked"

    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=customer_headers, json={"reason": "changed plans"}
    )
    assert cancel.status_code == 200
    assert cancel.json()["booking"]["status"] == "cancelled"
    return booking


async def test_voluntary_cancel_refund_amount_equals_amount_paid_partial(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    """Partial refund: the price is 2000 with a 20% advance rule (400), so the player only ever
    paid 400 -- the refund owed must be 400, not the full 2000 court price."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923006100001", role=UserRole.OWNER)
    customer = await make_user("+923006100002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000, advance_percentage=20)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_pay_approve_cancel(client, court, owner_headers, customer_headers)

    async with db_session_factory() as session:
        from sqlalchemy import select

        result = await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking["id"]))
        disputes = result.scalars().all()
        assert len(disputes) == 1
        assert disputes[0].reason == "player_cancelled_paid_booking"
        assert disputes[0].refund_status == "owed"
        assert float(disputes[0].refund_amount) == 400.0  # 20% of 2000 -- the advance, not the full price
        assert float(disputes[0].refund_amount) < 2000.0


async def test_payment_review_expired_dispute_has_zero_refund_amount(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    """The reinterpreted 'non-refundable advance' case: a payment_submitted booking that expires
    on the owner's inaction was never approved, so `booking.amount_paid` is still 0 even though the
    player may well have transferred real money -- nothing in this app ever recorded it as paid, so
    there is nothing to refund from the app's own point of view. refund_amount must be exactly 0,
    distinct from the voluntary-cancel case above."""
    from app.jobs.expiry_job import expire_stale_bookings

    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923006100003", role=UserRole.OWNER)
    customer = await make_user("+923006100004", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=3),
            price=1000,
            advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED,
            payment_deadline=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        session.add(booking)
        await session.flush()
        assert booking.amount_paid == 0  # never approved -- confirm_booking is the only writer of amount_paid
        payment = Payment(
            booking_id=booking.id, amount_claimed=1000, ocr_amount=1000, ocr_verdict="match", is_duplicate=False
        )
        session.add(payment)
        await session.commit()
        booking_id = booking.id

    expired_count = await expire_stale_bookings(session_factory=db_session_factory)
    assert expired_count == 1

    async with db_session_factory() as session:
        from sqlalchemy import select

        result = await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking_id))
        disputes = result.scalars().all()
        assert len(disputes) == 1
        assert disputes[0].reason == "payment_review_expired"
        assert float(disputes[0].refund_amount) == 0.0
        assert disputes[0].refund_status == "owed"


async def test_owner_refunds_screen_lists_and_marks_refund_paid(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    _mock_upload(monkeypatch)
    owner = await make_user("+923006100005", role=UserRole.OWNER)
    customer = await make_user("+923006100006", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000, advance_percentage=20)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_pay_approve_cancel(client, court, owner_headers, customer_headers)

    listing = await client.get("/api/v1/owners/refunds", headers=owner_headers)
    assert listing.status_code == 200
    rows = listing.json()
    row = next(r for r in rows if r["booking_id"] == booking["id"])
    assert row["refund_status"] == "owed"
    assert row["refund_amount"] == 400.0
    assert row["is_overdue"] is False

    marked = await client.post(
        f"/api/v1/owners/refunds/{row['id']}/mark-refunded",
        headers=owner_headers,
        data={"reference": "JazzCash TXN 998877"},
    )
    assert marked.status_code == 200
    body = marked.json()
    assert body["refund_status"] == "refunded"
    assert body["refunded_amount"] == 400.0
    assert body["refund_reference"] == "JazzCash TXN 998877"

    # No longer on the open "Refunds to pay" list
    listing_after = await client.get("/api/v1/owners/refunds", headers=owner_headers)
    assert all(r["booking_id"] != booking["id"] for r in listing_after.json())

    # Ledger shows the refund as a real negative entry linked to the booking
    today = date.today()
    ledger = await client.get(
        "/api/v1/owners/ledger",
        headers=owner_headers,
        params={"start_date": (today - timedelta(days=1)).isoformat(), "end_date": (today + timedelta(days=3)).isoformat()},
    )
    assert ledger.status_code == 200
    ledger_row = next(r for r in ledger.json()["bookings"] if r["booking_id"] == booking["id"])
    assert ledger_row["refund_amount"] == -400.0


async def test_mark_refund_exceeding_owed_amount_is_rejected(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    """'refund larger than the amount paid rejected' -- the spec's own required test."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923006100007", role=UserRole.OWNER)
    customer = await make_user("+923006100008", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000, advance_percentage=20)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_pay_approve_cancel(client, court, owner_headers, customer_headers)
    listing = await client.get("/api/v1/owners/refunds", headers=owner_headers)
    row = next(r for r in listing.json() if r["booking_id"] == booking["id"])
    assert row["refund_amount"] == 400.0

    resp = await client.post(
        f"/api/v1/owners/refunds/{row['id']}/mark-refunded",
        headers=owner_headers,
        data={"reference": "trying to overpay", "amount": "500"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "REFUND_EXCEEDS_OWED_AMOUNT"

    # Still owed, untouched, after the rejected attempt
    async with db_session_factory() as session:
        from sqlalchemy import select

        dispute = (
            await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking["id"]))
        ).scalar_one()
        assert dispute.refund_status == "owed"
        assert dispute.refunded_amount is None


async def test_mark_refund_paid_partial_amount_allowed(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    """An owner can legitimately refund LESS than what's technically owed (negotiated in person) --
    only refunding MORE than was paid is a hard rejection."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923006100009", role=UserRole.OWNER)
    customer = await make_user("+923006100010", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000, advance_percentage=20)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_pay_approve_cancel(client, court, owner_headers, customer_headers)
    listing = await client.get("/api/v1/owners/refunds", headers=owner_headers)
    row = next(r for r in listing.json() if r["booking_id"] == booking["id"])

    resp = await client.post(
        f"/api/v1/owners/refunds/{row['id']}/mark-refunded",
        headers=owner_headers,
        data={"reference": "partial cash refund at the counter", "amount": "150"},
    )
    assert resp.status_code == 200
    assert resp.json()["refunded_amount"] == 150.0
    assert resp.json()["refund_amount"] == 400.0  # what was owed is unchanged, only what was paid differs


async def test_double_click_on_refunded_is_idempotent(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    """Two mark-refunded calls on the same dispute (a double-tap, or two staff devices) must never
    both take effect -- the second gets a clean REFUND_ALREADY_MARKED, not silent double-processing."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923006100011", role=UserRole.OWNER)
    customer = await make_user("+923006100012", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000, advance_percentage=20)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_pay_approve_cancel(client, court, owner_headers, customer_headers)
    listing = await client.get("/api/v1/owners/refunds", headers=owner_headers)
    row = next(r for r in listing.json() if r["booking_id"] == booking["id"])

    first = await client.post(
        f"/api/v1/owners/refunds/{row['id']}/mark-refunded",
        headers=owner_headers,
        data={"reference": "first tap"},
    )
    assert first.status_code == 200

    second = await client.post(
        f"/api/v1/owners/refunds/{row['id']}/mark-refunded",
        headers=owner_headers,
        data={"reference": "second tap (double-click)"},
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "REFUND_ALREADY_MARKED"

    async with db_session_factory() as session:
        from sqlalchemy import select

        dispute = (
            await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking["id"]))
        ).scalar_one()
        assert dispute.refund_reference == "first tap"  # the second call never overwrote it


async def test_refund_overdue_after_configured_days(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    """Section 32 Part 10's admin-facing overdue flag: a refund still 'owed' more than
    REFUND_OVERDUE_DAYS after it was flagged needs an admin's attention."""
    owner = await make_user("+923006100013", role=UserRole.OWNER)
    customer = await make_user("+923006100014", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    settings = get_settings()

    async with db_session_factory() as session:
        old_booking = Booking(
            court_id=court.id, player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(days=10),
            ends_at=datetime.now(timezone.utc) - timedelta(days=10, hours=-1),
            price=1000, advance_amount=1000, amount_paid=1000, status=BookingStatus.CANCELLED,
        )
        recent_booking = Booking(
            court_id=court.id, player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(days=1),
            ends_at=datetime.now(timezone.utc) + timedelta(days=1, hours=1),
            price=1000, advance_amount=1000, amount_paid=1000, status=BookingStatus.CANCELLED,
        )
        session.add_all([old_booking, recent_booking])
        await session.flush()
        old_payment = Payment(booking_id=old_booking.id, amount_claimed=1000, review_verdict="approved")
        recent_payment = Payment(booking_id=recent_booking.id, amount_claimed=1000, review_verdict="approved")
        session.add_all([old_payment, recent_payment])
        await session.flush()
        old_dispute = PaymentDispute(
            booking_id=old_booking.id, payment_id=old_payment.id, player_id=customer.id,
            reason="player_cancelled_paid_booking", refund_amount=1000,
        )
        recent_dispute = PaymentDispute(
            booking_id=recent_booking.id, payment_id=recent_payment.id, player_id=customer.id,
            reason="player_cancelled_paid_booking", refund_amount=1000,
        )
        session.add_all([old_dispute, recent_dispute])
        await session.commit()
        # Backdate created_at past the overdue window (TimestampMixin sets it on insert)
        from sqlalchemy import update

        await session.execute(
            update(PaymentDispute)
            .where(PaymentDispute.id == old_dispute.id)
            .values(created_at=datetime.now(timezone.utc) - timedelta(days=settings.REFUND_OVERDUE_DAYS + 1))
        )
        await session.commit()

    async with db_session_factory() as session:
        queue = await AdminService(session, settings).list_refund_queue()
        by_id = {entry.id: entry for entry in queue}
        assert by_id[old_dispute.id].is_overdue is True
        assert by_id[recent_dispute.id].is_overdue is False
