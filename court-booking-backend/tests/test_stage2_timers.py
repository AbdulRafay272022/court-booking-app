"""Round 2 Stage 2: per-venue hold / reminder / auto-cancel timers (docs/stage2-contract.md sections 1-3). Real Postgres."""
import json
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.jobs.expiry_job import expire_stale_bookings, remind_pending_payment_reviews
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.notification import NotificationLog
from app.models.payment import Payment
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.services.venue_timers import DEFAULTS, effective_timers
from app.utils.timezone import pkt_now
from overview_helpers import make_staff
from round2_helpers import future_day, held_and_submitted, hold, mock_upload, open_venue

FIXTURES = Path(__file__).resolve().parents[2] / "court-booking-frontend" / "packages" / "types" / "src" / "fixtures"


def test_defaults_fixture_equals_backend_defaults():
    assert json.loads((FIXTURES / "venue-timer-defaults.json").read_text(encoding="utf-8")) == DEFAULTS


def test_defaults_are_todays_behaviour():
    from app.config import get_settings

    s = get_settings()
    assert DEFAULTS["hold_minutes"] == s.BOOKING_HOLD_MINUTES
    assert DEFAULTS["auto_cancel_after_min"] == s.PAYMENT_REVIEW_HOURS * 60
    assert DEFAULTS["auto_cancel_enabled"] is True
    assert effective_timers(Venue()) == DEFAULTS


async def _world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, prefix):
    owner, venue, court = await open_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, prefix + "01")
    player = await make_user(prefix + "02", name="Player P")
    return owner, venue, court, await make_auth_headers(owner), player, await make_auth_headers(player)


async def _set(db_session_factory, venue, **values):
    async with db_session_factory() as s:
        v = await s.get(Venue, venue.id)
        for k, val in values.items():
            setattr(v, k, val)
        await s.commit()


URL = "/api/v1/owners/venues/{}/timers"


async def test_get_and_put_timers(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, venue, court, oh, _p, _ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302100"
    )
    body = (await client.get(URL.format(venue.id), headers=oh)).json()
    assert body["values"] == {k: None for k in DEFAULTS}
    assert body["defaults"] == DEFAULTS and body["effective"] == DEFAULTS

    new = {k: None for k in DEFAULTS} | {"hold_minutes": 30, "auto_cancel_enabled": False, "max_reminders": 3}
    resp = await client.put(URL.format(venue.id), headers=oh, json=new)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["values"]["hold_minutes"] == 30 and out["values"]["first_reminder_after_min"] is None
    assert out["effective"]["hold_minutes"] == 30 and out["effective"]["auto_cancel_enabled"] is False
    assert out["effective"]["first_reminder_after_min"] == 10

    # null resets to default
    resp = await client.put(URL.format(venue.id), headers=oh, json={k: None for k in DEFAULTS})
    assert resp.json()["effective"] == DEFAULTS


async def test_put_timers_out_of_range_is_422(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, venue, court, oh, _p, _ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302101"
    )
    for field, bad in (("hold_minutes", 4), ("hold_minutes", 181), ("max_reminders", 11), ("repeat_every_min", 4),
                       ("first_reminder_after_min", 0), ("auto_cancel_after_min", 1441)):
        resp = await client.put(URL.format(venue.id), headers=oh, json={k: None for k in DEFAULTS} | {field: bad})
        assert resp.status_code == 422, (field, bad, resp.text)
        err = resp.json()["error"]
        assert err["code"] == "TIMER_OUT_OF_RANGE" and err["details"]["field"] == field


