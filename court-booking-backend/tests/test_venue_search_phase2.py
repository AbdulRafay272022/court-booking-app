"""Phase 2 search API: has_indoor / has_outdoor, today_free_slots (bulk), latitude / longitude, rating + sort=rating."""
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models.blackout import Blackout
from app.models.court import Court
from app.models.booking import Booking, BookingStatus
from app.models.review import Review
from app.models.user import UserRole
from app.services.availability_service import AvailabilityService
from app.utils.timezone import pkt_time_to_utc, pkt_today

URL = "/api/v1/venues"


@pytest.fixture
def owner(make_user):
    return make_user("+923007780001", role=UserRole.OWNER)


@pytest.fixture
def open_court(make_court, make_schedule, make_pricing_rule):
    async def _make(venue, open_time=time(0, 0), close_time=time(23, 59), **kwargs):
        court = await make_court(venue, **kwargs)
        for day in range(7):
            await make_schedule(court, day_of_week=day, open_time=open_time, close_time=close_time)
        await make_pricing_rule(court, price_per_slot=1000)
        return court

    return _make


def _by_name(resp) -> dict:
    assert resp.status_code == 200, resp.text
    return {v["name"]: v for v in resp.json()["venues"]}


async def test_indoor_outdoor_flags_use_active_courts_only(client, owner, make_venue, make_court, db_session_factory):
    o = await owner
    both = await make_venue(o, name="Both")
    indoor = await make_venue(o, name="Indoor Only")
    none = await make_venue(o, name="No Courts")
    ghost = await make_venue(o, name="Inactive Outdoor")
    await make_court(both, name="A", is_indoor=True)
    await make_court(both, name="B", is_indoor=False)
    await make_court(indoor, name="A", is_indoor=True)
    await make_court(ghost, name="A", is_indoor=True)
    dead = await make_court(ghost, name="B", is_indoor=False)
    async with db_session_factory() as session:
        court = await session.get(Court, dead.id)
        court.is_active = False
        await session.commit()

    venues = _by_name(await client.get(URL))
    assert (venues["Both"]["has_indoor"], venues["Both"]["has_outdoor"]) == (True, True)
    assert (venues["Indoor Only"]["has_indoor"], venues["Indoor Only"]["has_outdoor"]) == (True, False)
    assert (venues["No Courts"]["has_indoor"], venues["No Courts"]["has_outdoor"]) == (False, False)
    assert (venues["Inactive Outdoor"]["has_indoor"], venues["Inactive Outdoor"]["has_outdoor"]) == (True, False)


async def test_coordinates_exposed_in_list(client, owner, make_venue):
    o = await owner
    await make_venue(o, name="Pinned", location="SRID=4326;POINT(67.05 24.85)")
    v = _by_name(await client.get(URL))["Pinned"]
    assert v["latitude"] == pytest.approx(24.85)
    assert v["longitude"] == pytest.approx(67.05)
    # nothing owner/admin-only leaks into the list item
    assert not {"bank_details", "checkin_qr_token", "owner_id", "phone", "whatsapp"} & set(v)


async def test_today_free_slots_in_list_matches_availability_rules(client, owner, make_venue, make_court, open_court, db_session_factory):
    o = await owner
    venue = await make_venue(o, name="Open All Day")
    court = await open_court(venue)
    no_sched = await make_venue(o, name="No Schedule")
    await make_court(no_sched)
    await make_venue(o, name="Courtless")

    venues = _by_name(await client.get(URL))
    assert isinstance(venues["Open All Day"]["today_free_slots"], int)
    assert venues["Open All Day"]["today_free_slots"] >= 0
    assert venues["Courtless"]["today_free_slots"] == 0
    assert venues["No Schedule"]["today_free_slots"] == 0
    # same rule as the by-slug detail, which uses the existing startable logic (modulo the instant it is evaluated at)
    async with db_session_factory() as session:
        now = datetime.now(timezone.utc)
        expected = len(await AvailabilityService(session).get_startable_starting_on(court, pkt_today(), now))
    assert abs(venues["Open All Day"]["today_free_slots"] - expected) <= 1


async def test_free_slot_counts_rules_with_fixed_clock(owner, make_venue, open_court, db_session_factory):
    o = await owner
    venue = await make_venue(o, name="Clocked")
    court = await open_court(venue, open_time=time(6, 0), close_time=time(23, 0))  # 60-minute court: min 2 slots
    today = pkt_today()
    now = pkt_time_to_utc(today, time(20, 0))

    async def counts():
        async with db_session_factory() as session:
            return (await AvailabilityService(session).free_slot_counts_on([court], today, now))[court.id]

    # starts left: 20:30, 21:00, 21:30, 22:00 (a 60-minute booking must end by 23:00); 20:00 itself has started
    assert await counts() == 4

    async with db_session_factory() as session:
        session.add(
            Booking(
                court_id=court.id,
                starts_at=pkt_time_to_utc(today, time(21, 0)),
                ends_at=pkt_time_to_utc(today, time(22, 0)),
                status=BookingStatus.BOOKED,
                price=1000,
                advance_amount=1000,
                balance_due=0,
            )
        )
        await session.commit()
    assert await counts() == 1  # only 22:00 remains

    async with db_session_factory() as session:
        session.add(
            Blackout(
                court_id=court.id,
                starts_at=pkt_time_to_utc(today, time(22, 0)),
                ends_at=pkt_time_to_utc(today, time(23, 0)),
                reason="maintenance",
            )
        )
        await session.commit()
    assert await counts() == 0

    # 0 even for an elapsed day
    late = pkt_time_to_utc(today, time(23, 30))
    async with db_session_factory() as session:
        assert (await AvailabilityService(session).free_slot_counts_on([court], today, late))[court.id] == 0


