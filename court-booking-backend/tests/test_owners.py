import csv
import io
from datetime import date, datetime, time, timedelta, timezone

from app.jobs.growth_job import compute_slot_stats
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.payment import Payment
from app.models.user import UserRole
from app.models.venue import PlanTier
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _today_utc() -> date:
    """Kept under its old name so the tests below read the same, but it is PAKISTAN's today: the owner's
    Today screen is a Pakistan calendar day. These tests used the UTC date and so failed every night
    between midnight and 5 AM in Karachi -- the very bug (the UTC date is still yesterday) they now guard."""
    return pkt_today()


async def test_today_view_accuracy(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner = await make_user("+923011000001", role=UserRole.OWNER)
    customer = await make_user("+923011000002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court_a = await make_court(venue, name="Court A")
    court_b = await make_court(venue, name="Court B")

    today = _today_utc()
    weekday = today.weekday()
    await make_schedule(court_a, day_of_week=weekday, open_time=time(8, 0), close_time=time(20, 0))
    await make_schedule(court_b, day_of_week=weekday, open_time=time(8, 0), close_time=time(20, 0))

    booked_start = pkt_time_to_utc(today, time(10, 0))
    async with db_session_factory() as session:
        booking = Booking(
            court_id=court_a.id,
            player_id=customer.id,
            starts_at=booked_start,
            ends_at=booked_start + timedelta(hours=1),
            price=3000,
            amount_paid=3000,
            player_name=customer.name or "Ahmed",
            status=BookingStatus.BOOKED,
            source=BookingSource.APP,
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    owner_headers = await make_auth_headers(owner)
    resp = await client.get("/api/v1/owners/today", headers=owner_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["date"] == today.isoformat()

    court_a_out = next(c for c in body["courts"] if c["name"] == "Court A")
    booked_slot = next(s for s in court_a_out["slots"] if s["status"] == "booked")
    assert booked_slot["amount_paid"] == 3000.0
    available_slots = [s for s in court_a_out["slots"] if s["status"] == "available"]
    assert len(available_slots) > 0
    assert body["summary"]["total_bookings"] == 1
    assert body["summary"]["total_revenue"] == 3000.0

    # A walk-in appears immediately.
    walkin_start = pkt_time_to_utc(today, time(14, 0))
    async with db_session_factory() as session:
        walkin = Booking(
            court_id=court_b.id,
            starts_at=walkin_start,
            ends_at=walkin_start + timedelta(hours=1),
            price=2000,
            amount_paid=2000,
            player_name="Walk-in Guy",
            status=BookingStatus.BOOKED,
            source=BookingSource.WALKIN,
        )
        session.add(walkin)
        await session.commit()

    resp2 = await client.get("/api/v1/owners/today", headers=owner_headers)
    body2 = resp2.json()
    assert body2["summary"]["walkins"] == 1

    # Cancel the first booking -> its slot goes back to available.
    async with db_session_factory() as session:
        refreshed = await session.get(Booking, booking_id)
        refreshed.status = BookingStatus.CANCELLED
        await session.commit()

    resp3 = await client.get("/api/v1/owners/today", headers=owner_headers)
    court_a_out3 = next(c for c in resp3.json()["courts"] if c["name"] == "Court A")
    slot_at_10 = next(s for s in court_a_out3["slots"] if s["starts_at"].startswith(f"{today.isoformat()}T10:00"))
    assert slot_at_10["status"] == "available"


async def test_pending_approvals_queue(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923011000010", role=UserRole.OWNER)
    customer = await make_user("+923011000011", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    payment_ids = []
    async with db_session_factory() as session:
        base = datetime.now(timezone.utc) - timedelta(days=1)
        for i in range(3):
            booking = Booking(
                court_id=court.id,
                player_id=customer.id,
                starts_at=base + timedelta(hours=i + 1),
                ends_at=base + timedelta(hours=i + 2),
                price=1000,
                advance_amount=1000,
                status=BookingStatus.PAYMENT_SUBMITTED,
                payment_deadline=datetime.now(timezone.utc) + timedelta(hours=1),
            )
            session.add(booking)
            await session.flush()
            payment = Payment(
                booking_id=booking.id,
                proof_key="payment-proofs/x.jpg",
                amount_claimed=1000,
                ocr_amount=1000,
                ocr_verdict="match",
                created_at=datetime.now(timezone.utc) - timedelta(minutes=30 - i * 10),
            )
            session.add(payment)
            await session.flush()
            payment_ids.append(payment.id)
        await session.commit()

    owner_headers = await make_auth_headers(owner)
    resp = await client.get("/api/v1/owners/pending-approvals", headers=owner_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 3
    # Oldest submission first (longest-waiting player served first).
    assert [p["payment_id"] for p in body] == [str(pid) for pid in payment_ids]
    assert body[0]["ocr_verdict"] == "match"
    assert body[0]["expected_amount"] == 1000.0

    approve_resp = await client.post(f"/api/v1/payments/{payment_ids[0]}/approve", headers=owner_headers)
    assert approve_resp.status_code == 200

    resp2 = await client.get("/api/v1/owners/pending-approvals", headers=owner_headers)
    assert len(resp2.json()) == 2


async def test_ledger_accuracy(client, db_session_factory, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923011000020", role=UserRole.OWNER)
    customer = await make_user("+923011000021", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court_a = await make_court(venue, name="Court A")
    court_b = await make_court(venue, name="Court B")

    sources = [BookingSource.APP] * 4 + [BookingSource.WHATSAPP] * 3 + [BookingSource.WALKIN] * 2 + [
        BookingSource.PHONE
    ]
    async with db_session_factory() as session:
        for i in range(10):
            court = court_a if i % 2 == 0 else court_b
            starts_at = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc) + timedelta(days=i)
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(hours=1),
                    price=1000,
                    amount_paid=1000,
                    balance_due=0,
                    status=BookingStatus.COMPLETED,
                    source=sources[i],
                )
            )
        await session.commit()

    owner_headers = await make_auth_headers(owner)
    resp = await client.get(
        "/api/v1/owners/ledger",
        headers=owner_headers,
        params={"start_date": "2026-10-01", "end_date": "2026-10-31"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["bookings"]) == 10
    assert body["summary"]["total_bookings"] == 10
    assert body["summary"]["total_revenue"] == 10000.0
    assert body["summary"]["by_source"] == {"app": 4, "whatsapp": 3, "walkin": 2, "phone": 1}
    assert body["summary"]["by_court"]["Court A"] == 5000.0
    assert body["summary"]["by_court"]["Court B"] == 5000.0


async def test_ledger_csv_export(client, db_session_factory, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923011000030", role=UserRole.OWNER)
    customer = await make_user("+923011000031", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        starts_at = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
        session.add(
            Booking(
                court_id=court.id,
                player_id=customer.id,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=1),
                price=1500,
                amount_paid=1500,
                balance_due=0,
                player_name="Ahmed",
                status=BookingStatus.COMPLETED,
                source=BookingSource.APP,
            )
        )
        await session.commit()

    owner_headers = await make_auth_headers(owner)
    resp = await client.get(
        "/api/v1/owners/ledger/export",
        headers=owner_headers,
        params={"start_date": "2026-10-01", "end_date": "2026-10-31", "format": "csv"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")

    rows = list(csv.reader(io.StringIO(resp.text)))
    # Section 32 Part 10 added a trailing refund_amount column (empty when nothing was refunded).
    assert rows[0] == ["date", "court", "player", "source", "amount_paid", "balance_due", "status", "refund_amount"]
    assert len(rows) == 2
    assert rows[1][1] == court.name
    assert rows[1][2] == "Ahmed"
    assert rows[1][3] == "app"


async def test_growth_suggestions_guardrail_insufficient_history(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923011000040", role=UserRole.OWNER)
    customer = await make_user("+923011000041", role=UserRole.PLAYER)
    venue = await make_venue(owner, plan_tier=PlanTier.PRO)
    court = await make_court(venue, created_at=datetime.now(timezone.utc) - timedelta(days=20))

    async with db_session_factory() as session:
        for i in range(3):
            starts_at = datetime.now(timezone.utc) - timedelta(days=20 - i * 7)
            starts_at = starts_at.replace(hour=10, minute=0, second=0, microsecond=0)
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(hours=1),
                    price=1000,
                    amount_paid=1000,
                    status=BookingStatus.COMPLETED,
                )
            )
        await session.commit()

    async with db_session_factory() as session:
        await compute_slot_stats(session)
        await session.commit()

    owner_headers = await make_auth_headers(owner)
    resp = await client.get("/api/v1/owners/growth", headers=owner_headers)
    assert resp.status_code == 200
    assert resp.json()["underbooked_slots"] == []


async def test_growth_suggestions_shown_for_underbooked_slot_with_enough_data(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923011000050", role=UserRole.OWNER)
    customer = await make_user("+923011000051", role=UserRole.PLAYER)
    venue = await make_venue(owner, plan_tier=PlanTier.PRO)
    # Court has been open for the full 180-day lookback window.
    court = await make_court(venue, created_at=datetime.now(timezone.utc) - timedelta(days=200))

    today = datetime.now(timezone.utc)
    mondays = [today - timedelta(days=today.weekday() + 7 * w) for w in range(1, 26)]
    tuesdays = [today - timedelta(days=today.weekday() - 1 + 7 * w) for w in range(1, 26) if today.weekday() >= 1] or [
        m + timedelta(days=1) for m in mondays
    ]

    async with db_session_factory() as session:
        # Monday 10am: booked only 4 out of ~25 weeks -> underbooked.
        for i, monday in enumerate(mondays[:4]):
            starts_at = monday.replace(hour=10, minute=0, second=0, microsecond=0)
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(hours=1),
                    price=1000,
                    amount_paid=1000,
                    status=BookingStatus.COMPLETED,
                )
            )
        # Tuesday 10am: booked almost every week -> healthy baseline.
        for i, tuesday in enumerate(tuesdays[:22]):
            starts_at = tuesday.replace(hour=10, minute=0, second=0, microsecond=0)
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(hours=1),
                    price=1000,
                    amount_paid=1000,
                    status=BookingStatus.COMPLETED,
                )
            )
        await session.commit()

    async with db_session_factory() as session:
        await compute_slot_stats(session)
        await session.commit()

    owner_headers = await make_auth_headers(owner)
    resp = await client.get("/api/v1/owners/growth", headers=owner_headers)
    assert resp.status_code == 200
    body = resp.json()
    monday_suggestions = [s for s in body["underbooked_slots"] if s["day_of_week"] == mondays[0].weekday()]
    assert len(monday_suggestions) == 1
    suggestion = monday_suggestions[0]
    assert suggestion["booking_rate"] < 0.3
    assert suggestion["weeks_of_data"] >= 6
    assert "%" in suggestion["suggestion"]
    tuesday_dow = tuesdays[0].weekday()
    assert all(s["day_of_week"] != tuesday_dow for s in body["underbooked_slots"])


async def test_growth_requires_pro_tier(client, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923011000060", role=UserRole.OWNER)
    venue = await make_venue(owner, plan_tier=PlanTier.FREE)
    await make_court(venue)

    owner_headers = await make_auth_headers(owner)
    resp = await client.get(
        "/api/v1/owners/growth", headers=owner_headers, params={"venue_id": str(venue.id)}
    )
    assert resp.status_code == 403


async def test_multi_venue_owner_today_and_ledger_filter_by_venue(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner = await make_user("+923011000070", role=UserRole.OWNER)
    customer = await make_user("+923011000071", role=UserRole.PLAYER)
    venue_a = await make_venue(owner, name="Venue A")
    venue_b = await make_venue(owner, name="Venue B")
    court_a = await make_court(venue_a, name="Court VA")
    court_b = await make_court(venue_b, name="Court VB")

    today = _today_utc()
    weekday = today.weekday()
    await make_schedule(court_a, day_of_week=weekday, open_time=time(8, 0), close_time=time(20, 0))
    await make_schedule(court_b, day_of_week=weekday, open_time=time(8, 0), close_time=time(20, 0))

    async with db_session_factory() as session:
        starts_a = pkt_time_to_utc(today, time(9, 0))
        starts_b = pkt_time_to_utc(today, time(11, 0))
        session.add(
            Booking(
                court_id=court_a.id,
                player_id=customer.id,
                starts_at=starts_a,
                ends_at=starts_a + timedelta(hours=1),
                price=1000,
                amount_paid=1000,
                status=BookingStatus.BOOKED,
            )
        )
        session.add(
            Booking(
                court_id=court_b.id,
                player_id=customer.id,
                starts_at=starts_b,
                ends_at=starts_b + timedelta(hours=1),
                price=2000,
                amount_paid=2000,
                status=BookingStatus.BOOKED,
            )
        )
        await session.commit()

    owner_headers = await make_auth_headers(owner)

    today_all = await client.get("/api/v1/owners/today", headers=owner_headers)
    assert today_all.json()["summary"]["total_revenue"] == 3000.0

    today_scoped = await client.get(
        "/api/v1/owners/today", headers=owner_headers, params={"venue_id": str(venue_a.id)}
    )
    assert today_scoped.json()["summary"]["total_revenue"] == 1000.0
    assert len(today_scoped.json()["courts"]) == 1

    ledger_scoped = await client.get(
        "/api/v1/owners/ledger",
        headers=owner_headers,
        params={"start_date": today.isoformat(), "end_date": today.isoformat(), "venue_id": str(venue_b.id)},
    )
    assert ledger_scoped.json()["summary"]["total_revenue"] == 2000.0


async def test_owner_dashboard_endpoints_require_owner_role(client, make_user, make_auth_headers):
    player = await make_user("+923011000080", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    resp = await client.get("/api/v1/owners/today", headers=headers)
    assert resp.status_code == 403
