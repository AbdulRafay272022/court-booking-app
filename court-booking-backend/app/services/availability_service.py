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
from app.utils.schedule import (
    minutes_from_midnight,
    opening_day_of,
    rule_matches_window,
    schedule_window,
)
from app.utils.timezone import PKT_OFFSET, utc_to_pkt_naive

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
    def match_rule_minutes(
        rules: list[PricingRule], day_of_week: int, slot_start_min: int, slot_end_min: int
    ) -> PricingRule | None:
        """First matching rule wins, evaluated in descending priority order. `day_of_week` is the OPENING day's weekday
        (Monday = 0) and the slot minutes count from that day's midnight (>= 1440 after midnight), so a rule window may
        cross midnight (see utils.schedule.rule_matches_window)."""
        for rule in sorted((r for r in rules if r.is_active), key=lambda r: r.priority, reverse=True):
            if rule.day_of_week and day_of_week not in rule.day_of_week:
                continue
            if not rule_matches_window(rule.start_time, rule.end_time, slot_start_min, slot_end_min):
                continue
            return rule
        return None

    @staticmethod
    def match_rule(
        rules: list[PricingRule], day_of_week: int, slot_start: time, slot_end: time
    ) -> PricingRule | None:
        """Wall-clock convenience over match_rule_minutes for a slot on a single day (end at or before start = crosses
        midnight)."""
        start = minutes_from_midnight(slot_start)
        end = minutes_from_midnight(slot_end)
        if end <= start:
            end += 24 * 60
        return AvailabilityService.match_rule_minutes(rules, day_of_week, start, end)

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

    async def _templates(self, court_id: uuid.UUID) -> dict[int, ScheduleTemplate]:
        result = await self.db.execute(
            select(ScheduleTemplate).where(ScheduleTemplate.court_id == court_id, ScheduleTemplate.is_active.is_(True))
        )
        return {t.day_of_week: t for t in result.scalars().all()}

    async def schedule_day_of(self, court: Court, instant: datetime) -> date:
        """The opening day whose schedule `instant` belongs to (an overnight court's 1:00 AM Friday is a Thursday slot)."""
        return opening_day_of(utc_to_pkt_naive(instant), await self._templates(court.id))

    async def get_day_slots(
        self, court: Court, target_date: date, viewer_id: uuid.UUID | None = None
    ) -> list[SlotOut]:
        """The slots of the schedule day that OPENS on `target_date`, including any after midnight on an overnight court
        (flagged `after_midnight`). The grid is walked in naive Pakistan wall-clock time -- the domain schedule_templates
        and pricing_rules are defined in -- and converted to UTC only at the storage boundary."""
        template = await self.db.scalar(
            select(ScheduleTemplate).where(
                ScheduleTemplate.court_id == court.id,
                ScheduleTemplate.day_of_week == target_date.weekday(),
                ScheduleTemplate.is_active.is_(True),
            )
        )
        if template is None:
            return []

        opens_local, closes_local = schedule_window(target_date, template)
        window_start = (opens_local - PKT_OFFSET).replace(tzinfo=timezone.utc)
        window_end = (closes_local - PKT_OFFSET).replace(tzinfo=timezone.utc)

        blackouts_result = await self.db.execute(
            select(Blackout).where(
                Blackout.court_id == court.id, Blackout.starts_at < window_end, Blackout.ends_at > window_start
            )
        )
        blackouts = blackouts_result.scalars().all()

        rules = await self._load_rules(court.id)

        bookings_result = await self.db.execute(
            select(Booking).where(
                Booking.court_id == court.id,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
                Booking.starts_at < window_end,
                Booking.ends_at > window_start,
            )
        )
        existing_bookings = bookings_result.scalars().all()

        slots: list[SlotOut] = []
        duration = timedelta(minutes=court.slot_minutes)
        day_midnight = datetime.combine(target_date, time.min)
        day_of_week = target_date.weekday()
        slot_start_local = opens_local

        while slot_start_local + duration <= closes_local:
            slot_end_local = slot_start_local + duration
            start_min = int((slot_start_local - day_midnight).total_seconds() // 60)
            rule = self.match_rule_minutes(rules, day_of_week, start_min, start_min + court.slot_minutes)
            price = self.price_for_rule(rule, court) or 0.0
            slot_start_dt = (slot_start_local - PKT_OFFSET).replace(tzinfo=timezone.utc)
            slot_end_dt = (slot_end_local - PKT_OFFSET).replace(tzinfo=timezone.utc)
            advance_amount = round(price * float(rule.advance_percentage) / 100, 2) if rule else 0.0
            after_midnight = slot_start_local.date() > target_date

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
                        after_midnight=after_midnight,
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
                        after_midnight=after_midnight,
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
                        after_midnight=after_midnight,
                    )
                )
            slot_start_local = slot_end_local
        return slots

    async def get_slots_starting_on(
        self, court: Court, calendar_date: date, viewer_id: uuid.UUID | None = None
    ) -> list[SlotOut]:
        """Every slot whose START falls on this Pakistan calendar date: yesterday's after-midnight tail plus today's own
        slots up to midnight. This is the calendar-day view ("what is free on Friday?") used by the assistant and the
        'available today' count; the apps' day tabs use the schedule-day view (get_day_slots) instead."""
        previous = await self.get_day_slots(court, calendar_date - timedelta(days=1), viewer_id=viewer_id)
        today = await self.get_day_slots(court, calendar_date, viewer_id=viewer_id)
        return [s for s in previous if s.after_midnight] + [s for s in today if not s.after_midnight]

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
            day = await self.schedule_day_of(court, slot_start)
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
        # The schedule day is the OPENING day of the slot's schedule (Pakistan time), not its UTC date and not always its
        # calendar date: 1:00 AM Friday on an overnight court is a Thursday slot.
        slots = await self.get_day_slots(court, await self.schedule_day_of(court, starts_at))
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
        opening_day = await self.schedule_day_of(court, starts_at)
        start_min = int((local_starts_at - datetime.combine(opening_day, time.min)).total_seconds() // 60)
        length_min = int((ends_at - starts_at).total_seconds() // 60)
        rule = self.match_rule_minutes(rules, opening_day.weekday(), start_min, start_min + length_min)
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
