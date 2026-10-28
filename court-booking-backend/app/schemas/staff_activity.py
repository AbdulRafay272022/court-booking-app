"""Audit 2026-10-28 item 16: the owner / admin staff dashboard (app/services/staff_activity_service.py)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel


class StaffActivityRowOut(BaseModel):
    user_id: uuid.UUID | None
    name: str | None
    role: str
    bookings_marked: int
    no_shows: int
    check_ins: int
    walkins: int
    short_payments: int
    short_amount_pkr: int
    cash_entries: int
    cash_pkr: int
    transfers: int
    transfers_pkr: int
    refunds_paid_pkr: int
    total_recorded_pkr: int


class StaffActivityTotalsOut(BaseModel):
    bookings_marked: int
    no_shows: int
    check_ins: int
    walkins: int
    short_payments: int
    short_amount_pkr: int
    cash_entries: int
    cash_pkr: int
    transfers: int
    transfers_pkr: int
    refunds_paid_pkr: int
    total_recorded_pkr: int


class StaffNoShowOut(BaseModel):
    booking_id: uuid.UUID
    player_name: str | None
    court_name: str | None
    starts_at: datetime | None
    marked_by_name: str | None
    marked_by_role: str | None
    marked_at: datetime
    # audit Phase 3 item 6 (flag noshow_reply): the player's reply and the "Pohanch gaya" GPS check
    reply_id: uuid.UUID | None = None
    player_replied: bool = False
    player_note: str | None = None
    owner_decision: str | None = None
    arrival_verdict: str | None = None  # near | far | pin_unreliable
    arrival_distance_m: float | None = None
    highlight: bool = False  # GPS says the player WAS there: show this no-show in red


class StaffActivityOut(BaseModel):
    venue_id: uuid.UUID
    date_from: date
    date_to: date
    people: list[StaffActivityRowOut]
    totals: StaffActivityTotalsOut
    no_shows: list[StaffNoShowOut]
