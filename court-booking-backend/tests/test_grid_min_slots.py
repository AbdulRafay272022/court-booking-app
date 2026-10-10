"""Section 32 Part 4c: ONE fixed 30-minute slot grid for every court, with the court's own slot length (30/60/90/120) as
its MINIMUM BOOKING TIME (`min_slots` consecutive 30-minute slots), plus the owner's multi-slot walk-in and the walk-in
customer's identity.

How an existing 60-minute court behaves now (the decision under test):
  * the grid is 30-minute slots, a start time every 30 minutes;
  * a booking must be at least 2 consecutive slots (60 minutes), any longer multiple of 30 is fine (90, 120, ...);
  * pricing: `pricing_rules.price_per_slot` is still the price of the court's own unit (its slot_minutes), so a 30-minute
    slot is `price_per_slot * 30 / slot_minutes` and a 60-minute booking costs EXACTLY what a 60-minute slot always did;
    the advance (percent / fixed / minimum floor) scales the same way, so the advance of a minimum booking is unchanged;
  * "From PKR X" (starts_from_price) is the price of the minimum booking, unchanged.
Every amount below is an exact number worked out by hand, not read back from the code under test."""
from datetime import datetime, time, timedelta

import io

import pytest
from sqlalchemy import func, select

from app.models.blackout import Blackout
from app.models.booking import Booking, BookingStatus
from app.models.court import CourtAdvanceType
from app.models.user import User, UserRole
from app.services.availability_service import AvailabilityService, min_slots
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _at(day_offset: int, hh: int, mm: int = 0) -> datetime:
    return pkt_time_to_utc(pkt_today() + timedelta(days=day_offset), time(hh, mm))


async def _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, *, slot_minutes=60,
                 price=1000, open_=time(6, 0), close=time(23, 0), court_kwargs=None, rule_kwargs=None):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=slot_minutes, **(court_kwargs or {}))
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=open_, close_time=close)
    await make_pricing_rule(court, price_per_slot=price, **(rule_kwargs or {}))
    return owner, venue, court


async def _quote(client, court, starts, slot_count=None):
    params = {"starts_at": _iso(starts)}
    if slot_count is not None:
        params["slot_count"] = slot_count
    return await client.get(f"/api/v1/courts/{court.id}/quote", params=params)


# ---- the grid ------------------------------------------------------------------------------------------

@pytest.mark.parametrize("slot_minutes,expected_min_slots", [(30, 1), (60, 2), (90, 3), (120, 4)])
async def test_every_court_gets_the_same_30_minute_grid_and_its_slot_length_is_the_minimum(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, slot_minutes, expected_min_slots
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                 f"+92311{slot_minutes:07d}", slot_minutes=slot_minutes)
    assert min_slots(court) == expected_min_slots
    day = pkt_today() + timedelta(days=2)
    body = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()
    assert body["slot_minutes"] == 30
    assert body["min_booking_minutes"] == slot_minutes and body["min_slots"] == expected_min_slots
    assert len(body["slots"]) == 34  # 06:00-23:00
    starts = [datetime.fromisoformat(s["starts_at"].replace("Z", "+00:00")) for s in body["slots"]]
    assert all(b - a == timedelta(minutes=30) for a, b in zip(starts, starts[1:]))
    assert all(datetime.fromisoformat(s["ends_at"].replace("Z", "+00:00")) - st == timedelta(minutes=30)
               for s, st in zip(body["slots"], starts))


# ---- pricing: exact numbers ----------------------------------------------------------------------------

