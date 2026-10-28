"""TRANSITION: delete this file together with app/services/slot_compat.py once the new EAS build is out everywhere.

An app build from BEFORE Section 32 Part 4c (the fixed 30-minute grid) sends `slot_count` in the OLD unit (1 slot = the court's
own slot length) and reads the old response shapes. A request WITHOUT the `X-Slot-Grid: 30` header is LEGACY and must behave as
it did before; the same request WITH the header is the new 30-minute behaviour.

The assertions below are the OLD ones, taken from the pre-change tests (commit e0da708: test_slots_duration_overlap.py,
test_availability.py, test_month_summary.py, test_bookings.py walk-in) and run through `legacy_client` (no header). Several
tests then repeat the same request with the header (`client`) to show the unit really switches on the header alone."""
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select

from app.models.blackout import Blackout
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _at(day_offset: int, hh: int, mm: int = 0) -> datetime:
    return pkt_time_to_utc(pkt_today() + timedelta(days=day_offset), time(hh, mm))


async def _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, *, slot_minutes=60,
                 open_=time(6, 0), close=time(23, 0), price=1000):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=slot_minutes)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=open_, close_time=close)
    await make_pricing_rule(court, price_per_slot=price)
    return owner, venue, court


async def _hold(c, court, headers, starts, slot_count=None, **extra):
    body = {"court_id": str(court.id), "starts_at": _iso(starts), **extra}
    if slot_count is not None:
        body["slot_count"] = slot_count
    return await c.post("/api/v1/bookings/hold", headers=headers, json=body)


async def _grid(c, court, day_offset, headers=None):
    day = pkt_today() + timedelta(days=day_offset)
    resp = await c.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()}, headers=headers or {})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _raw_booking(db_session_factory, court, starts, minutes=60, status=BookingStatus.BOOKED, player_id=None):
    async with db_session_factory() as s:
        s.add(Booking(court_id=court.id, starts_at=starts, ends_at=starts + timedelta(minutes=minutes), status=status,
                      source=BookingSource.WALKIN, player_name="x", player_id=player_id, price=1000, advance_amount=0,
                      balance_due=1000))
        await s.commit()


# ---- the unit switches on the header alone (exact numbers: 60-minute court at PKR 1000/hour) ------------------------

