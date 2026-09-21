"""Section 32 Parts 1-2: every time and date a player or owner is shown is 12-hour, Pakistan time, human
readable, and derived from the PAKISTAN calendar -- never a UTC date, never ISO, never 24-hour."""
import re
from datetime import date, datetime, time, timedelta, timezone

from app.config import get_settings
from app.models.user import UserRole
from app.services.notification_service import NotificationService
from app.utils.timezone import (
    contains_24h_time,
    enforce_display_format,
    format_date,
    format_date_relative,
    format_slot_label,
    format_time,
    format_time_range,
    format_when,
    pkt_date_of,
    pkt_time_to_utc,
    pkt_today,
)


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


NOW = utc(2026, 9, 21, 5, 0)  # 10:00 AM Monday 21 Sep in Karachi


def test_pkt_boundary_slots_show_the_right_time_and_the_right_calendar_day():
    """The day boundary is where a UTC date and a Pakistan date disagree. PKT is UTC+5, so a slot from
    7 PM PKT onward has a UTC date one day EARLIER than the day the player sees."""
    cases = [
        # (UTC instant,             PKT clock,  PKT calendar date)
        (utc(2026, 9, 23, 1, 0), "6:00 AM", date(2026, 9, 23)),
        (utc(2026, 9, 23, 14, 30), "7:30 PM", date(2026, 9, 23)),
        (utc(2026, 9, 23, 18, 30), "11:30 PM", date(2026, 9, 23)),
        (utc(2026, 9, 23, 19, 0), "12:00 AM", date(2026, 9, 24)),  # midnight PKT is already the 24th
        (utc(2026, 9, 23, 19, 30), "12:30 AM", date(2026, 9, 24)),
    ]
    for instant, clock, pkt_date in cases:
        assert format_time(instant) == clock, instant
        assert pkt_date_of(instant) == pkt_date, instant
    # a 12:30 AM slot is displayed under the 24th even though its UTC date is the 23rd
    assert format_date(utc(2026, 9, 23, 19, 30), NOW) == "Thu, 24 Sep"


def test_pkt_today_is_the_pakistan_date_not_the_utc_date():
    """4:32 AM Monday 21 Sep in Karachi is still Sunday 20 Sep in UTC. Using the UTC date for "today" made
    the owner's Today screen show yesterday and the date tabs query the wrong day."""
    now = utc(2026, 9, 20, 23, 32)
    assert now.date() == date(2026, 9, 20)
    assert pkt_today(now) == date(2026, 9, 21)
    # and 6:59 PM Sunday Karachi (13:59Z) is still the 20th
    assert pkt_today(utc(2026, 9, 20, 13, 59)) == date(2026, 9, 20)
    assert pkt_today(utc(2026, 9, 20, 19, 0)) == date(2026, 9, 21)  # exactly midnight PKT


def test_pkt_day_windows_are_five_hours_before_utc_midnight():
    assert pkt_time_to_utc(date(2026, 9, 23), time.min) == utc(2026, 9, 22, 19, 0)


def test_human_dates_never_iso_and_year_only_when_not_this_year():
    assert format_date(utc(2026, 9, 23, 14, 30), NOW) == "Wed, 23 Sep"
    assert format_date(utc(2027, 1, 5, 7, 0), NOW) == "Tue, 5 Jan 2027"
    assert format_date_relative(utc(2026, 9, 21, 14, 30), NOW) == "Today"
    assert format_date_relative(utc(2026, 9, 22, 14, 30), NOW) == "Tomorrow"
    assert format_date_relative(utc(2026, 9, 23, 14, 30), NOW) == "Wed, 23 Sep"
    # 12:30 AM on the 22nd is "Tomorrow" in Karachi even though its UTC date is the 21st = "today"
    assert format_date_relative(utc(2026, 9, 21, 19, 30), NOW) == "Tomorrow"


def test_slot_label_is_the_exact_string_the_assistant_copies():
    label = format_slot_label(utc(2026, 9, 23, 14, 30), utc(2026, 9, 23, 16, 0), NOW)
    assert label == "7:30 PM to 9:00 PM, Wed 23 Sep"
    # a range that crosses midnight names the next day (Section 32 Part 3); it used to read "11:30 PM to 12:30 AM"
    assert format_time_range(utc(2026, 9, 23, 18, 30), utc(2026, 9, 23, 19, 30)) == "11:30 PM to Thu 12:30 AM"
    assert format_when(utc(2026, 9, 23, 14, 30), NOW) == "Wed, 23 Sep, 7:30 PM"
    for text in (label, format_when(utc(2026, 9, 23, 14, 30), NOW)):
        assert not contains_24h_time(text)
        assert "UTC" not in text and "T14" not in text and "+00:00" not in text


