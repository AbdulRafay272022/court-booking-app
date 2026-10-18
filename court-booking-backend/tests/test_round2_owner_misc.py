"""Owner Round 2: Overview pending_all (A7), "Nahi" completion with received_now (A8), advance explain (A11), walk-in
channel_detail (A4) and the History booking_id focus filter (A2). Real Postgres."""
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.models.booking import Booking, BookingSource, BookingStatus, CancelledBy
from app.models.court import CourtAdvanceType
from app.models.payment_entry import PaymentEntry
from app.models.user import User, UserRole
from overview_helpers import add_booking, at, make_staff, past_day, seed_venue
from round2_helpers import future_day, open_venue

OV = "/api/v1/owners/overview"
HIST = "/api/v1/owners/bookings-history"


def completion_url(booking_id) -> str:
    return f"/api/v1/owners/bookings/{booking_id}/completion"


@pytest.fixture
def seed(make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    async def _seed(phone, **kw):
        return await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, **kw)

    return _seed


# ------------------------------------------------------------------ A7 pending_all


async def test_pending_all_counts_every_date_and_respects_court_filter(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (a, b) = await seed(
        "+923012000001", courts=(("Court A", time(10, 0), time(22, 0)), ("Court B", time(10, 0), time(22, 0)))
    )
    h = await make_auth_headers(owner)
    now = datetime.now(timezone.utc)
    await add_booking(db_session_factory, a, at(future_day(2), 12), status=BookingStatus.PAYMENT_SUBMITTED)
    await add_booking(db_session_factory, a, at(future_day(9), 12), status=BookingStatus.PAYMENT_SUBMITTED)
    held = await add_booking(db_session_factory, b, at(future_day(5), 12), status=BookingStatus.HELD)
    stale = await add_booking(db_session_factory, b, at(future_day(6), 12), status=BookingStatus.HELD)
    await add_booking(db_session_factory, a, at(future_day(3), 12), status=BookingStatus.BOOKED)
    async with db_session_factory() as session:
        await session.execute(update(Booking).where(Booking.id == held.id).values(held_until=now + timedelta(minutes=10)))
        # an expired hold is FREE at read time (B1): not pending
        await session.execute(update(Booking).where(Booking.id == stale.id).values(held_until=now - timedelta(minutes=1)))
        await session.commit()

    body = (await client.get(OV, params={"date": past_day(20).isoformat()}, headers=h)).json()
    assert body["pending_all"] == {"count": 3, "awaiting_approval": 2, "awaiting_payment": 1}
    assert body["bookings"]["pending"]["count"] == 0  # the date-based one is unchanged
    only_b = (await client.get(OV, params={"court_ids": str(b.id)}, headers=h)).json()
    assert only_b["pending_all"] == {"count": 1, "awaiting_approval": 0, "awaiting_payment": 1}


async def test_slot_invariant_holds_with_an_expired_hold(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923012000002")
    h = await make_auth_headers(owner)
    day = future_day(2)
    stale = await add_booking(db_session_factory, court, at(day, 12), status=BookingStatus.HELD)
    async with db_session_factory() as session:
        await session.execute(
            update(Booking).where(Booking.id == stale.id).values(held_until=datetime.now(timezone.utc) - timedelta(minutes=2))
        )
        await session.commit()
    s = (await client.get(OV, params={"date": day.isoformat()}, headers=h)).json()["slots"]
    assert s["pending"] == 0 and s["total"] == s["booked"] + s["pending"] + s["blocked"] + s["free"]


# ------------------------------------------------------------------ A8 received_now


async def _completed_case(seed, make_auth_headers, db_session_factory, phone):
    owner, venue, (court,) = await seed(phone)
    h = await make_auth_headers(owner)
    b = await add_booking(db_session_factory, court, at(past_day(2), 12), price=4500, advance=2000, paid=2000)
    return owner, h, b


async def _paid(sf, booking_id):
    async with sf() as session:
        b = await session.get(Booking, booking_id)
        return float(b.amount_paid), float(b.balance_due)


async def test_received_now_1000_adds_a_positive_entry_and_stays_adhoora(seed, make_auth_headers, client, db_session_factory):
    owner, h, b = await _completed_case(seed, make_auth_headers, db_session_factory, "+923012000003")
    missing = await client.post(completion_url(b.id), json={"result": "no", "received_now": 1000}, headers=h)
    assert missing.status_code == 400 and missing.json()["error"]["code"] == "REASON_REQUIRED"
    resp = await client.post(completion_url(b.id), json={"result": "no", "received_now": 1000, "reason": "baqi kal dega"}, headers=h)
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["total_paid"] == 3000 and row["due"] == 1500 and row["completion"]["result"] == "no"
    assert await _paid(db_session_factory, b.id) == (3000.0, 1500.0)
    async with db_session_factory() as session:
        amounts = sorted(e.amount_pkr for e in (await session.execute(select(PaymentEntry).where(PaymentEntry.booking_id == b.id))).scalars())
    assert amounts == [1000, 2000]  # one positive entry, nothing edited or reversed

    detail = (await client.get(f"/api/v1/owners/bookings/{b.id}/overview-detail", headers=h)).json()
    got = [e for e in detail["timeline"] if e["kind"] == "balance_received"]
    assert len(got) == 1 and got[0]["amount"] == 1000 and got[0]["actor_name"] == "Owner One" and got[0]["at"]


async def test_received_now_equal_to_due_is_mukammal(seed, make_auth_headers, client, db_session_factory):
    owner, h, b = await _completed_case(seed, make_auth_headers, db_session_factory, "+923012000004")
    resp = await client.post(completion_url(b.id), json={"result": "no", "received_now": 2500}, headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["total_paid"] == 4500 and resp.json()["due"] == 0 and resp.json()["completion"]["result"] == "yes"


async def test_received_now_zero_with_reason_changes_no_money(seed, make_auth_headers, client, db_session_factory):
    owner, h, b = await _completed_case(seed, make_auth_headers, db_session_factory, "+923012000005")
    resp = await client.post(completion_url(b.id), json={"result": "no", "received_now": 0, "reason": "nahi diya"}, headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["total_paid"] == 2000 and resp.json()["due"] == 2500 and resp.json()["completion"]["result"] == "no"
    assert await _paid(db_session_factory, b.id) == (2000.0, 2500.0)
    too_much = await client.post(completion_url(b.id), json={"result": "no", "received_now": 2600, "reason": "x"}, headers=h)
    assert too_much.status_code == 400 and too_much.json()["error"]["details"] == {"max": 2500}


async def test_old_received_pkr_path_is_unchanged(seed, make_auth_headers, client, db_session_factory):
    owner, h, b = await _completed_case(seed, make_auth_headers, db_session_factory, "+923012000006")
    # the old semantics: received_pkr is the new TOTAL paid (may lower it), no reason required
    resp = await client.post(completion_url(b.id), json={"result": "no", "received_pkr": 1500}, headers=h)
    assert resp.status_code == 200 and resp.json()["total_paid"] == 1500


# ------------------------------------------------------------------ A11 advance explain


async def test_advance_explain_percent_and_default(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, client):
    owner, venue, court = await open_venue(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923012000007", price=4000,
        advance_type=CourtAdvanceType.PERCENT, advance_value=50,
    )
    h = await make_auth_headers(owner)
    body = (await client.get(f"/api/v1/courts/{court.id}/advance-explain", headers=h)).json()
    assert body["mode"] == "percent" and body["value"] == 50 and body["minimum"] is None
    assert body["hourly_price"] == 4000 and body["example_minutes"] == 60
    assert body["example_total"] == 4000 and body["example_advance"] == 2000
    assert body["default_rule"] == {"source": "pricing_rule", "percentage": 100.0, "value_if_nothing_set": 4000}

    plain = await make_court(venue, name="Plain")
    bare = (await client.get(f"/api/v1/courts/{plain.id}/advance-explain", headers=h)).json()
    assert bare["mode"] == "default" and bare["hourly_price"] is None
    assert bare["default_rule"] == {"source": "none", "percentage": None, "value_if_nothing_set": 0}

    stranger = await make_user("+923012000077", role=UserRole.OWNER)
    assert (await client.get(f"/api/v1/courts/{court.id}/advance-explain", headers=await make_auth_headers(stranger))).status_code == 403


# ------------------------------------------------------------------ A4 channel_detail + A2 history focus


async def test_walkin_channel_detail_owner_vs_staff(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, client, db_session_factory):
    owner, venue, court = await open_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923012000008")
    oh = await make_auth_headers(owner)

    async def load_user(uid):
        async with db_session_factory() as session:
            return await session.get(User, uid)

    _s, sh = await make_staff(client, oh, venue, "+923012000088", ["walkin", "view_ledger"], load_user, make_auth_headers)
    day = future_day(2)
    ids = []
    for headers, hour in ((oh, 10), (sh, 12)):
        resp = await client.post(
            "/api/v1/bookings/walkin",
            headers=headers,
            json={"court_id": str(court.id), "starts_at": f"{day.isoformat()}T{hour:02d}:00:00+00:00", "player_name": "Walk In", "amount_paid": 500},
        )
        assert resp.status_code == 201, resp.text
        ids.append(resp.json()["booking"]["id"])
    details = [(await client.get(f"/api/v1/owners/bookings/{i}/overview-detail", headers=oh)).json() for i in ids]
    assert [d["channel_detail"] for d in details] == ["owner", "staff"]
    assert all(d["row"]["source"] == "walkin" for d in details)

    app_booking = await add_booking(db_session_factory, court, at(future_day(4), 12), source=BookingSource.APP)
    d = (await client.get(f"/api/v1/owners/bookings/{app_booking.id}/overview-detail", headers=oh)).json()
    assert d["channel_detail"] is None


async def test_history_booking_id_focus_ignores_the_date_range(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923012000009")
    h = await make_auth_headers(owner)
    target = await add_booking(
        db_session_factory, court, at(past_day(30), 12), status=BookingStatus.CANCELLED, cancelled_by=CancelledBy.PLAYER, paid=1000
    )
    from overview_helpers import add_dispute

    await add_dispute(db_session_factory, target, 1000)
    await add_booking(db_session_factory, court, at(past_day(30), 15))
    body = (await client.get(HIST, params={"booking_id": str(target.id)}, headers=h)).json()
    assert body["total"] == 2 and {i["booking_id"] for i in body["items"]} == {str(target.id)}
    assert {i["kind"] for i in body["items"]} == {"cancelled", "refund"}
    csv_text = (await client.get(HIST + "/export.csv", params={"booking_id": str(target.id)}, headers=h)).text
    assert csv_text.count(str(target.id)) == 2
    # another owner's venue never sees it (the filter is applied inside the venue scope)
    other, _v, _c = await seed("+923012000099")
    assert (await client.get(HIST, params={"booking_id": str(target.id)}, headers=await make_auth_headers(other))).json()["total"] == 0
