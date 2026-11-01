"""Staff "Aane wale players" (OStaffView board): today's players for a check-in staff member.

Deliberately minimal (owner decision 2026-11-01): the player's name, the court, start/end and whether they checked
in. No phone, no money, no screenshots, no booking ids and no other day -- a check-in account sees who is coming,
nothing it could use to contact a player or read the venue's money.
"""
import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ArrivalOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    player_name: str
    court_name: str
    starts_at: datetime
    ends_at: datetime
    checked_in: bool


class ArrivalsOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    venue_id: uuid.UUID
    date: date
    items: list[ArrivalOut]
