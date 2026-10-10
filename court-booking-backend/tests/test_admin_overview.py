"""GET /admin/overview: the read-only cross-platform picture for the super admin (no schema change behind it)."""

from datetime import datetime, time, timedelta, timezone

from app.models.ai_usage import AIUsageLog
from app.models.booking import Booking, BookingStatus
from app.models.message import Message
from app.models.payment import Payment
from app.models.user import Session, UserRole
from app.models.venue import VenueStatus
from app.utils.security import generate_session_token, hash_token, token_expiry
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _booking(court, player, day, start, end, status=BookingStatus.BOOKED, price=3000, paid=1000, created=None):
    b = Booking(
        court_id=court.id, player_id=player.id, player_phone=player.phone,
        starts_at=pkt_time_to_utc(day, start), ends_at=pkt_time_to_utc(day, end),
        price=price, advance_amount=paid, amount_paid=paid, balance_due=price - paid, status=status,
    )
    if created:
        b.created_at = created
    return b


async def test_only_an_admin_can_see_the_overview(client, make_user, make_auth_headers):
    owner = await make_user("+923097000001", role=UserRole.OWNER)
    assert (await client.get("/api/v1/admin/overview", headers=await make_auth_headers(owner))).status_code == 403
    assert (await client.get("/api/v1/admin/overview")).status_code in (401, 403)