async def test_timers_permissions_owner_and_edit_court_settings_staff(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, venue, court, oh, _p, player_h = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302102"
    )

    async def load_user(uid):
        async with db_session_factory() as s:
            return await s.get(User, uid)

    _u, editor_h = await make_staff(client, oh, venue, "+923021029901", ["edit_court_settings"], load_user, make_auth_headers)
    _r, reader_h = await make_staff(client, oh, venue, "+923021029903", ["view_ledger"], load_user, make_auth_headers)
    _n, none_h = await make_staff(client, oh, venue, "+923021029904", ["check_in"], load_user, make_auth_headers)
    body = {k: None for k in DEFAULTS} | {"hold_minutes": 20}
    assert (await client.get(URL.format(venue.id), headers=editor_h)).status_code == 200
    assert (await client.put(URL.format(venue.id), headers=editor_h, json=body)).status_code == 200
    assert (await client.get(URL.format(venue.id), headers=reader_h)).json()["values"]["hold_minutes"] == 20  # read-only
    assert (await client.put(URL.format(venue.id), headers=reader_h, json=body)).status_code == 403
    assert (await client.get(URL.format(venue.id), headers=none_h)).status_code == 403
    assert (await client.get(URL.format(venue.id), headers=player_h)).status_code == 403
    other = await make_user("+923021029902", role=UserRole.OWNER)
    assert (await client.get(URL.format(venue.id), headers=await make_auth_headers(other))).status_code == 403


async def test_hold_uses_the_venue_hold_minutes(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302103"
    )
    b = await hold(client, court, ph, future_day(2), 10)
    held = datetime.fromisoformat(b["held_until"]) - datetime.now(timezone.utc)
    assert timedelta(minutes=14) < held <= timedelta(minutes=15)  # default unchanged

    await _set(db_session_factory, venue, hold_minutes=40)
    b = await hold(client, court, ph, future_day(2), 12)
    held = datetime.fromisoformat(b["held_until"]) - datetime.now(timezone.utc)
    assert timedelta(minutes=39) < held <= timedelta(minutes=40)


async def test_hold_minutes_apply_to_the_whatsapp_and_ai_path_too(db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    """Every hold path (HTTP, AI chat tool, WhatsApp) goes through BookingService.create_hold."""
    from app.config import get_settings
    from app.models.booking import BookingSource
    from app.services.booking_service import BookingService

    owner, venue, court, oh, player, _ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302104"
    )
    await _set(db_session_factory, venue, hold_minutes=25)
    starts = datetime.combine(future_day(3), time(9, 0), tzinfo=timezone.utc)
    async with db_session_factory() as s:
        p = await s.get(User, player.id)
        b = await BookingService(s, get_settings()).create_hold(p, court.id, starts, source=BookingSource.WHATSAPP)
        left = b.held_until - datetime.now(timezone.utc)
    assert timedelta(minutes=24) < left <= timedelta(minutes=25)


async def test_auto_cancel_deadline_default_custom_and_off(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302105"
    )

    async def deadline(bid):
        async with db_session_factory() as s:
            return (await s.get(Booking, bid)).payment_deadline

    b1, _ = await held_and_submitted(client, court, ph, future_day(2), 8)
    left = await deadline(b1) - datetime.now(timezone.utc)
    assert timedelta(minutes=119) < left <= timedelta(minutes=120)  # default = the old PAYMENT_REVIEW_HOURS

    await _set(db_session_factory, venue, auto_cancel_after_min=30)
    b2, _ = await held_and_submitted(client, court, ph, future_day(2), 10)
    left = await deadline(b2) - datetime.now(timezone.utc)
    assert timedelta(minutes=29) < left <= timedelta(minutes=30)

    await _set(db_session_factory, venue, auto_cancel_enabled=False)
    b3, _ = await held_and_submitted(client, court, ph, future_day(2), 12)
    assert await deadline(b3) is None
    # never auto-cancelled: the expiry job leaves it alone
    await expire_stale_bookings(session_factory=db_session_factory)
    async with db_session_factory() as s:
        assert (await s.get(Booking, b3)).status == BookingStatus.PAYMENT_SUBMITTED


async def test_changing_auto_cancel_retimes_waiting_screenshots(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302106"
    )
    bid, _pid = await held_and_submitted(client, court, ph, future_day(2), 8)
    off = {k: None for k in DEFAULTS} | {"auto_cancel_enabled": False}
    assert (await client.put(URL.format(venue.id), headers=oh, json=off)).status_code == 200
    async with db_session_factory() as s:
        assert (await s.get(Booking, bid)).payment_deadline is None
    on = {k: None for k in DEFAULTS} | {"auto_cancel_after_min": 60}
    assert (await client.put(URL.format(venue.id), headers=oh, json=on)).status_code == 200
    async with db_session_factory() as s:
        b = await s.get(Booking, bid)
        pay = await s.scalar(select(Payment).where(Payment.booking_id == bid))
        assert abs((b.payment_deadline - pay.created_at) - timedelta(minutes=60)) < timedelta(seconds=1)


