"""fix/nov-9 item 6: text the server writes (push, WhatsApp, bell) follows the receiver's chosen language (users.language)."""

from __future__ import annotations

from app.models.user import User

LANGUAGES = ("ru", "en")
DEFAULT_LANGUAGE = "ru"


def lang_of(user: User | None) -> str:
    value = getattr(user, "language", None) if user is not None else None
    return value if value in LANGUAGES else DEFAULT_LANGUAGE


def pick(user: User | None, ru: str, en: str) -> str:
    """The Roman Urdu or the English text, by the user's language (Roman Urdu when never chosen)."""
    return en if lang_of(user) == "en" else ru


class Txt:
    """A server text in both languages. `legacy` is what a user who never chose a language gets: the text this event
    always used ("en" for the original English pushes, "ru" for the Roman Urdu ones), so nobody's messages change
    until they pick a language (the web / app save their current choice on start)."""

    __slots__ = ("ru", "en", "legacy")

    def __init__(self, ru: str, en: str, legacy: str = "en") -> None:
        self.ru, self.en, self.legacy = ru, en, legacy

    def for_user(self, user: User | None) -> str:
        value = getattr(user, "language", None) if user is not None else None
        lang = value if value in LANGUAGES else self.legacy
        return self.en if lang == "en" else self.ru


def text_for(user: User | None, value: "str | Txt") -> str:
    return value.for_user(user) if isinstance(value, Txt) else value
