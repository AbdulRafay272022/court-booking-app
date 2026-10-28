"""Meta-registered WhatsApp template catalog (Section 9.3).

Outside the 24-hour customer-service window, WhatsApp requires a
pre-approved template for any business-initiated message -- free-form text
is only allowed as a direct reply within that window. `notification_service`
checks the window and falls back to these when it's closed.

Each entry's `category` mirrors what Meta itself categorizes the template
as, which is also what drives WhatsApp's per-message cost: `authentication`
and `utility` are cheap (~$0.004 at the time this was written), `marketing`
is materially more (~$0.025) and is gated by the Announcements premium feature and a monthly cap (see
notification_service.can_send_marketing). `render` builds the plain-text
equivalent used for local logging/no-op dev mode and for the `messages.content`
audit trail -- the actual Cloud API call sends structured `{{n}}` component
params, not this string.
"""

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class WhatsAppTemplate:
    name: str
    category: str  # authentication | utility | marketing
    param_count: int
    render: Callable[[list[str]], str]


def _otp(p: list[str]) -> str:
    return f"Your verification code is {p[0]}. Valid for 5 minutes."


def _booking_confirmed(p: list[str]) -> str:
    return f"✅ Booking confirmed!\n\U0001f3df {p[0]} - {p[1]}\n\U0001f4c5 {p[2]}\n⏰ {p[3]}\n\U0001f4b0 PKR {p[4]} paid"


def _payment_rejected(p: list[str]) -> str:
    return f"❌ Payment not approved for {p[0]}.\nReason: {p[1]}\nYour slot has been released."


def _payment_submitted_owner(p: list[str]) -> str:
    return (
        f"\U0001f4b0 Payment received!\n\U0001f3df {p[0]} - {p[1]}\n⏰ {p[2]}\n"
        f"\U0001f464 {p[3]}\n✅ Amount: {p[4]}\nTap to approve ↓"
    )


def _tournament_announcement(p: list[str]) -> str:
    return f"\U0001f3c6 Tournament at {p[0]}!\n\U0001f3be {p[1]}\n\U0001f4c5 {p[2]}\n\U0001f4b0 Entry: PKR {p[3]}\nSpots: {p[4]} remaining"


def _venue_approved(p: list[str]) -> str:
    return f"\U0001f389 Your venue {p[0]} has been approved! Players can now find and book your courts."


def _venue_changes_requested(p: list[str]) -> str:
    return f"Your venue {p[0]} needs some changes: {p[1]}. Please update and resubmit."


def _venue_rejected(p: list[str]) -> str:
    return f"Your venue {p[0]} was not approved: {p[1]}."


def _booking_cancelled(p: list[str]) -> str:
    return f"Your booking for {p[0]} on {p[1]} was cancelled."


def _generic_notification(p: list[str]) -> str:
    return p[0]


# ---- audit 2026-10-28: Khelo templates (Roman Urdu). Registered in code so the payload shape is fixed; they are SENT only
# while the `whatsapp_templates` flag is on, which the founder turns on after Meta approved each one (docs/deploy-steps.md).


def _khelo_advance_payment(p: list[str]) -> str:
    return f"{p[0]}: {p[1]} hold ho gaya. Advance {p[2]} is account mein bhejein: {p[3]}. Phir screenshot app mein bhejein."


def _khelo_balance_payment(p: list[str]) -> str:
    return f"Booking {p[0]}: baqi {p[1]}. Transfer se dena ho to is account mein bhejein: {p[2]}."


def _khelo_payment_receipt(p: list[str]) -> str:
    return f"Booking {p[0]}: {p[1]} mil gaye. Kul ada {p[2]}, baqi {p[3]}. Shukriya!"


def _khelo_short_payment(p: list[str]) -> str:
    return f"Booking {p[0]}: kul {p[1]}, diye {p[2]}, baqi {p[3]}. Sahi hai ya ghalat? App mein jawab dein."


def _khelo_points_deducted(p: list[str]) -> str:
    return f"Booking {p[0]}: {p[1]} points kat gaye ({p[2]}). Theek karne ke liye app mein booking kholein."


def _khelo_due_resolved(p: list[str]) -> str:
    return f"Booking {p[0]} ka baqi {p[1]} clear ho gaya. Shukriya!"


def _khelo_no_show(p: list[str]) -> str:
    return f"Booking {p[0]} ({p[1]}) no-show mark hui. Kul {p[2]}, diye {p[3]}, baqi {p[4]}. Aap aaye the to app mein batayein."


def _khelo_walkin_welcome(p: list[str]) -> str:
    return f"{p[0]} mein khelne ka shukriya! Agli booking Khelo app se karein aur rasid WhatsApp par payein."


def _khelo_points_reward(p: list[str]) -> str:
    return f"Mubarak! {p[1]} par {p[0]} points mile. Ab aap ke {p[2]} points hain."


def _khelo_booking_reminder(p: list[str]) -> str:
    return f"Yaad dehaani: {p[0]}, {p[1]}, {p[2]}. Waqt par pohanchein."


TEMPLATES: dict[str, WhatsAppTemplate] = {
    t.name: t
    for t in (
        WhatsAppTemplate("whatsapp_otp", "authentication", 1, _otp),
        WhatsAppTemplate("booking_confirmed", "utility", 5, _booking_confirmed),
        WhatsAppTemplate("payment_rejected", "utility", 2, _payment_rejected),
        WhatsAppTemplate("payment_submitted_owner", "utility", 5, _payment_submitted_owner),
        WhatsAppTemplate("venue_approved", "utility", 1, _venue_approved),
        WhatsAppTemplate("venue_changes_requested", "utility", 2, _venue_changes_requested),
        WhatsAppTemplate("venue_rejected", "utility", 2, _venue_rejected),
        WhatsAppTemplate("booking_cancelled", "utility", 2, _booking_cancelled),
        WhatsAppTemplate("tournament_announcement", "marketing", 5, _tournament_announcement),
        WhatsAppTemplate("khelo_advance_payment", "utility", 4, _khelo_advance_payment),
        WhatsAppTemplate("khelo_balance_payment", "utility", 3, _khelo_balance_payment),
        WhatsAppTemplate("khelo_payment_receipt", "utility", 4, _khelo_payment_receipt),
        WhatsAppTemplate("khelo_short_payment", "utility", 4, _khelo_short_payment),
        WhatsAppTemplate("khelo_points_deducted", "utility", 3, _khelo_points_deducted),
        WhatsAppTemplate("khelo_due_resolved", "utility", 2, _khelo_due_resolved),
        WhatsAppTemplate("khelo_no_show", "utility", 5, _khelo_no_show),
        WhatsAppTemplate("khelo_walkin_welcome", "marketing", 1, _khelo_walkin_welcome),
        WhatsAppTemplate("khelo_points_reward", "utility", 3, _khelo_points_reward),
        WhatsAppTemplate("khelo_booking_reminder", "utility", 3, _khelo_booking_reminder),
        # Fallback for any event without a dedicated template, used only once
        # the 24h free-form window has closed.
        WhatsAppTemplate("generic_notification", "utility", 1, _generic_notification),
    )
}


def build_components(params: list[str], button_payloads: list[str] | None = None) -> list[dict]:
    """WhatsApp Cloud API component format for a template's body params, plus (audit Phase 3 item 8) the payload of each
    quick-reply button, in button order: a tap comes back to the webhook as `button.payload`."""
    out = [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}] if params else []
    for i, payload in enumerate(button_payloads or []):
        out.append({"type": "button", "sub_type": "quick_reply", "index": str(i), "parameters": [{"type": "payload", "payload": payload[:256]}]})
    return out