async def test_a_60_minute_booking_costs_exactly_what_a_60_minute_slot_always_did(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """Court priced PKR 1000 per 60-minute slot. Each 30-minute slot is 500. 60 min = 1000 (unchanged), 90 min = 1500,
    120 min = 2000, 150 min = 2500, and a start on the half hour costs the same."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000001")
    day = pkt_today() + timedelta(days=2)
    grid = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()
    assert {s["price"] for s in grid["slots"]} == {500.0}
    for start, count, total in ((_at(2, 18), 2, 1000.0), (_at(2, 18), 3, 1500.0), (_at(2, 18), 4, 2000.0),
                                (_at(2, 18, 30), 2, 1000.0), (_at(2, 18, 30), 5, 2500.0)):
        q = await _quote(client, court, start, count)
        assert q.status_code == 200, q.text
        body = q.json()
        assert body["price"] == total and body["duration_minutes"] == count * 30 and body["slot_count"] == count
        assert body["slot_minutes"] == 30 and body["min_booking_minutes"] == 60 and body["min_slots"] == 2
    # no slot_count = the court's minimum booking = 60 minutes = 1000
    default = (await _quote(client, court, _at(2, 18))).json()
    assert default["slot_count"] == 2 and default["price"] == 1000.0 and default["duration_minutes"] == 60


async def test_a_90_minute_courts_thirds_add_back_up_to_the_exact_price(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """PKR 1000 per 90 minutes is 333.333... per half hour: each slot is shown as 333.33 but the quote sums the exact
    thirds and rounds ONCE, so 90 minutes is exactly 1000.00 (not 999.99), and 150 minutes is 1666.67."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000002",
                                 slot_minutes=90, price=1000)
    day = pkt_today() + timedelta(days=2)
    grid = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()
    assert grid["slots"][0]["price"] == 333.33
    assert (await _quote(client, court, _at(2, 18))).json()["price"] == 1000.0  # default = 90 minutes
    assert (await _quote(client, court, _at(2, 18), 3)).json()["price"] == 1000.0
    assert (await _quote(client, court, _at(2, 18), 4)).json()["price"] == 1333.33
    assert (await _quote(client, court, _at(2, 18), 5)).json()["price"] == 1666.67
    assert (await _quote(client, court, _at(2, 18), 6)).json()["price"] == 2000.0


async def test_120_and_30_minute_courts(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    _o, _v, c120 = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000003",
                                slot_minutes=120, price=2000)
    assert (await _quote(client, c120, _at(2, 10))).json()["price"] == 2000.0         # the 2-hour minimum
    assert (await _quote(client, c120, _at(2, 10), 5)).json()["price"] == 2500.0      # 2.5 hours
    _o, _v, c30 = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000004",
                               slot_minutes=30, price=700)
    assert (await _quote(client, c30, _at(2, 10))).json()["price"] == 700.0           # one slot is the minimum
    assert (await _quote(client, c30, _at(2, 10), 3)).json()["price"] == 2100.0


async def test_peak_window_boundaries_are_priced_half_hour_by_half_hour(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """60-minute court: off-peak 1000/h, peak (18:00-23:00) 1500/h. Half-hour slots cost 500 / 750."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000005")
    await make_pricing_rule(court, name="Peak", priority=5, start_time=time(18, 0), end_time=time(23, 0), price_per_slot=1500)
    cases = [
        (_at(2, 17), 2, 1000.0),         # 17:00-18:00 entirely off-peak
        (_at(2, 17, 30), 2, 1250.0),     # 17:30-18:00 off-peak (500) + 18:00-18:30 peak (750)
        (_at(2, 18), 2, 1500.0),         # exactly the peak start
        (_at(2, 17, 30), 3, 2000.0),     # 500 + 750 + 750
        (_at(2, 17), 4, 2500.0),         # 500 + 500 + 750 + 750 (the Part 4 two-hour example, unchanged)
        (_at(2, 21, 30), 3, 2250.0),     # 21:30-23:00 all peak, ends exactly at the window's end
        (_at(2, 22), 2, 1500.0),         # last bookable hour
    ]
    for start, count, total in cases:
        q = await _quote(client, court, start, count)
        assert q.status_code == 200, (start, count, q.text)
        assert q.json()["price"] == total, (start, count, q.json())


async def test_floodlight_surcharge_scales_with_the_slot(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """1000/h + 200 floodlight surcharge per priced unit = 1200 per 60 minutes, 600 per half hour."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000006",
                                 court_kwargs={"has_floodlights": True}, rule_kwargs={"floodlight_surcharge": 200})
    assert (await _quote(client, court, _at(2, 20))).json()["price"] == 1200.0
    assert (await _quote(client, court, _at(2, 20), 3)).json()["price"] == 1800.0


