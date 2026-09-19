"""Meta-registered WhatsApp template catalog (Section 9.3).

Outside the 24-hour customer-service window, WhatsApp requires a
pre-approved template for any business-initiated message -- free-form text
is only allowed as a direct reply within that window. `notification_service`
checks the window and falls back to these when it's closed.

Each entry's `category` mirrors what Meta itself categorizes the template
as, which is also what drives WhatsApp's per-message cost: `authentication`
and `utility` are cheap (~$0.004 at the time this was written), `marketing`
is materially more (~$0.025) and is gated by `plan_tier` (see
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
        # Fallback for any event without a dedicated template, used only once
        # the 24h free-form window has closed.
        WhatsAppTemplate("generic_notification", "utility", 1, _generic_notification),
    )
}


def build_components(params: list[str]) -> list[dict]:
    """WhatsApp Cloud API component format for a template's body params."""
    if not params:
        return []
    return [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}]
