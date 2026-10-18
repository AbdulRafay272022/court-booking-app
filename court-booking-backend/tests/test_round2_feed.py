"""Owner Round 2 (A6): the readable notification feed, reference_id on every booking/venue notification, and the
truthful SMS log. Real Postgres."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select

from app.config import get_settings
from app.models.booking import BookingSource, BookingStatus
from app.models.fcm_token import FCMToken
from app.models.notification import NotificationLog
from app.models.user import User, UserRole
from app.models.waitlist import WaitlistEntry
from app.services.notification_feed import EVENT_KINDS
from app.services.notification_service import NotificationService
from app.services.waitlist_service import WaitlistService
from overview_helpers import add_booking, at
from round2_helpers import future_day, held_and_submitted, log_rows, mock_upload, open_venue

FEED = "/api/v1/users/me/notifications/feed"


@pytest.fixture
def venue_world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    async def _w(prefix):
        owner, venue, court = await open_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, prefix + "01")
        return owner, venue, court, await make_auth_headers(owner)

    return _w


async def _log(sf, user, event_type, channel, created_at, reference_id=None, status="sent"):
    async with sf() as session:
        row = NotificationLog(
            user_id=user.id, channel=channel, event_type=event_type, reference_id=reference_id, status=status,
        )
        session.add(row)
        await session.flush()
        row.created_at = created_at
        await session.commit()
        return row.id


async def test_escalation_folds_into_one_item_with_every_delivery(venue_world, client, db_session_factory):
    owner, venue, court, oh = await venue_world("+92301400")
    b = await add_booking(
        db_session_factory, court, at(future_day(2), 21), status=BookingStatus.PAYMENT_SUBMITTED, price=4000, advance=2000,
        name="Abbas Zafar", phone="+923001234567", source=BookingSource.APP,
    )
    t0 = datetime.now(timezone.utc) - timedelta(minutes=30)
    first = await _log(db_session_factory, owner, "payment_submitted", "push", t0, b.id)
    await _log(db_session_factory, owner, "payment_submitted_whatsapp", "whatsapp", t0 + timedelta(minutes=5), b.id, "failed")
    await _log(db_session_factory, owner, "payment_submitted_sms", "sms", t0 + timedelta(minutes=16), b.id, "skipped")
    await _log(db_session_factory, owner, "owner_daily_digest", "whatsapp", t0 - timedelta(hours=5))

    body = (await client.get(FEED, headers=oh)).json()
    assert body["page"] == 1 and body["has_more"] is False
    assert [i["kind"] for i in body["items"]] == ["payment_waiting", "daily_summary"]
    item = body["items"][0]
    assert item["id"] == str(first) and item["event_type"] == "payment_submitted"
    assert item["deliveries"] == [
        {"channel": "push", "status": "sent"},
        {"channel": "whatsapp", "status": "failed"},
        {"channel": "sms", "status": "failed"},  # a skipped SMS never reads as delivered
    ]
    assert item["link"] == {"kind": "approvals", "booking_id": str(b.id)}
    p = item["params"]
    assert p["player_name"] == "Abbas Zafar" and p["court_name"] == "Futsal 1" and p["sport"] == "futsal"
    assert p["venue_name"] == "R2 Arena" and p["amount"] == 2000 and p["starts_at"] and p["ends_at"]
    assert "1234567" not in str(body)  # never a phone number
    assert body["items"][1]["link"] == {"kind": "overview"} and body["items"][1]["params"] == {}


async def test_same_event_far_apart_stays_two_items_and_unknown_is_other(venue_world, client, db_session_factory):
    owner, venue, court, oh = await venue_world("+92301401")
    b = await add_booking(db_session_factory, court, at(future_day(2), 21))
    t0 = datetime.now(timezone.utc) - timedelta(hours=2)
    await _log(db_session_factory, owner, "owner_new_booking", "whatsapp", t0, b.id)
    await _log(db_session_factory, owner, "owner_new_booking", "push", t0 + timedelta(minutes=3), b.id)
    await _log(db_session_factory, owner, "owner_new_booking", "whatsapp", t0 + timedelta(minutes=40), b.id)
    await _log(db_session_factory, owner, "something_new_later", "push", t0 + timedelta(minutes=50))
    items = (await client.get(FEED, headers=oh)).json()["items"]
    assert [i["kind"] for i in items] == ["other", "new_booking", "new_booking"]
    assert items[2]["deliveries"] == [{"channel": "push", "status": "sent"}, {"channel": "whatsapp", "status": "sent"}]
    assert items[0]["link"] == {"kind": "none"}


async def test_feed_paginates_groups_and_resolves_in_bulk(venue_world, client, db_session_factory, test_engine):
    owner, venue, court, oh = await venue_world("+92301402")
    t0 = datetime.now(timezone.utc) - timedelta(days=1)
    bookings = []
    for i in range(12):
        b = await add_booking(db_session_factory, court, at(future_day(2 + i), 12), status=BookingStatus.PAYMENT_SUBMITTED, name=f"P{i}")
        bookings.append(b)
        await _log(db_session_factory, owner, "payment_submitted", "push", t0 + timedelta(minutes=30 * i), b.id)
        await _log(db_session_factory, owner, "refund_owed", "whatsapp", t0 + timedelta(minutes=30 * i + 1), b.id)
        await _log(db_session_factory, owner, "venue_approved", "whatsapp", t0 + timedelta(minutes=30 * i + 2), venue.id)

    statements: list[str] = []

    def count(conn, cursor, statement, *a):
        statements.append(statement)

    async def queries_for(params):
        statements.clear()
        event.listen(test_engine.sync_engine, "before_cursor_execute", count)
        try:
            resp = await client.get(FEED, params=params, headers=oh)
        finally:
            event.remove(test_engine.sync_engine, "before_cursor_execute", count)
        assert resp.status_code == 200, resp.text
        feed = [s for s in statements if "notification_log" in s or "bookings" in s or "venues" in s or "payments" in s or "payment_disputes" in s]
        return resp.json(), len(feed)

    small, n_small = await queries_for({"page_size": 3})
    big, n_big = await queries_for({"page_size": 30})
    assert len(small["items"]) == 3 and small["has_more"] is True
    assert len(big["items"]) == 30 and big["has_more"] is True
    assert n_small == n_big  # a fixed number of queries per page, whatever its size
    assert n_big <= 10
    last, _ = await queries_for({"page_size": 30, "page": 2})
    assert len(last["items"]) == 6 and last["has_more"] is False
    venue_item = next(i for i in big["items"] if i["kind"] == "venue_approved")
    assert venue_item["params"] == {"venue_name": "R2 Arena"} and venue_item["link"] == {"kind": "venue_status"}


def test_every_emitted_event_type_has_a_kind():
    import pathlib
    import re

    app_dir = pathlib.Path(__file__).resolve().parents[1] / "app"
    emitted: set[str] = set()
    for path in app_dir.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        emitted |= set(re.findall(r'event_type="([a-z_]+)"', text))
        emitted |= set(re.findall(r'_send_push(?:_and_whatsapp|_tier)\(\s*\w+,\s*"([a-z_]+)"', text))
    from app.services.owner_billing_service import REMINDER_EVENTS

    emitted |= {ev for ev, _title in REMINDER_EVENTS.values()}
    emitted |= {"premium_payment_approved", "premium_payment_rejected"}
    missing = sorted(e for e in emitted if e not in EVENT_KINDS)
    assert missing == [], missing


async def test_sms_escalation_logs_skipped_truthfully(venue_world, db_session_factory):
    owner, venue, court, oh = await venue_world("+92301403")
    b = await add_booking(db_session_factory, court, at(future_day(2), 21), status=BookingStatus.PAYMENT_SUBMITTED)
    async with db_session_factory() as session:
        o = await session.get(User, owner.id)
        fired = await NotificationService(session, get_settings()).escalate_payment_submitted(
            owner=o, court_name="Futsal 1", amount=2000, booking_id=b.id, minutes_elapsed=20
        )
    assert "sms" not in fired  # no SMS provider configured: nothing was sent
    rows = await log_rows(db_session_factory, owner.id, "payment_submitted_sms")
    assert len(rows) == 1 and rows[0].status == "skipped" and rows[0].error_message


async def test_sms_escalation_failure_is_logged_failed(venue_world, db_session_factory, monkeypatch):
    owner, venue, court, oh = await venue_world("+92301404")
    b = await add_booking(db_session_factory, court, at(future_day(2), 21), status=BookingStatus.PAYMENT_SUBMITTED)

    async def boom(self, to, body):
        raise RuntimeError("provider down")

    monkeypatch.setattr("app.services.sms_service.SMSService.send_text", boom)
    async with db_session_factory() as session:
        o = await session.get(User, owner.id)
        await NotificationService(session, get_settings()).escalate_payment_submitted(
            owner=o, court_name="Futsal 1", amount=2000, booking_id=b.id, minutes_elapsed=20
        )
    rows = await log_rows(db_session_factory, owner.id, "payment_submitted_sms")
    assert len(rows) == 1 and rows[0].status == "failed" and "provider down" in rows[0].error_message


async def test_reference_ids_on_booking_venue_court_and_waitlist_notifications(
    venue_world, client, db_session_factory, make_user, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, venue, court, oh = await venue_world("+92301405")
    player = await make_user("+923014050002", name="Ref Player")
    ph = await make_auth_headers(player)

    # owner_new_booking (hold) + booking_confirmed (approve)
    booking_id, payment_id = await held_and_submitted(client, court, ph, future_day(3))
    assert all(str(r.reference_id) == booking_id for r in await log_rows(db_session_factory, owner.id, "owner_new_booking"))
    assert (await client.post(f"/api/v1/payments/{payment_id}/approve", headers=oh)).status_code == 200
    confirmed = await log_rows(db_session_factory, player.id, "booking_confirmed")
    assert confirmed and all(str(r.reference_id) == booking_id for r in confirmed)

    # court_deactivated: the live booking is the reference
    assert (await client.delete(f"/api/v1/courts/{court.id}", headers=oh)).status_code == 204
    deact = await log_rows(db_session_factory, player.id, "court_deactivated")
    assert deact and all(str(r.reference_id) == booking_id for r in deact)

    # venue_* events: the venue is the reference
    admin = await make_user("+923014050003", role=UserRole.ADMIN)
    ah = await make_auth_headers(admin)
    for path, ev, body in (
        ("request-changes", "venue_changes_requested", {"reason": "photos"}),
        ("reject", "venue_rejected", {"reason": "duplicate"}),
        ("approve", "venue_approved", None),
    ):
        resp = await client.post(f"/api/v1/admin/venues/{venue.id}/{path}", headers=ah, json=body)
        assert resp.status_code == 200, resp.text
        rows = await log_rows(db_session_factory, owner.id, ev)
        assert rows and all(r.reference_id == venue.id for r in rows), ev

    # slot_reopened (waitlist): the waitlist entry is the reference
    waiter = await make_user("+923014050004", name="Waiter")
    starts = at(future_day(6), 19)
    async with db_session_factory() as session:
        entry = WaitlistEntry(court_id=court.id, player_id=waiter.id, slot_starts_at=starts)
        session.add(entry)
        session.add(FCMToken(user_id=waiter.id, token="tok-waiter", platform="android"))
        await session.commit()
        entry_id = entry.id
    async with db_session_factory() as session:
        from app.models.court import Court

        c = await session.get(Court, court.id)
        await WaitlistService(session, get_settings()).notify_matching_entries(c, starts, starts + timedelta(minutes=60))
    rows = await log_rows(db_session_factory, waiter.id, "slot_reopened")
    assert rows and all(r.reference_id == entry_id for r in rows)
    feed = (await client.get(FEED, headers=await make_auth_headers(waiter))).json()["items"]
    assert feed[0]["kind"] == "slot_freed" and feed[0]["params"]["court_name"] == "Futsal 1" and feed[0]["params"]["starts_at"]
