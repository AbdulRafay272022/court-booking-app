import uuid
from datetime import date, datetime, time, timedelta, timezone

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError, ErrorCode
from app.models.blackout import Blackout
from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.court import Court
from app.models.pricing import PricingRule
from app.models.schedule import ScheduleTemplate
from app.schemas.availability import SlotOut
from app.utils.timezone import PKT_OFFSET, pkt_date_of, pkt_time_to_utc, utc_to_pkt_naive

MAX_RANGE_DAYS = 28
# Longest single booking a player can make, whatever the court's slot length (Section 32 Part 4).
MAX_BOOKING_MINUTES = 240


@dataclass(frozen=True)
class RangeQuote:
    """What a booking of `slot_count` consecutive slots starting at `starts_at` costs. The one place the
    total is computed: the quote endpoint the apps show before confirming, the hold, and the AI all use it."""

    starts_at: datetime
    ends_at: datetime
    slot_count: int
    duration_minutes: int
    price: float
    advance_amount: float
    slots: list[SlotOut]


class AvailabilityService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_court(self, court_id: uuid.UUID) -> Court:
        court = await self.db.get(Court, court_id)
        if court is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Court not found")
        return court

    @staticmethod
    def match_rule(
        rules: list[PricingRule], day_of_week: int, slot_start: time, slot_end: time
    ) -> PricingRule | None:
        """First matching rule wins, evaluated in descending priority order."""
        for rule in sorted((r for r in rules if r.is_active), key=lambda r: r.priority, reverse=True):
            if rule.day_of_week and day_of_week not in rule.day_of_week:
                continue
            if rule.start_time is not None and slot_start < rule.start_time:
                continue
            if rule.end_time is not None and slot_end > rule.end_time:
                continue
            return rule
        return None

    @staticmethod
    def price_for_rule(rule: PricingRule | None, court: Court) -> float | None:
        if rule is None:
            return None
        price = float(rule.price_per_slot)
        if court.has_floodlights:
            price += float(rule.floodlight_surcharge)
        return price

    async def _load_rules(self, court_id: uuid.UUID) -> list[PricingRule]:
        result = await self.db.execute(select(PricingRule).where(PricingRule.court_id == court_id))
        return list(result.scalars().all())

    async def get_day_slots(
        self, court: Court, target_date: date, viewer_id: uuid.UUID | None = None
    ) -> list[SlotOut]:
        # Bounds are anchored to PKT midnight (not UTC midnight) so they stay
        # aligned with the PKT-shifted slot times computed below, even for a
        # court whose hours straddle the UTC day boundary.
        day_start = pkt_time_to_utc(target_date, datetime.min.time())
        day_end = day_start + timedelta(days=1)

        blackouts_result = await self.db.execute(
            select(Blackout).where(
                Blackout.court_id == court.id, Blackout.starts_at < day_end, Blackout.ends_at > day_start
            )
        )
        blackouts = blackouts_result.scalars().all()

        day_of_week = target_date.weekday()
        template = await self.db.scalar(
            select(ScheduleTemplate).where(
                ScheduleTemplate.court_id == court.id,
                ScheduleTemplate.day_of_week == day_of_week,
                ScheduleTemplate.is_active.is_(True),
            )
        )
        if template is None:
            return []

        rules = await self._load_rules(court.id)

        bookings_result = await self.db.execute(
            select(Booking).where(
                Booking.court_id == court.id,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
                Booking.starts_at < day_end,
                Booking.ends_at > day_start,
            )
        )
        existing_bookings = bookings_result.scalars().all()

        slots: list[SlotOut] = []
        duration = timedelta(minutes=court.slot_minutes)
        # The loop walks in naive Pakistan-local wall-clock time -- the same
        # domain schedule_templates/pricing_rules' start_time/end_time columns
        # are defined in -- and only converts to a UTC-aware instant at the
        # point of comparing against/returning real stored timestamps below.
        slot_start_local = datetime.combine(target_date, template.open_time)
        day_close_local = datetime.combine(target_date, template.close_time)

        while slot_start_local + duration <= day_close_local:
            slot_end_local = slot_start_local + duration
            rule = self.match_rule(rules, day_of_week, slot_start_local.time(), slot_end_local.time())
            price = self.price_for_rule(rule, court) or 0.0
            slot_start_dt = (slot_start_local - PKT_OFFSET).replace(tzinfo=timezone.utc)
            slot_end_dt = (slot_end_local - PKT_OFFSET).replace(tzinfo=timezone.utc)
            advance_amount = round(price * float(rule.advance_percentage) / 100, 2) if rule else 0.0

            blackout = next(
                (bl for bl in blackouts if bl.starts_at < slot_end_dt and bl.ends_at > slot_start_dt), None
            )
            booking = next(
                (
                    b
                    for b in existing_bookings
                    if b.starts_at < slot_end_dt and b.ends_at > slot_start_dt
                ),
                None,
            )

            if blackout is not None:
                slots.append(
                    SlotOut(
                        starts_at=slot_start_dt,
                        ends_at=slot_end_dt,
                        status="blocked",
                        price=round(price, 2),
                        advance_amount=advance_amount,
                        reason=blackout.reason,
                    )
                )
            elif booking is not None:
                # A multi-slot booking covers several grid cells; the total belongs to the booking, so only a
                # cell that IS the whole booking shows its price (otherwise each cell would claim the total).
                whole = booking.starts_at == slot_start_dt and booking.ends_at == slot_end_dt
                slots.append(
                    SlotOut(
                        starts_at=slot_start_dt,
                        ends_at=slot_end_dt,
                        status=booking.status.value,
                        price=float(booking.price) if whole else round(price, 2),
                        advance_amount=float(booking.advance_amount) if whole else advance_amount,
                        held_until=booking.held_until,
                        booking_id=booking.id,
                        is_mine=viewer_id is not None and booking.player_id == viewer_id,
                    )
                )
            else:
                slots.append(
                    SlotOut(
                        starts_at=slot_start_dt,
                        ends_at=slot_end_dt,
                        status="available",
                        price=round(price, 2),
                        advance_amount=advance_amount,
                    )
                )
            slot_start_local = slot_end_local
        return slots

    async def quote_range(self, court: Court, starts_at: datetime, slot_count: int = 1) -> RangeQuote:
        """Price a booking of `slot_count` consecutive slots beginning exactly at `starts_at`.

        Every slot is looked up on the court's real grid (so a range that runs past closing time, or starts
        off the grid, is refused) and priced by its own matching rule, so a booking that crosses a peak-price
        boundary (or midnight) is charged slot by slot rather than at the first slot's rate. Raises AppError
        with a plain-language message when the range cannot be booked as asked. The caller still relies on
        the database (unique index + overlap constraint) for the actual race, not on this pre-check.
        """
        if slot_count < 1:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_DURATION, "Pick at least one slot")
        if slot_count * court.slot_minutes > max(MAX_BOOKING_MINUTES, court.slot_minutes):
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.INVALID_DURATION,
                f"A single booking can be at most {MAX_BOOKING_MINUTES // 60} hours long",
            )
        step = timedelta(minutes=court.slot_minutes)
        by_day: dict[date, list[SlotOut]] = {}
        picked: list[SlotOut] = []
        for i in range(slot_count):
            slot_start = starts_at + step * i
            day = pkt_date_of(slot_start)
            if day not in by_day:
                by_day[day] = await self.get_day_slots(court, day)
            slot = next((s for s in by_day[day] if s.starts_at == slot_start), None)
            if slot is None:
                if i == 0:
                    raise AppError(
                        status.HTTP_400_BAD_REQUEST,
                        ErrorCode.INVALID_SLOT_TIME,
                        "starts_at must exactly match one of this court's scheduled slot start times",
                    )
                raise AppError(
                    status.HTTP_400_BAD_REQUEST,
                    ErrorCode.INVALID_DURATION,
                    "That length runs past the court's closing time. Pick a shorter time.",
                )
            if slot.status == "blocked":
                raise AppError(
                    status.HTTP_400_BAD_REQUEST, ErrorCode.SLOT_BLOCKED, "This time is unavailable"
                )
            if slot.status != "available":
                raise AppError(
                    status.HTTP_409_CONFLICT,
                    ErrorCode.SLOT_ALREADY_TAKEN,
                    "Part of that time is already booked" if i else "This slot was just booked by someone else",
                )
            if slot.price <= 0:
                raise AppError(
                    status.HTTP_400_BAD_REQUEST,
                    ErrorCode.INVALID_SLOT_TIME,
                    "No pricing rule covers this slot; ask the venue to configure pricing",
                )
            picked.append(slot)
        return RangeQuote(
            starts_at=picked[0].starts_at,
            ends_at=picked[-1].ends_at,
            slot_count=slot_count,
            duration_minutes=slot_count * court.slot_minutes,
            price=round(sum(s.price for s in picked), 2),
            advance_amount=round(sum(s.advance_amount for s in picked), 2),
            slots=picked,
        )

    async def is_slot_grid_aligned(self, court: Court, starts_at: datetime) -> bool:
        """True iff `starts_at` is exactly one of the slot start times the
        availability grid would generate for this court on that day.

        This is the gap that makes `one_live_booking_per_slot` (the
        partial unique index on (court_id, starts_at)) actually sufficient
        to prevent overlapping bookings: that index only catches two
        bookings with the *exact same* starts_at. Without this check, a
        caller could pass an off-grid starts_at (e.g. 19:37 when the grid
        is 19:00/20:00/...) and create a booking that overlaps an existing
        19:00-20:00 booking without ever colliding on the index, since
        19:00 != 19:37 as far as the index is concerned. Reuses
        `get_day_slots` (rather than reimplementing the grid math a second
        time) so this check can never drift from what the availability
        endpoint actually shows a player as bookable.
        """
        # The schedule day is the PAKISTAN calendar date of the slot, not its UTC date.
        slots = await self.get_day_slots(court, pkt_date_of(starts_at))
        return any(s.starts_at == starts_at for s in slots)

    async def is_slot_open(self, court_id: uuid.UUID, starts_at: datetime, ends_at: datetime) -> bool:
        """Blackout check only -- double-booking is the unique index's job
        (see `booking_service._insert_booking`), not a check-then-write race
        here. A blackout is a rare, deliberate owner action rather than a
        concurrent user-facing race, so a plain pre-check is fine for it."""
        blackout = await self.db.execute(
            select(Blackout).where(
                Blackout.court_id == court_id, Blackout.starts_at < ends_at, Blackout.ends_at > starts_at
            )
        )
        return blackout.scalar_one_or_none() is None

    async def is_range_available(self, court_id: uuid.UUID, starts_at: datetime, ends_at: datetime) -> bool:
        overlap = await self.db.execute(
            select(Booking).where(
                Booking.court_id == court_id,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
                Booking.starts_at < ends_at,
                Booking.ends_at > starts_at,
            )
        )
        if overlap.scalar_one_or_none() is not None:
            return False
        blackout = await self.db.execute(
            select(Blackout).where(
                Blackout.court_id == court_id, Blackout.starts_at < ends_at, Blackout.ends_at > starts_at
            )
        )
        return blackout.scalar_one_or_none() is None

    async def price_for_range_with_advance(
        self, court: Court, starts_at: datetime, ends_at: datetime
    ) -> tuple[float, float]:
        """Returns (price, advance_percentage) from the highest-priority
        matching rule; raises if no rule covers this slot at all.

        `starts_at`/`ends_at` are real UTC instants (as generated by
        get_day_slots and echoed back by the caller when holding a slot);
        pricing_rules' day_of_week/start_time/end_time are defined in PKT
        wall-clock terms, same as schedule_templates, so they must be
        converted back before matching."""
        rules = await self._load_rules(court.id)
        local_starts_at = utc_to_pkt_naive(starts_at)
        local_ends_at = utc_to_pkt_naive(ends_at)
        rule = self.match_rule(rules, local_starts_at.weekday(), local_starts_at.time(), local_ends_at.time())
        price = self.price_for_rule(rule, court)
        if price is None or rule is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No pricing rule covers this slot; ask the venue to configure pricing",
            )
        return price, float(rule.advance_percentage)

    @staticmethod
    def validate_range(start_date: date, end_date: date) -> None:
        if end_date < start_date:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date must be >= start_date")
        if (end_date - start_date).days + 1 > MAX_RANGE_DAYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Date range cannot exceed {MAX_RANGE_DAYS} days",
            )
