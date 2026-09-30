"""GET /venues filters (area, price, indoor, amenities, availability at a date/time, sort) and GET /venues/areas."""
from datetime import time, timedelta

import pytest

from app.models.blackout import Blackout
from app.models.booking import Booking, BookingStatus
from app.utils.timezone import pkt_time_to_utc, pkt_today

URL = "/api/v1/venues"


def _names(resp) -> list[str]:
    assert resp.status_code == 200, resp.text
    return [v["name"] for v in resp.json()["venues"]]


@pytest.fixture
def owner(make_user):
    async def _owner(n: int = 1):
        from app.models.user import UserRole

        return await make_user(f"+92300777{n:04d}", role=UserRole.OWNER)

    return _owner


async def _open_all_week(make_schedule, court, open_time=time(6, 0), close_time=time(23, 0)):
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=open_time, close_time=close_time)


@pytest.fixture
def bookable_court(make_court, make_schedule, make_pricing_rule):
    """A court with a wide schedule and a price, so it is genuinely bookable."""

    async def _make(venue, price=1000, open_time=time(6, 0), close_time=time(23, 0), **court_kwargs):
        court = await make_court(venue, **court_kwargs)
        await _open_all_week(make_schedule, court, open_time, close_time)
        await make_pricing_rule(court, price_per_slot=price)
        return court

    return _make


@pytest.fixture
def book(db_session_factory):
    async def _book(court, starts_at, ends_at, status=BookingStatus.BOOKED):
        async with db_session_factory() as session:
            session.add(
                Booking(
                    court_id=court.id,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    status=status,
                    price=1000,
                    advance_amount=1000,
                    balance_due=0,
                )
            )
            await session.commit()

    return _book


def _tomorrow():
    return pkt_today() + timedelta(days=1)


def _at(d, hh, mm=0):
    return pkt_time_to_utc(d, time(hh, mm))


def _avail(d=None, start="10:00", **extra):
    return {"date": (d or _tomorrow()).isoformat(), "start_time": start, **extra}


# ---------------------------------------------------------------------------
# simple filters
# ---------------------------------------------------------------------------


async def test_area_filter_is_case_insensitive_and_exact(client, owner, make_venue):
    o = await owner()
    await make_venue(o, name="DHA Arena", area="DHA Phase 6")
    await make_venue(o, name="Clifton Arena", area="Clifton")
    await make_venue(o, name="No Area Arena", area=None)

    assert _names(await client.get(URL, params={"area": "dha phase 6"})) == ["DHA Arena"]
    assert _names(await client.get(URL, params={"area": "CLIFTON"})) == ["Clifton Arena"]
    assert _names(await client.get(URL, params={"area": "DHA"})) == []  # exact, not a prefix match
    assert len(_names(await client.get(URL))) == 3


async def test_areas_endpoint_distinct_sorted_approved_only(client, owner, make_venue):
    from app.models.venue import VenueStatus

    o = await owner()
    await make_venue(o, name="A1", area="Clifton")
    await make_venue(o, name="A2", area="Clifton")
    await make_venue(o, name="A3", area="bahria")
    await make_venue(o, name="A4", area="DHA")
    await make_venue(o, name="A5", area=None)
    await make_venue(o, name="A6", area="Pending Area", status=VenueStatus.PENDING)
    await make_venue(o, name="A7", area="Gone Area", is_active=False)

    resp = await client.get(f"{URL}/areas")  # must not be shadowed by /{venue_id}
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"areas": ["bahria", "Clifton", "DHA"]}


