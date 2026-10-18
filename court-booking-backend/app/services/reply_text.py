"""Fixed replies the system sends in a chat (not written by the model), in the player's own language.

The payment-screenshot reply used to be English-only inside Roman Urdu chats, carried emoji, and said the same thing twice
("the owner will take a closer look ... the venue owner will review"). No emoji anywhere, one sentence per idea.

Khelo Phase 3 (chat reliability): every other fixed message (Held, decline, hold failed, generic failure, busy, handoff, image
replies, button titles) lives here too. `lang` is "ru" (Roman Urdu) or "en" (see app/services/chat_language.py:
`conversation_language`). Rules for every template: plain text (no markdown, no emoji), times are the existing PKT 12-hour
labels, money is `format_pkr`. These functions never raise and never include internal text (error details, tool names):
callers pass codes and facts, not exception messages. The facts (venue, court, slot, total, the pay-within window, bank
lines) are identical in both languages; only the words change."""

import re

from app.errors import ErrorCode
from app.utils.timezone import format_pkr

# Everyday Roman Urdu words that are not English words, so a few of them in a player's recent messages is a reliable signal.
_ROMAN_URDU_WORDS = frozenset(
    "hai hain hay kya kab kal aaj aj kl parson chahiye chahie chayie chaiye chahta chahtay chahtai karna karni kardo krdo "
    "kar karo bhai yaar mujhe mjhy mujhay mera meri apna apni nahi nahin ni haan han jee ji bilkul acha achha theek thik "
    "kaun kaha kahan kitni kitna kitne baje bje raat subah shaam ghanta ghante der abhi isko iska uska wala wali tw toh "
    "booking-karni salam assalam shukriya".split()
)


def looks_like_roman_urdu(texts: list[str]) -> bool:
    """True when at least two Roman Urdu words appear across the player's recent messages."""
    words = re.findall(r"[a-z]+", " ".join(texts).lower())
    return sum(1 for w in words if w in _ROMAN_URDU_WORDS) >= 2


def payment_proof_reply(verdict: str | None, *, booked: bool, roman_urdu: bool) -> str:
    """What the player is told right after sending a payment screenshot. `verdict` is the OCR amount check
    (match / mismatch / unreadable); `booked` is True when the booking was confirmed on the spot (auto-approved)."""
    if roman_urdu:
        if booked:
            return "Shukriya! Amount sahi hai aur aap ki booking confirm ho gayi hai."
        if verdict == "match":
            return "Shukriya! Amount sahi hai. Venue owner jaldi booking confirm kar denge."
        if verdict == "mismatch":
            return "Shukriya! Screenshot ka amount booking ke amount se match nahi kar raha, is liye venue owner khud check karke jaldi bata denge."
        if verdict == "unreadable":
            return "Shukriya! Screenshot ka amount saaf nazar nahi aa raha, is liye venue owner khud check karke jaldi bata denge."
        return "Shukriya! Venue owner aap ka screenshot check karke jaldi bata denge."
    if booked:
        return "Thank you! The amount matches and your booking is confirmed."
    if verdict == "match":
        return "Thank you! The amount matches. The venue owner will confirm your booking shortly."
    if verdict == "mismatch":
        return "Thank you! The amount on the screenshot does not match the booking amount, so the venue owner will check it and get back to you shortly."
    if verdict == "unreadable":
        return "Thank you! The amount on the screenshot is not clearly readable, so the venue owner will check it and get back to you shortly."
    return "Thank you! The venue owner will check your screenshot and get back to you shortly."


# Bank detail labels are the same in both languages (they are the names printed in banking apps).
BANK_LABELS = (("Bank", "bank"), ("Account title", "account_title"), ("Account number", "account_number"), ("IBAN", "iban"))


def _ru(lang: str) -> bool:
    return lang == "ru"


def duration_text(minutes: int, lang: str = "en") -> str:
    """"1 hour" / "1.5 hours" / "30 minutes", or in Roman Urdu "1 ghanta" / "1.5 ghante" / "30 minute"."""
    if minutes < 60:
        return f"{minutes} minute" if _ru(lang) else f"{minutes} minutes"
    hours = minutes / 60
    number = f"{hours:g}"
    if _ru(lang):
        return f"{number} ghanta" if hours == 1 else f"{number} ghante"
    return f"{number} hour" if hours == 1 else f"{number} hours"


def held_where(lang: str, court_name: str | None, venue_name: str | None) -> str:
    """The "where" part of the held message: "Court 1 at Maidan Court, " (English) / "Court 1, Maidan Court, " (Roman Urdu)."""
    if not court_name or not venue_name:
        return ""
    return f"{court_name}, {venue_name}, " if _ru(lang) else f"{court_name} at {venue_name}, "


def held_message(
    lang: str,
    *,
    where: str,
    slot_label: str,
    total: float,
    duration_minutes: int,
    advance: float,
    hold_minutes: int,
    bank_lines: list[tuple[str, str]] | None = None,
) -> str:
    """The reply after a slot is held. `where` comes from `held_where` (or ""), `slot_label` is the PKT label
    ("9:00 PM to 10:30 PM, Tue 22 Sep"), `bank_lines` is [(label, value), ...] in display order."""
    if _ru(lang):
        lines = [
            f"Slot hold ho gaya! {where}{slot_label} (Pakistan time).",
            f"Total {format_pkr(total)} ({duration_text(duration_minutes, lang)}).",
            f"Booking confirm karne ke liye {format_pkr(advance)} {hold_minutes} minute ke andar bhej dein:",
        ]
        closing = "Phir apna payment screenshot yahin bhej dein."
    else:
        lines = [
            f"Held! {where}{slot_label} (Pakistan time).",
            f"Total {format_pkr(total)} for {duration_text(duration_minutes, lang)}.",
            f"Please pay {format_pkr(advance)} within {hold_minutes} minutes to confirm:",
        ]
        closing = "Then send your payment screenshot here."
    lines.extend(f"{label}: {value}" for label, value in (bank_lines or []))
    lines.append(closing)
    return "\n".join(lines)


