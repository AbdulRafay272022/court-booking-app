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
    # audit fixes 2026-10-31 (b): balance transfers this person approved that the owner marked "bank mein nahi mila"
    bank_missing: int = 0
    bank_missing_pkr: int = 0
    bank_missing_open: int = 0  # still waiting for the owner's choice (shown red)


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
    bank_missing: int = 0
    bank_missing_pkr: int = 0
    bank_missing_open: int = 0


class StaffBankMissingOut(BaseModel):
    entry_id: uuid.UUID
    booking_id: uuid.UUID
    code: str
    player_name: str | None
    amount_pkr: int
    credited_at: datetime
    approved_by_id: uuid.UUID | None
    approved_by_name: str | None
    approved_by_role: str | None
    marked_at: datetime
    decision: str | None = None  # None = waiting (red) | staff | player
    decided_at: datetime | None = None


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
    bank_missing: list[StaffBankMissingOut] = []
