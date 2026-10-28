"""audit 2026-10-28 Phase 3 items 3-6 (app/api/phase3.py)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PointEntryOut(BaseModel):
    id: uuid.UUID
    delta: int
    # transfer_booking | short_reply | short_no_reply | short_no_reply_returned | redeem | redeem_returned
    reason: str
    booking_id: uuid.UUID | None
    code: str | None
    created_at: datetime


class PointsOut(BaseModel):
    enabled: bool
    balance: int
    redeem_points: int
    rule_text_ru: str
    rule_text_en: str
    entries: list[PointEntryOut]


class PointsOfferOut(BaseModel):
    # off | venue_off | not_now | not_enough | available | used
    state: str
    balance: int
    cost_points: int
    discount_pkr: int
    rule_text_ru: str
    rule_text_en: str


class DueOut(BaseModel):
    """One short payment ("kam mila"); while resolved_at is null it is a due the venue carries."""

    id: uuid.UUID
    booking_id: uuid.UUID
    code: str
    venue_id: uuid.UUID
    player_id: uuid.UUID | None
    total_pkr: int
    paid_pkr: int
    due_pkr: int
    status: str  # awaiting_reply | confirmed | disputed | no_reply
    reply_deadline_at: datetime
    replied_at: datetime | None
    player_reason: str | None
    penalty_applied: int
    penalty_returned: bool
    owner_decision: str | None
    resolved_at: datetime | None
    resolution: str | None
    player_name: str | None = None
    starts_at: datetime | None = None
    created_at: datetime
    can_reply: bool | None = None


class ArrivalStateOut(BaseModel):
    enabled: bool
    arrival: dict | None
    can_arrive: bool
    noshow_reply: dict | None
    can_reply_noshow: bool


class BookingExtrasOut(BaseModel):
    points: PointsOfferOut
    short_payment: DueOut | None
    arrival: ArrivalStateOut


class ShortReplyIn(BaseModel):
    answer: Literal["yes", "no"]
    reason: str | None = Field(default=None, max_length=500)


class ArrivalIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)


class ArrivalOut(BaseModel):
    verdict: str  # near | far | pin_unreliable
    distance_m: float | None
    at: datetime


class NoShowReplyIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class NoShowReplyOut(BaseModel):
    id: uuid.UUID
    booking_id: uuid.UUID
    note: str | None
    owner_decision: str | None
    at: datetime


class DecideIn(BaseModel):
    decision: Literal["collect", "waive"]


class NoShowDecideIn(BaseModel):
    decision: Literal["keep", "reverse"]


class ApprovalPlayerContextOut(BaseModel):
    """On an approval card (flag player_dues): the player's open dues at this venue and their record here."""

    dues: list[DueOut]
    no_shows: int
    total_bookings: int


class MoneyHealthRowOut(BaseModel):
    venue_id: uuid.UUID
    venue_name: str = ""
    dues_open: int = 0
    dues_open_pkr: int = 0
    short_disputes_waiting: int = 0
    noshow_replies_waiting: int = 0
    points_awarded: int = 0
    points_used: int = 0


class MoneyHealthTotalsOut(BaseModel):
    dues_open: int = 0
    dues_open_pkr: int = 0
    short_disputes_waiting: int = 0
    noshow_replies_waiting: int = 0
    points_awarded: int = 0
    points_used: int = 0


class MoneyHealthOut(BaseModel):
    """audit Phase 3 item 9: points, dues and disputes, per venue and in total (staff dashboard: one venue; admin: all)."""

    totals: MoneyHealthTotalsOut
    venues: list[MoneyHealthRowOut]