async def test_advance_rules_scale_so_a_minimum_booking_advance_is_unchanged(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    # percent: 25% of 1000 = 250 for 60 minutes; 90 minutes costs 1500 and needs 375
    _o, _v, pct = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000007",
                               court_kwargs={"advance_type": CourtAdvanceType.PERCENT, "advance_value": 25})
    q = (await _quote(client, pct, _at(2, 18))).json()
    assert (q["price"], q["advance_amount"], q["balance_due"]) == (1000.0, 250.0, 750.0)
    q = (await _quote(client, pct, _at(2, 18), 3)).json()
    assert (q["price"], q["advance_amount"]) == (1500.0, 375.0)
    # fixed PKR 400 per priced unit (a 60-minute court's slot): 60 min -> 400, 120 min -> 800 (as two old slots)
    _o, _v, fixed = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000008",
                                 court_kwargs={"advance_type": CourtAdvanceType.FIXED, "advance_value": 400})
    assert (await _quote(client, fixed, _at(2, 18))).json()["advance_amount"] == 400.0
    assert (await _quote(client, fixed, _at(2, 18), 4)).json()["advance_amount"] == 800.0
    # percent 10% with a 500 floor per unit: 60 min -> 500, 120 min -> 1000
    _o, _v, floor = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000009",
                                 court_kwargs={"advance_type": CourtAdvanceType.PERCENT, "advance_value": 10, "advance_minimum": 500})
    assert (await _quote(client, floor, _at(2, 18))).json()["advance_amount"] == 500.0
    assert (await _quote(client, floor, _at(2, 18), 4)).json()["advance_amount"] == 1000.0
    # the pricing rule's own percentage (no court override): 50% of 1000 = 500
    _o, _v, rule = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000010",
                                rule_kwargs={"advance_percentage": 50})
    assert (await _quote(client, rule, _at(2, 18))).json()["advance_amount"] == 500.0