def declined_message(lang: str) -> str:
    if _ru(lang):
        return "Theek hai, koi masla nahi. Agar kisi aur time ka slot dekhna ho to bata dein."
    return "No problem, let me know if you'd like to look at other times."


# error code -> (english, roman urdu); never the raw exception text.
_HOLD_FAILED: dict[str, tuple[str, str]] = {
    ErrorCode.SLOT_ALREADY_TAKEN: (
        "Sorry, that slot has just been taken. Want to try another time?",
        "Maaf kijiye, ye slot abhi kisi aur ne le liya hai. Koi aur time dekhein?",
    ),
    ErrorCode.PREMIUM_FEATURE_REQUIRED: (
        "Booking through chat is not available for this venue, please book it in the Khelo app.",
        "Is venue ki booking chat se nahi ho sakti, baraye meherbani Khelo app se book karein.",
    ),
}
_HOLD_FAILED_DEFAULT = (
    "Sorry, I couldn't hold that slot. Want to try another time?",
    "Maaf kijiye, ye slot hold nahi ho saka. Koi aur time dekhein?",
)


def hold_failed_message(lang: str, code: str | None = None) -> str:
    en, ru = _HOLD_FAILED.get(code or "", _HOLD_FAILED_DEFAULT)
    return ru if _ru(lang) else en


def generic_failure(lang: str) -> str:
    """The safe reply when the model or a tool failed or timed out. Never carries error text."""
    if _ru(lang):
        return "Maaf kijiye, kuch masla aa gaya. Ek minute baad apna message dobara bhej dein, hum phir koshish karte hain."
    return "Sorry, something went wrong on my side. Please send your message again in a minute and we will try once more."


def busy_message(lang: str) -> str:
    """This player's previous message is still being processed and the wait ran out."""
    if _ru(lang):
        return "Aap ka pichla message abhi process ho raha hai. Thori der baad dobara bhej dein."
    return "I'm still working on your previous message. Please send this again in a moment."


def handoff_message(lang: str) -> str:
    """The assistant is switched off or not configured: a person will follow up."""
    if _ru(lang):
        return "Aap ke message ka shukriya! Hamari team jald aap se rabta karegi. Aap Khelo app mein venues dekh kar seedha book bhi kar sakte hain."
    return "Thanks for your message! Our team will get back to you shortly. You can also browse venues and book directly in the app."


def trouble_message(lang: str) -> str:
    """The tool loop ran out before the model could answer."""
    if _ru(lang):
        return "Maaf kijiye, main ye poora nahi kar saka. Apni baat dobara likh dein, ya seedha Khelo app check kar lein."
    return "I'm having trouble completing that -- could you try rephrasing, or check the app directly?"


def no_pending_booking_message(lang: str) -> str:
    if _ru(lang):
        return "Mujhe payment ka intezar karti koi booking nazar nahi aa rahi. Pehle slot hold karein, phir payment screenshot yahin bhej dein."
    return "I don't see a pending booking waiting for payment. Hold a slot first, then send your payment screenshot here."


def late_payment_proof_message(lang: str) -> str:
    """Owner Round 2 (B1): the screenshot arrived after the hold time ran out (the screenshot is kept for the venue)."""
    if _ru(lang):
        return (
            "Aap ki booking ka waqt khatam ho gaya tha, is liye slot chhor diya gaya. Aap ka screenshot venue ko bhej diya "
            "gaya hai; woh check karke aap se rabta karenge (paisa pohncha ho to wapas kar denge)."
        )
    return (
        "Your booking time ran out before this screenshot arrived, so the slot was released. We have sent your "
        "screenshot to the venue; they will check it and contact you (a refund if the money reached them)."
    )


def image_download_failed_message(lang: str) -> str:
    if _ru(lang):
        return "Wo image download nahi ho saki, baraye meherbani dobara bhej dein."
    return "I couldn't download that image -- could you try sending it again?"


def confirm_button_title(lang: str) -> str:
    """WhatsApp button titles are limited to 20 characters."""
    return "Haan, book karein" if _ru(lang) else "Yes, book it"


def decline_button_title(lang: str) -> str:
    return "Nahi, shukriya" if _ru(lang) else "No, thanks"


# The English texts the chat service writes by itself (kill switch / no provider, tool loop exhausted) and their template.
_KNOWN_ENGLISH = {
    "Thanks for your message! Our team will get back to you shortly. You can also browse venues and book directly in the app.": handoff_message,
    "I'm having trouble completing that -- could you try rephrasing, or check the app directly?": trouble_message,
}
_ENGLISH_BUTTON_TITLES = {"Yes, book it": confirm_button_title, "No, thanks": decline_button_title}


def localize_known_reply(reply: str, lang: str) -> str:
    """If `reply` is one of the fixed English fallbacks the chat service writes itself, return it in `lang`; else unchanged."""
    template = _KNOWN_ENGLISH.get((reply or "").strip())
    return template(lang) if template else reply


def localize_button_title(title: str, lang: str) -> str:
    """The chat service's default English button labels in `lang`; any other label unchanged."""
    template = _ENGLISH_BUTTON_TITLES.get(title)
    return template(lang) if template else title
