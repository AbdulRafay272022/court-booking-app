"""Section 32 Part 2: "Notify me" on my own slot, and the Pakistan-vs-UTC day boundary in owner Today and the
ledger. Reproduced from real data on 2026-09-21: a booked slot showed "On waitlist" for the player who owned
it, and every date range/tab was built from the UTC date, which is still yesterday until 5 AM in Karachi."""
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import UserRole
from app.models.waitlist import WaitlistEntry
from app.utils.timezone import pkt_time_to_utc, pkt_today


async def _open_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phones, *, open_=time(6, 0), close=time(23, 0)):
    owner = await make_user(phones[0], role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=open_, close_time=close)
    await make_pricing_rule(court, price_per_slot=2500)
    return owner, court


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


async def _slot(client, court, day, starts_at, headers=None):
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()}, headers=headers or {})
    assert resp.status_code == 200, resp.text
    return next(s for s in resp.json()["slots"] if s["starts_at"] == _iso(starts_at))


async def test_availability_marks_the_viewers_own_slot_and_nobody_elses(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _owner, court = await _open_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923060000001",)
    )
    ali = await make_user("+923060000002", role=UserRole.PLAYER)
    bilal = await make_user("+923060000003", role=UserRole.PLAYER)
    ali_h, bilal_h = await make_auth_headers(ali), await make_auth_headers(bilal)
    day = pkt_today() + timedelta(days=2)
    starts = pkt_time_to_utc(day, time(19, 0))

    hold = await client.post("/api/v1/bookings/hold", headers=ali_h, json={"court_id": str(court.id), "starts_at": _iso(starts)})
    assert hold.status_code == 201, hold.text

    assert (await _slot(client, court, day, starts, ali_h))["is_mine"] is True  # Ali sees his own hold
    theirs = await _slot(client, court, day, starts, bilal_h)
    assert theirs["is_mine"] is False and theirs["status"] == "held"  # Bilal sees somebody else's
    assert (await _slot(client, court, day, starts))["is_mine"] is False  # anonymous: never mine
    # free slots are never "mine"
    free = await _slot(client, court, day, pkt_time_to_utc(day, time(10, 0)), ali_h)
    assert free["is_mine"] is False and free["status"] == "available"


async def test_you_cannot_join_the_waitlist_for_a_slot_you_already_hold(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """The button was shown on the player's own booked slot, and the API accepted it (a real row for the 23rd
    6:00 PM slot sat active next to that same player's booked booking)."""
    _owner, court = await _open_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923060000011",)
    )
    ali = await make_user("+923060000012", role=UserRole.PLAYER)
    bilal = await make_user("+923060000013", role=UserRole.PLAYER)
    ali_h, bilal_h = await make_auth_headers(ali), await make_auth_headers(bilal)
    starts = pkt_time_to_utc(pkt_today() + timedelta(days=2), time(19, 0))
    await client.post("/api/v1/bookings/hold", headers=ali_h, json={"court_id": str(court.id), "starts_at": _iso(starts)})

    own = await client.post("/api/v1/waitlist", headers=ali_h, json={"court_id": str(court.id), "slot_starts_at": _iso(starts)})
    assert own.status_code == 409
    assert own.json()["error"]["code"] == "ALREADY_YOUR_SLOT"

    other = await client.post("/api/v1/waitlist", headers=bilal_h, json={"court_id": str(court.id), "slot_starts_at": _iso(starts)})
    assert other.status_code == 201  # someone ELSE's slot: that is exactly what "Notify me" is for


async def test_holding_a_slot_retires_your_own_waitlist_entry_for_it(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _owner, court = await _open_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923060000021",)
    )
    ali = await make_user("+923060000022", role=UserRole.PLAYER)
    ali_h = await make_auth_headers(ali)
    starts = pkt_time_to_utc(pkt_today() + timedelta(days=2), time(19, 0))
    async with db_session_factory() as session:
        session.add(WaitlistEntry(court_id=court.id, player_id=ali.id, slot_starts_at=starts))
        await session.commit()

    hold = await client.post("/api/v1/bookings/hold", headers=ali_h, json={"court_id": str(court.id), "starts_at": _iso(starts)})
    assert hold.status_code == 201

    async with db_session_factory() as session:
        entries = (await session.execute(select(WaitlistEntry).where(WaitlistEntry.player_id == ali.id))).scalars().all()
    assert [e.is_active for e in entries] == [False]