async def test_legacy_hold_counts_in_court_slots_and_the_header_switches_to_30_minute_slots(
    client, legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000001")
    player = await make_user("+923190000002", role=UserRole.PLAYER)
    h = await make_auth_headers(player)

    one = await _hold(legacy_client, court, h, _at(2, 10), slot_count=1)  # old: ONE slot = 60 minutes
    assert one.status_code == 201, one.text
    b = one.json()["booking"]
    assert b["starts_at"] == _iso(_at(2, 10)) and b["ends_at"] == _iso(_at(2, 11)) and b["price"] == 1000.0
    assert b["advance_amount"] == 1000.0

    two = await _hold(legacy_client, court, h, _at(2, 12), slot_count=2)  # old: TWO slots = 120 minutes
    assert two.status_code == 201, two.text
    b = two.json()["booking"]
    assert b["ends_at"] == _iso(_at(2, 14)) and b["price"] == 2000.0

    default = await _hold(legacy_client, court, h, _at(2, 15))  # old default slot_count = 1
    assert default.status_code == 201 and default.json()["booking"]["ends_at"] == _iso(_at(2, 16))
    assert default.json()["booking"]["price"] == 1000.0

    # the SAME request with X-Slot-Grid: 30 counts 30-minute slots: slot_count=2 is 60 minutes
    new_two = await _hold(client, court, h, _at(2, 17), slot_count=2)
    assert new_two.status_code == 201, new_two.text
    assert new_two.json()["booking"]["ends_at"] == _iso(_at(2, 18)) and new_two.json()["booking"]["price"] == 1000.0
    # ...and slot_count=1 is below this court's 60-minute minimum
    below = await _hold(client, court, h, _at(2, 19), slot_count=1)
    assert below.status_code == 400 and below.json()["error"]["code"] == "BELOW_MINIMUM_BOOKING_TIME"
    # a header with any other value is NOT the new client: still legacy
    odd = await _hold(client, court, {**h, "X-Slot-Grid": "60"}, _at(2, 19), slot_count=1)
    assert odd.status_code == 201 and odd.json()["booking"]["ends_at"] == _iso(_at(2, 20))


async def test_old_test_two_hour_booking_grid_shows_both_hourly_cells_as_the_players_own(
    legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """OLD assertions of test_a_two_hour_booking_is_one_booking_priced_slot_by_slot (e0da708)."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000003")
    player = await make_user("+923190000004", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    starts = _at(2, 19)
    resp = await _hold(legacy_client, court, headers, starts, slot_count=2)
    assert resp.status_code == 201, resp.text
    booking = resp.json()["booking"]
    assert booking["starts_at"] == _iso(starts) and booking["ends_at"] == _iso(starts + timedelta(hours=2))
    assert booking["price"] == 2000.0

    grid = await _grid(legacy_client, court, 2, headers)
    cells = [s for s in grid["slots"] if s["starts_at"] in (_iso(starts), _iso(starts + timedelta(hours=1)))]
    assert [c["status"] for c in cells] == ["held", "held"]
    assert all(c["is_mine"] for c in cells)
    assert [c["price"] for c in cells] == [1000.0, 1000.0]
    # an anonymous viewer sees them held but not theirs
    anon = await _grid(legacy_client, court, 2)
    assert [s["is_mine"] for s in anon["slots"] if s["status"] == "held"] == [False, False]


async def test_old_peak_boundary_quote_and_hold_agree_and_match_the_old_numbers(
    client, legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """OLD assertions of test_price_follows_each_slots_own_rule_across_a_peak_boundary: 17:00-18:00 off-peak 1000,
    18:00-19:00 peak 1500, a legacy 2-slot booking from 17:00 = 2500 (quote == hold)."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000005")
    await make_pricing_rule(court, name="Peak", priority=5, start_time=time(18, 0), end_time=time(23, 0), price_per_slot=1500)
    player = await make_user("+923190000006", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    quote = await legacy_client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(2, 17)), "slot_count": 2})
    assert quote.status_code == 200, quote.text
    q = quote.json()
    assert q["price"] == 2500.0 and q["duration_minutes"] == 120
    # old response shape: slot_count in court slots, slot_minutes = the court's own slot length
    assert q["slot_count"] == 2 and q["slot_minutes"] == 60 and q["balance_due"] == 0.0

    hold = await _hold(legacy_client, court, headers, _at(2, 17), slot_count=2)
    assert hold.status_code == 201
    assert hold.json()["booking"]["price"] == q["price"] and hold.json()["booking"]["advance_amount"] == q["advance_amount"]

    # the new client asks for the same 2 hours with slot_count=4 and gets the same money and the new shape
    new_q = (await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(3, 17)), "slot_count": 4})).json()
    assert new_q["price"] == 2500.0 and new_q["slot_count"] == 4 and new_q["slot_minutes"] == 30


