"""Section 32 Part 4 item 5: booking duration in the AI chat and the WhatsApp flow. The assistant must know how
long the player wants to play, quote the total from the same price engine the apps use, only ever propose a
real bookable range, and write money as "PKR 3,500" (never "Rs. 3500.0")."""
from datetime import datetime, time, timedelta

from sqlalchemy import select

from app.api.webhooks import _confirm_button_id
from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.user import User, UserRole
from app.services.ai_chat_service import SYSTEM_PROMPT, AIChatService
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phones, *, slot_minutes=60, price=1000):
    owner = await make_user(phones[0], role=UserRole.OWNER)
    player = await make_user(phones[1], role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=slot_minutes)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=price)
    return venue, court, player


def _start(hh: int, mm: int = 0) -> datetime:
    return pkt_time_to_utc(pkt_today() + timedelta(days=2), time(hh, mm))


async def test_the_assistant_is_told_to_ask_how_long_and_to_copy_money_exactly():
    assert "How long do you want to play?" in SYSTEM_PROMPT
    assert "quote_booking" in SYSTEM_PROMPT
    assert "PKR 3,500" in SYSTEM_PROMPT and "never invent a reason" in SYSTEM_PROMPT.lower()


async def test_get_venue_courts_lists_the_durations_each_court_offers(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    venue, court, _p = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923080000001", "+923080000002"), slot_minutes=90)
    service = AIChatService(db_session, get_settings())
    out = await service._execute_tool(_p, "get_venue_courts", {"venue_id": str(venue.id)}, [])
    durations = out["courts"][0]["durations"]
    # Part 4c: a 90-minute court's minimum booking is 1.5 hours, then every 30 minutes up to the 6-hour cap
    assert [d["minutes"] for d in durations] == [90, 120, 150, 180, 210, 240, 270, 300, 330, 360]
    assert [d["label"] for d in durations][:3] == ["1.5 hours", "2 hours", "2.5 hours"]
    assert out["courts"][0]["min_booking_minutes"] == 90


async def test_quote_booking_returns_ready_made_text_priced_across_the_range(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _v, court, player = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923080000003", "+923080000004"), price=1000)
    await make_pricing_rule(court, name="Peak", priority=5, start_time=time(18, 0), end_time=time(23, 0), price_per_slot=1500)
    service = AIChatService(db_session, get_settings())

    out = await service._execute_tool(
        player, "quote_booking", {"court_id": str(court.id), "starts_at": _iso(_start(17)), "duration_minutes": 120}, []
    )
    assert out["ok"] is True
    assert out["total_price_text"] == "PKR 2,500"  # 1000 (5-6 PM) + 1500 (6-7 PM peak)
    assert out["duration_text"] == "2 hours"
    assert out["label"].startswith("5:00 PM to 7:00 PM, ")
    assert "3500.0" not in str(out) and "Rs" not in str(out)


async def test_quote_booking_refuses_a_length_below_the_minimum_or_off_the_30_minute_steps(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _v, court, player = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923080000005", "+923080000006"), slot_minutes=90)
    service = AIChatService(db_session, get_settings())
    out = await service._execute_tool(
        player, "quote_booking", {"court_id": str(court.id), "starts_at": _iso(_start(6)), "duration_minutes": 60}, []
    )
    assert out["status_code"] == 400
    assert "1.5 hours" in out["error"]  # says the court's minimum, in words
    off_step = await service._execute_tool(
        player, "quote_booking", {"court_id": str(court.id), "starts_at": _iso(_start(6)), "duration_minutes": 100}, []
    )
    assert off_step["status_code"] == 400 and "30" in off_step["error"]
    # 2 hours is fine on a 90-minute court now (any multiple of 30 at or above the minimum)
    ok = await service._execute_tool(
        player, "quote_booking", {"court_id": str(court.id), "starts_at": _iso(_start(6)), "duration_minutes": 120}, []
    )
    assert ok.get("ok") is True and ok["total_price_text"] == "PKR 1,333.33"


async def test_propose_then_hold_a_two_hour_booking(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _v, court, player = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923080000007", "+923080000008"))
    service = AIChatService(db_session, get_settings())
    actions: list = []
    args = {"court_id": str(court.id), "starts_at": _iso(_start(19)), "duration_minutes": 120}

    proposed = await service._execute_tool(player, "propose_booking_confirmation", args, actions)
    assert proposed["total_price_text"] == "PKR 2,000"
    confirm = next(a for a in actions if a.type == "confirm_booking")
    assert confirm.data["slot_count"] == 4  # the Yes button carries the duration (four 30-minute slots)

    held = await service._execute_tool(player, "hold_slot", args, [])
    assert held["duration_text"] == "2 hours" and held["total_price_text"] == "PKR 2,000"
    booking = await db_session.scalar(select(Booking).where(Booking.player_id == player.id))
    assert booking.ends_at - booking.starts_at == timedelta(hours=2)
    assert float(booking.price) == 2000.0


async def test_an_unavailable_range_is_not_proposed(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _v, court, player = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923080000009", "+923080000010"))
    service = AIChatService(db_session, get_settings())
    actions: list = []
    # runs past the 11 PM closing time
    out = await service._execute_tool(
        player, "propose_booking_confirmation",
        {"court_id": str(court.id), "starts_at": _iso(_start(22)), "duration_minutes": 120}, actions,
    )
    assert "error" in out and actions == []
    assert "closing" in out["error"].lower()


async def test_check_availability_gives_money_as_ready_made_text(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _v, court, player = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923080000011", "+923080000012"), price=3500)
    service = AIChatService(db_session, get_settings())
    out = await service._execute_tool(
        player, "check_availability", {"court_id": str(court.id), "date": (pkt_today() + timedelta(days=2)).isoformat()}, []
    )
    # each offered start is the court's whole 60-minute minimum booking, priced as such (starts every 30 minutes)
    assert out["slots"][0]["price_text"] == "PKR 3,500"
    assert out["slots"][0]["label"].startswith("6:00 AM to 7:00 AM")
    assert out["slots"][1]["label"].startswith("6:30 AM to 7:30 AM")
    assert "price" not in out["slots"][0]  # no raw 3500.0 for the model to reformat
    labels = [x["label"] for x in out["slots"]]
    assert any(l.startswith("10:00 PM to 11:00 PM") for l in labels)       # last start that still fits before closing
    assert not any(l.startswith("10:30 PM") for l in labels)               # 10:30 PM + 60 minutes is past 11 PM


def test_whatsapp_button_id_carries_the_duration_only_when_longer_than_one_slot():
    assert _confirm_button_id("c1", "2026-09-23T13:00:00+00:00") == "confirm:c1:2026-09-23T13:00:00+00:00"
    assert _confirm_button_id("c1", "2026-09-23T13:00:00+00:00", 2) == "confirm:c1:2026-09-23T13:00:00+00:00|x2"


async def test_tapping_yes_on_a_two_hour_proposal_holds_two_hours_and_says_the_total(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    from tests.test_webhooks import _button_payload, _mock_whatsapp_send

    sent = _mock_whatsapp_send(monkeypatch)
    _v, court, _p = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923080000013", "+923080000014"), price=1500)
    button_id = _confirm_button_id(str(court.id), _iso(_start(19)), 4)

    resp = await client.post("/api/v1/webhooks/whatsapp", json=_button_payload("923080000015", "wamid.dur-1", button_id))
    assert resp.status_code == 200

    user = await db_session.scalar(select(User).where(User.phone == "+923080000015"))
    booking = await db_session.scalar(select(Booking).where(Booking.player_id == user.id))
    assert booking.status == BookingStatus.HELD
    assert booking.ends_at - booking.starts_at == timedelta(hours=2)
    body = sent[0]["body"]
    assert "Total PKR 3,000 for 2 hours" in body
    assert "7:00 PM to 9:00 PM" in body