async def test_price_filter_and_min_price_field(client, owner, make_venue, bookable_court):
    o = await owner()
    cheap = await make_venue(o, name="Cheap", sports=["padel", "cricket"])
    await bookable_court(cheap, price=2000, sport="padel", name="P")
    await bookable_court(cheap, price=500, sport="cricket", name="C")
    pricey = await make_venue(o, name="Pricey", sports=["padel"])
    await bookable_court(pricey, price=3000, sport="padel")
    unpriced = await make_venue(o, name="Unpriced", sports=["padel"])
    # no court at all -> no price, never matches a price filter

    by_name = {v["name"]: v for v in (await client.get(URL)).json()["venues"]}
    assert by_name["Cheap"]["min_price"] == 500.0  # cheapest court, any sport
    assert by_name["Pricey"]["min_price"] == 3000.0
    assert by_name["Unpriced"]["min_price"] is None

    assert set(_names(await client.get(URL, params={"min_price": 1000}))) == {"Cheap", "Pricey"}
    assert set(_names(await client.get(URL, params={"max_price": 2500}))) == {"Cheap"}
    assert _names(await client.get(URL, params={"min_price": 2500, "max_price": 3500})) == ["Pricey"]
    assert _names(await client.get(URL, params={"min_price": 4000})) == []
    assert unpriced.name not in _names(await client.get(URL, params={"max_price": 100000}))

    # sport-scoped: Cheap's padel court costs 2000, its cricket court 500
    resp = await client.get(URL, params={"sport": "padel", "max_price": 1000})
    assert _names(resp) == []
    resp = await client.get(URL, params={"sport": "cricket", "max_price": 1000})
    assert _names(resp) == ["Cheap"]
    assert resp.json()["venues"][0]["min_price"] == 500.0
    resp = await client.get(URL, params={"sport": "padel", "min_price": 1500, "max_price": 2500})
    assert _names(resp) == ["Cheap"]
    assert resp.json()["venues"][0]["min_price"] == 2000.0  # respects the sport filter


async def test_price_includes_floodlight_surcharge_and_skips_inactive_rules(
    client, owner, make_venue, make_court, make_schedule, make_pricing_rule
):
    o = await owner()
    venue = await make_venue(o, name="Lit")
    court = await make_court(venue, has_floodlights=True)
    await make_pricing_rule(court, price_per_slot=1000, floodlight_surcharge=250)
    await make_pricing_rule(court, name="Off", price_per_slot=100, is_active=False)
    resp = await client.get(URL)
    assert resp.json()["venues"][0]["min_price"] == 1250.0


async def test_inactive_court_ignored_for_price(client, owner, make_venue, bookable_court):
    o = await owner()
    venue = await make_venue(o, name="Half")
    await bookable_court(venue, price=100, is_active=False, name="Old")
    await bookable_court(venue, price=900, name="New")
    resp = await client.get(URL)
    assert resp.json()["venues"][0]["min_price"] == 900.0
    assert _names(await client.get(URL, params={"max_price": 200})) == []


async def test_indoor_filter(client, owner, make_venue, make_court):
    o = await owner()
    ind = await make_venue(o, name="Indoor Club")
    await make_court(ind, is_indoor=True)
    out = await make_venue(o, name="Outdoor Club")
    await make_court(out, is_indoor=False)
    mixed = await make_venue(o, name="Mixed Club")
    await make_court(mixed, name="a", is_indoor=True)
    await make_court(mixed, name="b", is_indoor=False)
    await make_venue(o, name="Courtless")

    assert set(_names(await client.get(URL, params={"indoor": "true"}))) == {"Indoor Club", "Mixed Club"}
    assert set(_names(await client.get(URL, params={"indoor": "false"}))) == {"Outdoor Club", "Mixed Club"}


async def test_indoor_is_scoped_to_the_sport(client, owner, make_venue, make_court):
    o = await owner()
    venue = await make_venue(o, name="Split", sports=["padel", "cricket"])
    await make_court(venue, name="p", sport="padel", is_indoor=True)
    await make_court(venue, name="c", sport="cricket", is_indoor=False)
    assert _names(await client.get(URL, params={"indoor": "true", "sport": "cricket"})) == []
    assert _names(await client.get(URL, params={"indoor": "true", "sport": "padel"})) == ["Split"]