async def test_legacy_peak_window_that_straddles_an_old_slot_is_priced_by_the_old_whole_window_rule(
    client, legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """Old behaviour: a slot was priced by the ONE rule that contained its WHOLE window. A court opening 5:30 PM has hourly
    slots 5:30-6:30, 6:30-7:30...; peak (1500) starts at 6:00 PM, so the 5:30-6:30 slot is not wholly inside peak and costs the
    base 1000, and 6:30-7:30 is wholly peak = 1500. The new 30-minute pricing would split 5:30-6:30 into 500 + 750; a legacy caller
    must still get exactly the old numbers, in the listing, the quote and the hold."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000007",
                                 open_=time(17, 30), close=time(23, 30))
    await make_pricing_rule(court, name="Peak", priority=5, start_time=time(18, 0), end_time=time(23, 30), price_per_slot=1500)
    player = await make_user("+923190000008", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    grid = await _grid(legacy_client, court, 2)
    by_start = {s["starts_at"]: s for s in grid["slots"]}
    assert by_start[_iso(_at(2, 17, 30))]["price"] == 1000.0  # old: not wholly inside peak
    assert by_start[_iso(_at(2, 18, 30))]["price"] == 1500.0
    assert grid["slot_minutes"] == 60 and len(grid["slots"]) == 6

    q = (await legacy_client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(2, 17, 30)), "slot_count": 2})).json()
    assert q["price"] == 2500.0  # 1000 + 1500, the old total
    hold = await _hold(legacy_client, court, headers, _at(2, 17, 30), slot_count=2)
    assert hold.status_code == 201 and hold.json()["booking"]["price"] == 2500.0

    # new clients are priced half-hour by half-hour: 17:30 (500) + 18:00 (750) + 18:30 (750) + 19:00 (750) = 2750 for 2 hours
    new = (await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(3, 17, 30)), "slot_count": 4})).json()
    assert new["price"] == 2750.0


# ---- availability listing ----------------------------------------------------------------------------------------

async def test_legacy_listing_is_hourly_with_old_starts_prices_and_shape(
    legacy_client, client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """OLD assertions of test_basic_slot_generation (17 one-hour slots 06:00-23:00, slot_minutes 60)."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000009", price=3000)
    legacy = await _grid(legacy_client, court, 2)
    assert legacy["slot_minutes"] == 60 and len(legacy["slots"]) == 17
    assert all(s["status"] == "available" and s["price"] == 3000.0 and s["advance_amount"] == 3000.0 for s in legacy["slots"])
    for i, s in enumerate(legacy["slots"]):
        assert s["starts_at"] == _iso(_at(2, 6 + i)) and s["ends_at"] == _iso(_at(2, 7 + i))
    # the new client sees the 30-minute grid for the very same court and day
    new = await _grid(client, court, 2)
    assert new["slot_minutes"] == 30 and len(new["slots"]) == 34 and new["slots"][0]["price"] == 1500.0


async def test_a_booked_half_hour_makes_its_whole_legacy_hour_unavailable(
    legacy_client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000010")
    player = await make_user("+923190000011", role=UserRole.PLAYER)
    await _raw_booking(db_session_factory, court, _at(2, 19, 30), minutes=30, player_id=player.id)  # 7:30-8:00 PM
    grid = await _grid(legacy_client, court, 2, await make_auth_headers(player))
    by_start = {s["starts_at"]: s for s in grid["slots"]}
    assert by_start[_iso(_at(2, 18))]["status"] == "available"
    seven = by_start[_iso(_at(2, 19))]  # 7:00-8:00 contains the booked half hour
    assert seven["status"] == "booked" and seven["is_mine"] is True and seven["booking_id"] is not None
    assert by_start[_iso(_at(2, 20))]["status"] == "available"
    # a booking that is not the whole slot does not claim its price: the slot shows the rule's price
    assert seven["price"] == 1000.0

    # a booking straddling two hours (7:30-8:30) takes both
    await _raw_booking(db_session_factory, court, _at(2, 21, 30), minutes=60)
    grid = await _grid(legacy_client, court, 2)
    by_start = {s["starts_at"]: s for s in grid["slots"]}
    assert by_start[_iso(_at(2, 21))]["status"] == "booked" and by_start[_iso(_at(2, 22))]["status"] == "booked"
    assert by_start[_iso(_at(2, 20))]["status"] == "available"


async def test_legacy_blocked_hour_carries_its_reason_and_a_whole_booking_shows_its_own_price(
    legacy_client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000012")
    async with db_session_factory() as s:
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(2, 12, 30), ends_at=_at(2, 13), reason="rain"))
        await s.commit()
    await _raw_booking(db_session_factory, court, _at(2, 15), minutes=60)  # exactly one legacy slot: shows the booking's price (1000)
    by_start = {s["starts_at"]: s for s in (await _grid(legacy_client, court, 2))["slots"]}
    assert by_start[_iso(_at(2, 12))]["status"] == "blocked" and by_start[_iso(_at(2, 12))]["reason"] == "rain"
    assert by_start[_iso(_at(2, 15))]["status"] == "booked" and by_start[_iso(_at(2, 15))]["price"] == 1000.0


