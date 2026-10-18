"""Owner Round 2: approvals queue (A1), player cancels while a payment awaits approval (A5), overpayment at approval
(A10.3) and the refund breakdown (A10). Real Postgres."""
import uuid

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.booking import Booking, BookingSource, BookingStatus, CancelledBy
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.payment_entry import PaymentEntry
from app.models.user import User
from overview_helpers import add_booking, add_dispute, at, make_staff
from round2_helpers import future_day, held_and_submitted, log_rows, mock_upload, open_venue

QUEUE = "/api/v1/owners/approvals-queue"
BADGES = "/api/v1/owners/badges"
REFUNDS = "/api/v1/owners/refunds"


@pytest.fixture
def world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    async def _world(phone_prefix: str, **court_kwargs):
        mock_upload(monkeypatch)
        owner, venue, court = await open_venue(
            make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone_prefix + "01", **court_kwargs
        )
        player = await make_user(phone_prefix + "02", name="Abbas Zafar")
        return owner, venue, court, player, await make_auth_headers(owner), await make_auth_headers(player)

    return _world


async def _payment(sf, payment_id) -> Payment:
    async with sf() as session:
        return await session.get(Payment, uuid.UUID(str(payment_id)))


async def _cancel(client, booking_id, headers):
    resp = await client.post(f"/api/v1/bookings/{booking_id}/cancel", headers=headers, json={"reason": "changed plans"})
    assert resp.status_code == 200, resp.text


