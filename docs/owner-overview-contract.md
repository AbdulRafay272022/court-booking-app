# Owner Overview: shared contract (branch feat/owner-overview)

Lead-written. Backend agent A implements EXACTLY this; web/mobile agents code against `packages/types/src/owner-overview.ts` and `packages/api-client/src/owners.ts` (already added by the lead). All endpoints are additive; nothing existing changes.

## Rule 0.1 result (no schema change needed)
- Money: `payment_entries` already stores amount (whole PKR, negative for corrections), method, recorded_by, note, created_at, reverses_entry_id. "Haan" = a balance entry for the remaining due; "Nahi" = entries until total paid equals what was received. `bookings.amount_paid/balance_due` stay derived via `recompute_payment_totals`.
- Completion state (Haan / Nahi, who, when, previous value, new value, reason, amount) = `audit_log` rows `entity_type="booking"`, `action="booking.completion_marked"`, `new_value={"result":"yes|no","received_pkr":int,"reason":str|null}`, `old_value` = previous such value or null. The CURRENT state of a booking is its latest such row (one DISTINCT ON query for a whole page). No new column, no new table, no migration.
- `bookings.status = completed` exists in the enum but is NOT used by this feature (Nahi has no equivalent); do not set it.
- Refund state = `payment_disputes` (refund_amount, refund_status owed|paid, refunded_amount, refunded_at).
- The completion endpoint is NOT gated by the `split_payments` feature flag (it must work for plain bookings); it requires permission `record_payments` (owner always allowed). Record that decision in the report.

## Operating day
Venue opening hours per weekday (`schedule_templates`, `closes_next_day`) define the operating day: a slot belongs to the schedule day that OPENS it (existing rule, Section 32 Part 3: Thu 3 PM to 3 AM covers Fri 1 AM). Reuse `AvailabilityService` grid code (`build_day_slots`, 30-minute grid, `startable_slots` NOT used for counts). Asia/Karachi. `operating_day.start_at/end_at` = first open to last close of the selected courts for that date.

## Slot counts (one shared function, tested)
Unit = 30-minute grid slot of the selected courts in the operating day. Each slot has exactly ONE state:
`booked` (booking status booked/completed/no_show), `pending` (held / payment_submitted), `blocked` (owner blackout), `free` (rest). Closed hours are not slots. `total = booked + pending + blocked + free` ALWAYS (test it incl. an overnight court and a multi-slot booking). `free_upcoming` = free slots with ends_at > now, `free_past` = free slots already ended (`free = free_upcoming + free_past`). Past booked slots stay `booked`.

## Endpoints (prefix /api/v1/owners, auth owner/staff with `view_ledger` unless stated)
Query params: `venue_id` (optional, as elsewhere), `court_ids` (repeat param or comma list; empty = all active courts of the venue).

1. `GET /overview?date=YYYY-MM-DD&venue_id&court_ids` -> `OwnerOverview` (types file). Fixed number of queries.
   - `rows`: ONLY kinds booked / cancelled / refund for bookings whose slot START falls in the operating day (cancelled + refund rows placed by the booking's slot date). A cancelled booking WITH a refund yields two rows (cancelled + refund), same `booking_id`, both with `original_booking_id = booking_id`.
   - `bookings.count` = distinct bookings that are booked/completed/no_show (confirmed). `cancelled` = cancelled bookings. `refunds` = bookings with a dispute row whose refund_amount > 0 (count + sum of refund_amount). `pending` = held + payment_submitted (count; `awaiting_approval` = payment_submitted, `awaiting_payment` = held).
   - `money.collected` = sum of payment_entries (incl. negative) for bookings in scope minus refunds paid... (define precisely: sum of entries on non-cancelled bookings; refunds shown separately). `money.due` = sum(price - paid) over confirmed (booked/no_show/completed? only booked + completed) non-cancelled bookings; `due_bookings` = how many have due > 0. Agent A documents the exact definition in code and the report.
   - `by_court` arrays are complete (all courts); the UI decides "top 2 + N aur".
2. `GET /bookings-history?date_from&date_to&court_ids&statuses&q&page&page_size&sort` (`statuses` repeatable, values = `HistoryStatusKey`) -> `OwnerBookingsPage` (items, total, page, page_size, totals). Server-side pagination, max page_size 100. `q` matches player name, phone, booking short code or UUID prefix. Includes every real state (held, awaiting approval, expired, etc.). Same row shape. (Path is `/bookings-history` to avoid clashing with `/venues/{id}/bookings`.)
3. `GET /bookings-history/export.csv?same filters` -> CSV text (no pagination).
4. `GET /bookings/{booking_id}/overview-detail` -> `OwnerBookingDetail` (permission `view_ledger`; phone and screenshot flag only for owner/staff with view_ledger; screenshot is fetched with the EXISTING `GET /payments/{payment_id}/proof-url` signed URL, the detail only returns `payment_id`).
5. `POST /bookings/{booking_id}/completion` body `{result: "yes"|"no", received_pkr?: int, reason?: string}` -> `OwnerBookingRow` (updated). Permission `record_payments`. Refuses (400 `COMPLETION_TOO_EARLY`) before `ends_at`; only for confirmed bookings (booked/completed/no_show; not cancelled/held). `yes`: ledger entry for the remaining due (cash_at_venue, note "Booking completed"); if already fully paid, no entry. `no`: `received_pkr` required, 0..price; adjust total paid to exactly that (positive entry via record path, or a negative `other` correction entry when it is lower than what was already recorded; never edit/delete rows). Always writes the audit row. Repeat calls allowed (change later).
6. `GET /badges?venue_id` -> `{approvals: int, refunds: int}` (approvals = payment_submitted bookings awaiting review in scope, same rule as pending-approvals; refunds = refund_status owed), cheap, polled every 15 s.
7. Notification: when a PLAYER cancels a booking with `amount_paid > 0` (api/bookings.py cancel), also notify the venue owner (event_type `refund_owed`, push + best-effort WhatsApp via existing tiers, reference_id = booking id; reuse the generic template fallback). Owner kill-switch/flags behave as for other notifications.

## Short code
`short_code = "KH-" + uuid.hex[:8].upper()`; search by short code uses the UUID prefix.

## Status keys (HistoryStatusKey) = what the Status column shows
`booked`, `held` (awaiting payment), `awaiting_approval` (payment_submitted), `completed_yes` (Mukammal chip), `completed_no` (Adhoora chip), `checked_in`, `no_show`, `cancelled`, `refund_owed`, `refunded`, `expired` (held that timed out; cancelled by system with the expiry reason). A row has one `status_key` (primary: booked/held/awaiting_approval/no_show/cancelled/refund_owed/refunded/expired) plus chips `completion` and `checked_in`. Filters accept the composite names: `booked` (confirmed), `pending` (held + awaiting_approval), `cancelled`, `refund` (owed + refunded), `completed` (completion yes), `short_paid` (completion no), plus each raw key. Agent A reports the exact mapping from code states.