async def test_legacy_90_minute_court_old_starts_price_and_hold(
    legacy_client, client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """OLD assertions of test_ninety_minute_slots: schedule 06:00-22:30 PKT -> 11 slots starting 01:00, 02:30, 04:00 ... UTC;
    legacy slot_count=1 is one 90-minute slot at the court price, exactly (PKR 4000, not 3999.99)."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000013",
                                 slot_minutes=90, open_=time(6, 0), close=time(22, 30), price=4000)
    body = await _grid(legacy_client, court, 2)
    assert body["slot_minutes"] == 90 and len(body["slots"]) == 11
    expected = ["01:00", "02:30", "04:00", "05:30", "07:00", "08:30", "10:00", "11:30", "13:00", "14:30", "16:00"]
    for slot, exp in zip(body["slots"], expected):
        assert slot["starts_at"][11:16] == exp
        assert (datetime.fromisoformat(slot["ends_at"]) - datetime.fromisoformat(slot["starts_at"])).total_seconds() == 90 * 60
        assert slot["price"] == 4000.0 and slot["advance_amount"] == 4000.0

    player = await make_user("+923190000014", role=UserRole.PLAYER)
    h = await make_auth_headers(player)
    one = await _hold(legacy_client, court, h, _at(2, 6), slot_count=1)
    assert one.status_code == 201, one.text
    assert one.json()["booking"]["ends_at"] == _iso(_at(2, 7, 30)) and one.json()["booking"]["price"] == 4000.0
    two = await _hold(legacy_client, court, h, _at(2, 7, 30), slot_count=2)  # 7:30-10:30 = two 90-minute slots
    assert two.status_code == 201 and two.json()["booking"]["ends_at"] == _iso(_at(2, 10, 30))
    assert two.json()["booking"]["price"] == 8000.0
    q = (await legacy_client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(3, 6)), "slot_count": 1})).json()
    assert (q["slot_count"], q["slot_minutes"], q["duration_minutes"], q["price"]) == (1, 90, 90, 4000.0)
    # new client: slot_count counts 30-minute slots, 3 = 90 minutes
    nq = (await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(3, 6)), "slot_count": 3})).json()
    assert (nq["slot_count"], nq["slot_minutes"], nq["price"]) == (3, 30, 4000.0)


async def test_legacy_30_minute_court_is_unchanged(
    legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000015",
                                 slot_minutes=30, price=500)
    body = await _grid(legacy_client, court, 2)
    assert body["slot_minutes"] == 30 and len(body["slots"]) == 34 and body["slots"][0]["price"] == 500.0
    player = await make_user("+923190000016", role=UserRole.PLAYER)
    h = await make_auth_headers(player)
    one = await _hold(legacy_client, court, h, _at(2, 9), slot_count=1)
    assert one.status_code == 201 and one.json()["booking"]["ends_at"] == _iso(_at(2, 9, 30)) and one.json()["booking"]["price"] == 500.0
    three = await _hold(legacy_client, court, h, _at(2, 10), slot_count=3)
    assert three.status_code == 201 and three.json()["booking"]["ends_at"] == _iso(_at(2, 11, 30))
    assert three.json()["booking"]["price"] == 1500.0


async def test_legacy_range_and_venue_endpoints_are_hourly_too(
    legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, venue, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000017")
    start = pkt_today() + timedelta(days=1)
    rng = (await legacy_client.get(f"/api/v1/courts/{court.id}/availability",
                                   params={"start_date": start.isoformat(), "end_date": (start + timedelta(days=2)).isoformat()})).json()
    assert rng["slot_minutes"] == 60 and [len(d["slots"]) for d in rng["days"]] == [17, 17, 17]
    ven = (await legacy_client.get(f"/api/v1/venues/{venue.id}/availability", params={"date": start.isoformat()})).json()
    assert ven["courts"][0]["slot_minutes"] == 60 and len(ven["courts"][0]["slots"]) == 17


# ---- old hold validations, run with legacy units ---------------------------------------------------------------

async def test_old_test_closing_time_six_hour_cap_and_overlap_hold_through_legacy_units(
    legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """OLD assertions of the closing / six-hour / overlap tests (e0da708), same slot_count numbers."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000018")
    a = await make_user("+923190000019", role=UserRole.PLAYER)
    b = await make_user("+923190000020", role=UserRole.PLAYER)
    ha, hb = await make_auth_headers(a), await make_auth_headers(b)

    past_close = await _hold(legacy_client, court, ha, _at(2, 22), slot_count=2)  # 10 PM x2 ends at midnight, close is 11 PM
    assert past_close.status_code == 400 and past_close.json()["error"]["code"] == "INVALID_DURATION"
    assert "closing" in past_close.json()["error"]["message"].lower()
    assert (await _hold(legacy_client, court, ha, _at(2, 22), slot_count=1)).status_code == 201

    too_long = await _hold(legacy_client, court, ha, _at(2, 8), slot_count=7)
    assert too_long.status_code == 400 and too_long.json()["error"]["code"] == "INVALID_DURATION"
    assert "6 hours" in too_long.json()["error"]["message"]
    ok = await _hold(legacy_client, court, ha, _at(2, 8), slot_count=6)
    assert ok.status_code == 201 and ok.json()["booking"]["ends_at"] == _iso(_at(2, 14))

    for hh in (8, 11, 13):
        clash = await _hold(legacy_client, court, hb, _at(2, hh), slot_count=1)
        assert clash.status_code == 409 and clash.json()["error"]["code"] == "SLOT_ALREADY_TAKEN", (hh, clash.text)
    overlap = await _hold(legacy_client, court, hb, _at(2, 7), slot_count=2)
    assert overlap.status_code == 409
    assert (await _hold(legacy_client, court, hb, _at(2, 14), slot_count=1)).status_code == 201


