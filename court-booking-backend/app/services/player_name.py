"""The name a booking is made under, when the player gives one in chat (their own, or a friend's).

One cleaning rule shared by the AI chat tools, the WhatsApp confirm path and POST /bookings/hold (in-app chat buttons),
so a name means the same thing on every channel."""

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.court import Court
from app.models.venue import Venue

PLAYER_NAME_MAX_LENGTH = 100

# words that are never a person's name on their own: sports, places and booking vocabulary
NOT_NAMES = frozenset(
    "padel futsal football cricket badminton tennis squash ground court courts club arena sports sport venue "
    "booking book slot karachi lahore islamabad rawalpindi faisalabad multan peshawar quetta".split()
)


def tidy_player_name(raw: object) -> str | None:
    """Trim, collapse whitespace, strip stray punctuation, cap the length; None when blank or has no letters."""
    name = re.sub(r"\s+", " ", str(raw or "")).strip(" .,-")[:PLAYER_NAME_MAX_LENGTH].strip(" .,-")
    return name if re.search(r"[^\W\d_]", name) else None


async def clean_player_name(db: AsyncSession, court: Court, raw: object) -> str | None:
    """The name for a booking on `court`, or None when it is empty or not a person's name (the model sometimes lifts
    "Court 1" or the venue's name out of the message). Only whole-word matches are rejected, so a real name that merely
    contains a sport word ("Padel Khan") is kept."""
    name = tidy_player_name(raw)
    if name is None:
        return None
    words = {w.casefold() for w in re.findall(r"[^\W\d_]+", name)}
    venue = await db.get(Venue, court.venue_id)
    generic = set(NOT_NAMES)
    for text in (court.name, court.sport, venue.name if venue else ""):
        generic |= {w.casefold() for w in re.findall(r"[^\W\d_]+", text or "")}
    return None if words <= generic else name
