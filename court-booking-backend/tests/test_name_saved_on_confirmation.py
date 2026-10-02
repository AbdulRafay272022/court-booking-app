"""Owner decision: the player's OWN name is saved on users.name only when the booking is CONFIRMED (the hold is actually
created), never merely because the assistant proposed a slot.

A proposal only records the intent (`player_name` + `name_is_players_own` in the stored confirm action). The save happens in
BookingService.create_hold for the three ways a hold is created from a confirmation: the WhatsApp Yes button / typed yes,
the model-driven hold_slot tool, and the in-app Yes button (POST /bookings/hold with `name_is_own`). Safety rules unchanged:
only when users.name is empty, never overwrite, never a friend's name, never a court/venue/sport/city word."""
from datetime import time, timedelta

from sqlalchemy import delete, select

from app.config import get_settings
from app.models.booking import Booking
from app.models.user import User, UserRole
from app.services.ai_chat_service import AIChatService
from tests.test_ai_chat import (
    _add_proposal,
    _future_day,
    _hold_via_model,
    _nameless_setup,
    _pkt,
)
from tests.test_webhooks import _button_payload, _mock_whatsapp_send, _proposal_setup, _seed_proposal, _text_payload


async def _name_of(db_session, user) -> str | None:
    return (await db_session.execute(select(User.name).where(User.id == user.id))).scalar_one()


# ---- the proposal alone never saves -----------------------------------------------------------------------------

async def test_a_proposal_alone_records_the_intent_but_does_not_touch_the_account(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, guest = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         ("+923017000001", "+923017000002", "+923017000003"), monkeypatch)
    guest = await db_session.get(User, guest.id)
    start = _pkt(_future_day(5), 19).isoformat()
    actions: list = []
    await AIChatService(db_session, get_settings())._execute_tool(
        guest, "propose_booking_confirmation",
        {"court_id": str(court.id), "starts_at": start, "player_name": "Ali", "name_is_players_own": True}, actions)
    confirm = next(a for a in actions if a.type == "confirm_booking")
    assert confirm.data["player_name"] == "Ali" and confirm.data["name_is_players_own"] is True  # the intent is stored
    await db_session.commit()
    assert await _name_of(db_session, guest) is None  # ...but nothing is saved

    # a friend's name: the flag is stored False
    actions = []
    await AIChatService(db_session, get_settings())._execute_tool(
        guest, "propose_booking_confirmation",
        {"court_id": str(court.id), "starts_at": start, "player_name": "Ali Khan"}, actions)
    assert next(a for a in actions if a.type == "confirm_booking").data["name_is_players_own"] is False


# ---- WhatsApp: typed yes and the Yes button ---------------------------------------------------------------------

