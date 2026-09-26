"""Section 32 Part 4: per-court slot length, multi-slot (duration) bookings priced across the whole range, the
database-level overlap guarantee (btree_gist exclusion constraint), and what the availability grid shows.

The overlap tests are the ones the owner asked for by name: a 90-minute booking vs a 60-minute booking that
overlap by 30 minutes, back-to-back bookings (6-7 PM and 7-8 PM must NOT clash), the same across midnight, and
the 50-concurrent-request race (the original one lives in test_concurrency.py and must still pass)."""
import asyncio
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


async def _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, *, slot_minutes=60,
                 open_=time(6, 0), close=time(23, 0), price=1000):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=slot_minutes)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=open_, close_time=close)
    if price:
        await make_pricing_rule(court, price_per_slot=price)
    return owner, venue, court


def _at(day_offset: int, hh: int, mm: int = 0) -> datetime:
    return pkt_time_to_utc(pkt_today() + timedelta(days=day_offset), time(hh, mm))


async def _hold(client, court, headers, starts, slot_count=1):
    return await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _iso(starts), "slot_count": slot_count},
    )


def _raw_booking(court, starts, ends, status=BookingStatus.BOOKED) -> Booking:
    return Booking(
        court_id=court.id, starts_at=starts, ends_at=ends, status=status, source=BookingSource.WALKIN,
        player_name="Walk-in", price=1000, advance_amount=0, balance_due=1000,
    )


# ---- multi-slot holds, priced across the whole range ------------------------------------------------------

async def test_a_two_hour_booking_is_one_booking_priced_slot_by_slot(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000001")
    player = await make_user("+923070000002", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    starts = _at(2, 19)

    resp = await _hold(client, court, headers, starts, slot_count=2)
    assert resp.status_code == 201, resp.text
    booking = resp.json()["booking"]
    assert booking["starts_at"] == _iso(starts) and booking["ends_at"] == _iso(starts + timedelta(hours=2))
    assert booking["price"] == 2000.0

    # the slot grid now shows BOTH cells as this player's, and neither claims the whole 2000
    day = pkt_today() + timedelta(days=2)
    grid = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()}, headers=headers)).json()
    cells = [s for s in grid["slots"] if s["starts_at"] in (_iso(starts), _iso(starts + timedelta(hours=1)))]
    assert [c["status"] for c in cells] == ["held", "held"]
    assert all(c["is_mine"] for c in cells)
    assert [c["price"] for c in cells] == [1000.0, 1000.0]