async def test_starts_from_price_is_still_the_price_of_the_minimum_booking(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000011", price=2500)
    body = (await client.get(f"/api/v1/courts/{court.id}/availability/summary", params={"month": pkt_today().strftime("%Y-%m")})).json()
    assert body["starts_from_price"] == 2500.0 and body["min_booking_minutes"] == 60 and body["slot_minutes"] == 30
    assert (await _quote(client, court, _at(2, 12))).json()["price"] == 2500.0


# ---- the minimum is enforced server-side ---------------------------------------------------------------

async def test_below_the_minimum_is_refused_by_quote_hold_and_walkin(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000012")
    player = await make_user("+923120000013", role=UserRole.PLAYER)
    ph, oh = await make_auth_headers(player), await make_auth_headers(owner)

    q = await _quote(client, court, _at(2, 18), 1)
    assert q.status_code == 400
    err = q.json()["error"]
    assert err["code"] == "BELOW_MINIMUM_BOOKING_TIME" and "minimum booking of 1 hour" in err["message"]
    assert err["details"]["min_booking_minutes"] == 60 and err["details"]["min_slots"] == 2

    hold = await client.post("/api/v1/bookings/hold", headers=ph,
                             json={"court_id": str(court.id), "starts_at": _iso(_at(2, 18)), "slot_count": 1})
    assert hold.status_code == 400 and hold.json()["error"]["code"] == "BELOW_MINIMUM_BOOKING_TIME"

    walk = await client.post("/api/v1/bookings/walkin", headers=oh,
                             json={"court_id": str(court.id), "starts_at": _iso(_at(2, 18)), "slot_count": 1,
                                   "player_name": "Short", "amount_paid": 0})
    assert walk.status_code == 400 and walk.json()["error"]["code"] == "BELOW_MINIMUM_BOOKING_TIME"

    # nothing was created by any of the refused attempts
    async with db_session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(Booking)) == 0


async def test_the_assistant_cannot_hold_below_the_minimum_either(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    from app.config import get_settings
    from app.services.ai_chat_service import AIChatService

    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000014")
    player = await make_user("+923120000015", role=UserRole.PLAYER)
    service = AIChatService(db_session, get_settings())
    out = await service._execute_tool(
        player, "quote_booking", {"court_id": str(court.id), "starts_at": _at(2, 18).isoformat(), "duration_minutes": 30}, []
    )
    assert out["status_code"] == 400 and "minimum booking of 1 hour" in out["error"]
    ok = await service._execute_tool(
        player, "quote_booking", {"court_id": str(court.id), "starts_at": _at(2, 18, 30).isoformat(), "duration_minutes": 90}, []
    )
    assert ok["ok"] is True and ok["total_price_text"] == "PKR 1,500" and ok["label"].startswith("6:30 PM to 8:00 PM")
    # the assistant only OFFERS starts where the 60-minute minimum fits
    labels = [s["label"] for s in (await service._execute_tool(
        player, "check_availability", {"court_id": str(court.id), "date": (pkt_today() + timedelta(days=2)).isoformat()}, []))["slots"]]
    assert labels[0].startswith("6:00 AM to 7:00 AM") and labels[1].startswith("6:30 AM to 7:30 AM")
    assert labels[-1].startswith("10:00 PM to 11:00 PM") and len(labels) == 33


# ---- player multi-slot: hold, pay, confirm ---------------------------------------------------------------

def _png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(10, 90, 200)).save(buf, format="PNG")
    return buf.getvalue()


async def test_a_player_books_90_minutes_from_a_half_hour_start_hold_pay_confirm(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000016", price=2000)
    player = await make_user("+923120000017", role=UserRole.PLAYER)
    other = await make_user("+923120000018", role=UserRole.PLAYER)
    ph, oh, xh = await make_auth_headers(player), await make_auth_headers(owner), await make_auth_headers(other)

    start = _at(2, 19, 30)  # 19:30-21:00, three slots, starting on the half hour
    quote = (await _quote(client, court, start, 3)).json()
    assert quote["price"] == 3000.0 and quote["advance_amount"] == 3000.0  # 100% advance rule: pay it all

    hold = await client.post("/api/v1/bookings/hold", headers=ph,
                             json={"court_id": str(court.id), "starts_at": _iso(start), "slot_count": 3})
    assert hold.status_code == 201, hold.text
    booking = hold.json()["booking"]
    assert booking["price"] == quote["price"] and booking["advance_amount"] == quote["advance_amount"]
    assert booking["starts_at"] == _iso(start) and booking["ends_at"] == _iso(start + timedelta(minutes=90))

    # all three cells are held, the neighbours are free, and another player is blocked on any overlapping start
    day = pkt_today() + timedelta(days=2)
    cells = {s["starts_at"]: s for s in (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()["slots"]}
    for i in range(3):
        assert cells[_iso(start + timedelta(minutes=30 * i))]["status"] == "held"
    assert cells[_iso(start - timedelta(minutes=30))]["status"] == "available" and cells[_iso(start + timedelta(minutes=90))]["status"] == "available"
    for overlapping_start, count in ((start - timedelta(minutes=30), 2), (start + timedelta(minutes=60), 2), (start, 2)):
        clash = await client.post("/api/v1/bookings/hold", headers=xh,
                                  json={"court_id": str(court.id), "starts_at": _iso(overlapping_start), "slot_count": count})
        assert clash.status_code == 409 and clash.json()["error"]["code"] == "SLOT_ALREADY_TAKEN", (overlapping_start, clash.text)
    # exactly adjacent on both sides is fine
    assert (await client.post("/api/v1/bookings/hold", headers=xh, json={"court_id": str(court.id), "starts_at": _iso(start + timedelta(minutes=90)), "slot_count": 2})).status_code == 201
    assert (await client.post("/api/v1/bookings/hold", headers=xh, json={"court_id": str(court.id), "starts_at": _iso(start - timedelta(minutes=60)), "slot_count": 2})).status_code == 201

    submit = await client.post(f"/api/v1/bookings/{booking['id']}/payment-proof", headers=ph,
                               files={"image": ("proof.jpg", io.BytesIO(_png()), "image/jpeg")})
    assert submit.status_code == 201, submit.text
    approve = await client.post(f"/api/v1/payments/{submit.json()['payment']['id']}/approve", headers=oh)
    assert approve.status_code == 200, approve.text
    confirmed = approve.json()["booking"]
    assert confirmed["status"] == "booked" and confirmed["price"] == 3000.0 and confirmed["amount_paid"] == 3000.0
    assert confirmed["ends_at"] == _iso(start + timedelta(minutes=90))


async def test_a_range_across_a_booked_slot_a_blackout_or_closing_time_is_refused(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000019")
    a = await make_user("+923120000020", role=UserRole.PLAYER)
    ha = await make_auth_headers(a)
    async with db_session_factory() as s:
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(3, 12), ends_at=_at(3, 13), reason="rain"))
        await s.commit()
    assert (await client.post("/api/v1/bookings/hold", headers=ha, json={"court_id": str(court.id), "starts_at": _iso(_at(2, 20)), "slot_count": 2})).status_code == 201
    # 19:30-20:30 runs into the booking at 20:00; 11:30-12:30 (next day) into the blackout; 22:30-23:30 past closing
    q = await _quote(client, court, _at(2, 19, 30), 2)
    assert q.status_code == 409 and q.json()["error"]["code"] == "SLOT_ALREADY_TAKEN"
    q = await _quote(client, court, _at(3, 11, 30), 2)
    assert q.status_code == 400 and q.json()["error"]["code"] == "SLOT_BLOCKED"
    q = await _quote(client, court, _at(2, 22, 30), 2)
    assert q.status_code == 400 and q.json()["error"]["code"] == "INVALID_DURATION"
    # off the 30-minute grid
    q = await _quote(client, court, _at(2, 18, 15), 2)
    assert q.status_code == 400 and q.json()["error"]["code"] == "INVALID_SLOT_TIME"


async def test_a_lone_free_half_hour_on_a_60_minute_court_is_not_bookable_anywhere(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """9:00-9:30 booked and 10:00-... booked leaves 9:30-10:00 free: shorter than the 60-minute minimum, so the month
    calendar, the venue's 'available today' filter and the assistant must not count it as an open start."""
    owner, venue, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000021",
                                       open_=time(9, 0), close=time(11, 0))
    day = pkt_today() + timedelta(days=3)
    async with db_session_factory() as s:
        for st, en in (((9, 0), (9, 30)), ((10, 0), (11, 0))):
            s.add(Booking(court_id=court.id, starts_at=pkt_time_to_utc(day, time(*st)), ends_at=pkt_time_to_utc(day, time(*en)),
                          status=BookingStatus.BOOKED, source="walkin", player_name="x", price=1, advance_amount=0, balance_due=1))
        await s.commit()
    month = (await client.get(f"/api/v1/courts/{court.id}/availability/summary", params={"month": day.strftime("%Y-%m")})).json()
    row = next(r for r in month["days"] if r["date"] == day.isoformat())
    assert row["total_slots"] == 4 and row["open_slots"] == 0 and row["state"] == "full"
    # the venue filter agrees (it asks courts_bookable_at, which needs a whole 60-minute run)
    async with db_session_factory() as s:
        service = AvailabilityService(s)
        assert await service.courts_bookable_at([court], {venue.id: 90}, day) == set()
        assert await service.courts_bookable_at([court], {venue.id: 90}, day + timedelta(days=1)) == {court.id}
        # a 30-minute duration is below the minimum: not bookable even on a free day
        assert await service.courts_bookable_at([court], {venue.id: 90}, day + timedelta(days=1), duration_minutes=30) == set()
        # an explicit start + duration: 10:00 for 60 minutes fits the free day, 10:00 for 45 does not (not a multiple of 30)
        free_day = day + timedelta(days=1)
        assert await service.courts_bookable_at([court], {venue.id: 90}, free_day, time(10, 0), 60) == {court.id}  # 10:00-11:00 ends exactly AT closing: fine
        assert await service.courts_bookable_at([court], {venue.id: 90}, free_day, time(10, 30), 60) == set()  # would pass 11:00
        assert await service.courts_bookable_at([court], {venue.id: 90}, free_day, time(9, 0), 90) == {court.id}
        assert await service.courts_bookable_at([court], {venue.id: 90}, free_day, time(9, 0), 45) == set()


# ---- owner walk-in: multi-slot, one booking -----------------------------------------------------------

async def test_walkin_books_several_contiguous_slots_as_one_booking_priced_by_quote_range(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000022", price=1000)
    await make_pricing_rule(court, name="Peak", priority=5, start_time=time(18, 0), end_time=time(23, 0), price_per_slot=1500)
    oh = await make_auth_headers(owner)
    start = _at(2, 17, 30)  # 17:30-19:00: 500 + 750 + 750 = 2000
    expected = (await _quote(client, court, start, 3)).json()["price"]
    assert expected == 2000.0

    resp = await client.post("/api/v1/bookings/walkin", headers=oh,
                             json={"court_id": str(court.id), "starts_at": _iso(start), "slot_count": 3,
                                   "player_name": "Usman Tariq", "amount_paid": 500})
    assert resp.status_code == 201, resp.text
    b = resp.json()["booking"]
    assert b["starts_at"] == _iso(start) and b["ends_at"] == _iso(start + timedelta(minutes=90))
    assert (b["price"], b["amount_paid"], b["balance_due"], b["source"], b["status"]) == (2000.0, 500.0, 1500.0, "walkin", "booked")
    async with db_session_factory() as s:
        n = await s.scalar(select(func.count()).select_from(Booking).where(Booking.court_id == court.id))
    assert n == 1  # ONE booking row, not three

    # the three cells are booked on the grid; a second walk-in over any of them is refused
    clash = await client.post("/api/v1/bookings/walkin", headers=oh,
                              json={"court_id": str(court.id), "starts_at": _iso(start + timedelta(minutes=60)), "slot_count": 2,
                                    "player_name": "Late", "amount_paid": 0})
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "SLOT_ALREADY_TAKEN"
    # omitted slot_count = the court's minimum (2 slots = 60 minutes); right after the first booking
    nxt = await client.post("/api/v1/bookings/walkin", headers=oh,
                            json={"court_id": str(court.id), "starts_at": _iso(start + timedelta(minutes=90)),
                                  "player_name": "Default Length", "amount_paid": 0})
    assert nxt.status_code == 201 and nxt.json()["booking"]["ends_at"] == _iso(start + timedelta(minutes=150))
    assert nxt.json()["booking"]["price"] == 1500.0  # 19:00-20:00 all peak


async def test_walkin_is_validated_like_a_hold_grid_closing_blackout_and_not_limited_by_the_horizon(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000023",
                                    court_kwargs=None)
    oh = await make_auth_headers(owner)
    async with db_session_factory() as s:
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(3, 12), ends_at=_at(3, 13), reason="rain"))
        await s.commit()

    def body(starts, count, name="Walk Guest"):
        return {"court_id": str(court.id), "starts_at": _iso(starts), "slot_count": count, "player_name": name, "amount_paid": 0}

    off = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(_at(2, 18, 10), 2))
    assert off.status_code == 400 and off.json()["error"]["code"] == "INVALID_SLOT_TIME"
    closing = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(_at(2, 22, 30), 2))
    assert closing.status_code == 400 and closing.json()["error"]["code"] == "INVALID_DURATION"
    blocked = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(_at(3, 11, 30), 2))
    assert blocked.status_code == 400 and blocked.json()["error"]["code"] == "SLOT_BLOCKED"
    too_long = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(_at(2, 8), 14))
    assert too_long.status_code == 400 and too_long.json()["error"]["code"] == "INVALID_DURATION"
    far = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(_at(120, 12), 2))  # past the 90-day player horizon
    assert far.status_code == 201, far.text
    # a plain player cannot use the walk-in endpoint
    player = await make_user("+923120000024", role=UserRole.PLAYER)
    forbidden = await client.post("/api/v1/bookings/walkin", headers=await make_auth_headers(player), json=body(_at(2, 14), 2))
    assert forbidden.status_code == 403


