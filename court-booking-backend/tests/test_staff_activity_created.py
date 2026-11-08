"""fix/nov-7 item 2: the staff activity page's "Bookings banayi" column = bookings each person created (Add booking / walk-in).
The owner's own bookings must show under the owner. Real Postgres."""

from datetime import datetime, timedelta, timezone

from app.models.booking import Booking, BookingSource, BookingStatus
from test_audit_phase1 import _booked_walkin, _venue_with_court, make_staff


async def test_bookings_created_per_person_including_the_owners_own_three(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    staff = await make_staff(db_session_factory, make_user, venue, "+923001230001", ["walkin", "record_payments"], name="Bilal")
    oh, sh = await make_auth_headers(owner), await make_auth_headers(staff)

    for hour in (8, 10, 12):  # the owner adds 3 bookings
        await _booked_walkin(client, oh, court, "+923001230002", paid=0, hour=hour)
    await _booked_walkin(client, sh, court, "+923001230003", paid=500, hour=14)  # Bilal adds 1

    out = (await client.get(f"/api/v1/owners/staff-activity?venue_id={venue.id}", headers=oh)).json()
    people = {p["role"] if p["role"] == "owner" else p["name"]: p for p in out["people"]}
    assert people["owner"]["bookings_created"] == 3
    assert people["Bilal"]["bookings_created"] == 1
    assert people["owner"]["bookings_marked"] == 0  # creating a booking is not "Mukammal ki"
    assert out["totals"]["bookings_created"] == 4


async def test_a_walkin_without_an_audit_row_counts_under_the_owner(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    start = datetime.now(timezone.utc) + timedelta(days=2)
    async with db_session_factory() as s:  # an old walk-in written before / without the audit row
        s.add(Booking(court_id=court.id, starts_at=start, ends_at=start + timedelta(hours=1), status=BookingStatus.BOOKED,
                      source=BookingSource.WALKIN, player_name="Purana", price=1500, advance_amount=0))
        # a player's own app booking is never "banayi" by anyone at the venue
        s.add(Booking(court_id=court.id, starts_at=start + timedelta(hours=2), ends_at=start + timedelta(hours=3),
                      status=BookingStatus.BOOKED, source=BookingSource.APP, price=1500, advance_amount=0))
        await s.commit()

    out = (await client.get(f"/api/v1/owners/staff-activity?venue_id={venue.id}", headers=await make_auth_headers(owner))).json()
    owner_row = next(p for p in out["people"] if p["role"] == "owner")
    assert owner_row["bookings_created"] == 1
    assert out["totals"]["bookings_created"] == 1


async def test_nov9_each_staff_number_opens_exactly_the_bookings_behind_it(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """fix/nov-9 item 8: Bookings history with ?staff=<user>&act=<kind> lists the bookings a Staff ka kaam number counts."""
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    staff = await make_staff(db_session_factory, make_user, venue, "+923001230011", ["walkin", "record_payments"], name="Bilal")
    oh, sh = await make_auth_headers(owner), await make_auth_headers(staff)
    mine = [await _booked_walkin(client, oh, court, "+923001230012", paid=0, hour=h) for h in (8, 10)]
    bilal = await _booked_walkin(client, sh, court, "+923001230013", paid=500, hour=14)

    out = (await client.get(f"/api/v1/owners/staff-activity?venue_id={venue.id}", headers=oh)).json()
    rng = {"date_from": out["date_from"], "date_to": out["date_to"], "venue_id": str(venue.id)}

    async def ids(user_id, act, headers=oh):
        r = await client.get("/api/v1/owners/bookings-history", params={**rng, "staff": str(user_id), "act": act, "page_size": 100}, headers=headers)
        return r, {i["booking_id"] for i in r.json().get("items", [])} if r.status_code == 200 else set()

    _, got = await ids(owner.id, "created")
    assert got == {m["id"] if isinstance(m, dict) else str(m) for m in mine}
    _, got = await ids(staff.id, "created")
    assert got == {bilal["id"] if isinstance(bilal, dict) else str(bilal)}
    people = {p["user_id"]: p for p in out["people"]}
    _, cash = await ids(staff.id, "cash")
    assert len(cash) == people[str(staff.id)]["cash_entries"]
    # staff can't look at a colleague's numbers through History either
    r, _ = await ids(owner.id, "created", headers=sh)
    assert r.status_code == 403
    r, _ = await ids(owner.id, "bogus")
    assert r.status_code == 400
