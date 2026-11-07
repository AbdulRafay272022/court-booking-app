"""fix/nov-8: a web push about ONE booking opens THAT booking (the bell and the app push follow the same rule)."""
import json

from app.services.web_push import build_payload, url_for_event

B = "c710ec77-af12-47f1-8aeb-1930dfba27fa"


def test_player_booking_pushes_open_the_players_booking_page():
    for event in ("booking_confirmed", "booking_cancelled", "booking_reminder", "payment_rejected", "refund_paid",
                  "hold_expiring", "player_no_show", "player_short", "player_noshow_decision"):
        assert url_for_event(event, B) == f"/booking/{B}/done", event


def test_owner_pushes_open_the_booking_on_the_page_that_acts_on_it():
    for event in ("payment_submitted", "late_payment_proof", "payment_final_warning", "owner_player_cancelled", "payment_reminder_2"):
        assert url_for_event(event, B) == f"/dashboard/owner/approvals?booking={B}&open=1", event
    for event in ("refund_owed", "owner_refund_requested"):
        assert url_for_event(event, B) == f"/dashboard/owner/paisa?tab=wapas&booking={B}&open=1", event
    for event in ("owner_new_booking", "owner_staff_action", "owner_noshow_reply", "owner_short_dispute"):
        assert url_for_event(event, B) == f"/dashboard/bookings?booking={B}&open=1", event


def test_without_a_booking_the_old_page_links_stay():
    assert url_for_event("payment_submitted") == "/dashboard/owner/approvals"
    assert url_for_event("booking_confirmed") == "/bookings"
    assert url_for_event("refund_owed") == "/dashboard/owner/paisa?tab=wapas"
    assert url_for_event("owner_daily_digest", B) == "/dashboard/owner/today"  # not about a booking
    assert url_for_event("slot_reopened", B) == "/"  # reference is a waitlist entry, not a booking
    assert url_for_event("venue_approved", B) == "/dashboard/owner/today"


def test_the_payload_carries_the_booking_link():
    data = json.loads(build_payload("booking_confirmed", "Court aapka hai", "body", B))
    assert data["url"] == f"/booking/{B}/done"
