"""Real facts for the booking assistant, read from the database every turn (never from the model's memory or a hard-coded list).

`PlatformFacts` is a plain, immutable-ish snapshot of the approved venues: which sports each really offers (from its ACTIVE courts), the
courts per sport, indoor/outdoor, minimum booking, the "from" price of each court (the existing `AvailabilityService.starts_from_price`,
formatted with `format_pkr`; nothing is computed here) and, on demand, opening hours. The deterministic state extractor
(`chat_state`), the guards (`chat_guards`), the fixed templates (`chat_templates`) and the reply validator (`chat_validator`) all read
this one object, and `facts_block` renders the short block appended to the model's system prompt.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import time
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.models.schedule import ScheduleTemplate
from app.services.availability_service import AvailabilityService
from app.utils.timezone import format_duration, format_pkr

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.chat_state import ChatState
    from app.services.venue_service import VenueService

MAX_VENUES_IN_BLOCK = 8


def sport_display(sport: str) -> str:
    """"padel" / "Cricket nets" -> "Padel" / "Cricket Nets": one spelling for a sport wherever it is shown."""
    return " ".join((sport or "").split()).title()


def clock_12h(value: time) -> str:
    return f"{value.hour % 12 or 12}:{value.minute:02d} {'AM' if value.hour < 12 else 'PM'}"


@dataclass(frozen=True)
class CourtFact:
    id: str
    name: str
    sport: str  # display spelling
    indoor: bool
    min_minutes: int
    from_price: float | None  # price of the minimum booking, None when no active pricing rule

    @property
    def from_price_text(self) -> str | None:
        return format_pkr(self.from_price) if self.from_price is not None else None

    @property
    def price_line(self) -> str | None:
        if self.from_price is None:
            return None
        return f"{format_pkr(self.from_price)} for {format_duration(self.min_minutes)}"


@dataclass
class VenueFact:
    id: str
    name: str
    city: str
    area: str | None
    address: str
    courts: list[CourtFact] = field(default_factory=list)
    listed_sports: list[str] = field(default_factory=list)  # the owner-entered list, only used when no active court exists
    hours: str | None = None  # filled by `load_hours`

    @property
    def sports(self) -> list[str]:
        """The sports this venue REALLY offers: its active courts' sports (first-seen order), else the owner-entered list."""
        seen: dict[str, str] = {}
        for court in self.courts:
            seen.setdefault(court.sport.lower(), court.sport)
        if not seen:
            for sport in self.listed_sports:
                seen.setdefault(sport.strip().lower(), sport_display(sport))
        return sorted(seen.values(), key=str.lower)  # one stable, alphabetical order wherever sports are listed

    def courts_for(self, sport: str | None) -> list[CourtFact]:
        if not sport:
            return list(self.courts)
        return [c for c in self.courts if c.sport.lower() == sport.lower()]


@dataclass
class PlatformFacts:
    venues: list[VenueFact] = field(default_factory=list)

    def sports(self) -> list[str]:
        seen: dict[str, str] = {}
        for venue in self.venues:
            for sport in venue.sports:
                seen.setdefault(sport.lower(), sport)
        return sorted(seen.values())

    def venue(self, venue_id: str | None) -> VenueFact | None:
        return next((v for v in self.venues if v.id == str(venue_id)), None) if venue_id else None

    def court(self, court_id: str | None) -> tuple[VenueFact, CourtFact] | None:
        for venue in self.venues:
            for court in venue.courts:
                if court.id == str(court_id):
                    return venue, court
        return None

    def venues_with_sport(self, sport: str | None) -> list[VenueFact]:
        if not sport:
            return list(self.venues)
        return [v for v in self.venues if sport.lower() in {s.lower() for s in v.sports}]

    @property
    def empty(self) -> bool:
        return not self.venues


async def load_platform_facts(venue_service: VenueService) -> PlatformFacts:
    """The approved, active venues with their active courts. One query set (selectinload) per turn."""
    rows, _total = await venue_service.list_venues(limit=200)
    venues: list[VenueFact] = []
    for venue, _dist in rows:
        courts = [
            CourtFact(
                id=str(c.id),
                name=c.name,
                sport=sport_display(c.sport),
                indoor=bool(c.is_indoor),
                min_minutes=int(c.slot_minutes),
                from_price=AvailabilityService.starts_from_price(c, list(c.pricing_rules)),
            )
            for c in sorted(venue.courts, key=lambda c: (c.sort_order, c.name))
            if c.is_active
        ]
        venues.append(
            VenueFact(
                id=str(venue.id),
                name=venue.name,
                city=venue.city,
                area=venue.area,
                address=venue.address or "",
                courts=courts,
                listed_sports=[str(s) for s in (venue.sports or [])],
            )
        )
    return PlatformFacts(venues=venues)