# ---- walk-in customer identity -------------------------------------------------------------------------------

async def test_walkin_customer_name_is_required_and_phone_is_validated_and_normalized(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000025")
    oh = await make_auth_headers(owner)

    def body(slot_hour, **extra):
        return {"court_id": str(court.id), "starts_at": _iso(_at(2, slot_hour)), "slot_count": 2, "amount_paid": 0, **extra}

    # name is required: missing, empty and whitespace-only are all refused (422)
    for bad in ({}, {"player_name": ""}, {"player_name": "   "}):
        r = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(8, **bad))
        assert r.status_code == 422, (bad, r.text)
    # phone: the signup rule (Pakistani mobile +923XXXXXXXXX), accepted in the forms people type, stored normalized
    for hour, typed in ((9, "0333 5119042"), (10, "+92 333 5119042"), (11, "923335119042"), (12, "333-5119042")):
        r = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(hour, player_name="  Usman   Tariq ", player_phone=typed))
        assert r.status_code == 201, (typed, r.text)
        assert r.json()["booking"]["player_phone"] == "+923335119042" and r.json()["booking"]["player_name"] == "Usman Tariq"
    for hour, typed in ((13, "12345"), (14, "0233 5119042"), (15, "+923335119"), (16, "033511904211"), (17, "abc")):
        r = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(hour, player_name="Bad", player_phone=typed))
        assert r.status_code == 422, (typed, r.text)
    # phone is optional: empty/blank means "no phone"
    for hour, blank in ((18, None), (19, ""), (20, "  ")):
        r = await client.post("/api/v1/bookings/walkin", headers=oh, json=body(hour, player_name="No Phone", player_phone=blank))
        assert r.status_code == 201 and r.json()["booking"]["player_phone"] is None, (blank, r.text)