async def test_bulk_query_count_does_not_grow_with_page_size(client, owner, make_venue, open_court, test_engine):
    o = await owner

    async def make_n(n, prefix):
        for i in range(n):
            v = await make_venue(o, name=f"{prefix} {i}")
            await open_court(v, name="C1")
            await open_court(v, name="C2", is_indoor=True)

    statements: list[str] = []

    def count(conn, cursor, statement, *a):
        statements.append(statement)

    async def run(per_page):
        statements.clear()
        event.listen(test_engine.sync_engine, "before_cursor_execute", count)
        try:
            resp = await client.get(URL, params={"per_page": per_page})
        finally:
            event.remove(test_engine.sync_engine, "before_cursor_execute", count)
        assert resp.status_code == 200
        return len(statements), len(resp.json()["venues"])

    await make_n(2, "Few")
    n_few, got_few = await run(100)
    assert got_few == 2
    await make_n(8, "Many")
    n_many, got_many = await run(100)
    assert got_many == 10
    assert n_few == n_many, f"query count grew with page size: {n_few} -> {n_many}"


async def _review(db_session_factory, make_user, venue, court, player_phone, rating, hidden=False):
    player = await make_user(player_phone)
    async with db_session_factory() as session:
        now = datetime.now().astimezone()
        booking = Booking(
            court_id=court.id,
            player_id=player.id,
            starts_at=now - timedelta(days=2),
            ends_at=now - timedelta(days=2) + timedelta(hours=1),
            status=BookingStatus.COMPLETED,
            price=1000,
            advance_amount=1000,
            balance_due=0,
        )
        session.add(booking)
        await session.flush()
        session.add(Review(booking_id=booking.id, venue_id=venue.id, player_id=player.id, rating=rating, is_hidden=hidden))
        await session.commit()


async def test_rating_fields_and_sort_rating(client, owner, make_user, make_venue, make_court, db_session_factory):
    o = await owner
    v_top = await make_venue(o, name="Top")
    v_many = await make_venue(o, name="Same Avg More Reviews")
    v_low = await make_venue(o, name="Low")
    v_none = await make_venue(o, name="Unrated")
    v_hidden = await make_venue(o, name="Only Hidden")
    courts = {v.name: await make_court(v) for v in (v_top, v_many, v_low, v_none, v_hidden)}
    phone = iter(range(5550, 5600))

    async def rate(venue, rating, hidden=False):
        await _review(db_session_factory, make_user, venue, courts[venue.name], f"+9230066{next(phone):05d}", rating, hidden)

    await rate(v_top, 5)  # 5.0 with one review
    await rate(v_many, 4)
    await rate(v_many, 5)
    await rate(v_many, 5)
    await rate(v_many, 5)  # 4.75
    await rate(v_low, 2)
    await rate(v_hidden, 5, hidden=True)

    resp = await client.get(URL, params={"sort": "rating"})
    assert resp.status_code == 200, resp.text
    items = resp.json()["venues"]
    assert [v["name"] for v in items][:3] == ["Top", "Same Avg More Reviews", "Low"]
    assert {v["name"] for v in items[3:]} == {"Unrated", "Only Hidden"}  # unrated last (hidden reviews do not count)
    by = {v["name"]: v for v in items}
    assert by["Top"]["average_rating"] == 5.0 and by["Top"]["review_count"] == 1
    assert by["Same Avg More Reviews"]["average_rating"] == 4.75 and by["Same Avg More Reviews"]["review_count"] == 4
    assert by["Unrated"]["average_rating"] is None and by["Unrated"]["review_count"] == 0
    assert by["Only Hidden"]["average_rating"] is None and by["Only Hidden"]["review_count"] == 0

    # pagination applies after the sort
    page2 = await client.get(URL, params={"sort": "rating", "per_page": 1, "page": 2})
    assert [v["name"] for v in page2.json()["venues"]] == ["Same Avg More Reviews"]
    assert page2.json()["total"] == 5


async def test_sort_rating_tie_on_average_prefers_more_reviews(client, owner, make_user, make_venue, make_court, db_session_factory):
    o = await owner
    a = await make_venue(o, name="One Review")
    b = await make_venue(o, name="Three Reviews")
    ca, cb = await make_court(a), await make_court(b)
    await _review(db_session_factory, make_user, a, ca, "+923006650001", 4)
    for i in range(3):
        await _review(db_session_factory, make_user, b, cb, f"+92300665001{i}", 4)
    names = [v["name"] for v in (await client.get(URL, params={"sort": "rating"})).json()["venues"]]
    assert names == ["Three Reviews", "One Review"]


async def test_sort_message_lists_rating(client):
    resp = await client.get(URL, params={"sort": "bogus"})
    assert resp.status_code == 422
    assert "rating" in resp.json()["error"]["message"]