async def test_overview_on_an_empty_platform_is_all_zero_not_an_error(client, make_user, make_auth_headers):
    admin = await make_user("+923097000002", role=UserRole.ADMIN)
    resp = await client.get("/api/v1/admin/overview", headers=await make_auth_headers(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["courts"] == [] and body["underperforming"] == []
    assert body["usage"]["bookings"] == {"today": 0, "last_7_days": 0, "last_30_days": 0}
    assert body["usage"]["payment_approval_rate"] is None


async def test_overview_figures_match_the_data(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    admin = await make_user("+923097000003", role=UserRole.ADMIN)
    owner = await make_user("+923097000004", role=UserRole.OWNER, name="Active Owner")
    suspended = await make_user("+923097000005", role=UserRole.OWNER, name="Suspended Owner", is_active=False)
    other = await make_user("+923097000006", role=UserRole.OWNER, name="New Owner")
    p1 = await make_user("+923097000007", role=UserRole.PLAYER)
    p2 = await make_user("+923097000008", role=UserRole.PLAYER)
    p3 = await make_user("+923097000009", role=UserRole.PLAYER)  # never active

    alpha = await make_venue(owner, name="Alpha Arena")
    beta = await make_venue(suspended, name="Beta Arena")
    gamma = await make_venue(other, name="Gamma Arena", status=VenueStatus.PENDING)
    busy = await make_court(alpha, name="Busy Court", sport="padel")
    quiet = await make_court(beta, name="Quiet Court", sport="futsal")
    await make_court(gamma, name="Pending Court", sport="padel")

    today = pkt_today()
    now = datetime.now(timezone.utc)
    async with db_session_factory() as session:
        session.add_all([
            _booking(busy, p1, today, time(18, 0), time(19, 0), price=4000, paid=4000),
            _booking(busy, p2, today, time(19, 0), time(20, 0), price=4000, paid=1000),
            _booking(busy, p1, today, time(20, 0), time(21, 0), status=BookingStatus.CANCELLED),  # not counted
            _booking(busy, p1, today - timedelta(days=3), time(18, 0), time(19, 0), status=BookingStatus.COMPLETED, price=2000, paid=2000),
            _booking(busy, p2, today - timedelta(days=40), time(18, 0), time(19, 0), status=BookingStatus.COMPLETED, price=9000, paid=9000),
        ])
        # chat volume: 2 app + 1 whatsapp messages from players today; a reply (ai) must not count
        session.add_all([
            Message(sender_id=p1.id, sender_type="player", channel="app", content="hi"),
            Message(sender_id=p1.id, sender_type="player", channel="app", content="hello"),
            Message(sender_id=p2.id, sender_type="player", channel="whatsapp", content="salam"),
            Message(sender_id=p1.id, sender_type="ai", channel="app", content="reply"),
        ])
        session.add_all([AIUsageLog(provider="gemini", model="m", purpose="chat", input_tokens=100, output_tokens=20),
                         AIUsageLog(provider="gemini", model="m", purpose="vision", input_tokens=50, output_tokens=5)])
        # one player used the app (a session), one only chatted, one did neither
        session.add(Session(user_id=p1.id, token_hash=hash_token(generate_session_token(), "x"), expires_at=token_expiry(hours=8)))
        # four payments (each on its own cancelled booking, so the booking counts above are untouched)
        for verdict, auto in (("approved", True), ("approved", False), ("rejected", False), (None, False)):
            old = _booking(quiet, p1, today - timedelta(days=10), time(10, 0), time(11, 0), status=BookingStatus.CANCELLED)
            session.add(old)
            await session.flush()
            session.add(Payment(booking_id=old.id, proof_key="x.jpg", amount_claimed=1000, review_verdict=verdict, auto_approved=auto))
        await session.commit()

    resp = await client.get("/api/v1/admin/overview", headers=await make_auth_headers(admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # --- venues / courts
    by_name = {c["court_name"]: c for c in body["courts"]}
    assert set(by_name) == {"Busy Court", "Quiet Court", "Pending Court"}
    assert by_name["Busy Court"]["state"] == "active"
    assert by_name["Busy Court"]["bookings_today"] == 2  # the cancelled one is not counted
    assert by_name["Busy Court"]["owner_name"] == "Active Owner"
    assert by_name["Busy Court"]["idle"] is False and by_name["Busy Court"]["last_booking_at"] is not None
    assert by_name["Quiet Court"]["state"] == "suspended" and by_name["Quiet Court"]["idle"] is False
    assert by_name["Pending Court"]["state"] == "not_live"

    # --- users
    users = body["users"]
    assert users["total_players"] == 3 and users["total_owners"] == 3 and users["total_admins"] == 1
    assert users["new_players_7_days"] == 3 and users["new_owners_30_days"] == 3
    assert users["active_30_days"] == 2 and users["active_30_days_of_total"] == 6  # p1 (session + chat), p2 (chat)

    # --- usage
    usage = body["usage"]
    assert usage["bookings"]["today"] == 2
    assert usage["bookings"]["last_7_days"] >= 3  # + the one 3 days ago
    assert usage["bookings"]["last_30_days"] == usage["bookings"]["last_7_days"]  # the 40-day-old one is outside
    assert usage["gmv_pkr"]["today"] == 8000 and usage["collected_pkr"]["today"] == 5000
    assert usage["chat_messages_app"]["today"] == 2 and usage["chat_messages_whatsapp"]["today"] == 1
    assert usage["ai_model_calls_30_days"] == 2 and usage["ai_tokens_30_days"] == 175
    assert (usage["payments_approved_30_days"], usage["payments_rejected_30_days"], usage["payments_pending_30_days"]) == (2, 1, 1)
    assert usage["payments_auto_approved_30_days"] == 1
    assert usage["payment_approval_rate"] == round(2 / 3, 4)


async def test_a_live_court_with_no_bookings_reads_idle(
    client, make_user, make_venue, make_court, make_auth_headers
):
    admin = await make_user("+923097000010", role=UserRole.ADMIN)
    owner = await make_user("+923097000011", role=UserRole.OWNER)
    await make_court(await make_venue(owner, name="Dusty"), name="Dusty Court")
    body = (await client.get("/api/v1/admin/overview", headers=await make_auth_headers(admin))).json()
    court = body["courts"][0]
    assert court["state"] == "active" and court["idle"] is True and court["last_booking_at"] is None


async def test_underperforming_ranks_the_emptiest_court_first_and_skips_new_courts(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    from sqlalchemy import update

    from app.models.court import Court

    admin = await make_user("+923097000012", role=UserRole.ADMIN)
    owner = await make_user("+923097000013", role=UserRole.OWNER)
    player = await make_user("+923097000014", role=UserRole.PLAYER)
    venue = await make_venue(owner, name="Rate Arena")
    full = await make_court(venue, name="Fullish")
    empty = await make_court(venue, name="Empty")
    fresh = await make_court(venue, name="Brand New")
    old = datetime.now(timezone.utc) - timedelta(days=60)
    async with db_session_factory() as session:
        await session.execute(update(Court).where(Court.id.in_([full.id, empty.id])).values(created_at=old))
        await session.commit()
    for court in (full, empty, fresh):
        for d in range(7):
            await make_schedule(court, day_of_week=d, open_time=time(8, 0), close_time=time(22, 0))  # 14 open hours a day
    today = pkt_today()
    async with db_session_factory() as session:
        for i in range(1, 15):  # 14 booked hours over the last 28 days on "Fullish", none on "Empty"
            session.add(_booking(full, player, today - timedelta(days=i), time(18, 0), time(19, 0)))
        session.add(_booking(fresh, player, today - timedelta(days=1), time(18, 0), time(19, 0)))
        await session.commit()

    body = (await client.get("/api/v1/admin/overview", headers=await make_auth_headers(admin))).json()
    names = [c["court_name"] for c in body["underperforming"]]
    assert names == ["Empty", "Fullish"]  # the brand-new court has under a week of data and is left out
    empty_row, full_row = body["underperforming"]
    assert empty_row["booking_rate"] == 0 and empty_row["days_measured"] == 28
    assert full_row["booked_hours"] == 14.0 and full_row["open_hours"] == 14 * 28
    assert full_row["booking_rate"] == round(14 / (14 * 28), 4)
