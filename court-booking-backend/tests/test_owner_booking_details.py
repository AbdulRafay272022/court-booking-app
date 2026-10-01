"""Owner screens must say, for every booking, WHICH court (and its sport), HOW and WHEN it was booked, and the name it was
booked UNDER (a friend's / a walk-in's name beats the account name). Exact values throughout."""

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select, update

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today

BOOKED_AT = datetime(2026, 9, 28, 11, 12, tzinfo=timezone.utc)  # 4:12 PM PKT


async def _two_court_venue(make_user, make_venue, make_court, make_schedule):
    """One venue, two courts that share the NAME "Court 1" but differ in sport -- so any frontend that still matched on
    court name could not tell them apart."""
    owner = await make_user("+923061000001", role=UserRole.OWNER)
    venue = await make_venue(owner, name="Twin Arena", sports=["padel", "futsal"])
    padel = await make_court(venue, name="Court 1", sport="padel")
    futsal = await make_court(venue, name="Court 1", sport="futsal")
    today = pkt_today()
    for court in (padel, futsal):
        await make_schedule(court, day_of_week=today.weekday(), open_time=time(8, 0), close_time=time(20, 0))
    return owner, venue, padel, futsal, today


async def test_today_rows_carry_court_sport_source_booked_at_and_booked_under_name(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, _venue, padel, futsal, today = await _two_court_venue(make_user, make_venue, make_court, make_schedule)
    account = await make_user("+923061000002", role=UserRole.PLAYER, name="Ahmed Khan")
    async with db_session_factory() as session:
        friend = Booking(  # an app booking the account holder made FOR A FRIEND
            court_id=padel.id, player_id=account.id, player_phone=account.phone, player_name="Bilal Raza",
            starts_at=pkt_time_to_utc(today, time(10, 0)), ends_at=pkt_time_to_utc(today, time(11, 0)),
            price=3000, advance_amount=1500, amount_paid=1500, balance_due=1500,
            status=BookingStatus.BOOKED, source=BookingSource.APP,
        )
        walkin = Booking(  # a walk-in at the other court: no account at all
            court_id=futsal.id, player_name="Walk-in Guy", player_phone="+923009990000",
            starts_at=pkt_time_to_utc(today, time(12, 0)), ends_at=pkt_time_to_utc(today, time(13, 0)),
            price=2000, advance_amount=2000, amount_paid=2000, balance_due=0,
            status=BookingStatus.BOOKED, source=BookingSource.WALKIN,
        )
        wa = Booking(  # a WhatsApp booking made under the account's own name (player_name left empty on an old row)
            court_id=padel.id, player_id=account.id, player_phone=account.phone, player_name=None,
            starts_at=pkt_time_to_utc(today, time(14, 0)), ends_at=pkt_time_to_utc(today, time(15, 0)),
            price=3000, advance_amount=3000, amount_paid=0, balance_due=3000,
            status=BookingStatus.HELD, source=BookingSource.WHATSAPP,
        )
        session.add_all([friend, walkin, wa])
        await session.commit()
        ids = {"friend": friend.id, "walkin": walkin.id, "wa": wa.id}
        await session.execute(update(Booking).where(Booking.id.in_(ids.values())).values(created_at=BOOKED_AT))
        await session.commit()

    resp = await client.get("/api/v1/owners/today", headers=await make_auth_headers(owner))
    assert resp.status_code == 200
    courts = {c["court_id"]: c for c in resp.json()["courts"]}
    assert courts[str(padel.id)]["sport"] == "padel"
    assert courts[str(futsal.id)]["sport"] == "futsal"
    rows = {s["booking_id"]: s for c in courts.values() for s in c["slots"] if s["booking_id"]}

    f = rows[str(ids["friend"])]
    assert (f["court_id"], f["court_name"], f["court_sport"]) == (str(padel.id), "Court 1", "padel")
    assert f["booking_source"] == "app"
    assert f["player_name"] == "Bilal Raza"  # the name it was booked under, NOT the account's
    assert f["account_name"] == "Ahmed Khan"
    assert f["booked_at"].startswith("2026-09-28T11:12")
    assert (f["price"], f["amount_paid"], f["balance_due"]) == (3000.0, 1500.0, 1500.0)

    w = rows[str(ids["walkin"])]
    assert (w["court_id"], w["court_sport"], w["booking_source"]) == (str(futsal.id), "futsal", "walkin")
    assert w["player_name"] == "Walk-in Guy"
    assert w["account_name"] is None

    h = rows[str(ids["wa"])]
    assert h["booking_source"] == "whatsapp"
    assert h["player_name"] == "Ahmed Khan"  # no booked-under name -> falls back to the account name
    assert h["court_sport"] == "padel"

    # an open slot carries none of the booking fields
    open_slot = next(s for s in courts[str(padel.id)]["slots"] if s["status"] == "available")
    assert open_slot["court_sport"] is None and open_slot["booking_source"] is None and open_slot["booked_at"] is None


async def test_pending_approval_and_refund_and_ledger_carry_court_id_sport_and_booked_under_name(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, _venue, padel, futsal, today = await _two_court_venue(make_user, make_venue, make_court, make_schedule)
    account = await make_user("+923061000003", role=UserRole.PLAYER, name="Sana Malik")
    start = datetime.now(timezone.utc) + timedelta(days=2)
    async with db_session_factory() as session:
        b1 = Booking(  # awaiting approval, at the FUTSAL "Court 1", booked for a friend
            court_id=futsal.id, player_id=account.id, player_name="Hira (friend)", player_phone=account.phone,
            starts_at=start, ends_at=start + timedelta(hours=1), price=2500, advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED, payment_deadline=start,
        )
        b2 = Booking(  # cancelled, refund owed, at the PADEL "Court 1", booked for a friend
            court_id=padel.id, player_id=account.id, player_name="Omar (friend)", player_phone=account.phone,
            starts_at=start + timedelta(days=1), ends_at=start + timedelta(days=1, hours=1), price=3000,
            advance_amount=1000, amount_paid=1000, status=BookingStatus.CANCELLED,
        )
        b3 = Booking(  # paid, in the ledger, no booked-under name stored
            court_id=padel.id, player_id=account.id, player_name=None, player_phone=account.phone,
            starts_at=start + timedelta(days=2), ends_at=start + timedelta(days=2, hours=1), price=3000,
            advance_amount=3000, amount_paid=3000, status=BookingStatus.BOOKED,
        )
        session.add_all([b1, b2, b3])
        await session.flush()
        session.add(Payment(booking_id=b1.id, proof_key="payment-proofs/x.jpg", amount_claimed=1000, ocr_amount=1000, ocr_verdict="match"))
        pay2 = Payment(booking_id=b2.id, amount_claimed=1000, review_verdict="approved")
        session.add(pay2)
        await session.flush()
        session.add(PaymentDispute(booking_id=b2.id, payment_id=pay2.id, player_id=account.id,
                                   reason="player_cancelled_paid_booking", refund_amount=1000))
        session.add(PaymentEntry(booking_id=b3.id, amount_pkr=3000, method=PaymentMethod.CASH_AT_VENUE, recorded_by=owner.id))
        await session.commit()

    headers = await make_auth_headers(owner)

    approvals = (await client.get("/api/v1/owners/pending-approvals", headers=headers)).json()
    assert len(approvals) == 1
    a = approvals[0]
    assert (a["court_name"], a["court_id"], a["court_sport"]) == ("Court 1", str(futsal.id), "futsal")
    assert a["player_name"] == "Hira (friend)"
    assert a["account_name"] == "Sana Malik"

    refunds = (await client.get("/api/v1/owners/refunds", headers=headers)).json()
    assert len(refunds) == 1
    r = refunds[0]
    assert (r["court_name"], r["court_id"], r["court_sport"]) == ("Court 1", str(padel.id), "padel")
    assert r["player_name"] == "Omar (friend)"  # was the account name before the fix

    ledger = (await client.get(
        "/api/v1/owners/ledger",
        params={"start_date": (today - timedelta(days=1)).isoformat(), "end_date": (today + timedelta(days=1)).isoformat()},
        headers=headers,
    )).json()
    assert len(ledger["entries"]) == 1
    e = ledger["entries"][0]
    assert (e["court"], e["court_id"], e["court_sport"]) == ("Court 1", str(padel.id), "padel")
    assert e["player"] == "Sana Malik"  # no booked-under name -> the account's


async def test_http_hold_is_recorded_as_app_and_whatsapp_button_hold_as_whatsapp(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "wamid.reply.1"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923061000010", role=UserRole.OWNER)
    player = await make_user("+923061000011", role=UserRole.PLAYER, name="App Player")
    venue = await make_venue(owner)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1500)
    target = date.today() + timedelta(days=1)

    # 1. the in-app hold endpoint
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=await make_auth_headers(player),
        json={"court_id": str(court.id), "starts_at": f"{target.isoformat()}T10:00:00+00:00"},
    )
    assert resp.status_code == 201
    assert resp.json()["booking"]["source"] == "app"

    # 2. the WhatsApp "Yes" button for a different slot
    starts_at = f"{target.isoformat()}T12:00:00+00:00"
    payload = {"entry": [{"changes": [{"value": {"messages": [{
        "from": "923061000012", "id": "wamid.src-1", "type": "interactive",
        "interactive": {"button_reply": {"id": f"confirm:{court.id}:{starts_at}", "title": "Yes"}},
    }]}}]}]}
    assert (await client.post("/api/v1/webhooks/whatsapp", json=payload)).status_code == 200

    rows = (await db_session.execute(select(Booking).order_by(Booking.created_at))).scalars().all()
    assert [(b.source, b.status) for b in rows] == [
        (BookingSource.APP, BookingStatus.HELD),
        (BookingSource.WHATSAPP, BookingStatus.HELD),
    ]

    # 3. the channel marker does not leak: a hold made afterwards over HTTP is "app" again
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=await make_auth_headers(player),
        json={"court_id": str(court.id), "starts_at": f"{target.isoformat()}T14:00:00+00:00"},
    )
    assert resp.json()["booking"]["source"] == "app"