async def _submitted_minutes_ago(db_session_factory, bid, minutes):
    async with db_session_factory() as s:
        pay = await s.scalar(select(Payment).where(Payment.booking_id == bid))
        pay.created_at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        b = await s.get(Booking, bid)
        if b.payment_deadline is not None:
            court = await s.get(Court, b.court_id)
            v = await s.get(Venue, court.venue_id)
            b.payment_deadline = pay.created_at + timedelta(minutes=effective_timers(v)["auto_cancel_after_min"])
        await s.commit()


async def _events(db_session_factory, bid):
    async with db_session_factory() as s:
        rows = (await s.execute(select(NotificationLog).where(NotificationLog.reference_id == bid))).scalars().all()
        return sorted({r.event_type for r in rows if r.event_type.startswith("payment_")})


async def _open_all_day(db_session_factory, court):
    """Open around the clock so the reminder tests do not depend on what time it is (night shifting has its own test)."""
    from app.models.schedule import ScheduleTemplate

    async with db_session_factory() as s:
        for t in (await s.execute(select(ScheduleTemplate).where(ScheduleTemplate.court_id == court.id))).scalars():
            t.open_time = time(0, 0)
            t.close_time = time(0, 0)
            t.closes_next_day = True
        await s.commit()


def _quiet_whatsapp(monkeypatch):
    async def ok(self, payload):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", ok)


async def test_custom_reminder_values_and_final_warning(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    _quiet_whatsapp(monkeypatch)
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302107"
    )
    await _set(db_session_factory, venue, first_reminder_after_min=2, repeat_every_min=5, auto_cancel_after_min=20)
    bid, _ = await held_and_submitted(client, court, ph, future_day(2), 8)
    await _open_all_day(db_session_factory, court)
    await _submitted_minutes_ago(db_session_factory, bid, 1)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 0
    await _submitted_minutes_ago(db_session_factory, bid, 3)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 1
    assert await _events(db_session_factory, bid) == ["payment_reminder_1", "payment_submitted"]
    await _submitted_minutes_ago(db_session_factory, bid, 8)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 1
    assert "payment_reminder_2" in await _events(db_session_factory, bid)
    # schedule 2, 7, 12 and the final warning at 15 (cancel at 20): at 16 minutes the final warning goes out
    await _submitted_minutes_ago(db_session_factory, bid, 16)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 1
    events = await _events(db_session_factory, bid)
    assert "payment_final_warning" in events and "payment_reminder_3" not in events
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 0
    async with db_session_factory() as s:
        row = await s.scalar(
            select(NotificationLog).where(NotificationLog.reference_id == bid, NotificationLog.event_type == "payment_final_warning").limit(1)
        )
        assert row.payload["minutes_to_cancel"] <= 5


async def test_reminders_disabled_still_warn_before_cancel(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    _quiet_whatsapp(monkeypatch)
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302108"
    )
    await _set(db_session_factory, venue, reminders_enabled=False)
    bid, _ = await held_and_submitted(client, court, ph, future_day(2), 8)
    await _open_all_day(db_session_factory, court)
    await _submitted_minutes_ago(db_session_factory, bid, 50)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 0
    await _submitted_minutes_ago(db_session_factory, bid, 116)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 1
    assert await _events(db_session_factory, bid) == ["payment_final_warning", "payment_submitted"]


async def test_auto_cancel_off_means_reminders_but_no_warning_and_no_cancel(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    _quiet_whatsapp(monkeypatch)
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302109"
    )
    await _set(db_session_factory, venue, auto_cancel_enabled=False)
    bid, _ = await held_and_submitted(client, court, ph, future_day(2), 8)
    await _open_all_day(db_session_factory, court)
    await _submitted_minutes_ago(db_session_factory, bid, 300)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 1
    assert await _events(db_session_factory, bid) == ["payment_reminder_5", "payment_submitted"]
    assert await expire_stale_bookings(session_factory=db_session_factory) == 0


