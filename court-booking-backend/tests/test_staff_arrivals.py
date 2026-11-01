"""GET /owners/arrivals -- staff "Aane wale players" (OStaffView). Owner decision 2026-11-01: minimal fields only."""
import uuid
from datetime import time, timedelta

from app.models.booking import BookingSource, BookingStatus
from app.models.user import User, UserRole
from app.utils.timezone import pkt_today
from tests.overview_helpers import add_booking, at, seed_venue

ALLOWED_FIELDS = {"player_name", "court_name", "starts_at", "ends_at", "checked_in"}


async def _staff(client, db_session_factory, make_auth_headers, owner_headers, venue_id, phone, permissions):
    resp = await client.post(
        "/api/v1/staff",
        headers=owner_headers,
        json={"venue_id": str(venue_id), "name": "Desk", "phone": phone, "password": "staffpass123", "permissions": permissions},
    )
    assert resp.status_code == 201, resp.text
    async with db_session_factory() as s:
        user = await s.get(User, uuid.UUID(resp.json()["staff_user_id"]))
    return await make_auth_headers(user)


async def _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, phone):
    owner, venue, (court,) = await seed_venue(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, courts=(("Court A", time(0, 0), time(23, 59)),)
    )
    today = pkt_today()
    player = await make_user(phone[:-4] + "9" + phone[-3:], role=UserRole.PLAYER, name="App Player")
    # today: a walk-in (checked in), an app booking (name from the account), a pending screenshot, a cancelled one
    await add_booking(db_session_factory, court, at(today, 18), name="Walk In Ali", phone="+923001112233", paid=2000, checked_in=True)
    await add_booking(db_session_factory, court, at(today, 20), player=player, source=BookingSource.APP, phone="+923004445566")
    await add_booking(db_session_factory, court, at(today, 21), name="Pending Pay", status=BookingStatus.PAYMENT_SUBMITTED)
    await add_booking(db_session_factory, court, at(today, 22), name="Gone", status=BookingStatus.CANCELLED)
    # other days never show
    await add_booking(db_session_factory, court, at(today + timedelta(days=1), 18), name="Tomorrow Tom")
    await add_booking(db_session_factory, court, at(today - timedelta(days=1), 18), name="Yesterday Yas")
    return owner, venue


async def test_check_in_staff_gets_todays_players_with_only_the_minimal_fields(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory
):
    owner, venue = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, "+923018100001")
    staff_headers = await _staff(client, db_session_factory, make_auth_headers, await make_auth_headers(owner), venue.id, "+923018100101", ["check_in"])

    resp = await client.get("/api/v1/owners/arrivals", headers=staff_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"venue_id", "date", "items"}
    assert body["venue_id"] == str(venue.id)
    assert body["date"] == pkt_today().isoformat()
    names = [it["player_name"] for it in body["items"]]
    assert names == ["Walk In Ali", "App Player"]  # pakki only, today only, in time order
    for it in body["items"]:
        assert set(it) == ALLOWED_FIELDS  # no phone, money, screenshot or booking id
        assert it["court_name"] == "Court A"
    assert [it["checked_in"] for it in body["items"]] == [True, False]
    assert "+92300" not in resp.text and "2000" not in resp.text


async def test_staff_without_check_in_is_refused(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory
):
    owner, venue = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, "+923018100002")
    staff_headers = await _staff(client, db_session_factory, make_auth_headers, await make_auth_headers(owner), venue.id, "+923018100102", ["edit_court_settings"])
    resp = await client.get("/api/v1/owners/arrivals", headers=staff_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "NOT_STAFF_PERMITTED"


async def test_check_in_staff_cannot_read_another_venue(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory
):
    owner, venue = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, "+923018100003")
    _other_owner, other_venue = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, "+923018100004")
    staff_headers = await _staff(client, db_session_factory, make_auth_headers, await make_auth_headers(owner), venue.id, "+923018100103", ["check_in"])
    resp = await client.get("/api/v1/owners/arrivals", headers=staff_headers, params={"venue_id": str(other_venue.id)})
    assert resp.status_code == 403


async def test_players_cannot_read_arrivals_and_owners_only_their_venue(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory
):
    owner, venue = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, "+923018100005")
    _other_owner, other_venue = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, "+923018100006")
    player = await make_user("+923018100195", role=UserRole.PLAYER)
    assert (await client.get("/api/v1/owners/arrivals", headers=await make_auth_headers(player), params={"venue_id": str(venue.id)})).status_code == 403
    owner_headers = await make_auth_headers(owner)
    ok = await client.get("/api/v1/owners/arrivals", headers=owner_headers, params={"venue_id": str(venue.id)})
    assert ok.status_code == 200 and len(ok.json()["items"]) == 2
    assert (await client.get("/api/v1/owners/arrivals", headers=owner_headers, params={"venue_id": str(other_venue.id)})).status_code == 403


async def test_no_date_parameter_other_days_stay_hidden(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory
):
    owner, venue = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, "+923018100007")
    staff_headers = await _staff(client, db_session_factory, make_auth_headers, await make_auth_headers(owner), venue.id, "+923018100107", ["check_in"])
    tomorrow = (pkt_today() + timedelta(days=1)).isoformat()
    resp = await client.get("/api/v1/owners/arrivals", headers=staff_headers, params={"date": tomorrow, "date_": tomorrow})
    assert resp.status_code == 200
    names = {it["player_name"] for it in resp.json()["items"]}
    assert "Tomorrow Tom" not in names and "Yesterday Yas" not in names