async def test_price_follows_each_slots_own_rule_across_a_peak_boundary(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """17:00-18:00 is off-peak (1000), 18:00-19:00 is peak (1500): a 2-hour booking from 17:00 costs 2500,
    not 2000 (first slot's rate) and not 3000."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000003", price=1000)
    await make_pricing_rule(court, name="Peak", priority=5, start_time=time(18, 0), end_time=time(23, 0), price_per_slot=1500)
    player = await make_user("+923070000004", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    quote = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(2, 17)), "slot_count": 2})
    assert quote.status_code == 200, quote.text
    assert quote.json()["price"] == 2500.0 and quote.json()["duration_minutes"] == 120

    hold = await _hold(client, court, headers, _at(2, 17), slot_count=2)
    assert hold.status_code == 201
    # the quote the app showed is exactly what is charged
    assert hold.json()["booking"]["price"] == quote.json()["price"]
    assert hold.json()["booking"]["advance_amount"] == quote.json()["advance_amount"]


async def test_a_duration_that_runs_past_closing_time_is_refused(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000005")
    player = await make_user("+923070000006", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    # court closes 11 PM; the last 60-min slot starts 10 PM, so 10 PM x2 would end at midnight
    resp = await _hold(client, court, headers, _at(2, 22), slot_count=2)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_DURATION"
    assert "closing" in resp.json()["error"]["message"].lower()
    # one slot at 10 PM is fine
    assert (await _hold(client, court, headers, _at(2, 22), slot_count=1)).status_code == 201


async def test_a_duration_over_six_hours_is_refused(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """post-batch #8: the cap is 6 hours now. Exactly 6 hours (six 60-min slots) is allowed; 7 hours is refused."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000007")
    player = await make_user("+923070000008", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    # 8 AM x 7 = 8 AM-3 PM, all within the 6 AM-11 PM hours but 420 min > the 360-min cap
    too_long = await _hold(client, court, headers, _at(2, 8), slot_count=7)
    assert too_long.status_code == 400 and too_long.json()["error"]["code"] == "INVALID_DURATION"
    assert "6 hours" in too_long.json()["error"]["message"]
    # exactly 6 hours (six slots, 8 AM-2 PM) is now allowed
    ok = await _hold(client, court, headers, _at(2, 8), slot_count=6)
    assert ok.status_code == 201, ok.text
    assert ok.json()["booking"]["ends_at"] == _iso(_at(2, 8) + timedelta(hours=6))


async def test_a_six_hour_booking_blocks_every_slot_it_covers(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """post-batch #8: a 6-hour booking is one row spanning six slots; the overlap constraint must block any other
    live booking that touches any of those six, and the grid must show all six as the player's own."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000021")
    a = await make_user("+923070000022", role=UserRole.PLAYER)
    b = await make_user("+923070000023", role=UserRole.PLAYER)
    ha, hb = await make_auth_headers(a), await make_auth_headers(b)

    held = await _hold(client, court, ha, _at(2, 8), slot_count=6)  # A holds 8 AM-2 PM
    assert held.status_code == 201, held.text

    # every hour inside the 6-hour span is taken for anyone else, incl. the first, a middle one, and the last
    for hh in (8, 11, 13):
        clash = await _hold(client, court, hb, _at(2, hh), slot_count=1)
        assert clash.status_code == 409 and clash.json()["error"]["code"] == "SLOT_ALREADY_TAKEN", (hh, clash.text)
    # a booking that starts before and runs into the span is refused too
    overlap = await _hold(client, court, hb, _at(2, 7), slot_count=2)  # 7-9 AM runs into 8 AM
    assert overlap.status_code == 409 and overlap.json()["error"]["code"] == "SLOT_ALREADY_TAKEN"
    # the slot right after the span (2 PM) is still free
    assert (await _hold(client, court, hb, _at(2, 14), slot_count=1)).status_code == 201

    # the grid shows all six covered cells as A's own held slots
    day = pkt_today() + timedelta(days=2)
    grid = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()}, headers=ha)).json()
    covered = {_iso(_at(2, 8) + timedelta(hours=i)) for i in range(6)}
    cells = [s for s in grid["slots"] if s["starts_at"] in covered]
    assert len(cells) == 6
    assert all(c["status"] == "held" and c["is_mine"] for c in cells)


async def test_a_six_hour_booking_that_runs_past_closing_time_is_refused(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """post-batch #8: the longer cap must not let a booking spill past closing time (or across midnight on a
    same-day court -- overnight belongs to Part 3). Court closes 11 PM; 6 PM + 6 h would end at midnight."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000024")
    player = await make_user("+923070000025", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    resp = await _hold(client, court, headers, _at(2, 18), slot_count=6)  # 6 PM-12 AM, past the 11 PM close
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_DURATION"
    assert "closing" in resp.json()["error"]["message"].lower()


async def test_a_duration_touching_a_booked_or_blocked_slot_is_refused_with_a_clear_reason(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from app.models.blackout import Blackout

    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000009")
    a = await make_user("+923070000010", role=UserRole.PLAYER)
    b = await make_user("+923070000011", role=UserRole.PLAYER)
    ha, hb = await make_auth_headers(a), await make_auth_headers(b)
    assert (await _hold(client, court, ha, _at(2, 20))).status_code == 201  # A holds 8-9 PM

    over = await _hold(client, court, hb, _at(2, 19), slot_count=2)  # B wants 7-9 PM
    assert over.status_code == 409 and over.json()["error"]["code"] == "SLOT_ALREADY_TAKEN"

    async with db_session_factory() as s:
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(3, 12), ends_at=_at(3, 14), reason="maintenance"))
        await s.commit()
    blocked = await _hold(client, court, hb, _at(3, 11), slot_count=2)  # 11 AM-1 PM runs into the 12-2 blackout
    assert blocked.status_code == 400 and blocked.json()["error"]["code"] == "SLOT_BLOCKED"


# ---- the database guarantee: no two live bookings on a court may overlap -----------------------------------

async def test_a_90_minute_booking_and_a_60_minute_booking_overlapping_by_30_minutes_cannot_both_exist(
    db_session_factory, make_user, make_venue, make_court
):
    owner = await make_user("+923070000020", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner), slot_minutes=30)
    start = _at(3, 18)  # 18:00-19:30 (90 min) vs 19:00-20:00 (60 min): overlap 19:00-19:30
    async with db_session_factory() as s:
        s.add(_raw_booking(court, start, start + timedelta(minutes=90)))
        await s.commit()
    async with db_session_factory() as s:
        s.add(_raw_booking(court, start + timedelta(minutes=60), start + timedelta(minutes=120)))
        with pytest.raises(IntegrityError) as err:
            await s.commit()
        # not the old per-start-time index (their start times differ): the new overlap constraint refused it
        assert "no_overlapping_live_bookings" in str(err.value.orig)


