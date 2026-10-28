"""Audit build 2026-10-28, Phase 1 (no migration). One section per item; see docs/audit-build-progress.md."""

from app.services.auth_service import AuthService


# ---------------------------------------------------------------- item 1: /auth/me never 500s


async def test_auth_me_is_401_when_the_session_rotates_between_lookups(client, make_user, make_auth_headers, monkeypatch):
    """CurrentUser resolved the token, then a parallel refresh revoked the session before get_me's own lookup."""
    user = await make_user("+923001110001")
    headers = await make_auth_headers(user)

    async def _gone(self, token):
        return None

    async def _user(self, token):
        return user

    monkeypatch.setattr(AuthService, "get_user_from_token", _user)
    monkeypatch.setattr(AuthService, "get_session_from_token", _gone)
    resp = await client.get("/api/v1/auth/me", headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "SESSION_EXPIRED"


async def test_auth_me_still_works(client, make_user, make_auth_headers):
    user = await make_user("+923001110002")
    resp = await client.get("/api/v1/auth/me", headers=await make_auth_headers(user))
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == str(user.id)


# ---------------------------------------------------------------- item 2: hidden venues stay hidden

from datetime import date, time, timedelta  # noqa: E402

from app.models.user import UserRole  # noqa: E402
from app.models.venue import VenueStatus  # noqa: E402


def _starts_at() -> str:
    return f"{(date.today() + timedelta(days=3)).isoformat()}T10:00:00Z"


async def _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, **venue_kwargs):
    owner = await make_user("+923001120001", role=UserRole.OWNER)
    venue = await make_venue(owner, **venue_kwargs)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    return owner, venue, court


async def test_pending_venue_page_is_404_for_players_but_open_for_its_owner(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, _court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, status=VenueStatus.PENDING
    )
    player = await make_user("+923001120002")
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 404
    assert (await client.get(f"/api/v1/venues/{venue.id}", headers=await make_auth_headers(player))).status_code == 404
    mine = await client.get(f"/api/v1/venues/{venue.id}", headers=await make_auth_headers(owner))
    assert mine.status_code == 200
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}", headers=await make_auth_headers(owner))).status_code == 200


async def test_deleted_or_rejected_venue_slots_and_quote_are_hidden(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, is_active=False
    )
    day = (date.today() + timedelta(days=3)).isoformat()
    month = day[:7]
    for url in (
        f"/api/v1/courts/{court.id}/availability?date={day}",
        f"/api/v1/venues/{venue.id}/availability?date={day}",
        f"/api/v1/courts/{court.id}/quote?starts_at={_starts_at()}",
        f"/api/v1/courts/{court.id}/availability/summary?month={month}",
    ):
        resp = await client.get(url)
        assert resp.status_code == 404, url
        assert resp.json()["error"]["code"] == "VENUE_NOT_FOUND", url
    # the owner keeps their walk-in grid
    owner_headers = await make_auth_headers(owner)
    assert (await client.get(f"/api/v1/courts/{court.id}/availability?date={day}", headers=owner_headers)).status_code == 200


async def test_rejected_venue_is_hidden(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    _o, venue, _c = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, status=VenueStatus.REJECTED
    )
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 404


async def test_soft_deleted_venue_cannot_be_held_by_court_id(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _owner, _venue, court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, is_active=False
    )
    player = await make_user("+923001120003")
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=await make_auth_headers(player),
        json={"court_id": str(court.id), "starts_at": _starts_at()},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VENUE_NOT_APPROVED"


async def test_live_venue_still_opens_and_holds(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 200
    player = await make_user("+923001120004")
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=await make_auth_headers(player),
        json={"court_id": str(court.id), "starts_at": _starts_at()},
    )
    assert resp.status_code == 201


async def test_ai_tools_do_not_describe_hidden_venues(db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    from app.config import get_settings
    from app.services.ai_chat_service import AIChatService

    _o, venue, court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, status=VenueStatus.PENDING
    )
    svc = AIChatService(db_session, get_settings())
    assert "error" in await svc._tool_get_venue_info({"venue_id": str(venue.id)})
    assert "error" in await svc._tool_get_venue_courts({"venue_id": str(venue.id)})
    out = await svc._tool_check_availability({"court_id": str(court.id), "date": (date.today() + timedelta(days=3)).isoformat()})
    assert "error" in out