async def test_whatsapp_typed_yes_saves_the_players_own_name_but_ignoring_the_proposal_does_not(
    client, db_session, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    _mock_whatsapp_send(monkeypatch)
    player, court, starts_at = await _proposal_setup(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923017000011")
    await _seed_proposal(db_session_factory, player, court, starts_at, player_name="Ali Raza", name_is_players_own=True)
    assert await _name_of(db_session, player) is None  # proposed, not confirmed: still empty

    # the player says something else instead of confirming (declines): still empty
    await client.post("/api/v1/webhooks/whatsapp", json=_button_payload("923017000011", "wamid.nm-1", "decline"))
    assert await _name_of(db_session, player) is None
    assert await db_session.scalar(select(Booking).where(Booking.player_id == player.id)) is None

    # ...a fresh proposal, confirmed with a typed yes: the hold is created AND the name is saved
    await _seed_proposal(db_session_factory, player, court, starts_at, player_name="Ali Raza", name_is_players_own=True)
    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923017000011", "wamid.nm-2", "yes"))
    booking = await db_session.scalar(select(Booking).where(Booking.player_id == player.id))
    assert booking is not None and booking.player_name == "Ali Raza"
    assert await _name_of(db_session, player) == "Ali Raza"


async def test_whatsapp_yes_button_saves_the_name_and_never_overwrites_or_saves_a_friend(
    client, db_session, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    _mock_whatsapp_send(monkeypatch)
    player, court, starts_at = await _proposal_setup(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923017000021")
    friend = await make_user("+923017000022", role=UserRole.PLAYER)
    named = await make_user("+923017000023", role=UserRole.PLAYER, name="Sara Ahmed")

    # nameless player taps Yes on a proposal with their own name -> saved
    await _seed_proposal(db_session_factory, player, court, starts_at, player_name="Ali Raza", name_is_players_own=True)
    await client.post("/api/v1/webhooks/whatsapp",
                      json=_button_payload("923017000021", "wamid.nm-3", f"confirm:{court.id}:{starts_at}"))
    assert await _name_of(db_session, player) == "Ali Raza"

    # (the same slot is reused below, so clear the first hold)
    await db_session.execute(delete(Booking))
    await db_session.commit()

    # a friend's name (flag false) is on the booking but NOT on the account
    await _seed_proposal(db_session_factory, friend, court, starts_at, player_name="Bilal Khan", name_is_players_own=False)
    await client.post("/api/v1/webhooks/whatsapp",
                      json=_button_payload("923017000022", "wamid.nm-4", f"confirm:{court.id}:{starts_at}"))
    booking = await db_session.scalar(select(Booking).where(Booking.player_id == friend.id))
    assert booking is not None and booking.player_name == "Bilal Khan"
    assert await _name_of(db_session, friend) is None

    await db_session.execute(delete(Booking))
    await db_session.commit()

    # an account that already has a name is never overwritten, even when the flag says "own"
    await _seed_proposal(db_session_factory, named, court, starts_at, player_name="Someone Else", name_is_players_own=True)
    await client.post("/api/v1/webhooks/whatsapp",
                      json=_button_payload("923017000023", "wamid.nm-5", f"confirm:{court.id}:{starts_at}"))
    assert await _name_of(db_session, named) == "Sara Ahmed"


# ---- the model-driven hold_slot path ----------------------------------------------------------------------------

async def test_model_driven_hold_saves_the_name_from_the_confirmed_proposal_only_when_the_hold_is_created(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, guest = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         ("+923017000031", "+923017000032", "+923017000033"), monkeypatch)
    guest = await db_session.get(User, guest.id)  # bound to the session, like the request's user
    seven = _pkt(_future_day(5), 19).isoformat()
    await _add_proposal(db_session, guest, court, seven, player_name="Ali", name_is_players_own=True)
    assert await _name_of(db_session, guest) is None  # proposal only

    # the model forgets the name AND the flag when it calls hold_slot: the proposal's stored intent is used
    await _hold_via_model(db_session, monkeypatch, guest, court, seven)
    assert [b.player_name for b in (await db_session.execute(select(Booking).where(Booking.player_id == guest.id))).scalars()] == ["Ali"]
    assert await _name_of(db_session, guest) == "Ali"


async def test_model_driven_hold_with_a_friend_name_or_a_refused_hold_saves_nothing(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, guest = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         ("+923017000041", "+923017000042", "+923017000043"), monkeypatch)
    guest = await db_session.get(User, guest.id)  # bound to the session, like the request's user
    day = _future_day(5)
    seven, eight = _pkt(day, 19).isoformat(), _pkt(day, 20).isoformat()

    # a friend's name (flag false/absent)
    await _add_proposal(db_session, guest, court, seven, player_name="Ali Khan", name_is_players_own=False)
    await _hold_via_model(db_session, monkeypatch, guest, court, seven)
    assert await _name_of(db_session, guest) is None

    # the model says "own" but the hold is refused (the player had not confirmed THIS slot): nothing saved
    await _add_proposal(db_session, guest, court, seven, player_name="Ali", name_is_players_own=True)
    await _hold_via_model(db_session, monkeypatch, guest, court, eight, player_name="Ali", name_is_players_own=True)
    assert await _name_of(db_session, guest) is None


# ---- the in-app Yes button: POST /bookings/hold -----------------------------------------------------------------

async def _in_app_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner, name="Clifton Padel Club")
    court = await make_court(venue, name="Court 1", sport="padel", slot_minutes=60)
    for dow in range(7):
        await make_schedule(court, day_of_week=dow, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    return court


def _hold_body(court, day_offset, **extra):
    from app.utils.timezone import pkt_time_to_utc, pkt_today

    starts = pkt_time_to_utc(pkt_today() + timedelta(days=day_offset), time(19, 0))
    return {"court_id": str(court.id), "starts_at": starts.isoformat().replace("+00:00", "Z"), "slot_count": 2, **extra}


async def test_in_app_hold_saves_the_own_name_only_on_confirmation_and_only_when_safe(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    court = await _in_app_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923017000051")
    guest = await make_user("+923017000052", role=UserRole.PLAYER)
    named = await make_user("+923017000053", role=UserRole.PLAYER, name="Sara Ahmed")
    gh, nh = await make_auth_headers(guest), await make_auth_headers(named)

    # old/other builds send no flag: the name rides on the booking only
    r = await client.post("/api/v1/bookings/hold", headers=gh, json=_hold_body(court, 2, player_name="Ali Raza"))
    assert r.status_code == 201 and r.json()["booking"]["player_name"] == "Ali Raza"
    assert await _name_of(db_session, guest) is None

    # a friend's name with the flag false: not saved
    r = await client.post("/api/v1/bookings/hold", headers=gh,
                          json=_hold_body(court, 3, player_name="Bilal Khan", name_is_own=False))
    assert r.status_code == 201 and await _name_of(db_session, guest) is None

    # a court / venue word is never a name, even when flagged own
    r = await client.post("/api/v1/bookings/hold", headers=gh,
                          json=_hold_body(court, 4, player_name="Court 1", name_is_own=True))
    assert r.status_code == 201 and await _name_of(db_session, guest) is None
    r = await client.post("/api/v1/bookings/hold", headers=gh,
                          json=_hold_body(court, 5, player_name="Padel", name_is_own=True))
    assert r.status_code == 201 and await _name_of(db_session, guest) is None

    # an existing name is never overwritten
    r = await client.post("/api/v1/bookings/hold", headers=nh,
                          json=_hold_body(court, 6, player_name="Someone Else", name_is_own=True))
    assert r.status_code == 201 and await _name_of(db_session, named) == "Sara Ahmed"

    # the real thing: own name, flagged, hold created -> saved
    r = await client.post("/api/v1/bookings/hold", headers=gh,
                          json=_hold_body(court, 7, player_name="  Ali   Raza ", name_is_own=True))
    assert r.status_code == 201 and r.json()["booking"]["player_name"] == "Ali Raza"
    assert await _name_of(db_session, guest) == "Ali Raza"


async def test_in_app_hold_that_fails_saves_no_name(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    court = await _in_app_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923017000061")
    first = await make_user("+923017000062", role=UserRole.PLAYER, name="Sara Ahmed")
    guest = await make_user("+923017000063", role=UserRole.PLAYER)
    assert (await client.post("/api/v1/bookings/hold", headers=await make_auth_headers(first), json=_hold_body(court, 2))).status_code == 201
    # the slot is taken: the guest's Yes fails, so their name must NOT be saved
    r = await client.post("/api/v1/bookings/hold", headers=await make_auth_headers(guest),
                          json=_hold_body(court, 2, player_name="Ali Raza", name_is_own=True))
    assert r.status_code == 409
    assert await _name_of(db_session, guest) is None