async def test_back_to_back_bookings_do_not_clash(db_session_factory, make_user, make_venue, make_court):
    """[6 PM, 7 PM) and [7 PM, 8 PM) share only the instant 7 PM: the half-open range means no clash."""
    owner = await make_user("+923070000021", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner))
    six = _at(3, 18)
    async with db_session_factory() as s:
        s.add(_raw_booking(court, six, six + timedelta(hours=1)))
        s.add(_raw_booking(court, six + timedelta(hours=1), six + timedelta(hours=2)))
        s.add(_raw_booking(court, six + timedelta(hours=2), six + timedelta(hours=3)))
        await s.commit()
    async with db_session_factory() as s:
        rows = (await s.execute(select(Booking).where(Booking.court_id == court.id))).scalars().all()
        assert len(rows) == 3


async def test_back_to_back_bookings_across_midnight_do_not_clash_but_an_overlap_does(
    db_session_factory, make_user, make_venue, make_court
):
    """11 PM-midnight and midnight-1 AM Pakistan time (two different calendar days, and 18:00-19:00 UTC on
    the same UTC day) sit side by side; a 11:30 PM-12:30 AM booking would straddle both and must be refused."""
    owner = await make_user("+923070000022", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner))
    eleven = _at(3, 23)
    async with db_session_factory() as s:
        s.add(_raw_booking(court, eleven, eleven + timedelta(hours=1)))
        s.add(_raw_booking(court, eleven + timedelta(hours=1), eleven + timedelta(hours=2)))
        await s.commit()
    async with db_session_factory() as s:
        s.add(_raw_booking(court, eleven + timedelta(minutes=30), eleven + timedelta(minutes=90)))
        with pytest.raises(IntegrityError) as err:
            await s.commit()
        assert "no_overlapping_live_bookings" in str(err.value.orig)


async def test_only_live_bookings_count_and_other_courts_are_independent(
    db_session_factory, make_user, make_venue, make_court
):
    owner = await make_user("+923070000023", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court_a, court_b = await make_court(venue, name="A"), await make_court(venue, name="B")
    start = _at(3, 18)
    async with db_session_factory() as s:
        s.add(_raw_booking(court_a, start, start + timedelta(hours=1), status=BookingStatus.CANCELLED))
        s.add(_raw_booking(court_a, start, start + timedelta(hours=1), status=BookingStatus.BOOKED))  # cancelled one is ignored
        s.add(_raw_booking(court_b, start, start + timedelta(hours=1), status=BookingStatus.BOOKED))  # other court is fine
        s.add(_raw_booking(court_a, start, start + timedelta(hours=1), status=BookingStatus.COMPLETED))  # not live
        await s.commit()
    for live in (BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED, BookingStatus.BOOKED):
        async with db_session_factory() as s:
            s.add(_raw_booking(court_a, start + timedelta(minutes=15), start + timedelta(minutes=45), status=live))
            with pytest.raises(IntegrityError):
                await s.commit()  # every live status is covered, exactly like the old unique index


async def test_the_service_maps_the_overlap_constraint_to_slot_already_taken(
    db_session_factory, make_user, make_venue, make_court
):
    """Bypasses the friendly pre-check (as a lost race would) and goes straight to the insert: the caller must
    get the same 409 SLOT_ALREADY_TAKEN as before, not a raw 500."""
    from app.config import get_settings
    from app.errors import AppError
    from app.services.booking_service import BookingService

    owner = await make_user("+923070000024", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner), slot_minutes=30)
    start = _at(3, 18)
    async with db_session_factory() as s:
        s.add(_raw_booking(court, start, start + timedelta(minutes=90)))
        await s.commit()
    async with db_session_factory() as s:
        with pytest.raises(AppError) as err:
            await BookingService(s, get_settings())._insert_booking(
                _raw_booking(court, start + timedelta(minutes=60), start + timedelta(minutes=120))
            )
    assert err.value.status_code == 409 and err.value.code == "SLOT_ALREADY_TAKEN"