async def test_amenities_require_all_case_insensitively(client, owner, make_venue):
    o = await owner()
    await make_venue(o, name="Both", amenities=["Floodlights", "Parking", "Cafe"])
    await make_venue(o, name="One", amenities=["parking"])
    await make_venue(o, name="None", amenities=None)

    assert _names(await client.get(URL, params={"amenities": "floodlights,parking"})) == ["Both"]
    assert set(_names(await client.get(URL, params={"amenities": "parking"}))) == {"Both", "One"}
    assert _names(await client.get(URL, params={"amenities": " FloodLights , parking ,"})) == ["Both"]
    assert _names(await client.get(URL, params={"amenities": "parking,wifi"})) == []


async def test_new_sport_types_and_case_insensitive_parentheses(client, owner, make_venue, make_court):
    o = await owner()
    await make_venue(o, name="Turf", sports=["Football (full-field)", "Ground"])
    await make_venue(o, name="Padel Only", sports=["padel"])
    assert _names(await client.get(URL, params={"sport": "Football (full-field)"})) == ["Turf"]
    assert _names(await client.get(URL, params={"sport": "football (FULL-field)"})) == ["Turf"]
    assert _names(await client.get(URL, params={"sport": "ground"})) == ["Turf"]
    assert set(_names(await client.get(URL, params={"sport": "padel"}))) == {"Padel Only"}


async def test_court_level_sport_match_with_parentheses(client, owner, make_venue, bookable_court):
    o = await owner()
    v = await make_venue(o, name="Turf", sports=["Football (full-field)"])
    await bookable_court(v, price=4000, sport="Football (full-field)")
    resp = await client.get(URL, params={"sport": "football (full-field)", "max_price": 5000})
    assert _names(resp) == ["Turf"]
    assert resp.json()["venues"][0]["min_price"] == 4000.0


# ---------------------------------------------------------------------------
# sort
# ---------------------------------------------------------------------------


async def test_sort_distance_nearest_first_and_radius(client, owner, make_venue):
    o = await owner()
    await make_venue(o, name="Far", location="SRID=4326;POINT(67.10 24.90)")
    await make_venue(o, name="Near", location="SRID=4326;POINT(67.001 24.801)")
    await make_venue(o, name="Mid", location="SRID=4326;POINT(67.03 24.83)")
    await make_venue(o, name="Way Off", location="SRID=4326;POINT(74.35 31.52)")  # Lahore

    params = {"lat": 24.8, "lng": 67.0, "radius_km": 30}
    resp = await client.get(URL, params={**params, "sort": "distance"})
    assert _names(resp) == ["Near", "Mid", "Far"]
    dists = [v["distance_meters"] for v in resp.json()["venues"]]
    assert dists == sorted(dists)
    # without an explicit sort, lat/lng keeps the nearest-first behavior
    assert _names(await client.get(URL, params=params)) == ["Near", "Mid", "Far"]
    # no lat/lng: no radius applied, all four come back, no distance
    resp = await client.get(URL)
    assert len(_names(resp)) == 4
    assert all(v["distance_meters"] is None for v in resp.json()["venues"])


