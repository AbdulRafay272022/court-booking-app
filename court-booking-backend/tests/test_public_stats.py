"""GET /api/v1/public/stats: unauthenticated marketing counts, cached 5 minutes."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.booking import Booking, BookingStatus
from app.models.user import UserRole
from app.models.venue import VenueStatus
from app.services import public_stats_service

URL = "/api/v1/public/stats"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture(autouse=True)
def _fresh_cache():
    public_stats_service.clear()
    yield
    public_stats_service.clear()


@pytest.fixture
def clock():
    c = FakeClock()
    public_stats_service.set_clock(c)
    return c


@pytest.fixture
def add_booking(db_session_factory):
    counter = {"n": 0}

    async def _add(court, status):
        counter["n"] += 1
        start = datetime(2031, 1, 1, tzinfo=timezone.utc) + timedelta(hours=2 * counter["n"])
        async with db_session_factory() as session:
            session.add(
                Booking(
                    court_id=court.id,
                    starts_at=start,
                    ends_at=start + timedelta(hours=1),
                    status=status,
                    price=1000,
                    advance_amount=1000,
                    balance_due=0,
                )
            )
            await session.commit()

    return _add


async def _seed(make_user, make_venue, make_court, add_booking):
    """2 live venues (3 live courts + 1 inactive court), plus venues that must not count."""
    owner = await make_user("+923001230001", role=UserRole.OWNER)
    live1 = await make_venue(owner, name="Live One")
    live2 = await make_venue(owner, name="Live Two")
    pending = await make_venue(owner, name="Pending", status=VenueStatus.PENDING)
    rejected = await make_venue(owner, name="Rejected", status=VenueStatus.REJECTED)
    inactive = await make_venue(owner, name="Inactive", is_active=False)

    c1 = await make_court(live1, name="A")
    await make_court(live1, name="B")
    await make_court(live2, name="C")
    await make_court(live2, name="Off", is_active=False)
    for v in (pending, rejected, inactive):
        hidden = await make_court(v, name="Hidden")
        await add_booking(hidden, BookingStatus.BOOKED)  # a booking on a venue that is not live never counts

    # Round 2 Stage 2: booked + completed + no_show count; held / awaiting / cancelled do not.
    for status in (BookingStatus.BOOKED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW):
        await add_booking(c1, status)
    for status in (
        BookingStatus.HELD,
        BookingStatus.PAYMENT_SUBMITTED,
        BookingStatus.CANCELLED,
    ):
        await add_booking(c1, status)

    await make_user("+923001230010")
    await make_user("+923001230011")
    await make_user("+923001230012", phone_verified_at=None)  # half-finished signup
    await make_user("+923001230013", role=UserRole.ADMIN)
    return c1


async def test_counts_with_mixed_fixture_and_no_auth(client, make_user, make_venue, make_court, add_booking):
    await _seed(make_user, make_venue, make_court, add_booking)
    resp = await client.get(URL)  # no Authorization header
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"venues": 2, "courts": 3, "bookings": 3, "players": 2}


async def test_empty_database_is_all_zero(client):
    resp = await client.get(URL)
    assert resp.status_code == 200
    assert resp.json() == {"venues": 0, "courts": 0, "bookings": 0, "players": 0}


async def test_shape_has_exact_keys_and_int_values_no_pii(client, make_user, make_venue, make_court, add_booking):
    await _seed(make_user, make_venue, make_court, add_booking)
    body = (await client.get(URL)).json()
    assert set(body) == {"venues", "courts", "bookings", "players"}
    assert all(type(v) is int for v in body.values())
    text = (await client.get(URL)).text
    for leaked in ("+92300", "Live One", "Karachi", "id", "phone", "name"):
        assert leaked not in text


async def test_cache_control_header(client):
    resp = await client.get(URL)
    assert resp.headers["cache-control"] == "public, max-age=300"


async def test_cached_within_ttl_then_recomputed_after(client, clock, make_user, make_venue, make_court, add_booking):
    owner = await make_user("+923001230001", role=UserRole.OWNER)
    await make_venue(owner, name="First")
    first = (await client.get(URL)).json()
    assert first["venues"] == 1

    await make_venue(owner, name="Second")  # data changes
    clock.now += 299
    assert (await client.get(URL)).json() == first  # still cached

    clock.now += 2  # now past 300 seconds since the first computation
    assert (await client.get(URL)).json()["venues"] == 2


async def test_clear_drops_the_cache(client, clock, make_user, make_venue):
    owner = await make_user("+923001230001", role=UserRole.OWNER)
    await make_venue(owner, name="First")
    assert (await client.get(URL)).json()["venues"] == 1
    await make_venue(owner, name="Second")
    public_stats_service.clear()
    public_stats_service.set_clock(clock)
    assert (await client.get(URL)).json()["venues"] == 2