def test_contains_24h_time_detects_only_clock_times_without_am_pm():
    for bad in ("Slots run 01:00 to 17:30", "at 21:00", "07:00 to 08:30", "17:30:00"):
        assert contains_24h_time(bad), bad
    for ok in ("7:30 PM", "10:00 PM to 11:30 PM", "12:30 AM", "5 PM", "Rs. 3,500", "2026", "call 0300 1234567"):
        assert not contains_24h_time(ok), ok


def test_enforce_display_format_rewrites_what_the_model_slipped_in():
    """Real production replies (2026-09-20): "slots only run up to 17:30", "from 07:00 to 08:30"."""
    fixed = enforce_display_format("Slots for that day only run up to 17:30, e.g. 07:00 to 08:30 for PKR 3,500.")
    assert fixed == "Slots for that day only run up to 5:30 PM, e.g. 7:00 AM to 8:30 AM for PKR 3,500."
    assert not contains_24h_time(fixed)
    # an ISO timestamp carries its own offset, so it is converted properly
    iso = enforce_display_format("Booked for 2026-09-23T14:30:00+00:00.")
    assert "7:30 PM" in iso and "T14" not in iso and "+00:00" not in iso
    # already-correct text is untouched
    ok = "Court 1 is free 7:30 PM to 9:00 PM, Wed 23 Sep."
    assert enforce_display_format(ok) == ok


async def test_notification_texts_are_human_readable_not_utc_iso(db_session, make_user, monkeypatch):
    """"Your booking for Court 1 on 2026-09-23T14:30:00+00:00 is confirmed" is what players were sent, and
    the WhatsApp booking_confirmed template went out with a blank venue and a blank time line."""
    captured = []

    async def fake_smart(self, to, body, *, last_inbound_at, template_name, template_params):
        captured.append({"body": body, "template": template_name, "params": template_params})
        return {"messages": [{"id": "x"}]}, None

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_smart", fake_smart)
    player = await make_user("+923050000001", role=UserRole.PLAYER)
    starts = pkt_time_to_utc(pkt_today() + timedelta(days=3), time(19, 30))
    ends = starts + timedelta(minutes=90)
    notifications = NotificationService(db_session, get_settings())

    await notifications.notify_booking_confirmed(
        user=player, court_name="Court 1", venue_name="Maidan Court", starts_at=starts, ends_at=ends, amount_paid=3500
    )
    await notifications.notify_booking_cancelled(user=player, court_name="Court 1", starts_at=starts, ends_at=ends)
    await notifications.notify_court_deactivated(user=player, court_name="Court 1", starts_at=starts, ends_at=ends)

    confirmed, cancelled, deactivated = captured
    assert re.search(r"on \w{3}, \d{1,2} \w{3}, 7:30 PM to 9:00 PM is confirmed", confirmed["body"]), confirmed["body"]
    # the template lines: venue / date / time are all filled in, none of them ISO
    court, venue, date_text, time_text, paid = confirmed["params"]
    assert (court, venue, time_text, paid) == ("Court 1", "Maidan Court", "7:30 PM to 9:00 PM", "3,500")
    assert re.fullmatch(r"\w{3}, \d{1,2} \w{3}", date_text), date_text
    for message in captured:
        text = message["body"] + " " + " ".join(message["params"])
        assert not contains_24h_time(text), text
        assert "+00:00" not in text and "UTC" not in text and not re.search(r"\d{4}-\d{2}-\d{2}", text), text
    assert "7:30 PM to 9:00 PM" in cancelled["body"]
    assert "7:30 PM to 9:00 PM" in deactivated["body"]


def test_a_range_that_ends_the_next_day_names_the_day():
    """Section 32 Part 3: 11 PM Thu to 1 AM Fri must not read "11:00 PM to 1:00 AM" (which day is 1 AM?)."""
    from datetime import datetime, timezone

    from app.utils.timezone import format_slot_label, format_time_range

    thu_11pm = datetime(2026, 9, 24, 18, 0, tzinfo=timezone.utc)   # 11:00 PM Thu 24 Sep PKT
    fri_1am = datetime(2026, 9, 24, 20, 0, tzinfo=timezone.utc)    # 1:00 AM Fri 25 Sep PKT
    fri_2am = datetime(2026, 9, 24, 21, 0, tzinfo=timezone.utc)
    midnight = datetime(2026, 9, 24, 19, 0, tzinfo=timezone.utc)
    assert format_time_range(thu_11pm, fri_1am) == "11:00 PM to Fri 1:00 AM"
    assert format_time_range(thu_11pm, midnight) == "11:00 PM to 12:00 AM"          # ending at midnight is not named
    assert format_time_range(fri_1am, fri_2am) == "1:00 AM to 2:00 AM"              # both after midnight, same day
    assert format_slot_label(fri_1am, fri_2am, now_utc=thu_11pm) == "1:00 AM to 2:00 AM, Fri 25 Sep"
    assert format_time_range(datetime(2026, 9, 23, 14, 30, tzinfo=timezone.utc), datetime(2026, 9, 23, 16, 0, tzinfo=timezone.utc)) == "7:30 PM to 9:00 PM"
