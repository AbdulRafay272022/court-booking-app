"""Round 2 Stage 2: duplicate-screenshot confirm (spec B.a + findings 1) and the no-show fix (spec C). Real Postgres."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.config import get_settings
from app.jobs.digest_job import send_owner_daily_digests
from app.models.audit import AuditLog
from app.models.booking import BookingStatus
from app.models.notification import NotificationLog
from app.models.payment import Payment
from app.models.user import User, UserRole
from overview_helpers import add_booking, at, make_staff, past_day
from round2_helpers import future_day, held_and_submitted, mock_upload, open_venue


async def _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, prefix):
    owner, venue, court = await open_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, prefix + "01")
    return owner, venue, court, await make_auth_headers(owner)


# -- duplicate screenshot -------------------------------------------------------------------------------------------


async def test_duplicate_approve_needs_confirm_and_counts_bookings_across_players(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, venue, court, oh = await _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302400")
    p1 = await make_user("+923024000002", name="Abbas")
    p2 = await make_user("+923024000003", name="Mujtaba")
    h1, h2 = await make_auth_headers(p1), await make_auth_headers(p2)

    b1, pay1 = await held_and_submitted(client, court, h1, future_day(2), 8)
    first = await client.post(f"/api/v1/payments/{pay1}/approve", headers=oh)
    assert first.status_code == 200, first.text  # the original image is not a duplicate

    # the SAME image, uploaded by ANOTHER player
    b2, pay2 = await held_and_submitted(client, court, h2, future_day(2), 10)
    queue = (await client.get("/api/v1/owners/approvals-queue", headers=oh)).json()
    item = next(i for i in queue["items"] if i["payment_id"] == pay2)
    assert item["duplicate"] == {"used_on_bookings": 1}

    blocked = await client.post(f"/api/v1/payments/{pay2}/approve", headers=oh)
    assert blocked.status_code == 409
    err = blocked.json()["error"]
    assert err["code"] == "DUPLICATE_PROOF_CONFIRM_REQUIRED" and err["details"] == {"used_on_bookings": 1}
    async with db_session_factory() as s:
        assert (await s.get(Payment, pay2)).review_verdict is None  # nothing changed

    ok = await client.post(f"/api/v1/payments/{pay2}/approve", headers=oh, json={"confirm_duplicate": True})
    assert ok.status_code == 200 and ok.json()["booking"]["status"] == "booked"

    b3, pay3 = await held_and_submitted(client, court, h1, future_day(2), 12)
    again = await client.post(f"/api/v1/payments/{pay3}/approve", headers=oh, json={})
    assert again.status_code == 409 and again.json()["error"]["details"] == {"used_on_bookings": 2}
    # rejecting a duplicate needs no confirm
    rej = await client.post(f"/api/v1/payments/{pay3}/reject", headers=oh, json={"reason": "same screenshot"})
    assert rej.status_code == 200, rej.text


async def test_refund_row_warns_when_its_screenshot_was_credited_elsewhere(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, venue, court, oh = await _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302401")
    p = await make_user("+923024010002", name="Abbas")
    ph = await make_auth_headers(p)
    b1, pay1 = await held_and_submitted(client, court, ph, future_day(3), 8)
    assert (await client.post(f"/api/v1/payments/{pay1}/approve", headers=oh)).status_code == 200
    b2, pay2 = await held_and_submitted(client, court, ph, future_day(3), 10)
    assert (await client.post(f"/api/v1/payments/{pay2}/approve", headers=oh, json={"confirm_duplicate": True})).status_code == 200
    # the player cancels the second (duplicate-credited) booking: a refund is owed
    assert (await client.post(f"/api/v1/bookings/{b2}/cancel", headers=ph, json={})).status_code == 200
    refunds = (await client.get("/api/v1/owners/refunds", headers=oh)).json()
    row = next(r for r in refunds if r["booking_id"] == b2)
    assert row["duplicate_proof"] == {"used_on_bookings": 1}
    # the original booking's own refund (if it were cancelled) also points at the other credit
    assert (await client.post(f"/api/v1/bookings/{b1}/cancel", headers=ph, json={})).status_code == 200
    refunds = (await client.get("/api/v1/owners/refunds", headers=oh)).json()
    assert next(r for r in refunds if r["booking_id"] == b1)["duplicate_proof"] == {"used_on_bookings": 1}


async def test_non_duplicate_has_no_duplicate_field(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, venue, court, oh = await _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302402")
    ph = await make_auth_headers(await make_user("+923024020002"))
    _b, pay = await held_and_submitted(client, court, ph, future_day(2), 8)
    item = (await client.get("/api/v1/owners/approvals-queue", headers=oh)).json()["items"][0]
    assert item["payment_id"] == pay and item["duplicate"] is None


# -- no-show fix ----------------------------------------------------------------------------------------------------


async def _load(db_session_factory, model, id_):
    async with db_session_factory() as s:
        return await s.get(model, id_)


async def test_manual_no_show_only_after_the_slot_ended_and_audited(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court, oh = await _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302410")
    now = datetime.now(timezone.utc)
    running = await add_booking(db_session_factory, court, now - timedelta(minutes=90), hours=2)  # ends in 30 min
    ended = await add_booking(db_session_factory, court, now - timedelta(hours=3), hours=1)
    r = await client.post(f"/api/v1/bookings/{running.id}/no-show", headers=oh)
    assert r.status_code == 400 and r.json()["error"]["code"] == "TOO_EARLY_FOR_NO_SHOW"
    r = await client.post(f"/api/v1/bookings/{ended.id}/no-show", headers=oh)
    assert r.status_code == 200 and r.json()["booking"]["status"] == "no_show"
    async with db_session_factory() as s:
        log = await s.scalar(select(AuditLog).where(AuditLog.entity_id == ended.id, AuditLog.action == "booking.no_show"))
        assert log.actor_id == owner.id and log.actor_type == "owner" and log.new_value["marked_at"]
    # only from booked
    r = await client.post(f"/api/v1/bookings/{ended.id}/no-show", headers=oh)
    assert r.status_code == 400


async def test_no_show_permission_check_in_or_record_payments(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court, oh = await _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302411")

    async def load_user(uid):
        async with db_session_factory() as s:
            return await s.get(User, uid)

    _a, check_in = await make_staff(client, oh, venue, "+923024119901", ["check_in"], load_user, make_auth_headers)
    _b, payments = await make_staff(client, oh, venue, "+923024119902", ["record_payments"], load_user, make_auth_headers)
    _c, reader = await make_staff(client, oh, venue, "+923024119903", ["view_ledger"], load_user, make_auth_headers)
    now = datetime.now(timezone.utc)
    b1 = await add_booking(db_session_factory, court, now - timedelta(hours=5), hours=1)
    b2 = await add_booking(db_session_factory, court, now - timedelta(hours=3), hours=1)
    b3 = await add_booking(db_session_factory, court, now - timedelta(hours=7), hours=1)
    assert (await client.post(f"/api/v1/bookings/{b3.id}/no-show", headers=reader)).status_code == 403
    assert (await client.post(f"/api/v1/bookings/{b1.id}/no-show", headers=check_in)).status_code == 200
    assert (await client.post(f"/api/v1/bookings/{b2.id}/no-show", headers=payments)).status_code == 200


async def test_haan_nahi_sets_completed_from_booked_and_from_no_show(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court, oh = await _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302412")
    player = await make_user("+923024120002")
    async with db_session_factory() as s:
        p = await s.get(User, player.id)
        p.total_no_shows = 1
        await s.commit()
    booked = await add_booking(db_session_factory, court, at(past_day(), 11), price=1000, paid=500)
    old_no_show = await add_booking(db_session_factory, court, at(past_day(), 13), price=1000, paid=1000, status=BookingStatus.NO_SHOW, player=player)
    url = "/api/v1/owners/bookings/{}/completion"
    r = await client.post(url.format(booked.id), headers=oh, json={"result": "no", "received_now": 0, "reason": "baqi kal"})
    assert r.status_code == 200, r.text
    assert r.json()["status_pending"] is False and r.json()["status_key"] == "booked"
    r = await client.post(url.format(old_no_show.id), headers=oh, json={"result": "yes"})
    assert r.status_code == 200 and r.json()["status_key"] == "booked"
    assert (await _load(db_session_factory, type(booked), booked.id)).status == BookingStatus.COMPLETED
    assert (await _load(db_session_factory, type(booked), old_no_show.id)).status == BookingStatus.COMPLETED
    assert (await _load(db_session_factory, User, player.id)).total_no_shows == 0  # the wrong no-show is given back
    async with db_session_factory() as s:
        logs = (await s.execute(select(AuditLog).where(AuditLog.action == "booking.completed"))).scalars().all()
        assert {l.entity_id for l in logs} == {booked.id, old_no_show.id}
        assert all(l.actor_id == owner.id and l.new_value["marked_at"] for l in logs)
        assert {l.old_value["status"] for l in logs} == {"booked", "no_show"}


async def test_status_pending_in_overview_history_and_digest(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    owner, venue, court, oh = await _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302413")
    day = past_day(3)
    pending1 = await add_booking(db_session_factory, court, at(day, 9), price=1000)
    pending2 = await add_booking(db_session_factory, court, at(past_day(20), 9), price=1000)  # another date counts too
    done = await add_booking(db_session_factory, court, at(day, 11), price=1000, status=BookingStatus.COMPLETED)
    no_show = await add_booking(db_session_factory, court, at(day, 13), price=1000, status=BookingStatus.NO_SHOW)
    future = await add_booking(db_session_factory, court, at(future_day(3), 9), price=1000)
    cancelled = await add_booking(db_session_factory, court, at(day, 15), price=1000, status=BookingStatus.CANCELLED)

    ov = (await client.get("/api/v1/owners/overview", headers=oh, params={"date": day.isoformat()})).json()
    assert ov["status_pending_count"] == 2
    flags = {r["booking_id"]: r["status_pending"] for r in ov["rows"] if r["kind"] == "booked"}
    assert flags[str(pending1.id)] is True and flags[str(done.id)] is False and flags[str(no_show.id)] is False

    hist = (
        await client.get(
            "/api/v1/owners/bookings-history",
            headers=oh,
            params={"date_from": past_day(30).isoformat(), "date_to": future_day(5).isoformat(), "statuses": "status_pending"},
        )
    ).json()
    assert {i["booking_id"] for i in hist["items"]} == {str(pending1.id), str(pending2.id)}
    assert str(future.id) not in {i["booking_id"] for i in hist["items"]} and str(cancelled.id) not in str(hist)

    # marking one settles it everywhere
    assert (await client.post(f"/api/v1/owners/bookings/{pending1.id}/completion", headers=oh, json={"result": "yes"})).status_code == 200
    ov = (await client.get("/api/v1/owners/overview", headers=oh, params={"date": day.isoformat()})).json()
    assert ov["status_pending_count"] == 1

    # the daily digest carries the line + payload
    sent = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)
    await send_owner_daily_digests(session_factory=db_session_factory)
    async with db_session_factory() as s:
        row = await s.scalar(
            select(NotificationLog).where(NotificationLog.user_id == owner.id, NotificationLog.event_type == "owner_daily_digest")
        )
    assert row is not None
    assert row.payload["status_pending"] == 1
    assert any("1 bookings ka status baqi hai" in str(p) for p in sent)
    feed = (await client.get("/api/v1/users/me/notifications/feed", headers=oh)).json()
    item = next(i for i in feed["items"] if i["kind"] == "daily_summary")
    assert item["params"]["status_pending"] == 1
