"""Fixed replies the system sends on WhatsApp (not written by the model), in the player's own language.

The payment-screenshot reply used to be English-only inside Roman Urdu chats, carried emoji, and said the same thing twice
("the owner will take a closer look ... the venue owner will review"). No emoji anywhere, one sentence per idea."""

import re

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