async def test_sort_distance_needs_coordinates_and_bad_sort_rejected(client):
    resp = await client.get(URL, params={"sort": "distance"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    resp = await client.get(URL, params={"sort": "rating"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_sort_price_ascending_nulls_last_and_pagination(client, owner, make_venue, bookable_court):
    o = await owner()
    for name, price in (("C", 3000), ("A", 1000), ("B", 2000)):
        v = await make_venue(o, name=name)
        await bookable_court(v, price=price)
    await make_venue(o, name="Z-unpriced")

    resp = await client.get(URL, params={"sort": "price"})
    assert _names(resp) == ["A", "B", "C", "Z-unpriced"]
    assert resp.json()["total"] == 4
    resp = await client.get(URL, params={"sort": "price", "per_page": 2, "page": 2})
    assert _names(resp) == ["C", "Z-unpriced"]
    assert resp.json()["total"] == 4


async def test_sort_price_combined_with_radius(client, owner, make_venue, bookable_court):
    o = await owner()
    near = await make_venue(o, name="Near Pricey", location="SRID=4326;POINT(67.001 24.801)")
    await bookable_court(near, price=3000)
    cheap_far = await make_venue(o, name="Far Cheap", location="SRID=4326;POINT(74.35 31.52)")
    await bookable_court(cheap_far, price=500)
    resp = await client.get(URL, params={"sort": "price", "lat": 24.8, "lng": 67.0, "radius_km": 10})
    assert _names(resp) == ["Near Pricey"]


async def test_filters_combine(client, owner, make_venue, bookable_court):
    o = await owner()
    hit = await make_venue(o, name="Hit", area="DHA", amenities=["parking", "floodlights"], sports=["padel"])
    await bookable_court(hit, price=1500, is_indoor=True)
    wrong_area = await make_venue(o, name="WrongArea", area="Clifton", amenities=["parking", "floodlights"])
    await bookable_court(wrong_area, price=1500, is_indoor=True)
    wrong_price = await make_venue(o, name="WrongPrice", area="DHA", amenities=["parking", "floodlights"])
    await bookable_court(wrong_price, price=9000, is_indoor=True)
    outdoor = await make_venue(o, name="Outdoor", area="DHA", amenities=["parking", "floodlights"])
    await bookable_court(outdoor, price=1500, is_indoor=False)
    no_amenity = await make_venue(o, name="NoAmenity", area="DHA", amenities=["parking"])
    await bookable_court(no_amenity, price=1500, is_indoor=True)

    resp = await client.get(
        URL,
        params={
            "city": "karachi",
            "sport": "PADEL",
            "area": "dha",
            "max_price": 2000,
            "indoor": "true",
            "amenities": "parking,floodlights",
            "sort": "price",
            **_avail(),
        },
    )
    assert _names(resp) == ["Hit"]


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "params",
    [
        {"start_time": "10:00"},  # time without a date
        {"date": "2030-13-45"},
        {"date": "tomorrow"},
        {"date": "2030-1-5"},
        {"date": "2030-01-05", "start_time": "25:00"},
        {"date": "2030-01-05", "start_time": "10am"},
        {"date": "2030-01-05", "start_time": "9:00"},
        {"date": "2030-01-05", "duration_minutes": 60},  # duration without a start time
        {"date": "2030-01-05", "start_time": "10:00", "duration_minutes": 0},
        {"min_price": -1},
        {"min_price": 500, "max_price": 100},
        {"duration_minutes": "abc"},
    ],
)
async def test_bad_availability_params_are_422_in_the_error_envelope(client, params):
    resp = await client.get(URL, params=params)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["message"]


# ---------------------------------------------------------------------------
# availability filter against real bookings
# ---------------------------------------------------------------------------


async def test_free_slot_returns_venue(client, owner, make_venue, bookable_court):
    o = await owner()
    v = await make_venue(o, name="Free")
    await bookable_court(v)
    assert _names(await client.get(URL, params=_avail())) == ["Free"]
    # date alone: any bookable slot that starts that day
    assert _names(await client.get(URL, params={"date": _tomorrow().isoformat()})) == ["Free"]


@pytest.mark.parametrize(
    "status,blocks",
    [
        (BookingStatus.BOOKED, True),
        (BookingStatus.HELD, True),
        (BookingStatus.PAYMENT_SUBMITTED, True),
        (BookingStatus.CANCELLED, False),
        (BookingStatus.NO_SHOW, False),
    ],
)
async def test_live_bookings_block_and_dead_ones_do_not(
    client, owner, make_venue, bookable_court, book, status, blocks
):
    o = await owner()
    v = await make_venue(o, name="Taken")
    court = await bookable_court(v)
    d = _tomorrow()
    await book(court, _at(d, 10), _at(d, 11), status=status)
    names = _names(await client.get(URL, params=_avail(d, "10:00")))
    assert names == ([] if blocks else ["Taken"])
    # the neighbouring hour is still free either way
    assert _names(await client.get(URL, params=_avail(d, "11:00"))) == ["Taken"]


async def test_blackout_blocks(client, owner, make_venue, bookable_court, db_session_factory):
    o = await owner()
    v = await make_venue(o, name="Rainy")
    court = await bookable_court(v)
    d = _tomorrow()
    async with db_session_factory() as session:
        session.add(Blackout(court_id=court.id, starts_at=_at(d, 9, 30), ends_at=_at(d, 10, 30), reason="rain"))
        await session.commit()
    assert _names(await client.get(URL, params=_avail(d, "10:00"))) == []
    assert _names(await client.get(URL, params=_avail(d, "11:00"))) == ["Rainy"]


async def test_outside_schedule_hours_and_closed_day_block(
    client, owner, make_venue, make_court, make_schedule, make_pricing_rule, bookable_court
):
    o = await owner()
    v = await make_venue(o, name="Hours")
    await bookable_court(v)  # open 06:00-23:00 every day
    d = _tomorrow()
    assert _names(await client.get(URL, params=_avail(d, "03:00"))) == []  # before opening
    assert _names(await client.get(URL, params=_avail(d, "23:00"))) == []  # 22:00 is the last hour slot
    assert _names(await client.get(URL, params=_avail(d, "22:00"))) == ["Hours"]
    assert _names(await client.get(URL, params=_avail(d, "10:30"))) == []  # off the 60-minute grid

    closed = await make_venue(o, name="Closed Day")
    court = await make_court(closed)
    for day in range(7):
        if day != d.weekday():
            await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    assert _names(await client.get(URL, params=_avail(d, "10:00"))) == ["Hours"]  # Closed Day is closed on d


async def test_past_slot_blocks(client, owner, make_venue, bookable_court):
    o = await owner()
    v = await make_venue(o, name="Early")
    await bookable_court(v, open_time=time(0, 0), close_time=time(23, 0))
    today = pkt_today()
    assert _names(await client.get(URL, params=_avail(today, "00:00"))) == []  # already started
    assert _names(await client.get(URL, params=_avail(today - timedelta(days=1), "10:00"))) == []
    assert _names(await client.get(URL, params=_avail(_tomorrow(), "00:00"))) == ["Early"]


async def test_beyond_booking_horizon_blocks(client, owner, make_venue, bookable_court):
    o = await owner()
    v = await make_venue(o, name="Short Horizon", booking_horizon_days=3)
    await bookable_court(v)
    today = pkt_today()
    assert _names(await client.get(URL, params=_avail(today + timedelta(days=3)))) == ["Short Horizon"]
    assert _names(await client.get(URL, params=_avail(today + timedelta(days=10)))) == []


async def test_multi_slot_duration_overlap_vs_back_to_back(client, owner, make_venue, bookable_court, book):
    o = await owner()
    v = await make_venue(o, name="Half Hours")
    court = await bookable_court(v, slot_minutes=30)
    d = _tomorrow()
    await book(court, _at(d, 10, 30), _at(d, 11, 30))  # 60-minute booking on the 30-minute grid

    # 09:30 for 90 minutes runs to 11:00 and overlaps the booking by 30 minutes
    assert _names(await client.get(URL, params=_avail(d, "09:30", duration_minutes=90))) == []
    # 09:30 for 60 minutes ends at 10:30, exactly back to back
    assert _names(await client.get(URL, params=_avail(d, "09:30", duration_minutes=60))) == ["Half Hours"]
    # 11:30 onwards is free too
    assert _names(await client.get(URL, params=_avail(d, "11:30", duration_minutes=90))) == ["Half Hours"]
    # default duration = the court's own 30-minute slot
    assert _names(await client.get(URL, params=_avail(d, "10:00"))) == ["Half Hours"]
    assert _names(await client.get(URL, params=_avail(d, "10:30"))) == []


async def test_duration_must_fit_the_courts_slots_and_closing_time(client, owner, make_venue, bookable_court):
    o = await owner()
    v = await make_venue(o, name="Hourly")
    await bookable_court(v)  # 60-minute slots, closes 23:00
    d = _tomorrow()
    assert _names(await client.get(URL, params=_avail(d, "10:00", duration_minutes=120))) == ["Hourly"]
    assert _names(await client.get(URL, params=_avail(d, "10:00", duration_minutes=90))) == []  # not bookable
    assert _names(await client.get(URL, params=_avail(d, "21:00", duration_minutes=180))) == []  # past closing
    assert _names(await client.get(URL, params=_avail(d, "10:00", duration_minutes=480))) == []  # over the cap


async def test_two_courts_only_one_free_returns_venue(client, owner, make_venue, bookable_court, book):
    o = await owner()
    v = await make_venue(o, name="Twin")
    c1 = await bookable_court(v, name="One")
    c2 = await bookable_court(v, name="Two")
    d = _tomorrow()
    await book(c1, _at(d, 10), _at(d, 11))
    assert _names(await client.get(URL, params=_avail(d, "10:00"))) == ["Twin"]
    await book(c2, _at(d, 10), _at(d, 11), status=BookingStatus.HELD)
    assert _names(await client.get(URL, params=_avail(d, "10:00"))) == []


async def test_sport_filter_scopes_the_availability_check(client, owner, make_venue, bookable_court, book):
    o = await owner()
    v = await make_venue(o, name="Multi", sports=["padel", "cricket"])
    padel = await bookable_court(v, name="P", sport="padel")
    cricket = await bookable_court(v, name="C", sport="cricket")
    d = _tomorrow()
    await book(cricket, _at(d, 10), _at(d, 11))  # only the cricket court is taken

    assert _names(await client.get(URL, params=_avail(d, "10:00", sport="padel"))) == ["Multi"]
    assert _names(await client.get(URL, params=_avail(d, "10:00", sport="Cricket"))) == []
    assert _names(await client.get(URL, params=_avail(d, "10:00"))) == ["Multi"]  # padel court is free

    # advertised sport but no court of that sport at all
    ghost = await make_venue(o, name="Ghost", sports=["padel", "cricket"])
    await bookable_court(ghost, sport="padel")
    assert "Ghost" not in _names(await client.get(URL, params=_avail(d, "10:00", sport="cricket")))
    assert "Ghost" in _names(await client.get(URL, params=_avail(d, "10:00", sport="padel")))
    _ = padel


async def test_court_level_filters_apply_to_the_same_court_as_availability(
    client, owner, make_venue, bookable_court, book
):
    o = await owner()
    v = await make_venue(o, name="Mixed")
    indoor = await bookable_court(v, name="In", price=3000, is_indoor=True)
    await bookable_court(v, name="Out", price=1000, is_indoor=False)
    d = _tomorrow()
    await book(indoor, _at(d, 10), _at(d, 11))  # the indoor court is taken, the outdoor one is free

    assert _names(await client.get(URL, params=_avail(d, "10:00", indoor="true"))) == []
    assert _names(await client.get(URL, params=_avail(d, "10:00", indoor="false"))) == ["Mixed"]
    # the free court is the 1000 one, so a price band that only fits the taken indoor court finds nothing
    assert _names(await client.get(URL, params=_avail(d, "10:00", min_price=2500))) == []
    assert _names(await client.get(URL, params=_avail(d, "10:00", max_price=1500))) == ["Mixed"]
    # without an availability filter the indoor court alone satisfies indoor + price
    assert _names(await client.get(URL, params={"indoor": "true", "min_price": 2500})) == ["Mixed"]


async def test_unpriced_court_is_not_bookable(client, owner, make_venue, make_court, make_schedule):
    o = await owner()
    v = await make_venue(o, name="No Rules")
    court = await make_court(v)
    await _open_all_week(make_schedule, court)  # schedule but no pricing rule
    assert _names(await client.get(URL, params=_avail())) == []


async def test_overnight_court_slot_after_midnight(client, owner, make_venue, make_court, make_schedule, make_pricing_rule):
    o = await owner()
    v = await make_venue(o, name="Night Owl")
    court = await make_court(v)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(20, 0), close_time=time(3, 0))
    await make_pricing_rule(court)
    d = _tomorrow()
    # 1 AM on calendar date d belongs to the previous evening's schedule
    assert _names(await client.get(URL, params=_avail(d, "01:00"))) == ["Night Owl"]
    assert _names(await client.get(URL, params=_avail(d, "22:00"))) == ["Night Owl"]
    assert _names(await client.get(URL, params=_avail(d, "12:00"))) == []