# ---- walk-in -----------------------------------------------------------------------------------------------------

async def test_legacy_walkin_is_one_court_slot_by_default_and_counts_court_slots(
    legacy_client, client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """OLD behaviour: a walk-in (no slot_count field) was exactly ONE court slot (60 minutes on this court) priced by the rule."""
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000021")
    oh = await make_auth_headers(owner)
    base = {"court_id": str(court.id), "player_phone": "+923009990001", "player_name": "Walk Guest", "amount_paid": 300}
    plain = await legacy_client.post("/api/v1/bookings/walkin", headers=oh, json={**base, "starts_at": _iso(_at(2, 10))})
    assert plain.status_code == 201, plain.text
    b = plain.json()["booking"]
    assert b["ends_at"] == _iso(_at(2, 11)) and b["price"] == 1000.0 and b["amount_paid"] == 300.0 and b["source"] == "walkin"
    two = await legacy_client.post("/api/v1/bookings/walkin", headers=oh, json={**base, "starts_at": _iso(_at(2, 12)), "slot_count": 2})
    assert two.status_code == 201 and two.json()["booking"]["ends_at"] == _iso(_at(2, 14)) and two.json()["booking"]["price"] == 2000.0
    # same field with the header = 30-minute slots: 2 is one hour
    new = await client.post("/api/v1/bookings/walkin", headers=oh, json={**base, "starts_at": _iso(_at(2, 16)), "slot_count": 2})
    assert new.status_code == 201 and new.json()["booking"]["ends_at"] == _iso(_at(2, 17))
    # a legacy walk-in on the 90-minute court is one 90-minute slot
    owner2, _v2, court90 = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000022",
                                        slot_minutes=90, price=4000)
    oh2 = await make_auth_headers(owner2)
    r90 = await legacy_client.post("/api/v1/bookings/walkin", headers=oh2,
                                   json={"court_id": str(court90.id), "starts_at": _iso(_at(2, 9)), "player_phone": "+923009990001", "player_name": "Walk Guest", "amount_paid": 0})
    assert r90.status_code == 201 and r90.json()["booking"]["ends_at"] == _iso(_at(2, 10, 30)) and r90.json()["booking"]["price"] == 4000.0