async def test_a_slot_after_midnight_pkt_can_be_held_because_alignment_uses_the_pakistan_date(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """1:00 AM Karachi is 20:00 UTC the DAY BEFORE. Slot alignment looked the schedule up by the UTC date, so a
    court open 12 AM - 4 AM could never be booked (INVALID_SLOT_TIME)."""
    _owner, court = await _open_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923060000031",), open_=time(0, 0), close=time(4, 0)
    )
    player = await make_user("+923060000032", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    starts = pkt_time_to_utc(pkt_today() + timedelta(days=2), time(1, 0))
    assert starts.hour == 20  # the UTC clock says 8 PM, on the previous UTC day

    hold = await client.post("/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": _iso(starts)})
    assert hold.status_code == 201, hold.text


async def _add_bookings(db_session_factory, court, player, times):
    """One booking per instant in `times`, each with a payment_entries row RECORDED at that same instant --
    Section 32 Part 5's ledger is keyed by when the money was recorded (payment_entries.created_at), not
    when the booking's slot is, so a test of the ledger's PKT-day-boundary handling needs to control that
    timestamp directly rather than the booking's starts_at."""
    async with db_session_factory() as session:
        for starts in times:
            booking = Booking(
                court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
                price=1000, amount_paid=1000, status=BookingStatus.BOOKED, source=BookingSource.APP,
            )
            session.add(booking)
            await session.flush()
            session.add(
                PaymentEntry(
                    booking_id=booking.id, amount_pkr=1000, method=PaymentMethod.BANK_TRANSFER_PROOF,
                    created_at=starts,
                )
            )
        await session.commit()


async def test_owner_today_and_ledger_use_pakistan_days_not_utc_days(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Owner Today showed yesterday between midnight and 5 AM (its default date was the UTC date) and covered
    5 AM-to-5 AM (a UTC day). The ledger's range had the same boundary error, so "today" missed every evening
    booking after 7 PM... and counted the next morning's."""
    owner, court = await _open_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923060000041",), open_=time(0, 0), close=time(23, 0)
    )
    player = await make_user("+923060000042", role=UserRole.PLAYER)
    monday = pkt_today() + timedelta(days=3)
    tuesday = monday + timedelta(days=1)
    await _add_bookings(
        db_session_factory, court, player,
        [
            pkt_time_to_utc(monday, time(1, 0)),    # 1:00 AM Mon  = 20:00Z Sun
            pkt_time_to_utc(monday, time(23, 30)),  # 11:30 PM Mon = 18:30Z Mon
            pkt_time_to_utc(tuesday, time(0, 30)),  # 12:30 AM Tue = 19:30Z Mon  (a UTC "Monday" booking)
        ],
    )
    headers = await make_auth_headers(owner)

    async def ledger(start, end):
        resp = await client.get("/api/v1/owners/ledger", headers=headers, params={"start_date": start.isoformat(), "end_date": end.isoformat()})
        assert resp.status_code == 200, resp.text
        return len(resp.json()["entries"])

    assert await ledger(monday, monday) == 2  # 1 AM and 11:30 PM are Monday; 12:30 AM belongs to Tuesday
    assert await ledger(tuesday, tuesday) == 1
    assert await ledger(monday, tuesday) == 3

    # owner Today: default date is Pakistan's today -- pin it to Monday
    monkeypatch.setattr("app.services.owner_dashboard_service.pkt_today", lambda: monday)
    today = (await client.get("/api/v1/owners/today", headers=headers)).json()
    assert today["date"] == monday.isoformat()
    assert today["summary"]["total_bookings"] == 2
    tue = (await client.get("/api/v1/owners/today", headers=headers, params={"date_": tuesday.isoformat()})).json()
    assert tue["summary"]["total_bookings"] == 1


async def test_owner_today_slot_carries_paid_and_balance_due(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """The owner's Today row must show what was paid AND what is still owed at the venue (it showed only
    the paid amount, so "PKR 400 of 3,500" was indistinguishable from "fully paid")."""
    owner = await make_user("+923060000051", role=UserRole.OWNER)
    player = await make_user("+923060000052", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=90)
    today = pkt_today()
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    starts = pkt_time_to_utc(today, time(19, 30))
    async with db_session_factory() as session:
        session.add(
            Booking(
                court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(minutes=90),
                price=3500, advance_amount=400, amount_paid=400, balance_due=3100,
                status=BookingStatus.BOOKED, source=BookingSource.APP, player_name="Ali Raza",
            )
        )
        await session.commit()

    body = (await client.get("/api/v1/owners/today", headers=await make_auth_headers(owner))).json()
    slot = next(s for c in body["courts"] for s in c["slots"] if s["status"] == "booked")
    assert (slot["player_name"], slot["price"], slot["amount_paid"], slot["balance_due"]) == ("Ali Raza", 3500.0, 400.0, 3100.0)
