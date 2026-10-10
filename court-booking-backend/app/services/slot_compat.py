"""TRANSITION: delete once the new EAS build is out everywhere.

Backward compatibility for app builds from BEFORE Section 32 Part 4c (the fixed 30-minute grid).

Until Part 4c a court's slot length (`courts.slot_minutes`, 30/60/90/120) WAS the grid and `slot_count` counted slots of that
length. Since Part 4c the grid is always 30 minutes and `slot_count` counts 30-minute slots. A phone that still runs an old
build sends `slot_count` in the OLD unit and reads the OLD response shape, so for a transition window the backend serves both.

How a request is classified: new web/mobile clients send `X-Slot-Grid: 30` on every request (packages/api-client
src/client.ts). A request WITHOUT that header is LEGACY. That is the only signal; it is explicit and costs nothing.

How it is kept cheap to delete: there is ONE implementation (the 30-minute logic in availability_service / booking_service).
Everything legacy lives in this module and is a thin adapter around it:
  * legacy requests -> `to_new_slot_count` (old units in, 30-minute slots out) before calling the one real code path;
  * legacy responses <- `legacy_day_slots` (groups the 30-minute slots back into per-court-slot-length slots, derived from the
    real grid so availability stays truthful) and `legacy_quote_fields` / `legacy_action_data` for the other shapes;
  * legacy pricing <- `legacy_range_price` reproduces the old "price the whole court-length window by the rule that contains
    it" rule, so a peak boundary inside a legacy slot is charged exactly as it was before Part 4c.
To remove: delete this file, the `LegacySlotUnits` parameters/branches marked `TRANSITION` in app/api/availability.py,
app/api/bookings.py, app/api/chat.py, the `legacy_units` flag in AvailabilityService.quote_range / month_summary and
BookingService.create_hold / create_walkin, the `Vary` header in the month-summary route, and the tests/test_legacy_slot_units.py.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from typing import TYPE_CHECKING, Annotated, Sequence

from fastapi import Depends, Request, status

from app.errors import AppError, ErrorCode
from app.models.booking import Booking
from app.models.court import Court
from app.models.pricing import PricingRule
from app.schemas.availability import SlotOut
from app.utils.timezone import utc_to_pkt_naive

if TYPE_CHECKING:  # pragma: no cover
    from app.services.availability_service import AvailabilityService

SLOT_GRID_HEADER = "X-Slot-Grid"
SLOT_GRID_VALUE = "30"

# when a legacy slot's 30-minute parts are booked by different bookings, show the most "taken" one
_STATUS_RANK = {"booked": 3, "payment_submitted": 2, "held": 1}


def is_legacy_slot_request(request: Request) -> bool:
    """True when the caller did not declare the 30-minute grid (an app build from before Part 4c)."""
    return request.headers.get(SLOT_GRID_HEADER, "").strip() != SLOT_GRID_VALUE


LegacySlotUnits = Annotated[bool, Depends(is_legacy_slot_request)]


def unit_slots(court: Court) -> int:
    """How many 30-minute slots one OLD slot of this court spans (30 -> 1, 60 -> 2, 90 -> 3, 120 -> 4)."""
    return max(1, -(-int(court.slot_minutes) // 30))


def to_new_slot_count(court: Court, legacy_count: int | None) -> int:
    """A legacy `slot_count` (old slots of the court's length; omitted meant 1) as 30-minute slots."""
    return (legacy_count if legacy_count is not None else 1) * unit_slots(court)


def from_new_slot_count(court: Court, new_count: int) -> int | None:
    """30-minute slots as a legacy count, or None when it is not a whole number of old slots (e.g. 90 minutes on a 60-minute
    court: an old client cannot express that)."""
    k = unit_slots(court)
    return new_count // k if new_count % k == 0 else None


def _old_style_price(
    court: Court, rules: Sequence[PricingRule], opening_day: date, start_local: datetime, length_min: int
) -> tuple[float, float] | None:
    """The pre-Part-4c price of ONE slot window: the rule that contains the WHOLE window (not each half), floodlight surcharge
    included, advance by the court's rule. None when no rule covers it (the old grid showed price 0 and refused the hold)."""
    from app.services.availability_service import AvailabilityService  # local: availability_service imports this module

    start_min = int((start_local - datetime.combine(opening_day, time.min)).total_seconds() // 60)
    rule = AvailabilityService.match_rule_minutes(list(rules), opening_day.weekday(), start_min, start_min + length_min)
    price = AvailabilityService.price_for_rule(rule, court)
    if rule is None or price is None or price <= 0:
        return None
    return price, AvailabilityService.compute_advance(price, court, rule)


def legacy_day_slots(
    court: Court,
    new_slots: list[SlotOut],
    *,
    rules: Sequence[PricingRule] | None = None,
    target_date: date | None = None,
    bookings: Sequence[Booking] = (),
    viewer_id: uuid.UUID | None = None,
) -> list[SlotOut]:
    """One schedule day's 30-minute slots regrouped into the old per-court-slot-length slots (the first slot of the group is the
    old slot's start; the old grid walked from opening time in court-slot-length steps and dropped a last partial slot, which is
    exactly "groups of k, drop an incomplete trailing group"). An old slot is `available` only when every 30-minute part is
    free; otherwise it takes the status of the booking that covers it (or `blocked`). `is_mine` / `booking_id` / `held_until`
    come from the viewer's own booking when one of the parts is theirs. With `rules` and `target_date` the price is the old
    whole-window price (see _old_style_price); without them (the month summary does not show prices) it is the sum of the parts."""
    k = unit_slots(court)
    by_id = {b.id: b for b in bookings}
    out: list[SlotOut] = []
    for i in range(0, len(new_slots) - k + 1, k):
        group = new_slots[i : i + k]
        first, last = group[0], group[-1]
        if any(group[j].ends_at != group[j + 1].starts_at for j in range(k - 1)):
            continue  # cannot happen on a real grid; never merge across a gap
        taken = [s for s in group if s.status not in ("available", "blocked")]
        blocked = [s for s in group if s.status == "blocked"]
        if taken:
            mine = [s for s in taken if s.is_mine]
            pick = mine[0] if mine else max(taken, key=lambda s: _STATUS_RANK.get(s.status, 0))
            status_ = pick.status
            booking_id, held_until, is_mine, reason = pick.booking_id, pick.held_until, pick.is_mine, None
        elif blocked:
            status_, booking_id, held_until, is_mine, reason = "blocked", None, None, False, blocked[0].reason
        else:
            status_, booking_id, held_until, is_mine, reason = "available", None, None, False, None

        price = round(sum(s.price if s.price_exact is None else s.price_exact for s in group), 2)
        advance = round(sum(s.advance_amount if s.advance_exact is None else s.advance_exact for s in group), 2)
        if rules is not None and target_date is not None:
            old = _old_style_price(court, rules, target_date, utc_to_pkt_naive(first.starts_at), int(court.slot_minutes))
            price, advance = old if old is not None else (0.0, 0.0)
        if taken and booking_id is not None:
            booking = by_id.get(booking_id)
            if booking is not None and booking.starts_at == first.starts_at and booking.ends_at == last.ends_at:
                price, advance = float(booking.price), float(booking.advance_amount)  # the old grid showed a whole booking's price
        out.append(
            SlotOut(
                starts_at=first.starts_at,
                ends_at=last.ends_at,
                status=status_,
                price=round(price, 2),
                advance_amount=round(advance, 2),
                held_until=held_until,
                booking_id=booking_id,
                is_mine=is_mine,
                reason=reason,
                after_midnight=first.after_midnight,
            )
        )
    return out


async def legacy_range_price(
    service: "AvailabilityService", court: Court, picked: list[SlotOut]
) -> tuple[float, float]:
    """(price, advance) of a legacy booking = the sum, per old slot, of the old whole-window price. `picked` are the 30-minute
    slots already validated by quote_range (so grid, closing, blackouts and clashes are the one real implementation); only the
    money differs from the new per-30-minute pricing when a rule boundary falls inside an old slot."""
    rules = await service._load_rules(court.id)
    k = unit_slots(court)
    price = advance = 0.0
    for i in range(0, len(picked), k):
        group = picked[i : i + k]
        opening_day = await service.schedule_day_of(court, group[0].starts_at)
        length = int((group[-1].ends_at - group[0].starts_at).total_seconds() // 60)
        old = _old_style_price(court, rules, opening_day, utc_to_pkt_naive(group[0].starts_at), length)
        if old is None:
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.INVALID_SLOT_TIME,
                "No pricing rule covers this slot; ask the venue to configure pricing",
            )
        price += old[0]
        advance += old[1]
    return round(price, 2), round(advance, 2)


def legacy_quote_fields(court: Court, slot_count_new: int) -> dict:
    """The legacy shape of the quote's unit fields: `slot_count` in old slots, `slot_minutes` = the court's own slot length
    (old clients compute `slot_count * slot_minutes` for the duration, which equals the real duration)."""
    return {
        "slot_count": slot_count_new // unit_slots(court),
        "slot_minutes": int(court.slot_minutes),
    }


def legacy_action_data(court: Court | None, data: dict) -> dict | None:
    """The in-app assistant's confirm-button data for a legacy client: `slot_count` converted to old slots (the button's data is
    sent straight back to POST /bookings/hold, which reads it in old units for a legacy caller). None when the booking cannot be
    expressed in old slots (e.g. 90 minutes on a 60-minute court): the caller then omits the button rather than book the wrong
    length (the player can still type 'yes', which the server handles in the new units)."""
    if court is None or "slot_count" not in data:
        return dict(data)
    legacy_count = from_new_slot_count(court, int(data["slot_count"]))
    if legacy_count is None:
        return None
    return {**data, "slot_count": legacy_count}