# ---------------------------------------------------------------- item 3: replies are Latin letters only

from app.services import chat_validator  # noqa: E402
from app.services.chat_language import detect_language, has_non_latin, transliterate_common  # noqa: E402


def test_script_detection_sees_devanagari_and_urdu():
    assert has_non_latin("शुक्रिया! आपकी बुकिंग हो गई।")
    assert has_non_latin("شکریہ")
    assert not has_non_latin("Shukriya, aap ka slot book ho gaya. PKR 3,000")


def test_a_player_writing_hindi_or_urdu_script_gets_roman_urdu():
    assert detect_language("मुझे कल का स्लॉट चाहिए") == "ru"
    assert detect_language("مجھے کل کا سلاٹ چاہیے") == "ru"


def test_common_words_are_transliterated_and_unknown_script_is_left_for_the_validator():
    assert transliterate_common("शुक्रिया!") == "Shukriya!"
    assert transliterate_common("شکریہ، جی") == "Shukriya, Ji"
    assert has_non_latin(transliterate_common("शुक्रिया! आपकी बुकिंग हो गई।"))  # whole Hindi sentence: still rejected


def test_prompt_never_invites_urdu_script():
    from app.services.ai_chat_service import SYSTEM_PROMPT

    assert "English, Urdu," not in SYSTEM_PROMPT
    assert "Latin letters" in SYSTEM_PROMPT


async def test_a_devanagari_draft_is_regenerated_and_the_player_never_sees_it(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    from tests.test_chat_replay import ScriptedModel, arena, player_headers, say, text

    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    _u, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch, [text("बुकिंग कैंसल करने के लिए My Bookings खोलें।"), text("Booking cancel karne ke liye My Bookings kholein.")])
    reply = (await say(client, headers, "booking cancel kaise hoti hai?"))["reply"]
    assert not has_non_latin(reply), reply
    assert reply == "Booking cancel karne ke liye My Bookings kholein."
    assert len(model.bodies) == 2, "the Devanagari draft must have been rejected and regenerated"