async def test_reminder_due_at_night_waits_for_opening_time(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    """Night shifting: when the venue is closed right now, a due reminder is not sent (it goes out at opening)."""
    mock_upload(monkeypatch)
    _quiet_whatsapp(monkeypatch)
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302110"
    )
    bid, _ = await held_and_submitted(client, court, ph, future_day(2), 8)
    # Re-open the court only for a 1-hour window starting 6 hours from now (Pakistan time), every day.
    from app.models.schedule import ScheduleTemplate

    now_pkt = pkt_now()
    open_h = (now_pkt.hour + 6) % 24
    close_h = (open_h + 1) % 24
    async with db_session_factory() as s:
        for t in (await s.execute(select(ScheduleTemplate).where(ScheduleTemplate.court_id == court.id))).scalars():
            t.open_time = time(open_h, 0)
            t.close_time = time(close_h, 0)
            t.closes_next_day = close_h == 0
        await s.commit()
    await _submitted_minutes_ago(db_session_factory, bid, 12)
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 0
    assert await _events(db_session_factory, bid) == ["payment_submitted"]


async def test_reminders_stop_when_owner_acts_or_player_cancels(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    _quiet_whatsapp(monkeypatch)
    owner, venue, court, oh, _p, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302111"
    )
    b1, p1 = await held_and_submitted(client, court, ph, future_day(2), 8)
    await _open_all_day(db_session_factory, court)
    b2, _p2 = await held_and_submitted(client, court, ph, future_day(2), 10)
    await _submitted_minutes_ago(db_session_factory, b1, 12)
    await _submitted_minutes_ago(db_session_factory, b2, 12)
    assert (await client.post(f"/api/v1/payments/{p1}/approve", headers=oh, json={"confirm_duplicate": True})).status_code == 200
    assert (await client.post(f"/api/v1/bookings/{b2}/cancel", headers=ph, json={})).status_code == 200
    assert await remind_pending_payment_reviews(session_factory=db_session_factory) == 0
    assert "payment_reminder_1" not in await _events(db_session_factory, b1)
    assert "payment_reminder_1" not in await _events(db_session_factory, b2)


async def test_auto_cancel_with_screenshot_frees_slot_and_tells_owner_money_may_be_owed(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    _quiet_whatsapp(monkeypatch)
    owner, venue, court, oh, player, ph = await _world(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+92302112"
    )
    await _set(db_session_factory, venue, auto_cancel_after_min=30)
    bid, pid = await held_and_submitted(client, court, ph, future_day(2), 8)
    await _submitted_minutes_ago(db_session_factory, bid, 31)
    assert await expire_stale_bookings(session_factory=db_session_factory) == 1
    async with db_session_factory() as s:
        b = await s.get(Booking, bid)
        assert b.status == BookingStatus.CANCELLED and b.cancellation_reason == "payment_review_expired"
        owner_rows = (
            await s.execute(select(NotificationLog).where(NotificationLog.user_id == owner.id, NotificationLog.reference_id == bid))
        ).scalars().all()
        player_rows = (
            await s.execute(select(NotificationLog).where(NotificationLog.user_id == player.id, NotificationLog.reference_id == bid))
        ).scalars().all()
    assert "owner_payment_auto_cancelled" in {r.event_type for r in owner_rows}
    assert "booking_cancelled" in {r.event_type for r in player_rows}
    # the slot is free again: the same time can be held
    again = await client.post(
        "/api/v1/bookings/hold", headers=ph, json={"court_id": str(court.id), "starts_at": f"{future_day(2).isoformat()}T08:00:00+00:00"}
    )
    assert again.status_code == 201, again.text
    # the expired card is in the approvals queue; "money received" queues the refund via the existing dispute path
    ack = await client.post(f"/api/v1/owners/payments/{pid}/acknowledge", headers=oh, json={"money_received": True})
    assert ack.status_code == 200 and ack.json()["refund_dispute_id"]
    # feed: kind + link to approvals
    feed = (await client.get("/api/v1/users/me/notifications/feed", headers=oh)).json()
    item = next(i for i in feed["items"] if i["event_type"] == "owner_payment_auto_cancelled")
    assert item["kind"] == "payment_auto_cancelled" and item["link"]["kind"] == "approvals"
