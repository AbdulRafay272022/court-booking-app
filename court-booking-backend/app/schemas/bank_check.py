"""audit 2026-10-28 Phase 3 item 2: GET /owners/bank-check (app/services/bank_check_service.py)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel


class BankCheckItemOut(BaseModel):
    entry_id: uuid.UUID
    booking_id: uuid.UUID
    code: str
    player_name: str | None
    court_name: str
    starts_at: datetime
    amount_pkr: int
    credited_at: datetime
    approved_by: str
    kind: str  # "advance" | "balance"


class BankCheckOut(BaseModel):
    venue_id: uuid.UUID
    date: date
    items: list[BankCheckItemOut]
    total_pkr: int
