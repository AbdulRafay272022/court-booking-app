"""Audit build 2026-10-28, Phase 3 items 3-6 + 8 (points, short payments / dues, no-show replies, arrival GPS, WhatsApp
quick replies). Every flag defaults OFF; each test switches on only what it needs. Real Postgres."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.audit_phase3 import PointEntry, ShortPaymentClaim
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.user import UserRole
from app.models.venue import Venue
from app.services import phase3_service as p3
from overview_helpers import add_booking, at, past_day, seed_venue
from tests.round2_helpers import log_rows, mock_upload
from tests.test_audit_phase3 import booked_with_balance, half_advance_venue, set_flag, submit_other_proof


def completion_url(booking_id) -> str:
    return f"/api/v1/owners/bookings/{booking_id}/completion"


async def _short_booking(client, sf, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, phone):
    """An owner, a player, and a finished booking of PKR 2,000 completed with only PKR 1,000 received."""
    owner, venue, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone)
    player = await make_user(phone[:-1] + "9", name="Saad")
    b = await add_booking(sf, court, at(past_day(), 12), 1, player=player, price=2000, paid=500, source=BookingSource.APP, name="Saad")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    r = await client.post(completion_url(b.id), json={"result": "no", "received_pkr": 1000, "reason": "baqi kal"}, headers=oh)
    assert r.status_code == 200, r.text
    return owner, venue, court, player, b, oh, ph


async def _claim(sf, booking_id) -> ShortPaymentClaim | None:
    async with sf() as s:
        return (await s.execute(select(ShortPaymentClaim).where(ShortPaymentClaim.booking_id == booking_id))).scalar_one_or_none()


async def _give_points(sf, player, n):
    async with sf() as s:
        s.add(PointEntry(player_id=player.id, delta=n, reason="seed"))
        await s.commit()


async def _balance(sf, player) -> int:
    async with sf() as s:
        return await p3.points_balance(s, player.id)


# ---------------------------------------------------------------- item 4: short payment reply


async def test_flags_off_completion_keeps_the_old_behaviour(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    *_rest, b, _oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003110001")
    assert await _claim(db_session_factory, b.id) is None
    assert len(await log_rows(db_session_factory, event_type="player_short")) == 1  # the plain "baqi" notice, as before


async def test_player_answers_sahi_hai_once_and_gets_5_points(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "short_payment_reply")
    _o, _v, _c, player, b, _oh, ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003110011")
    claim = await _claim(db_session_factory, b.id)
    assert claim.status == "awaiting_reply" and claim.total_pkr == 2000 and claim.paid_pkr == 1000 and claim.due_pkr == 1000
    asked = await log_rows(db_session_factory, user_id=player.id, event_type="player_short_ask")
    assert asked
    assert await log_rows(db_session_factory, user_id=player.id, event_type="player_short") == []  # replaced, not doubled

    extras = (await client.get(f"/api/v1/bookings/{b.id}/extras", headers=ph)).json()
    assert extras["short_payment"]["can_reply"] is True
    r = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "yes"}, headers=ph)
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    assert await _balance(db_session_factory, player) == 5
    again = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "no"}, headers=ph)
    assert again.status_code == 409
    assert await _balance(db_session_factory, player) == 5  # once per booking


async def test_no_reply_in_24h_takes_20_and_paying_later_gives_it_back(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "short_payment_reply")
    owner, _v, _c, player, b, oh, ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003110021")
    await _give_points(db_session_factory, player, 50)
    claim = await _claim(db_session_factory, b.id)
    from app.config import get_settings

    async with db_session_factory() as s:
        out = await p3.run_short_payment_job(s, get_settings(), now=claim.reply_deadline_at + timedelta(minutes=1))
    assert out["penalised"] == 1
    claim = await _claim(db_session_factory, b.id)
    assert claim.status == "no_reply" and claim.penalty_applied == 20
    assert await _balance(db_session_factory, player) == 30
    assert await log_rows(db_session_factory, user_id=player.id, event_type="player_points_deducted")
    owner_rows = await log_rows(db_session_factory, user_id=owner.id, event_type="owner_short_dispute")
    assert owner_rows == []  # a no-reply never goes to the owner
    # too late to answer now
    assert (await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "yes"}, headers=ph)).status_code == 409

    # the owner presses "done" on the carried due: the rest is recorded, the due is settled, the 20 come back
    r = await client.post(f"/api/v1/owners/dues/{claim.id}/done", headers=oh)
    assert r.status_code == 200, r.text
    assert r.json()["resolution"] == "paid" and r.json()["penalty_returned"] is True
    assert await _balance(db_session_factory, player) == 50
    async with db_session_factory() as s:
        assert float((await s.get(Booking, b.id)).balance_due) == 0


async def test_points_never_go_below_zero(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "short_payment_reply")
    *_r, player, b, _oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003110031")
    await _give_points(db_session_factory, player, 5)
    claim = await _claim(db_session_factory, b.id)
    from app.config import get_settings

    async with db_session_factory() as s:
        await p3.run_short_payment_job(s, get_settings(), now=claim.reply_deadline_at + timedelta(minutes=1))
    assert await _balance(db_session_factory, player) == 0
    assert (await _claim(db_session_factory, b.id)).penalty_applied == 5


async def test_ghalat_hai_goes_to_the_owner_who_can_waive(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "short_payment_reply")
    owner, venue, _c, player, b, oh, ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003110041")
    claim = await _claim(db_session_factory, b.id)
    r = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "no", "reason": "Maine poore diye the"}, headers=ph)
    assert r.status_code == 200 and r.json()["status"] == "disputed"
    assert await log_rows(db_session_factory, user_id=owner.id, event_type="owner_short_dispute")
    dues = (await client.get("/api/v1/owners/dues", params={"venue_id": str(venue.id)}, headers=oh)).json()
    assert len(dues) == 1 and dues[0]["player_reason"] == "Maine poore diye the"
    # only a disputed claim can be decided, only once
    d = await client.post(f"/api/v1/owners/short-payments/{claim.id}/decide", json={"decision": "waive"}, headers=oh)
    assert d.status_code == 200 and d.json()["resolution"] == "waived"
    assert (await client.post(f"/api/v1/owners/short-payments/{claim.id}/decide", json={"decision": "collect"}, headers=oh)).status_code == 409
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert float(bk.price) == 1000 and float(bk.balance_due) == 0
    assert (await client.get("/api/v1/owners/dues", params={"venue_id": str(venue.id)}, headers=oh)).json() == []
    # another owner cannot see or settle it
    other = await make_auth_headers(await make_user("+923003110048", role=UserRole.OWNER))
    assert (await client.get("/api/v1/owners/dues", params={"venue_id": str(venue.id)}, headers=other)).status_code in (403, 404)


# ---------------------------------------------------------------- item 5: dues on the next approval


async def test_dues_and_record_show_on_the_players_next_approval(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "player_dues")
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003110051")
    player = await make_user("+923003110052", name="Ali")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    old = await add_booking(db_session_factory, court, at(past_day(), 12), 1, player=player, price=1000, paid=500, source=BookingSource.APP)
    assert (await client.post(completion_url(old.id), json={"result": "no", "received_pkr": 500, "reason": "x"}, headers=oh)).status_code == 200
    await add_booking(db_session_factory, court, at(past_day(5), 12), 1, player=player, status=BookingStatus.NO_SHOW, source=BookingSource.APP)

    from tests.round2_helpers import future_day, hold, submit_proof

    nb = await hold(client, court, ph, future_day(4))
    assert (await submit_proof(client, nb["id"], ph)).status_code == 201
    queue = (await client.get("/api/v1/owners/approvals-queue", headers=oh)).json()
    card = next(c for c in queue["items"] if c["booking_id"] == nb["id"])
    ctx = card["player_context"]
    assert ctx["no_shows"] == 1 and ctx["total_bookings"] >= 2
    assert len(ctx["dues"]) == 1 and ctx["dues"][0]["code"] == p3.short_code(old.id) and ctx["dues"][0]["due_pkr"] == 500
    # the new booking is not blocked: it is waiting for approval like any other
    assert card["state"] == "awaiting"


async def test_no_player_context_while_the_flag_is_off(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003110061")
    player = await make_user("+923003110062")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    from tests.round2_helpers import future_day, hold, submit_proof

    nb = await hold(client, court, ph, future_day(4))
    await submit_proof(client, nb["id"], ph)
    card = (await client.get("/api/v1/owners/approvals-queue", headers=oh)).json()["items"][0]
    assert card["player_context"] is None


# ---------------------------------------------------------------- item 3: points


async def test_fully_paid_by_transfer_earns_50_points_and_cash_earns_none(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "player_points")
    await set_flag(db_session_factory, "balance_proof")
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003110071")
    player = await make_user("+923003110072")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    bid = await booked_with_balance(client, court, oh, ph)
    assert await _balance(db_session_factory, player) == 0  # half paid: nothing yet
    pay_id = (await submit_other_proof(client, bid, ph)).json()["payment"]["id"]
    assert (await client.post(f"/api/v1/payments/{pay_id}/approve", headers=oh, json={"amount_pkr": 500})).status_code == 200
    assert await _balance(db_session_factory, player) == 50
    pts = (await client.get("/api/v1/users/me/points", headers=ph)).json()
    assert pts["balance"] == 50 and pts["entries"][0]["reason"] == "transfer_booking" and "50 points" in pts["rule_text_ru"]

    # a second booking where the balance was paid in cash at the venue: no points
    player2 = await make_user("+923003110073")
    ph2 = await make_auth_headers(player2)
    b2 = await add_booking(db_session_factory, court, at(past_day(), 12), 1, player=player2, price=1000, paid=500, source=BookingSource.APP)
    assert (await client.post(completion_url(b2.id), json={"result": "yes"}, headers=oh)).status_code == 200
    assert await _balance(db_session_factory, player2) == 0
    assert (await client.get("/api/v1/users/me/points", headers=ph2)).json()["balance"] == 0


async def test_500_points_buy_the_venues_discount_once(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "player_points")
    owner, venue, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003110081")
    player = await make_user("+923003110082")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    bid = await booked_with_balance(client, court, oh, ph)  # price 1000, paid 500
    url = f"/api/v1/bookings/{bid}/extras"
    assert (await client.get(url, headers=ph)).json()["points"]["state"] == "venue_off"
    # the owner switches the discount on and sets the amount (venue settings)
    r = await client.patch(f"/api/v1/venues/{venue.id}", json={"points_discount_enabled": True, "points_discount_pkr": 300}, headers=oh)
    assert r.status_code == 200, r.text
    assert (await client.get(url, headers=ph)).json()["points"]["state"] == "not_enough"
    await _give_points(db_session_factory, player, 520)
    offer = (await client.get(url, headers=ph)).json()["points"]
    assert offer["state"] == "available" and offer["discount_pkr"] == 300
    used = await client.post(f"/api/v1/bookings/{bid}/use-points", headers=ph)
    assert used.status_code == 200 and used.json()["points"]["state"] == "used"
    assert await _balance(db_session_factory, player) == 20
    async with db_session_factory() as s:
        b = await s.get(Booking, bid)
        assert float(b.price) == 700 and float(b.balance_due) == 200 and b.points_discount_pkr == 300
    assert (await client.post(f"/api/v1/bookings/{bid}/use-points", headers=ph)).status_code == 400


# ---------------------------------------------------------------- item 6: no-show reply + arrival GPS


async def _now_booking(sf, court, player):
    start = datetime.now(timezone.utc) - timedelta(minutes=10)
    return await add_booking(sf, court, start, 1, player=player, source=BookingSource.APP, paid=2000)


async def test_pohanch_gaya_takes_one_reading_compared_with_the_pin(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "noshow_reply")
    _o, venue, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003110091")
    player = await make_user("+923003110092")
    ph = await make_auth_headers(player)
    b = await _now_booking(db_session_factory, court, player)
    near = await client.post(f"/api/v1/bookings/{b.id}/arrived", json={"latitude": 24.8008, "longitude": 67.0005, "accuracy_m": 15}, headers=ph)
    assert near.status_code == 201 and near.json()["verdict"] == "near" and near.json()["distance_m"] < 200
    assert (await client.post(f"/api/v1/bookings/{b.id}/arrived", json={"latitude": 24.9, "longitude": 67.1}, headers=ph)).status_code == 409

    court2 = await make_court(venue, name="Court Far")  # one booking per slot, so the second reading is on another court
    b2 = await _now_booking(db_session_factory, court2, player)
    far = await client.post(f"/api/v1/bookings/{b2.id}/arrived", json={"latitude": 24.82, "longitude": 67.0}, headers=ph)
    assert far.json()["verdict"] == "far"


async def test_a_city_centre_fallback_pin_is_not_trusted(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "noshow_reply")
    _o, venue, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003110101")
    async with db_session_factory() as s:
        v = await s.get(Venue, venue.id)
        v.location = "SRID=4326;POINT(67.0011 24.8607)"  # the Karachi centre the wizard falls back to
        await s.commit()
    player = await make_user("+923003110102")
    ph = await make_auth_headers(player)
    b = await _now_booking(db_session_factory, court, player)
    r = await client.post(f"/api/v1/bookings/{b.id}/arrived", json={"latitude": 24.8607, "longitude": 67.0011}, headers=ph)
    assert r.json()["verdict"] == "pin_unreliable"


async def test_main_aaya_tha_goes_to_the_owner_and_gps_highlights_the_no_show(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "noshow_reply")
    owner, venue, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003110111")
    player = await make_user("+923003110112", name="Hamza")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    b = await add_booking(db_session_factory, court, at(past_day(1), 12), 1, player=player, source=BookingSource.APP, paid=2000)
    # the player had pressed "Pohanch gaya" at the venue (recorded directly: the slot is over now)
    from app.models.audit_phase3 import ArrivalCheck

    async with db_session_factory() as s:
        s.add(ArrivalCheck(booking_id=b.id, player_id=player.id, latitude=24.8, longitude=67.0, distance_m=12.0, verdict="near"))
        await s.commit()
    assert (await client.post(f"/api/v1/bookings/{b.id}/no-show", headers=oh)).status_code == 200
    rows = await log_rows(db_session_factory, user_id=player.id, event_type="player_no_show")
    assert rows  # the no-show notice (with the "Main aaya tha" button when WhatsApp is on)

    r = await client.post(f"/api/v1/bookings/{b.id}/noshow-reply", json={"note": "Main 6 baje aa gaya tha"}, headers=ph)
    assert r.status_code == 201
    assert (await client.post(f"/api/v1/bookings/{b.id}/noshow-reply", json={}, headers=ph)).status_code == 409
    assert await log_rows(db_session_factory, user_id=owner.id, event_type="owner_noshow_reply")

    act = (await client.get("/api/v1/owners/staff-activity", params={"venue_id": str(venue.id)}, headers=oh)).json()
    row = next(n for n in act["no_shows"] if n["booking_id"] == str(b.id))
    assert row["player_replied"] is True and row["arrival_verdict"] == "near" and row["highlight"] is True
    d = await client.post(f"/api/v1/owners/noshow-replies/{row['reply_id']}/decide", json={"decision": "reverse"}, headers=oh)
    assert d.status_code == 200 and d.json()["owner_decision"] == "reverse"
    async with db_session_factory() as s:
        assert (await s.get(Booking, b.id)).status == BookingStatus.COMPLETED


async def test_noshow_endpoints_refuse_while_the_flag_is_off(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    _o, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003110121")
    player = await make_user("+923003110122")
    ph = await make_auth_headers(player)
    b = await _now_booking(db_session_factory, court, player)
    assert (await client.post(f"/api/v1/bookings/{b.id}/arrived", json={"latitude": 24.8, "longitude": 67.0}, headers=ph)).status_code == 403
    assert (await client.post(f"/api/v1/bookings/{b.id}/use-points", headers=ph)).status_code == 403


# ---------------------------------------------------------------- item 8: WhatsApp quick-reply buttons


def test_template_components_carry_quick_reply_payloads():
    from app.services.whatsapp_templates import build_components

    comps = build_components(["KH-1", "PKR 2,000"], ["short:abc:yes", "short:abc:no"])
    assert comps[0]["type"] == "body"
    assert comps[1] == {"type": "button", "sub_type": "quick_reply", "index": "0", "parameters": [{"type": "payload", "payload": "short:abc:yes"}]}
    assert comps[2]["index"] == "1"
    assert build_components(["x"]) == [{"type": "body", "parameters": [{"type": "text", "text": "x"}]}]


async def test_webhook_button_answers_the_short_payment(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    await set_flag(db_session_factory, "short_payment_reply")
    *_r, player, b, _oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003110131")
    claim = await _claim(db_session_factory, b.id)
    sent = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "wamid.test"}]}

    from app.services.whatsapp_service import WhatsAppService

    monkeypatch.setattr(WhatsAppService, "_send", fake_send)
    from app.api.webhooks import _handle_button_reply
    from app.config import get_settings
    from app.models.user import User

    async with db_session_factory() as s:
        u = await s.get(User, player.id)
        await _handle_button_reply(s, get_settings(), u, f"short:{claim.id}:no")
    claim = await _claim(db_session_factory, b.id)
    assert claim.status == "disputed"
    assert await _balance(db_session_factory, player) == 5
    assert sent and "venue" in sent[-1]["text"]["body"].lower()


async def test_khelo_whatsapp_templates_go_out_only_with_the_flag(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    from app.services.whatsapp_service import WhatsAppService
    from tests.round2_helpers import future_day, hold

    sent = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "wamid.t"}]}

    monkeypatch.setattr(WhatsAppService, "_send", fake_send)
    mock_upload(monkeypatch)
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003110141")
    player = await make_user("+923003110142")
    ph, oh = await make_auth_headers(player), await make_auth_headers(owner)
    await hold(client, court, ph, future_day(5))
    assert await log_rows(db_session_factory, user_id=player.id, event_type="advance_payment_wa") == []

    await set_flag(db_session_factory, "whatsapp_templates")
    await hold(client, court, ph, future_day(4))
    rows = await log_rows(db_session_factory, user_id=player.id, event_type="advance_payment_wa")
    assert len(rows) == 1  # noqa: the day-5 hold (flag off) sent none and rows[0].template_name == "khelo_advance_payment"
    # the approval sends the receipt and (money still due) the balance instructions
    bid = await booked_with_balance(client, court, oh, ph)
    assert await log_rows(db_session_factory, user_id=player.id, event_type="payment_receipt_wa")
    assert any(p.get("template", {}).get("name") == "khelo_payment_receipt" for p in sent)
    assert bid
