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
