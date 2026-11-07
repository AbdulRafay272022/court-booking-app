"""fix/nov-7 item 1: the owner bookings search box ("Naam, phone ya booking ID") finds a booking by name, by phone in
any format (0300..., +92300..., 92300..., 300..., with spaces / dashes, whatever format the row stored) and by booking ID
(short code KH-XXXXXXXX or the full uuid). A phone or booking ID is searched across ALL dates. Real Postgres."""

from datetime import time

import pytest

from app.services.owner_overview_service import booking_code_hex, national_phone_digits, search_spans_all_dates
from overview_helpers import add_booking, at, past_day, seed_venue

HIST = "/api/v1/owners/bookings-history"
COURTS = (("Court A", time(10, 0), time(23, 0)),)


@pytest.fixture
def seed(make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    async def _seed(phone):
        return await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, courts=COURTS)

    return _seed


# -- pure helpers -----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "term, expected",
    [
        ("03001234567", "3001234567"),
        ("0300 1234567", "3001234567"),
        ("0300-123-4567", "3001234567"),
        ("+923001234567", "3001234567"),
        ("+92 300 1234567", "3001234567"),
        ("923001234567", "3001234567"),
        ("00923001234567", "3001234567"),
        ("3001234567", "3001234567"),
        ("300 1234567", "3001234567"),
        ("4567", "4567"),
        ("Ali Raza", None),
        ("KH-3B9A41D7", None),
        ("12", None),
    ],
)
def test_national_phone_digits(term, expected):
    assert national_phone_digits(term) == expected


def test_booking_code_hex_and_all_dates_rule():
    assert booking_code_hex("KH-3B9A41D7") == "3b9a41d7"
    assert booking_code_hex("kh3b9a41d7") == "3b9a41d7"
    assert booking_code_hex("3B9A41D7-1111-2222-3333-444455556666") == "3b9a41d7111122223333444455556666"
    assert booking_code_hex("Ali") is None
    assert search_spans_all_dates("KH-3B9A41D7")
    assert search_spans_all_dates("3b9a41d7-1111-2222-3333-444455556666")
    assert search_spans_all_dates("0300 1234567")
    assert search_spans_all_dates("1234567")
    assert not search_spans_all_dates("Ali Raza")
    assert not search_spans_all_dates("bead")  # a short hex-looking word stays a name search within the range
    assert not search_spans_all_dates("4567")  # too few digits: still inside the date range
    assert not search_spans_all_dates("")


# -- the endpoint ------------------------------------------------------------------------------------------------------


async def test_search_by_phone_in_any_format_and_by_booking_id_across_dates(seed, make_user, make_auth_headers, client, db_session_factory):
    owner, _venue, (court,) = await seed("+923008800901")
    old_day = past_day(20)
    # a walk-in saved in E.164, a legacy walk-in saved as typed, and a registered player (phone only on the account)
    e164 = await add_booking(db_session_factory, court, at(old_day, 18), name="Ali Raza", phone="+923001110001")
    legacy = await add_booking(db_session_factory, court, at(old_day, 19), name="Bilal", phone="0300-111 0002")
    player = await make_user("+923001110003", name="Sana Player")
    registered = await add_booking(db_session_factory, court, at(old_day, 20), player=player)
    headers = await make_auth_headers(owner)

    async def found(q, **params):
        r = await client.get(HIST, params={"q": q, **params}, headers=headers)  # no dates = today, like the page
        assert r.status_code == 200, r.text
        return {row["booking_id"] for row in r.json()["items"]}, r.json()["search_all_dates"]

    for q in ("03001110001", "0300 1110001", "0300-1110001", "+923001110001", "+92 300 1110001", "923001110001", "3001110001"):
        assert await found(q) == ({str(e164.id)}, True), q
    for q in ("03001110002", "+923001110002", "300 1110002"):
        assert await found(q) == ({str(legacy.id)}, True), q
    for q in ("03001110003", "+923001110003", "3001110003"):
        assert await found(q) == ({str(registered.id)}, True), q

    short = "KH-" + legacy.id.hex[:8].upper()
    assert await found(short) == ({str(legacy.id)}, True)
    assert await found(short.lower()) == ({str(legacy.id)}, True)
    assert await found(str(registered.id)) == ({str(registered.id)}, True)
    assert await found(str(registered.id).upper()) == ({str(registered.id)}, True)

    # a name still respects the date range (today: nothing), and finds it when the range covers the day
    assert await found("Ali Raza") == (set(), False)
    day = old_day.isoformat()
    assert await found("ali raz", date_from=day, date_to=day) == ({str(e164.id)}, False)
    assert await found("sana", date_from=day, date_to=day) == ({str(registered.id)}, False)


async def test_search_never_leaks_another_venues_booking(seed, make_auth_headers, client, db_session_factory):
    owner, _venue, _courts = await seed("+923008800902")
    _other_owner, _other_venue, (other_court,) = await seed("+923008800903")
    theirs = await add_booking(db_session_factory, other_court, at(past_day(3), 18), name="Elsewhere", phone="+923001110009")
    headers = await make_auth_headers(owner)

    for q in ("03001110009", "KH-" + theirs.id.hex[:8].upper(), str(theirs.id)):
        r = await client.get(HIST, params={"q": q}, headers=headers)
        assert r.status_code == 200 and r.json()["items"] == [], q