async def test_fifty_concurrent_overlapping_bookings_of_different_lengths_only_one_wins(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """25 players ask for 6:00-7:30 PM (3 slots) and 25 ask for 7:00-8:00 PM (2 slots) on a 30-minute court:
    all 50 overlap each other (none has the same start as the other group, and only same-group starts match),
    so exactly one may succeed -- which the old start-time index alone could not guarantee."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000030", slot_minutes=30)
    customers = [await make_user(f"+92307003{n:04d}", role=UserRole.PLAYER) for n in range(50)]
    header_sets = [await make_auth_headers(c) for c in customers]
    six, seven = _at(2, 18), _at(2, 19)

    async def attempt(i: int) -> int:
        starts, count = (six, 3) if i % 2 == 0 else (seven, 2)
        return (await _hold(client, court, header_sets[i], starts, slot_count=count)).status_code

    results = await asyncio.gather(*(attempt(i) for i in range(50)))
    assert results.count(201) == 1, results
    assert results.count(409) == 49, results


# ---- slot length per court: allowed values, and changing it later ------------------------------------------

@pytest.mark.parametrize("minutes,ok", [(30, True), (60, True), (90, True), (120, True), (45, False), (15, False), (180, False)])
async def test_only_30_60_90_120_minute_slots_can_be_chosen(
    client, make_user, make_venue, make_auth_headers, minutes, ok
):
    owner = await make_user(f"+92307004{minutes:04d}", role=UserRole.OWNER)
    venue = await make_venue(owner)
    headers = await make_auth_headers(owner)
    resp = await client.post(
        f"/api/v1/venues/{venue.id}/courts", headers=headers, json={"name": "C", "sport": "padel", "slot_minutes": minutes}
    )
    assert (resp.status_code == 201) is ok, resp.text
    if ok:
        court_id = resp.json()["court"]["id"]
        patch = await client.patch(f"/api/v1/courts/{court_id}", headers=headers, json={"slot_minutes": 60})
        assert patch.status_code == 200
    else:
        assert resp.status_code == 422


async def test_changing_slot_length_later_never_moves_an_existing_booking(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """A 90-minute booking (6:00-7:30 PM) exists, then the owner switches the court to 60-minute slots. The
    booking keeps its own times; the new 7:00 PM cell overlaps it so it shows booked and cannot be booked; the
    next free cell (7:30 PM does not exist on the hourly grid, 8:00 PM does) is bookable."""
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000050", slot_minutes=90, open_=time(6, 0), close=time(23, 30))
    player = await make_user("+923070000051", role=UserRole.PLAYER)
    other = await make_user("+923070000052", role=UserRole.PLAYER)
    hp, ho, hown = await make_auth_headers(player), await make_auth_headers(other), await make_auth_headers(owner)
    six = _at(2, 18)  # 6:00 PM is on the 6:00/7:30 grid of a 90-minute court opening at 6 AM
    booking = (await _hold(client, court, hp, six)).json()["booking"]
    assert booking["ends_at"] == _iso(six + timedelta(minutes=90))

    patch = await client.patch(f"/api/v1/courts/{court.id}", headers=hown, json={"slot_minutes": 60})
    assert patch.status_code == 200 and patch.json()["slot_minutes"] == 60

    async with db_session_factory() as s:
        kept = await s.get(Booking, booking["id"])
        assert kept.starts_at == six and kept.ends_at == six + timedelta(minutes=90)  # untouched

    day = pkt_today() + timedelta(days=2)
    grid = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()}, headers=ho)).json()
    by_start = {s["starts_at"]: s for s in grid["slots"]}
    assert by_start[_iso(six)]["status"] == "held"
    assert by_start[_iso(six + timedelta(hours=1))]["status"] == "held"  # 7-8 PM cell overlaps the old 6-7:30 booking
    assert by_start[_iso(six + timedelta(hours=2))]["status"] == "available"
    clash = await _hold(client, court, ho, six + timedelta(hours=1))
    assert clash.status_code == 409


# ---- what the grid shows ---------------------------------------------------------------------------------

async def test_a_6am_to_11pm_court_shows_exactly_those_slots_and_nothing_else(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000060")
    day = pkt_today() + timedelta(days=2)
    grid = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()
    starts = [s["starts_at"] for s in grid["slots"]]
    assert len(starts) == 17  # 6 AM ... 10 PM starts, the last one ends at 11 PM
    assert starts[0] == _iso(_at(2, 6)) and starts[-1] == _iso(_at(2, 22))
    assert all(_at(2, 6) <= datetime.fromisoformat(s.replace("Z", "+00:00")) <= _at(2, 22) for s in starts)
    assert {s["status"] for s in grid["slots"]} == {"available"}


async def test_a_blackout_is_reported_as_blocked_with_its_reason(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    from app.models.blackout import Blackout

    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923070000061")
    async with db_session_factory() as s:
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(2, 10), ends_at=_at(2, 12), reason="maintenance"))
        await s.commit()
    day = pkt_today() + timedelta(days=2)
    grid = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()
    by = {s["starts_at"]: s for s in grid["slots"]}
    assert by[_iso(_at(2, 10))]["status"] == "blocked" and by[_iso(_at(2, 10))]["reason"] == "maintenance"
    assert by[_iso(_at(2, 11))]["status"] == "blocked"
    assert by[_iso(_at(2, 12))]["status"] == "available"
