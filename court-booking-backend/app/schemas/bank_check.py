"""audit 2026-10-28 Phase 3 item 2: GET /owners/bank-check (app/services/bank_check_service.py)."""

import uuid
from datetime import date, datetime

from typing import Literal

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
    # audit fixes 2026-10-31 (b): a balance transfer the owner marked "bank mein nahi mila"
    can_mark: bool = False
    not_received: bool = False
    decision: str | None = None  # staff | player, once the owner chose
    approved_by_role: str | None = None


class BankMissingDecideIn(BaseModel):
    decision: Literal["staff", "player"]


class BankMissingStateOut(BaseModel):
    entry_id: uuid.UUID
    not_received: bool = True
    marked_at: datetime
    decision: str | None = None
    decided_at: datetime | None = None


class BankCheckOut(BaseModel):
    venue_id: uuid.UUID
    date: date
    items: list[BankCheckItemOut]
    total_pkr: int