async def test_walkin_links_to_an_existing_account_by_phone_otherwise_stores_the_name_without_creating_a_login(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923120000026")
    member = await make_user("+923335550101", role=UserRole.PLAYER, name="Registered Rana")
    oh = await make_auth_headers(owner)

    async def users() -> int:
        async with db_session_factory() as s:
            return await s.scalar(select(func.count()).select_from(User))

    before = await users()
    linked = await client.post("/api/v1/bookings/walkin", headers=oh, json={
        "court_id": str(court.id), "starts_at": _iso(_at(2, 10)), "slot_count": 2, "amount_paid": 0,
        "player_name": "Rana at the counter", "player_phone": "0333 5550101"})  # typed locally, matches +923335550101
    assert linked.status_code == 201, linked.text
    assert linked.json()["booking"]["player_id"] == str(member.id)
    assert linked.json()["booking"]["player_name"] == "Rana at the counter"  # the booking keeps the name it was made under

    stranger = await client.post("/api/v1/bookings/walkin", headers=oh, json={
        "court_id": str(court.id), "starts_at": _iso(_at(2, 12)), "slot_count": 2, "amount_paid": 0,
        "player_name": "Nobody Yet", "player_phone": "0300 1112223"})
    nameonly = await client.post("/api/v1/bookings/walkin", headers=oh, json={
        "court_id": str(court.id), "starts_at": _iso(_at(2, 14)), "slot_count": 2, "amount_paid": 0, "player_name": "Walk-up Customer"})
    assert stranger.json()["booking"]["player_id"] is None and nameonly.json()["booking"]["player_id"] is None
    assert stranger.json()["booking"]["player_phone"] == "+923001112223"
    assert await users() == before  # no login account was created for either

    # the owner's screens show the customer: Today's slot carries the name and phone, and the member sees it in their bookings
    today = (await client.get("/api/v1/owners/today", params={"date_": (pkt_today() + timedelta(days=2)).isoformat()}, headers=oh)).json()
    by_start = {s["starts_at"]: s for c in today["courts"] for s in c["slots"]}
    assert by_start[_iso(_at(2, 14))]["player_name"] == "Walk-up Customer"
    assert by_start[_iso(_at(2, 12))]["player_name"] == "Nobody Yet" and by_start[_iso(_at(2, 12))]["player_phone"] == "+923001112223"
    assert by_start[_iso(_at(2, 10))]["player_name"] == "Rana at the counter"
    mine = (await client.get("/api/v1/bookings/mine", headers=await make_auth_headers(member))).json()
    assert [m["id"] for m in mine] == [linked.json()["booking"]["id"]]