async def test_queue_lists_every_pending_payment_newest_first_with_state(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301100")
    day = future_day(3)
    b1, p1 = await held_and_submitted(client, court, ph, day, 10)
    b2, p2 = await held_and_submitted(client, court, ph, day, 12)
    b3, p3 = await held_and_submitted(client, court, ph, future_day(4), 12)

    page = (await client.get(QUEUE, headers=oh)).json()
    assert page["total"] == 3 and page["page"] == 1 and page["page_size"] == 50
    assert [i["payment_id"] for i in page["items"]] == [p3, p2, p1]  # newest submission first
    item = page["items"][0]
    assert item["state"] == "awaiting" and item["has_screenshot"] is True and item["cancelled_at"] is None
    assert item["overpayment"] is None and item["starts_at"] and item["court_sport"] == "futsal"

    # pagination + date filter (same operating-day rule as /owners/pending-approvals)
    small = (await client.get(QUEUE, params={"page_size": 2, "page": 2}, headers=oh)).json()
    assert small["total"] == 3 and [i["payment_id"] for i in small["items"]] == [p1]
    on_day = (await client.get(QUEUE, params={"date": day.isoformat()}, headers=oh)).json()
    assert on_day["total"] == 2
    assert (await client.get(QUEUE, params={"page_size": 101}, headers=oh)).status_code == 422
    assert (await client.get(BADGES, headers=oh)).json()["approvals"] == 3


async def test_cancel_after_screenshot_turns_card_grey_and_tells_owner(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301101")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    await _cancel(client, booking_id, ph)

    page = (await client.get(QUEUE, headers=oh)).json()
    assert page["total"] == 1
    item = page["items"][0]
    assert item["state"] == "cancelled_by_player" and item["cancelled_at"] is not None and item["has_screenshot"] is True
    assert (await client.get(BADGES, headers=oh)).json()["approvals"] == 1
    # the owner gets a bell row (in_app: no device token) with the booking as reference
    rows = await log_rows(db_session_factory, owner.id, "owner_player_cancelled")
    assert len(rows) == 1 and str(rows[0].reference_id) == booking_id and rows[0].channel == "in_app"


async def test_approve_after_cancel_is_a_clear_409_and_changes_nothing(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301102")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    await _cancel(client, booking_id, ph)
    before = len(await log_rows(db_session_factory, player.id))

    resp = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=oh)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "BOOKING_NO_LONGER_PENDING"
    assert resp.json()["error"]["details"] == {"state": "cancelled_by_player"}
    assert (await _payment(db_session_factory, payment_id)).review_verdict is None
    assert len(await log_rows(db_session_factory, player.id)) == before  # player not messaged


async def test_reject_after_cancel_needs_no_reason_and_never_messages_the_player(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301103")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    await _cancel(client, booking_id, ph)
    before = len(await log_rows(db_session_factory, player.id))

    for body in ({}, {"reason": "Screenshot unreadable"}):
        resp = await client.post(f"/api/v1/payments/{payment_id}/reject", headers=oh, json=body)
        assert resp.status_code == 409, resp.text
        assert resp.json()["error"]["code"] == "BOOKING_NO_LONGER_PENDING"
        assert resp.json()["error"]["details"]["state"] == "cancelled_by_player"
    assert (await _payment(db_session_factory, payment_id)).review_verdict is None
    assert await log_rows(db_session_factory, player.id, "payment_rejected") == []
    assert len(await log_rows(db_session_factory, player.id)) == before
    async with db_session_factory() as session:
        assert (await session.execute(select(PaymentDispute))).scalars().all() == []  # no 0-amount row either


async def test_reject_on_an_awaiting_payment_still_requires_a_reason(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301104")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    resp = await client.post(f"/api/v1/payments/{payment_id}/reject", headers=oh, json={})
    assert resp.status_code == 422
    ok = await client.post(f"/api/v1/payments/{payment_id}/reject", headers=oh, json={"reason": "wrong account"})
    assert ok.status_code == 200
    rows = await log_rows(db_session_factory, player.id, "payment_rejected")
    assert rows and all(str(r.reference_id) == booking_id for r in rows)


async def test_acknowledge_without_money_clears_card_and_badge(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301105")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    await _cancel(client, booking_id, ph)
    before = len(await log_rows(db_session_factory, player.id))

    resp = await client.post(f"/api/v1/owners/payments/{payment_id}/acknowledge", headers=oh, json={"money_received": False})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "refund_dispute_id": None}
    payment = await _payment(db_session_factory, payment_id)
    assert payment.review_verdict == "acknowledged" and payment.reviewed_by == owner.id and payment.reviewed_at
    assert (await client.get(QUEUE, headers=oh)).json()["total"] == 0
    assert (await client.get(BADGES, headers=oh)).json()["approvals"] == 0
    async with db_session_factory() as session:
        log = (
            await session.execute(select(AuditLog).where(AuditLog.action == "payment.cancelled_acknowledged"))
        ).scalar_one()
    assert log.actor_id == owner.id and log.new_value["money_received"] is False
    assert len(await log_rows(db_session_factory, player.id)) == before
    again = await client.post(f"/api/v1/owners/payments/{payment_id}/acknowledge", headers=oh, json={"money_received": False})
    assert again.status_code == 409 and again.json()["error"]["code"] == "PAYMENT_ALREADY_REVIEWED"


async def test_acknowledge_with_money_queues_a_refund_for_the_screenshot_amount(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301106")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    async with db_session_factory() as session:  # OCR read 10,000 on the screenshot
        p = await session.get(Payment, uuid.UUID(payment_id))
        p.ocr_amount = 10000
        await session.commit()
    await _cancel(client, booking_id, ph)
    before = len(await log_rows(db_session_factory, player.id))

    resp = await client.post(f"/api/v1/owners/payments/{payment_id}/acknowledge", headers=oh, json={"money_received": True})
    assert resp.status_code == 200, resp.text
    dispute_id = resp.json()["refund_dispute_id"]
    assert dispute_id
    refunds = (await client.get(REFUNDS, headers=oh)).json()
    assert len(refunds) == 1
    r = refunds[0]
    assert r["id"] == dispute_id and r["reason"] == "cancelled_payment_received"
    assert r["refund_due"] == 10000 and r["remaining_amount"] == 10000 and r["already_refunded"] == 0
    assert r["player_sent"] == 10000 and r["reason_label_key"] == "rfd.reason.cancelled_payment_received"
    assert (await client.get(BADGES, headers=oh)).json() == {"approvals": 0, "refunds": 1}
    assert len(await log_rows(db_session_factory, player.id)) == before  # acknowledge never messages the player

    # paying it out never writes a negative ledger entry: that money was never credited
    paid = await client.post(f"/api/v1/owners/refunds/{dispute_id}/mark-refunded", headers=oh, data={"reference": "JC-1", "amount": "10000"})
    assert paid.status_code == 200, paid.text
    async with db_session_factory() as session:
        entries = (await session.execute(select(PaymentEntry).where(PaymentEntry.booking_id == uuid.UUID(booking_id)))).scalars().all()
        assert entries == []
        assert float((await session.get(Booking, uuid.UUID(booking_id))).amount_paid) == 0


async def test_acknowledge_on_an_awaiting_payment_is_refused(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301107")
    _booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    resp = await client.post(f"/api/v1/owners/payments/{payment_id}/acknowledge", headers=oh, json={"money_received": False})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "PAYMENT_STILL_PENDING"


async def test_expired_review_shows_as_expired_state(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301108")
    b = await add_booking(
        db_session_factory, court, at(future_day(5), 18), status=BookingStatus.CANCELLED, player=player,
        cancelled_by=CancelledBy.SYSTEM, reason="payment_review_expired", unreviewed_payment=True,
    )
    item = (await client.get(QUEUE, headers=oh)).json()["items"][0]
    assert item["booking_id"] == str(b.id) and item["state"] == "expired" and item["has_screenshot"] is False
    b2 = await add_booking(
        db_session_factory, court, at(future_day(6), 18), status=BookingStatus.CANCELLED, player=player,
        cancelled_by=CancelledBy.OWNER, reason="x", unreviewed_payment=True,
    )
    states = {i["booking_id"]: i["state"] for i in (await client.get(QUEUE, headers=oh)).json()["items"]}
    assert states[str(b2.id)] == "cancelled_by_owner"


async def test_acknowledge_permission_matches_approve(world, client, db_session_factory, make_auth_headers):
    owner, venue, court, player, oh, ph = await world("+92301109")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    await _cancel(client, booking_id, ph)

    async def load_user(uid):
        async with db_session_factory() as session:
            return await session.get(User, uid)

    _s1, viewer = await make_staff(client, oh, venue, "+923011090101", ["view_ledger"], load_user, make_auth_headers)
    _s2, approver = await make_staff(client, oh, venue, "+923011090102", ["approve_payments", "view_ledger"], load_user, make_auth_headers)
    url = f"/api/v1/owners/payments/{payment_id}/acknowledge"
    assert (await client.post(url, headers=viewer, json={"money_received": False})).status_code == 403
    # a staff member can SEE the queue with view_ledger
    assert (await client.get(QUEUE, headers=viewer)).json()["total"] == 1
    assert (await client.post(url, headers=approver, json={"money_received": False})).status_code == 200


async def _overpaid(db_session_factory, court, player, ocr=10000):
    b = await add_booking(
        db_session_factory, court, at(future_day(4), 19), status=BookingStatus.PAYMENT_SUBMITTED, player=player,
        price=4000, advance=2000, source=BookingSource.APP,
    )
    async with db_session_factory() as session:
        p = Payment(booking_id=b.id, proof_key="payment-proofs/x.jpg", amount_claimed=2000, ocr_amount=ocr, ocr_verdict="mismatch")
        session.add(p)
        await session.commit()
        return b, p.id


async def test_queue_flags_overpayment(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301110")
    _b, pid = await _overpaid(db_session_factory, court, player)
    item = (await client.get(QUEUE, headers=oh)).json()["items"][0]
    assert item["overpayment"] == {"expected": 2000, "ocr_amount": 10000, "excess": 8000}


async def test_approve_advance_only_credits_the_advance_and_queues_the_rest(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301111")
    b, pid = await _overpaid(db_session_factory, court, player)
    resp = await client.post(f"/api/v1/payments/{pid}/approve", headers=oh, json={"accept_mode": "advance_only"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["booking"]["amount_paid"] == 2000 and resp.json()["booking"]["status"] == "booked"
    refunds = (await client.get(REFUNDS, headers=oh)).json()
    assert [(r["reason"], r["refund_due"], r["player_sent"]) for r in refunds] == [("overpayment_excess", 8000, 10000)]


async def test_approve_full_keeps_todays_behaviour(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301112")
    b, pid = await _overpaid(db_session_factory, court, player)
    resp = await client.post(f"/api/v1/payments/{pid}/approve", headers=oh, json={"accept_mode": "full"})
    assert resp.status_code == 200, resp.text
    # everything up to the price (4,000) is credited, only money above the price becomes a refund
    assert resp.json()["booking"]["amount_paid"] == 4000
    refunds = (await client.get(REFUNDS, headers=oh)).json()
    assert [(r["reason"], r["refund_due"]) for r in refunds] == [("overpayment_excess", 6000)]
    assert (await client.post(f"/api/v1/payments/{pid}/approve", headers=oh, json={"accept_mode": "bogus"})).status_code == 422


async def test_approve_without_mode_is_unchanged(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301113")
    b, pid = await _overpaid(db_session_factory, court, player, ocr=3000)
    resp = await client.post(f"/api/v1/payments/{pid}/approve", headers=oh)
    assert resp.status_code == 200 and resp.json()["booking"]["amount_paid"] == 3000
    assert (await client.get(REFUNDS, headers=oh)).json() == []
    rows = await log_rows(db_session_factory, player.id, "booking_confirmed")
    assert rows and all(r.reference_id == b.id for r in rows)


async def test_zero_amount_disputes_never_show_on_refunds_or_badge(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301114")
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    rejected = await client.post(f"/api/v1/payments/{payment_id}/reject", headers=oh, json={"reason": "Screenshot unreadable"})
    assert rejected.status_code == 200
    async with db_session_factory() as session:  # the audit-trail row is still written ...
        rows = (await session.execute(select(PaymentDispute))).scalars().all()
        assert [(r.reason, float(r.refund_amount), r.refund_status) for r in rows] == [("payment_rejected", 0.0, "owed")]
    # ... but it is not a refund to pay
    assert (await client.get(REFUNDS, headers=oh)).json() == []
    assert (await client.get(BADGES, headers=oh)).json()["refunds"] == 0


async def test_partial_refunds_and_the_exceeds_error_details(world, client, db_session_factory):
    owner, venue, court, player, oh, ph = await world("+92301115")
    b = await add_booking(
        db_session_factory, court, at(future_day(5), 18), status=BookingStatus.CANCELLED, player=player,
        cancelled_by=CancelledBy.PLAYER, price=4500, paid=2000,
    )
    await add_dispute(db_session_factory, b, 2000)
    rid = (await client.get(REFUNDS, headers=oh)).json()[0]["id"]
    url = f"/api/v1/owners/refunds/{rid}/mark-refunded"

    too_much = await client.post(url, headers=oh, data={"reference": "JC-9", "amount": "10000"})
    assert too_much.status_code == 400
    err = too_much.json()["error"]
    assert err["code"] == "REFUND_EXCEEDS_OWED_AMOUNT"
    assert err["details"]["remaining"] == 2000 and err["details"]["typed"] == 10000

    part = await client.post(url, headers=oh, data={"reference": "JC-10", "amount": "500"})
    assert part.status_code == 200, part.text
    body = part.json()
    assert body["refund_status"] == "owed" and body["already_refunded"] == 500 and body["remaining_amount"] == 1500
    assert body["refund_due"] == 2000 and body["player_sent"] == 2000
    listed = (await client.get(REFUNDS, headers=oh)).json()[0]
    assert listed["already_refunded"] == 500 and listed["remaining_amount"] == 1500 and listed["player_sent"] == 2000
    over = await client.post(url, headers=oh, data={"reference": "JC-11", "amount": "1600"})
    assert over.json()["error"]["details"] == {"owed": 1500, "attempted": 1600, "remaining": 1500, "typed": 1600}
    rest = await client.post(url, headers=oh, data={"reference": "JC-12"})
    assert rest.status_code == 200 and rest.json()["refund_status"] == "refunded" and rest.json()["remaining_amount"] == 0
    rows = await log_rows(db_session_factory, player.id, "refund_paid")
    assert rows and all(r.reference_id == b.id for r in rows)