async def test_a_model_stuck_in_devanagari_gets_the_latin_fallback(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    from tests.test_chat_replay import ScriptedModel, arena, player_headers, say, text

    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    _u, headers = await player_headers(make_user, make_auth_headers)
    ScriptedModel(monkeypatch, [text("बुकिंग कैंसल करने के लिए My Bookings खोलें।")])
    reply = (await say(client, headers, "booking cancel kaise hoti hai?"))["reply"]
    assert reply and not has_non_latin(reply), reply


def test_validator_flags_mixed_script_drafts():
    from app.services.chat_validator import Issue  # noqa: F401

    assert chat_validator._INSTRUCTIONS["non_latin_script"]


# ---------------------------------------------------------------- item 4: the player's booking detail


async def test_player_booking_detail_has_everything_for_a_held_booking(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001140001")
    headers = await make_auth_headers(player)
    held = (await client.post("/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": _starts_at()})).json()
    bid = held["booking"]["id"]
    resp = await client.get(f"/api/v1/bookings/{bid}/detail", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["venue"]["name"] == venue.name and body["venue"]["slug"] == venue.slug
    assert body["court"]["sport"] == "padel"
    assert body["duration_minutes"] == 60
    assert body["booking"]["status"] == "held"
    assert [e["kind"] for e in body["timeline"]] == ["held"]
    assert body["payments"] == []
    assert body["venue"]["cancellation_allowed"] is True


async def test_player_booking_detail_lists_cash_paid_at_a_walkin_and_hides_from_others(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001140002", name="Ali")
    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=await make_auth_headers(owner),
        json={"court_id": str(court.id), "starts_at": _starts_at(), "player_name": "Ali", "player_phone": "+923001140002", "amount_paid": 400},
    )
    assert resp.status_code == 201, resp.text
    bid = resp.json()["booking"]["id"]
    detail = (await client.get(f"/api/v1/bookings/{bid}/detail", headers=await make_auth_headers(player))).json()
    assert [(p["amount"], p["method"]) for p in detail["payments"]] == [(400, "cash_at_venue")]
    assert detail["booking"]["balance_due"] == 600
    stranger = await make_user("+923001140003")
    assert (await client.get(f"/api/v1/bookings/{bid}/detail", headers=await make_auth_headers(stranger))).status_code in (403, 404)


# ---------------------------------------------------------------- item 6: player photo on owner screens


async def test_owner_rows_carry_the_players_photo(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    await make_user("+923001160001", name="Hina", avatar_url="https://cdn.example/avatars/hina.jpg")
    day = date.today() + timedelta(days=3)
    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=await make_auth_headers(owner),
        json={"court_id": str(court.id), "starts_at": _starts_at(), "player_name": "Hina", "player_phone": "+923001160001", "amount_paid": 0},
    )
    assert resp.status_code == 201, resp.text
    headers = await make_auth_headers(owner)
    ov = (await client.get(f"/api/v1/owners/overview?date={day.isoformat()}&venue_id={venue.id}", headers=headers)).json()
    assert [r["player_avatar_url"] for r in ov["rows"]] == ["https://cdn.example/avatars/hina.jpg"]
    today = (await client.get(f"/api/v1/owners/today?date_={day.isoformat()}&venue_id={venue.id}", headers=headers)).json()
    booked = [s for c in today["courts"] for s in c["slots"] if s.get("booking_id")]
    assert booked and all(s["player_avatar_url"] == "https://cdn.example/avatars/hina.jpg" for s in booked)


# ---------------------------------------------------------------- item 7: the approvals badge counts only actionable proofs


async def _booking_with_proof(db_session_factory, court, player, status, start_hour, cancelled_by=None):
    from datetime import datetime, timezone

    from app.models.booking import Booking, BookingStatus, CancelledBy
    from app.models.payment import Payment

    day = date.today() + timedelta(days=4)
    starts = datetime(day.year, day.month, day.day, start_hour, 0, tzinfo=timezone.utc)
    async with db_session_factory() as s:
        b = Booking(
            court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
            status=BookingStatus(status), price=1000, advance_amount=1000,
            cancelled_by=CancelledBy(cancelled_by) if cancelled_by else None,
        )
        s.add(b)
        await s.flush()
        s.add(Payment(booking_id=b.id, proof_key="proofs/x.jpg", amount_claimed=1000))
        await s.commit()
        return b


async def test_badge_ignores_unreviewed_proofs_on_cancelled_or_expired_bookings(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001170001")
    await _booking_with_proof(db_session_factory, court, player, "payment_submitted", 9)
    await _booking_with_proof(db_session_factory, court, player, "cancelled", 11, cancelled_by="player")
    await _booking_with_proof(db_session_factory, court, player, "cancelled", 13, cancelled_by="system")
    resp = await client.get(f"/api/v1/owners/badges?venue_id={venue.id}", headers=await make_auth_headers(owner))
    assert resp.status_code == 200, resp.text
    assert resp.json()["approvals"] == 1


# ---------------------------------------------------------------- item 8: the audit log names the real actor


async def make_staff(db_session_factory, make_user, venue, phone, permissions, name="Bilal"):
    from app.models.staff import StaffMember, StaffPermission

    staff = await make_user(phone, role=UserRole.STAFF, name=name)
    async with db_session_factory() as s:
        sm = StaffMember(staff_user_id=staff.id, venue_id=venue.id, invited_by_user_id=venue.owner_id, is_active=True)
        s.add(sm)
        await s.flush()
        for p in permissions:
            s.add(StaffPermission(staff_member_id=sm.id, permission=p))
        await s.commit()
    return staff


async def _audit_rows(db_session_factory, action):
    from sqlalchemy import select

    from app.models.audit import AuditLog

    async with db_session_factory() as s:
        return list((await s.execute(select(AuditLog).where(AuditLog.action == action))).scalars().all())


async def _booked_walkin(client, owner_headers, court, phone, paid=0, hour=10):
    day = (date.today() + timedelta(days=3)).isoformat()
    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=owner_headers,
        json={"court_id": str(court.id), "starts_at": f"{day}T{hour:02d}:00:00Z", "player_name": "Ali", "player_phone": phone, "amount_paid": paid},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["booking"]["id"]


async def test_staff_check_in_is_logged_as_the_staff_member(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001180001")
    staff = await make_staff(db_session_factory, make_user, venue, "+923001180002", ["check_in"])
    bid = await _booked_walkin(client, await make_auth_headers(owner), court, "+923001180001")
    resp = await client.post(f"/api/v1/bookings/{bid}/checkin", headers=await make_auth_headers(staff))
    assert resp.status_code == 200, resp.text
    rows = await _audit_rows(db_session_factory, "booking.checked_in")
    assert [(r.actor_id, r.actor_type) for r in rows] == [(staff.id, "staff")]
    assert rows[0].actor_id != player.id


async def test_owner_cancel_and_walkin_are_logged_as_the_owner(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    await make_user("+923001180011")
    headers = await make_auth_headers(owner)
    bid = await _booked_walkin(client, headers, court, "+923001180011")
    resp = await client.post(f"/api/v1/bookings/{bid}/cancel", headers=headers, json={"reason": "rain"})
    assert resp.status_code == 200, resp.text
    cancelled = await _audit_rows(db_session_factory, "booking.cancelled")
    assert [(r.actor_id, r.actor_type) for r in cancelled] == [(owner.id, "owner")]
    walkin = await _audit_rows(db_session_factory, "booking.walkin")
    assert walkin[0].actor_id == owner.id


async def test_bank_detail_edits_are_audited_with_masked_numbers(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, _court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    headers = await make_auth_headers(owner)
    body = {"bank_details": {"bank": "Meezan", "account_title": "KHA Sports", "account_number": "01234567890123", "iban": "PK36MEZN0001234567890123"}}
    assert (await client.patch(f"/api/v1/venues/{venue.id}", headers=headers, json=body)).status_code == 200
    body["bank_details"]["account_number"] = "99990000111122"
    assert (await client.patch(f"/api/v1/venues/{venue.id}", headers=headers, json=body)).status_code == 200
    # the same details again change nothing and log nothing
    assert (await client.patch(f"/api/v1/venues/{venue.id}", headers=headers, json=body)).status_code == 200
    rows = await _audit_rows(db_session_factory, "venue.bank_details_changed")
    assert len(rows) == 2
    last = rows[-1]
    assert last.actor_id == owner.id
    assert last.old_value["account_number"] == "**********0123"
    assert last.new_value["account_number"] == "**********1122"
    assert last.new_value["iban"].endswith("0123") and "MEZN" not in last.new_value["iban"]
    assert last.new_value["account_title"] == "KHA Sports"


async def test_staff_permission_changes_are_audited(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from sqlalchemy import select

    from app.models.staff import StaffMember

    owner, venue, _court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    staff = await make_staff(db_session_factory, make_user, venue, "+923001180021", ["view_ledger"])
    async with db_session_factory() as s:
        sm_id = (await s.execute(select(StaffMember.id).where(StaffMember.staff_user_id == staff.id))).scalar_one()
    headers = await make_auth_headers(owner)
    resp = await client.patch(f"/api/v1/staff/{sm_id}/permissions", headers=headers, json={"permissions": ["view_ledger", "check_in"]})
    assert resp.status_code == 200, resp.text
    rows = await _audit_rows(db_session_factory, "staff.permissions_changed")
    assert rows and rows[0].actor_id == owner.id
    assert rows[0].old_value == {"permissions": ["view_ledger"]}
    assert rows[0].new_value == {"permissions": ["check_in", "view_ledger"]}


# ---------------------------------------------------------------- item 9: no venue goes live incomplete


async def test_admin_cannot_approve_an_incomplete_venue_and_sees_what_is_missing(
    client, make_user, make_venue, make_court, make_auth_headers
):
    admin = await make_user("+923001190001", role=UserRole.ADMIN)
    owner = await make_user("+923001190002", role=UserRole.OWNER)
    venue = await make_venue(owner, status=VenueStatus.PENDING, photos=[])
    await make_court(venue, name="Court 1")
    headers = await make_auth_headers(admin)
    resp = await client.post(f"/api/v1/admin/venues/{venue.id}/approve", headers=headers)
    assert resp.status_code == 400
    body = resp.json()["error"]
    assert body["code"] == "VENUE_INCOMPLETE"
    codes = {(m["code"], m["court"]) for m in body["details"]["missing"]}
    assert codes == {("photo", None), ("bank_details", None), ("schedule", "Court 1"), ("pricing", "Court 1")}
    # the owner sees the same list on their own venue
    mine = (await client.get(f"/api/v1/venues/{venue.id}", headers=await make_auth_headers(owner))).json()
    assert {(m["code"], m["court"]) for m in mine["missing_for_approval"]} == codes


async def test_a_complete_venue_is_approved(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from app.config import get_settings
    from app.utils.encryption import encrypt_json

    admin = await make_user("+923001190011", role=UserRole.ADMIN)
    owner = await make_user("+923001190012", role=UserRole.OWNER)
    venue = await make_venue(
        owner,
        status=VenueStatus.PENDING,
        photos=["venues/a.jpg"],
        bank_details=encrypt_json({"bank": "HBL", "account_title": "Arena", "account_number": "12345678"}, get_settings()),
    )
    court = await make_court(venue)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    resp = await client.post(f"/api/v1/admin/venues/{venue.id}/approve", headers=await make_auth_headers(admin))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "approved"
    assert resp.json()["missing_for_approval"] == []


# ---------------------------------------------------------------- item 10: refund rows and the "refund owed" notice


async def _log_rows(db_session_factory, user_id, event):
    from sqlalchemy import select

    from app.models.notification import NotificationLog

    async with db_session_factory() as s:
        return list(
            (await s.execute(select(NotificationLog).where(NotificationLog.user_id == user_id, NotificationLog.event_type == event))).scalars().all()
        )


async def test_cancelling_a_cash_paid_booking_sends_no_refund_owed_notice(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001200001")
    bid = await _booked_walkin(client, await make_auth_headers(owner), court, "+923001200001", paid=500)
    resp = await client.post(f"/api/v1/bookings/{bid}/cancel", headers=await make_auth_headers(player), json={})
    assert resp.status_code == 200, resp.text
    assert await _log_rows(db_session_factory, owner.id, "refund_owed") == []


async def test_cancelling_an_online_paid_booking_puts_it_on_refunds_and_tells_the_owner(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.models.booking import Booking, BookingStatus
    from app.models.dispute import PaymentDispute
    from app.models.payment import Payment
    from app.models.payment_entry import PaymentEntry, PaymentMethod

    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001200011")
    starts = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(days=4)
    async with db_session_factory() as s:
        b = Booking(court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
                    status=BookingStatus.BOOKED, price=1000, advance_amount=1000, amount_paid=1000, balance_due=0)
        s.add(b)
        await s.flush()
        s.add(Payment(booking_id=b.id, proof_key="p.jpg", amount_claimed=1000, review_verdict="approved", reviewed_at=starts))
        s.add(PaymentEntry(booking_id=b.id, amount_pkr=1000, method=PaymentMethod.BANK_TRANSFER_PROOF))
        await s.commit()
        bid = b.id
    resp = await client.post(f"/api/v1/bookings/{bid}/cancel", headers=await make_auth_headers(player), json={})
    assert resp.status_code == 200, resp.text
    async with db_session_factory() as s:
        disputes = (await s.execute(select(PaymentDispute).where(PaymentDispute.booking_id == bid))).scalars().all()
    assert [(d.reason, float(d.refund_amount)) for d in disputes] == [("player_cancelled_paid_booking", 1000.0)]
    assert len(await _log_rows(db_session_factory, owner.id, "refund_owed")) >= 1


# ---------------------------------------------------------------- item 15: hidden defaults are listed for the owner


async def test_owner_sees_settings_still_running_on_defaults(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, _court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    headers = await make_auth_headers(owner)
    body = (await client.get(f"/api/v1/venues/{venue.id}", headers=headers)).json()
    codes = {(u["code"], u["court"]) for u in body["unconfirmed_settings"]}
    assert ("hold_minutes", None) in codes and ("advance", "Court 1") in codes
    # saving the timers with real values confirms them
    timers = {"hold_minutes": 15, "reminders_enabled": True, "first_reminder_after_min": 10, "repeat_every_min": 30,
              "max_reminders": 5, "auto_cancel_enabled": True, "auto_cancel_after_min": 120}
    resp = await client.put(f"/api/v1/owners/venues/{venue.id}/timers", headers=headers, json=timers)
    assert resp.status_code == 200, resp.text
    body = (await client.get(f"/api/v1/venues/{venue.id}", headers=headers)).json()
    assert {u["code"] for u in body["unconfirmed_settings"]} == {"advance"}
    # the public never sees it
    assert "unconfirmed_settings" not in (await client.get(f"/api/v1/venues/{venue.id}")).json()


# ---------------------------------------------------------------- item 16: the staff dashboard


async def _past_booked(db_session_factory, court, player, hours_ago=3, price=2000, paid=500):
    from datetime import datetime, timezone

    from app.models.booking import Booking, BookingStatus

    starts = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=hours_ago)
    async with db_session_factory() as s:
        b = Booking(court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
                    status=BookingStatus.BOOKED, price=price, advance_amount=500, amount_paid=paid, balance_due=price - paid)
        s.add(b)
        await s.flush()
        if paid:
            from app.models.payment_entry import PaymentEntry, PaymentMethod

            s.add(PaymentEntry(booking_id=b.id, amount_pkr=paid, method=PaymentMethod.BANK_TRANSFER_PROOF))
        await s.commit()
        return b


async def test_staff_dashboard_counts_each_person_and_lists_no_shows(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    staff = await make_staff(db_session_factory, make_user, venue, "+923001210001", ["check_in", "record_payments", "walkin"], name="Bilal")
    player = await make_user("+923001210002", name="Ali")
    sh = await make_auth_headers(staff)
    oh = await make_auth_headers(owner)
    # Bilal: one no-show, one cash walk-in
    ns = await _past_booked(db_session_factory, court, player, hours_ago=5)
    assert (await client.post(f"/api/v1/bookings/{ns.id}/no-show", headers=sh)).status_code == 200
    await _booked_walkin(client, sh, court, "+923001210002", paid=700, hour=11)
    # the owner: one short payment ("kam mila": received 300 of the 1500 still due)
    short = await _past_booked(db_session_factory, court, player, hours_ago=3)
    resp = await client.post(
        f"/api/v1/owners/bookings/{short.id}/completion", headers=oh,
        json={"result": "no", "received_now": 300, "reason": "baqi kal dega"},
    )
    assert resp.status_code == 200, resp.text

    out = (await client.get(f"/api/v1/owners/staff-activity?venue_id={venue.id}", headers=oh)).json()
    people = {p["name"]: p for p in out["people"]}
    assert people["Bilal"]["no_shows"] == 1 and people["Bilal"]["walkins"] == 1
    assert people["Bilal"]["cash_pkr"] == 700 and people["Bilal"]["cash_entries"] == 1
    owner_row = next(p for p in out["people"] if p["role"] == "owner")
    assert owner_row["short_payments"] == 1 and owner_row["short_amount_pkr"] == 1200
    assert owner_row["cash_pkr"] == 300
    assert out["totals"]["total_recorded_pkr"] == 1000
    assert [(n["marked_by_name"], n["player_name"]) for n in out["no_shows"]] == [("Bilal", "Ali")]
    # staff may not see the dashboard; an admin may, for any venue
    assert (await client.get("/api/v1/owners/staff-activity", headers=sh)).status_code == 403
    admin = await make_user("+923001210003", role=UserRole.ADMIN)
    adm = await client.get(f"/api/v1/admin/staff-activity?venue_id={venue.id}", headers=await make_auth_headers(admin))
    assert adm.status_code == 200 and adm.json()["totals"]["no_shows"] == 1


# ---------------------------------------------------------------- the build's new flags ship OFF without a migration


async def test_new_flags_are_off_until_an_admin_switches_them_on(client, db_session, make_user, make_auth_headers):
    from app.services.feature_flag_service import FeatureFlagService

    svc = FeatureFlagService(db_session)
    for key in ("cnic_visibility_gate", "iban_qr", "whatsapp_templates", "balance_proof", "player_points"):
        assert await svc.is_on(key) is False, key
    assert await svc.is_on("reviews") is True  # older flags still fail open
    admin = await make_user("+923001220001", role=UserRole.ADMIN)
    headers = await make_auth_headers(admin)
    listed = {f["key"]: f["enabled"] for f in (await client.get("/api/v1/admin/feature-flags", headers=headers)).json()}
    assert listed["iban_qr"] is False
    resp = await client.patch("/api/v1/admin/feature-flags/iban_qr", headers=headers, json={"enabled": True})
    assert resp.status_code == 200, resp.text
    assert await FeatureFlagService(db_session).is_on("iban_qr") is True


# ---------------------------------------------------------------- items 17 + 18: who hears about a no-show / short payment


async def test_staff_no_show_and_short_payment_reach_the_owner_and_the_player_without_whatsapp(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    sent = []

    async def no_whatsapp(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", no_whatsapp)
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    staff = await make_staff(db_session_factory, make_user, venue, "+923001230001", ["check_in", "record_payments"], name="Bilal")
    player = await make_user("+923001230002", name="Ali")
    sh = await make_auth_headers(staff)

    ns = await _past_booked(db_session_factory, court, player, hours_ago=5)
    assert (await client.post(f"/api/v1/bookings/{ns.id}/no-show", headers=sh)).status_code == 200
    owner_rows = await _log_rows(db_session_factory, owner.id, "owner_staff_action")
    assert owner_rows and owner_rows[0].reference_id == ns.id
    player_rows = await _log_rows(db_session_factory, player.id, "player_no_show")
    assert player_rows and player_rows[0].reference_id == ns.id

    short = await _past_booked(db_session_factory, court, player, hours_ago=3)
    resp = await client.post(
        f"/api/v1/owners/bookings/{short.id}/completion", headers=sh, json={"result": "no", "received_now": 300, "reason": "kal dega"}
    )
    assert resp.status_code == 200, resp.text
    assert len(await _log_rows(db_session_factory, owner.id, "owner_staff_action")) == 2
    assert await _log_rows(db_session_factory, player.id, "player_short")
    assert sent == [], "WhatsApp must stay silent while the whatsapp_templates flag is off"


async def test_owner_doing_it_themselves_does_not_notify_the_owner(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001230011", name="Sana")
    ns = await _past_booked(db_session_factory, court, player, hours_ago=5)
    assert (await client.post(f"/api/v1/bookings/{ns.id}/no-show", headers=await make_auth_headers(owner))).status_code == 200
    assert await _log_rows(db_session_factory, owner.id, "owner_staff_action") == []
    assert await _log_rows(db_session_factory, player.id, "player_no_show")


# ---------------------------------------------------------------- item 19: walk-in phone required


async def test_walkin_needs_the_players_phone_but_an_old_app_build_is_not_refused(
    client, legacy_client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    headers = await make_auth_headers(owner)
    day = (date.today() + timedelta(days=3)).isoformat()
    body = {"court_id": str(court.id), "starts_at": f"{day}T10:00:00Z", "player_name": "Walk In", "amount_paid": 0}
    resp = await client.post("/api/v1/bookings/walkin", headers=headers, json=body)
    assert resp.status_code == 422 and resp.json()["error"]["details"]["field"] == "player_phone"
    assert (await client.post("/api/v1/bookings/walkin", headers=headers, json={**body, "player_phone": "0333 1234567"})).status_code == 201
    old = await legacy_client.post("/api/v1/bookings/walkin", headers=headers, json={**body, "starts_at": f"{day}T12:00:00Z"})
    assert old.status_code == 201, old.text