def _hours_text(templates: list[ScheduleTemplate]) -> str | None:
    active = [t for t in templates if t.is_active]
    if not active:
        return None
    spans = {(t.open_time, t.close_time, bool(t.closes_next_day)) for t in active}

    def span(o: time, c: time, nxt: bool) -> str:
        return f"{clock_12h(o)} to {clock_12h(c)}" + (" (next day)" if nxt else "")

    if len(spans) == 1:
        o, c, nxt = next(iter(spans))
        every_day = len({t.day_of_week for t in active}) == 7
        return span(o, c, nxt) + (" every day" if every_day else " (not every day)")
    earliest = min(t.open_time for t in active)
    latest = max(t.close_time for t in active)
    return f"{clock_12h(earliest)} to {clock_12h(latest)} (hours vary by day or court)"


async def load_hours(db: AsyncSession, venues: list[VenueFact]) -> None:
    """Fill `VenueFact.hours` for the given venues from the courts' schedule templates (one query)."""
    court_ids = [uuid.UUID(c.id) for v in venues for c in v.courts]
    if not court_ids:
        return
    rows = (await db.scalars(select(ScheduleTemplate).where(ScheduleTemplate.court_id.in_(court_ids)))).all()
    by_court: dict[str, list[ScheduleTemplate]] = {}
    for row in rows:
        by_court.setdefault(str(row.court_id), []).append(row)
    for venue in venues:
        venue.hours = _hours_text([t for c in venue.courts for t in by_court.get(c.id, [])])


# --- the block appended to the model's system prompt --------------------------------------------------------------------------------


def _known(value: object, prov: str | None = None) -> str:
    return "unknown" if value in (None, "") else str(value)


def known_line(state: ChatState) -> str:
    """"Known so far (from the player): sport=Futsal, date=..." -- what the player has actually said (or a database fact) this conversation."""
    from app.services.chat_state import PLAYER, BUTTON, display_date, display_duration, display_time

    def tag(name: str, text: str | None) -> str:
        if not text:
            return f"{name}=unknown"
        prov = state.prov.get(name)
        marker = "" if prov in (PLAYER, BUTTON) else (" (from the database)" if prov == "tool_result" else " (NOT said by the player)")
        return f"{name}={text}{marker}"

    parts = [
        tag("venue", state.venue_name),
        tag("sport", state.sport),
        tag("court", state.court_name),
        tag("date", display_date(state.date)),
        tag("time", display_time(state.start_time) + (f" to {display_time(state.end_time)}" if state.end_time else "") if state.start_time else None),
        tag("duration", display_duration(state.duration_minutes)),
    ]
    if state.ambiguous_hour:
        parts.append(f"time={state.ambiguous_hour} o'clock but AM or PM is not known yet")
    return ", ".join(parts)


def facts_block(state: ChatState, facts: PlatformFacts, *, missing: list[str] | None = None) -> str:
    """Short structured block for the system prompt: the state plus the real facts for the venue(s) in play."""
    lines = [
        "CONVERSATION STATE (computed by the server from the player's own messages; it is the truth about this booking):",
        "Known so far: " + known_line(state) + f". Player language: {'Roman Urdu' if state.language == 'ru' else 'English'} (reply in it).",
        f"Stage: {state.stage}.",
    ]
    venue = facts.venue(state.venue_id)
    if venue is not None:
        lines.append(f"Real facts for {venue.name} [venue_id={venue.id}] (never contradict): offers {', '.join(venue.sports) or 'no sports yet'}.")
        for court in venue.courts:
            if state.sport and court.sport.lower() != state.sport.lower():
                lines.append(f"- {court.name} [court_id={court.id}]: {court.sport}, {'indoor' if court.indoor else 'outdoor'} (not the sport asked for).")
                continue
            price = f", from {court.price_line}" if court.price_line else ""
            lines.append(
                f"- {court.name} [court_id={court.id}]: {court.sport}, {'indoor' if court.indoor else 'outdoor'}, minimum booking {format_duration(court.min_minutes)}{price}."
            )
        if venue.hours:
            lines.append(f"Open {venue.hours}.")
    else:
        lines.append("Real facts (venue not chosen yet; never contradict): venues and the sports they really offer:")
        shown = facts.venues_with_sport(state.sport) or facts.venues
        for v in shown[:MAX_VENUES_IN_BLOCK]:
            courts = "; ".join(f"{c.name} [court_id={c.id}]={c.sport}" for c in v.courts)
            lines.append(f"- {v.name} [venue_id={v.id}] ({v.city}): {', '.join(v.sports) or 'none'}. Courts: {courts or 'none'}.")
        if len(shown) > MAX_VENUES_IN_BLOCK:
            lines.append(f"- and {len(shown) - MAX_VENUES_IN_BLOCK} more venues (use search_venues).")
    lines.append("Platform sports: " + (", ".join(facts.sports()) or "none yet") + ".")
    if missing:
        lines.append("Still needed from the player, ask ONE question only, in this order: " + ", ".join(missing) + ".")
    lines.append(
        "Rules from the state: never ask for something that is already known above; never use a sport, court, date, time or duration that the player did not say "
        "(items marked NOT said by the player are only guesses). If the player asks for a sport this venue does not offer, say so and list the real ones. "
        "The venue_id and court_id values above are real: use them directly (no need to call search_venues, get_venue_info or get_venue_courts just to find them), "
        "and go straight to check_availability / quote_booking / propose_booking_confirmation."
    )
    return "\n".join(lines)