# ---- month summary parity ---------------------------------------------------------------------------------------

async def test_legacy_month_summary_matches_the_old_test_numbers_and_varies_on_the_header(
    legacy_client, client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """OLD assertions of test_states_open_few_full_closed_past_and_the_cache_header: 8-18 = 10 one-hour slots a day."""
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000023",
                                    open_=time(8, 0), close=time(18, 0))
    today = pkt_today()
    first_next = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    d_open, d_few, d_full, d_closed, d_half = (first_next + timedelta(days=n) for n in (0, 1, 2, 3, 4))

    def at(d, hh, mm=0):
        return pkt_time_to_utc(d, time(hh, mm))

    for h in (8, 9):
        await _raw_booking(db_session_factory, court, at(d_open, h))
    for h in range(8, 16):
        await _raw_booking(db_session_factory, court, at(d_few, h))
    for h in range(8, 18):
        await _raw_booking(db_session_factory, court, at(d_full, h))
    async with db_session_factory() as s:
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=at(d_closed, 0), ends_at=at(d_closed, 0) + timedelta(hours=24), reason="private event"))
        await s.commit()
    await _raw_booking(db_session_factory, court, at(d_half, 10, 30), minutes=30)  # one booked half hour on d_half

    month = first_next.strftime("%Y-%m")
    resp = await legacy_client.get(f"/api/v1/courts/{court.id}/availability/summary", params={"month": month})
    assert resp.status_code == 200, resp.text
    assert resp.headers["cache-control"] == "public, max-age=30"
    assert "x-slot-grid" in resp.headers["vary"].lower()  # a shared cache must not serve one client's units to the other
    body = resp.json()
    assert body["slot_minutes"] == 60
    by = {r["date"]: r for r in body["days"]}
    assert by[d_open.isoformat()]["state"] == "open" and by[d_open.isoformat()]["open_slots"] == 8
    assert by[d_open.isoformat()]["total_slots"] == 10
    assert by[d_few.isoformat()]["state"] == "few" and by[d_few.isoformat()]["open_slots"] == 2
    assert by[d_full.isoformat()]["state"] == "full" and by[d_full.isoformat()]["open_slots"] == 0 and by[d_full.isoformat()]["total_slots"] == 10
    assert by[d_closed.isoformat()]["state"] == "closed"
    # a booked half hour spoils its whole hour: 9 of 10 old slots open
    assert by[d_half.isoformat()]["open_slots"] == 9 and by[d_half.isoformat()]["total_slots"] == 10
    assert body["starts_from_price"] == 1000.0

    # parity: every day's summary agrees with the legacy day view
    for row in body["days"]:
        if row["state"] in ("past", "beyond", "closed") or row["total_slots"] == 0:
            continue
        day = (await legacy_client.get(f"/api/v1/courts/{court.id}/availability", params={"date": row["date"]})).json()["slots"]
        now = datetime.now(timezone.utc)
        open_now = sum(1 for s in day if s["status"] == "available" and datetime.fromisoformat(s["starts_at"].replace("Z", "+00:00")) > now)
        assert row["total_slots"] == len(day) and row["open_slots"] == open_now, row

    # the new client gets the 30-minute numbers for the same month
    new = (await client.get(f"/api/v1/courts/{court.id}/availability/summary", params={"month": month})).json()
    assert new["slot_minutes"] == 30
    nby = {r["date"]: r for r in new["days"]}
    assert nby[d_open.isoformat()]["total_slots"] == 20 and nby[d_open.isoformat()]["open_slots"] == 15


# ---- the in-app assistant's confirm button ----------------------------------------------------------------------

def test_confirm_button_data_is_converted_to_old_court_slots_and_inexpressible_lengths_have_no_button():
    from app.models.court import Court
    from app.services.slot_compat import legacy_action_data

    c60, c90 = Court(slot_minutes=60), Court(slot_minutes=90)
    assert legacy_action_data(c60, {"court_id": "x", "slot_count": 2, "player_name": "Ali"}) == {"court_id": "x", "slot_count": 1, "player_name": "Ali"}
    assert legacy_action_data(c60, {"slot_count": 4})["slot_count"] == 2
    assert legacy_action_data(c60, {"slot_count": 3}) is None  # 90 minutes on a 60-minute court: an old build cannot ask for it
    assert legacy_action_data(c90, {"slot_count": 3})["slot_count"] == 1
    assert legacy_action_data(c90, {"slot_count": 6})["slot_count"] == 2
    assert legacy_action_data(None, {"slot_count": 2}) == {"slot_count": 2}


async def test_in_app_chat_confirm_button_round_trips_in_legacy_units(
    client, legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """An old build sends the Yes button's `slot_count` straight back to POST /bookings/hold WITHOUT the header, so the server
    must hand it the count in old units; a new build gets (and sends back) 30-minute slots. Either way: a 60-minute booking."""
    from app.services.ai_chat_service import AIChatService, ChatAction, ChatResult

    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000024")
    player = await make_user("+923190000025", role=UserRole.PLAYER)
    h = await make_auth_headers(player)
    state = {"count": 2}

    async def fake_process(self, **kwargs):
        data = {"court_id": str(court.id), "starts_at": _iso(_at(2, 18)), "slot_count": state["count"], "label": "x"}
        return ChatResult(reply="Shall I book it?", actions=[ChatAction("confirm_booking", "Yes, book it", data),
                                                             ChatAction("decline", "No, thanks", {})])

    monkeypatch.setattr(AIChatService, "process_message", fake_process)

    async def chat(c):
        r = await c.post("/api/v1/chat/message", headers=h, json={"message": "book 6pm"})
        assert r.status_code == 200, r.text
        return r.json()["actions"]

    legacy_actions = await chat(legacy_client)
    confirm = next(a for a in legacy_actions if a["type"] == "confirm_booking")
    assert confirm["data"]["slot_count"] == 1  # one 60-minute court slot, in the old unit
    hold = await legacy_client.post("/api/v1/bookings/hold", headers=h,
                                    json={"court_id": confirm["data"]["court_id"], "starts_at": confirm["data"]["starts_at"], "slot_count": confirm["data"]["slot_count"]})
    assert hold.status_code == 201 and hold.json()["booking"]["ends_at"] == _iso(_at(2, 19)) and hold.json()["booking"]["price"] == 1000.0

    new_actions = await chat(client)
    assert next(a for a in new_actions if a["type"] == "confirm_booking")["data"]["slot_count"] == 2

    state["count"] = 3  # 90 minutes on a 60-minute court: not expressible in old units
    assert await chat(legacy_client) == []  # no button rather than a wrong-length booking (typing "yes" still works)
    assert next(a for a in await chat(client) if a["type"] == "confirm_booking")["data"]["slot_count"] == 3


# ---- venue filter (courts_bookable_at) and CORS ---------------------------------------------------------------

async def test_venue_availability_filter_is_the_same_for_legacy_and_new_callers(
    client, legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, venue, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923190000026")
    day = (pkt_today() + timedelta(days=2)).isoformat()
    for c in (client, legacy_client):
        hit = await c.get("/api/v1/venues", params={"date": day, "start_time": "19:00"})
        assert hit.status_code == 200 and [v["id"] for v in hit.json()["venues"]] == [str(venue.id)]
        miss = await c.get("/api/v1/venues", params={"date": day, "start_time": "23:30"})  # nothing starts after closing
        assert miss.status_code == 200 and miss.json()["venues"] == []


async def test_cors_preflight_accepts_the_x_slot_grid_header(client):
    origin = "http://localhost:3000"
    resp = await client.options(
        "/api/v1/bookings/hold",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,x-slot-grid",
        },
    )
    assert resp.status_code == 200, resp.text
    allowed = resp.headers["access-control-allow-headers"].lower()
    assert "x-slot-grid" in allowed
    assert resp.headers["access-control-allow-origin"] in (origin, "*")
