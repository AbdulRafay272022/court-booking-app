# Floodlight redesign: backend contract (agent BE, branch `floodlight-be`)

Scope: what the existing API already supports for the Floodlight boards. Read-only research on main `1fdef6b`.
**No backend code changed. No migration.** One contract test was added (`court-booking-backend/tests/test_venue_card_contract.py`).
All paths are under `/api/v1`. File references are `court-booking-backend/app/...` unless they say otherwise.
Venue-card photos and amenities are covered in `docs/venue-card-contract.md`.

Every request from `packages/api-client` already sends `X-Slot-Grid: 30` (`packages/api-client/src/client.ts:7,134`).
Keep using the api-client. Without that header the server falls back to the legacy slot units.

---

## (a) Direct HOLD without the AI chat: YES, it exists

**`POST /bookings/hold`** (`api/bookings.py:43`). Any signed-in user can call it (`CurrentUser`). It has no feature flag and no premium gate.
The AI premium gate covers only the chat tools (`services/ai_chat_service.py:1268`).

- The AI `hold_slot` tool calls the same service: `_tool_hold_slot` → `BookingService.create_hold` (`services/ai_chat_service.py:1531-1534`).
  The WhatsApp button calls it too (`api/webhooks.py:452`). There is one code path: `services/booking_service.py:227`.
- The apps already use it today. Mobile calls it from the chat "Yes" button: `apps/mobile/app/(player)/booking/[id]/chat.tsx:211` → `api.bookings.hold(...)`.
  It saves `payment_instructions` (`lib/booking-flow-store.ts`), then opens `/(player)/booking/[id]/pay`. Web does the same in `apps/web/app/booking/[id]/chat/page.tsx:182`.
  The client is `packages/api-client/src/bookings.ts:12` (`api.bookings.hold`). The types are `HoldBookingInput` / `HoldBookingOut` in `packages/types/src/booking.ts:45-60`.
- **So "Book karo" can call `api.bookings.hold` directly.** You do not need the chat fallback.

Request (`schemas/booking.py:29-49`):
```json
{ "court_id": "uuid", "starts_at": "2026-10-25T14:00:00Z", "slot_count": 3, "player_name": "optional", "name_is_own": false }
```
- `starts_at` must have a UTC offset. Take it straight from an availability slot's `starts_at`.
- `slot_count` is the number of consecutive 30-minute slots, from 1 to 16. If you omit it, the server uses the court's minimum (`min_slots`).
- `player_name` and `name_is_own` are optional. Leave them out for a direct booking, and the server uses the account name.

Response `201` (`schemas/booking.py:101-140`):
```json
{ "booking": BookingOut, "payment_instructions": { "bank", "account_title", "account_number", "iban", "amount" } | null }
```
- `BookingOut` has these fields: `id, court_id, player_id, starts_at, ends_at, status ("held"), source ("app"), player_name, player_phone, price, advance_amount, amount_paid, balance_due, held_until, payment_deadline, cancelled_by, cancellation_reason, checked_in_at, checked_in_by, created_at`.
- `held_until` = now + the venue's hold length (`venue_timers.hold_minutes_for`, default 15 min; `booking_service.py:290`). **Drive the Pay countdown from `booking.held_until`.**
- `payment_instructions` comes back **only in this response**. No endpoint returns the bank details again for a booking, so keep persisting them the way `booking-flow-store.ts` does today.
- `price` = the total. `advance_amount` = the amount to pay now. `balance_due = price - advance_amount`.

Errors (`AppError` code in the body):

| Code | When it happens |
|---|---|
| `SLOT_ALREADY_TAKEN` | The slot is already held or booked (409). Includes a race lost to another player. |
| `SLOT_IN_PAST` | The slot has already started. |
| `SLOT_BLOCKED` | The slot falls in a blackout. |
| `BELOW_MINIMUM_BOOKING_TIME` | `slot_count` is below the court's `min_slots`. |
| `INVALID_SLOT_TIME` | The start is not on the court's grid. |
| `INVALID_DURATION` | The duration is invalid. |
| `BOOKING_TOO_FAR` | The start is beyond the venue's `booking_horizon_days`. |
| `VENUE_NOT_APPROVED` | The venue is not approved. |
| `NOT_FOUND` | The court is inactive or missing. |
| `VALIDATION_ERROR` | The datetime is naive (no UTC offset). |

Sources: `availability_service.py:624+` (`quote_range`), `booking_service.py:247-266`.

**Quote before the hold (confirm sheet money):** `GET /courts/{court_id}/quote?starts_at=...&slot_count=N` (`api/availability.py:100`) returns
`{ court_id, starts_at, ends_at, slot_count, slot_minutes, min_booking_minutes, min_slots, duration_minutes, price, advance_amount, balance_due }`.
`create_hold` charges exactly this quote. The client is `api.availability.quote(courtId, startsAt, slotCount)`.

## (b) "Held by someone else" signal: YES

Slots come from `GET /courts/{id}/availability?date=` and `GET /venues/{id}/availability?date=` (`api/availability.py:33,79`).
`SlotOut` (`schemas/availability.py:7-21`) contains:
- `status`: `"available" | "held" | "payment_submitted" | "booked" | "blocked"`.
  A booked cell takes the booking's own status (`availability_service.py:256-271`).
  Only live bookings occupy a slot: `held`, `payment_submitted` and `booked` (`models/booking.py:38`).
- `is_mine: bool`. It is true when the signed-in viewer is the player on that live booking, and always false for an anonymous viewer.
- `held_until`. It is set on a held cell, including someone else's hold, and gives the time the hold expires.
- `booking_id`. It is set for any occupied cell.
- `reason`. It is set only when the status is `blocked`.

Map these to SlotChip states:

| Backend values | SlotChip state |
|---|---|
| `available` | open |
| `held` or `payment_submitted` with `is_mine=false` | **held** (someone else) |
| `booked` with `is_mine=false` | booked |
| any live status with `is_mine=true` | "your booking" |
| `blocked` | noRoom / closed |

Also drop `available` slots whose `starts_at` is in the past. The server still lists them as available.

## (c) Cancellation policy and money

The policy is **one per venue**, as structured fields only. **No free-text policy field exists.**
Build the sentence on the client from these fields:
- `venue.cancellation_allowed: bool` and `venue.cancellation_cutoff_hours: int | null` (null = any time before the start). Defined at `models/venue.py:62-65`.
- They are returned by `GET /venues/by-slug/{slug}` and `GET /venues/{id}` (`VenuePublicOut`, `schemas/venue.py:201-202`).
- `GET /courts/{id}` also returns them as a deprecated mirror (`schemas/court.py:156-159`). That is what `apps/mobile/components/booking-card.tsx:81-82` reads today.
- Rules (`booking_service.py:433-521`):
  - A player can always cancel a `held` or `payment_submitted` booking.
  - A player cancelling a `booked` booking gets `CANCELLATION_NOT_ALLOWED` or `CANCELLATION_WINDOW_CLOSED` (400, `details.cutoff_at`, `details.cutoff_hours`) when the policy forbids it.
  - When the cancel is allowed, the refund owed is **the full `amount_paid`** (`booking_service.py:545-555`). There is no partial refund rule.
- Hold length for the "you have N minutes" copy:
  - Before the hold, it is not exposed to players: `VenuePublicOut` has no hold_minutes. Use the generic copy, or show it after the hold from `held_until`.
  - Owners read it via `GET /owners/venues/{id}/timers`.

Confirm sheet money comes from the quote (`price`, `advance_amount`, `balance_due`). Per-slot `price`/`advance_amount` are also on each `SlotOut`.

Player booking detail (Total / Mila / Baqi) comes from `GET /bookings/{id}` (`api/bookings.py:134`, `api.bookings.get`). `BookingOut` provides:
- **Total** = `price`
- **Mila** = `amount_paid`. This is the ledger sum and includes cash entries.
- **Baqi** = `balance_due`
- **Advance** = `advance_amount`

The money history is at `GET /bookings/{id}/payment-entries`, and the screenshot reviews are at `GET /bookings/{id}/payments`.
The venue is not embedded in the booking: call `GET /courts/{court_id}`, then `GET /venues/{venue_id}`, which is the same pattern `booking-card.tsx:67-70` uses.

Honest status mapping (`models/booking.py:13-19`):

| Booking state | Label |
|---|---|
| `held` | Hold |
| `payment_submitted` | Venue check |
| `booked` | Pakki ✓ (only this one) |
| `completed` | Completed |
| `no_show` | No-show |
| `cancelled`, `cancelled_by=player` | Player cancelled |
| `cancelled`, `cancelled_by=owner` | Owner cancelled or **rejected**; `cancellation_reason` holds the reject reason (`payment_service.py:~963`) |
| `cancelled`, `cancelled_by=system` | `cancellation_reason` is `"hold_expired"` or `"payment_review_expired"` |

Owner-side Total/Mila/Baqi: `GET /owners/bookings/{id}/overview-detail` gives `row.total`, `row.total_paid`, `row.due` and `row.advance`, plus `advance_required`.

## (d) Venue photos and amenities: the data exists and the list endpoints already return it

Summary only; the full detail is in `docs/venue-card-contract.md`.
- `venues.photos`: an ARRAY of S3 keys, ordered, with index 0 as the cover, capped at **8** (`MAX_VENUE_PHOTOS`, `services/venue_service.py:28`).
- `venues.amenities`: an ARRAY of strings (`models/venue.py:38-39`).
- `GET /venues` (search, list and map) and `GET /users/me/favorites` return `photo_urls: string[]` (every photo, in order) and `amenities: string[]`. Both are always lists, empty when there is none (`schemas/venue.py:225-226`, `venue_service.py:434-435`).
- Already typed in `packages/types/src/venue.ts` (`VenueSummary`).
- **Nothing was added.** A test now pins this contract.
- **No thumbnail variant exists.** Only one size is uploaded (`utils/s3.py:54-69`). Cards must use the full-size URL. See BACKEND DEPENDENCY D1.

## (e) Endpoint table per board

Legend: **OK** = exists. **PARTIAL** = exists, but the board wants more. **NOT SUPPORTED** = BACKEND DEPENDENCY.
"perm" means the staff permission the call needs. The owner always has it.

### Player

| Board / need | Method + path | api-client | Key response fields / notes |
|---|---|---|---|
| Auth (PAuth) | `POST /auth/signup`, `/auth/verify-signup-otp`, `/auth/login`, `/auth/request-otp`, `GET /auth/otp-status`, `POST /auth/refresh`, `/auth/logout`, `GET/PATCH /auth/me` | `api.auth.*` | unchanged |
| Search list + map (PSearch) | `GET /venues?city&sport&lat&lng&radius_km&area&min_price&max_price&indoor&amenities=a,b&date&start_time&duration_minutes&sort=distance\|price\|rating&page&per_page` | `api.venues.list` | `{venues: VenueSummary[], total, page}`. Each item has `photo_urls[], amenities[], min_price, average_rating, review_count, distance_meters, has_indoor, has_outdoor, today_free_slots, latitude, longitude`. The map uses the same call, with `latitude`/`longitude` per item. |
| Areas filter | `GET /venues/areas` | `api.venues.areas` | `{areas: string[]}` |
| Home "tonight" list | none | — | **NOT SUPPORTED as a dedicated endpoint.** Use `GET /venues?date=<today>` (optionally with `start_time`), or sort by `today_free_slots`. Mobile Home makes no venue call today. |
| Venue page | `GET /venues/by-slug/{slug}` | `api.venues.getBySlug` | `VenuePublicOut`: `photo_urls, photo_keys, amenities, courts[] (CourtOut), cancellation_allowed, cancellation_cutoff_hours, booking_horizon_days, average_rating, review_count, available_slots_today, phone, whatsapp, address, latitude, longitude` |
| Slots | `GET /venues/{id}/availability?date=` · `GET /courts/{id}/availability?date=` (or `start_date&end_date`) · `GET /courts/{id}/availability/summary?month=YYYY-MM` | `api.availability.forVenueOnDate / forCourtOnDate / forCourtRange / monthSummary` | `SlotOut` (see b). Month: `days[{date, state: past\|beyond\|closed\|full\|few\|open, open_slots, total_slots}]`, `starts_from_price`, `last_bookable_date` |
| Confirm sheet | `GET /courts/{id}/quote` | `api.availability.quote` | see (a) |
| Book karo | `POST /bookings/hold` | `api.bookings.hold` | see (a) |
| Pay | `POST /bookings/{id}/payment-proof` (multipart `image`) | `api.bookings.submitPaymentProof` | `{payment: PaymentOut, booking: BookingOut}`. After it, the booking status is `payment_submitted` (or `booked` when auto-approve applies). |
| Status / done | `GET /bookings/{id}` (poll) | `api.bookings.get` | `status`, `held_until`, `payment_deadline`, `cancellation_reason`, `checked_in_at` |
| Ticket QR | — | — | The owner scanner reads the **booking id**: `checkin-scan.tsx:26` posts `api.bookings.checkin(<scanned or typed id>)`. So the ticket QR content = `booking.id`. |
| Player self check-in | `POST /bookings/{id}/checkin/self` `{venue_qr_token}` (flag `qr_checkin`) | `api.bookings.checkinSelf` | `{booking}`. Errors: `INVALID_CHECKIN_CODE`, `INVALID_BOOKING_STATE`. |
| Bookings tab | `GET /bookings/mine?status=upcoming\|past\|all&page&page_size` | `api.bookings.mine` | `BookingOut[]` (no venue/court names embedded; resolve them through `courts.get` and `venues.get` as `booking-card.tsx` does) |
| Cancel sheet | `POST /bookings/{id}/cancel` `{reason?}` | `api.bookings.cancel` | `{booking}`. Errors: `CANCELLATION_NOT_ALLOWED`, `CANCELLATION_WINDOW_CLOSED`. |
| Chat thread (PChat) | `POST /chat/message` `{message, venue_id?, booking_id?}` · `GET /chat/history?venue_id&booking_id&page&page_size` | `api.chat.send / history` | send: `{reply, actions[{type: confirm_booking\|decline\|..., label, data}]}`. history: `[{id, sender_type: player\|ai, channel, content, created_at}]`. **This is an AI assistant thread only.** No player↔owner messaging exists. |
| Chat inbox (one row per venue/booking, unread dot) | none | — | **NOT SUPPORTED (BACKEND DEPENDENCY B1).** There is no conversation-list or unread endpoint. A client-only approximation is possible: group `GET /chat/history` (no filter, paged) by `venue_id`/`booking_id`. But history items **do not return `venue_id`/`booking_id`** (`schemas/chat.py:25-32`), so the grouping cannot be done client-side either. One inbox row ("Maidan assistant"), or rows built from `bookings.mine`, is the honest option. |
| Hold proposal card | from `ChatMessageOut.actions` (`confirm_booking` data: `court_id, starts_at, slot_count, player_name?, name_is_players_own?`) | — | already used by chat.tsx |
| Reviews (player) | `POST /reviews` `{booking_id, rating 1-5, comment?}` · `PATCH /reviews/{id}` · `GET /reviews/mine` · `GET /venues/{id}/reviews` | `api.reviews.*` | `ReviewOut {id, booking_id, venue_id, rating, comment, owner_reply, owner_replied_at, player_first_name, created_at}`. Create needs flag `reviews`. |
| Favourites | `GET /users/me/favorites` · `PUT/DELETE /venues/{id}/favorite` | `api.favorites.*` | the same card shape as search |
| Waitlist | `POST /waitlist` (flag `waitlist`) · `GET /waitlist/mine` · `DELETE /waitlist/{id}` | `api.waitlist.*` | |
| Profile stats (PAccount) | `GET /auth/me` | `api.auth.me` | `MeOut{user, session}`. `user` (`UserOut`, `schemas/auth.py:176-192`) has `name, phone, email, city, gender, avatar_url, role, reliability_score, total_bookings, total_no_shows, total_rejections, created_at`. These are the only real stats counters. There is no other stats endpoint. |
| Edit profile / avatar | `PATCH /auth/me` · `POST /users/me/avatar` | `api.auth.updateMe / api.users.uploadAvatar` | |
| Notifications | `GET /users/me/notifications/feed?page&page_size` | `api.users.notificationsFeed` | `{items[{id, event_type, kind, created_at, params{player_name, court_name, venue_name, starts_at, ends_at, amount, reason, ...}, link{kind: approvals\|refunds\|booking\|bookings\|overview\|venue_status\|none, booking_id}, deliveries[{channel, status}]}], page, page_size, has_more}`. **Unread state is client-side** (AsyncStorage last-read in `apps/mobile/lib/use-unread-notifications.ts`). There is no server read flag. |
| Push | `POST /users/me/fcm-token` · `DELETE /users/me/fcm-token/{token}` | `api.users.*` | the "push off" banner = OS permission state (client) |
| Feature flags | `GET /feature-flags` | `api.featureFlags.publicFlags` | `{flags: {key: bool}}`. Keys gate: `photos, reviews, waitlist, split_payments, refunds, qr_checkin, marketing_announcements, growth_suggestions` … |

### Owner

| Board / need | Method + path | api-client | Key response fields / notes |
|---|---|---|---|
| Today (OwnerToday) | `GET /owners/today?date_&venue_id` (perm `view_ledger`) | `api.owners.today` | `{date, courts[{court_id, name, sport, slots[{starts_at, ends_at, status, booking_id, player_name, amount_paid, price, balance_due, checked_in_at, booking_source, ...}]}], summary{total_bookings, total_revenue, pending_approvals, walkins, running_total, booking_status}}` |
| Today hero "collected today" (same as Ledger) | `GET /owners/ledger?start_date&end_date` → `summary.collected_today` | `api.owners.ledger` | `summary{collected_today, collected_this_week, collected_this_month, outstanding_balance, cancelled_refund_pending, total_in_range, by_court, by_day}`. Use THIS for the hero so it equals OPaisa (audit G14). |
| Overview (alt. Today) | `GET /owners/overview?date&venue_id&court_ids` | `api.owners.overview` | see `docs/owner-overview-contract.md` |
| Badges | `GET /owners/badges?venue_id` | `api.owners.badges` | `{approvals, refunds}` |
| Approvals | `GET /owners/approvals-queue?venue_id&date&court_ids&page&page_size` · legacy `GET /owners/pending-approvals` | `api.owners.approvalsQueue / pendingApprovals` | `{items, total, page, page_size}`. Each item has `payment_id, booking_id, expected_amount` ("Chahiye"), `ocr_amount, ocr_verdict, proof_url, checks` (5 plain-language checks), `submitted_at, minutes_since_submission, player_name, account_name, court_id, court_name, court_sport, starts_at, ends_at`. It also has the card fields `state` (awaiting\|cancelled_by_player\|expired\|cancelled_by_owner), `has_screenshot`, `overpayment{expected, ocr_amount, excess}` and `duplicate{used_on_bookings}` (`schemas/owner_dashboard.py:55-103`). |
| Approve | `POST /payments/{id}/approve` `{amount_pkr?, accept_mode?: advance_only\|full, confirm_duplicate?}` (perm `approve_payments`) | `api.payments.approve` | `{payment, booking}`. Errors: 409 `DUPLICATE_PROOF_CONFIRM_REQUIRED {used_on_bookings}`, 409 `BOOKING_NO_LONGER_PENDING`. **No bulk-approve endpoint.** Bulk = N sequential calls on the client. |
| Reject + reasons | `POST /payments/{id}/reject` `{reason}` (reason required; 422 otherwise) | `api.payments.reject` | The reason is **free text**. The preset radios are client-side: `apps/mobile/components/approval-card.tsx:15` `REJECT_REASONS`. The booking becomes `cancelled` (by owner), and `cancellation_reason` = the reason. |
| Proof viewer | `GET /payments/{id}/proof-url` | `api.payments.proofUrl` | `{url, expires_in}` (signed) |
| Cancelled-while-pending ack | `POST /owners/payments/{id}/acknowledge` `{money_received}` | `api.owners.acknowledgeCancelled` | `{ok, refund_dispute_id}` |
| Booking detail sheet (OSheets) | `GET /owners/bookings/{id}/overview-detail` | `api.owners.bookingDetail` | `{row{booking_id, short_code, status_key, player_name, player_phone, court_name, starts_at, ends_at, total, advance, due, total_paid, source, checked_in, completion, slot_ended, refund_amount, refund_status, status_pending}, booked_at, hold_expires_at, advance_required, payment_id, ocr_verdict, ocr_amount, approval, cancellation, refund, completion, timeline[], channel_detail}`. `short_code` is display-only for "ID copy": **no endpoint looks a booking up by short_code**. |
| "Baqi mil gaye" (balance collected) | `POST /owners/bookings/{id}/completion` `{result: "yes"}` (perm `record_payments`, NOT behind `split_payments`) | `api.owners.markCompletion` | returns `OwnerBookingRowOut`. It appends one ledger entry for the difference. **Only after the slot has ended**; before that it returns 400 `COMPLETION_TOO_EARLY` (`owner_overview_service.py:960-965`). Before the end (or instead): `POST /bookings/{id}/payment-entries` `{amount_pkr, method: cash_at_venue\|bank_transfer_proof\|other, note?}` (flag `split_payments`) → `{entry, amount_paid, balance_due}` (refuses more than the balance) |
| "Booking adhoora?" (partial: kitna mila + wajah) | `POST /owners/bookings/{id}/completion` `{result: "no", received_now: <PKR received now> (or received_pkr = total received), reason}` | `api.owners.markCompletion` | `received_now` must be between 0 and the due amount, else 400 `VALIDATION_ERROR` `{max}`. `reason` is required when money is still outstanding: 400 `REASON_REQUIRED` `{remaining}` (`owner_overview_service.py:970-988`). It is only allowed after the slot ends (`COMPLETION_TOO_EARLY`). This is the existing "Nahi" path. |
| No-show ("Nahi aaye") | `POST /bookings/{id}/no-show` (perm `check_in` or `record_payments`) | `api.bookings.noShow` | `TOO_EARLY_FOR_NO_SHOW` before the slot ends |
| Owner cancel | `POST /bookings/{id}/cancel` (perm `cancel_booking`) | `api.bookings.cancel` | a booked one flags a refund automatically |
| Walk-in (OWalkin) | `POST /bookings/walkin` `{court_id, starts_at, slot_count?, player_name, player_phone?, amount_paid, method}` (perm `walkin`) | `api.bookings.walkin` | `{booking}` status `booked`. Errors: `WALKIN_IN_PAST`, `SLOT_ALREADY_TAKEN`. Slot grid: same availability calls. |
| Check-in QR scan + manual code | `POST /bookings/{id}/checkin` (perm `check_in`) | `api.bookings.checkin` | The QR and the manual code are both the **full booking UUID** (`apps/mobile/app/(owner)/checkin-scan.tsx:19-26`). `expo-camera ~57.0.5` is already installed (`apps/mobile/package.json:18`). A short typed code is **NOT SUPPORTED** (B2). Errors: `INVALID_BOOKING_STATE`, `INVALID_CHECKIN_CODE`. |
| Venue QR (for self check-in poster) | `GET /owners/venues` → `checkin_qr_token` (owner/admin only) | `api.owners.venues` | used by `(owner)/checkin-qr.tsx` |
| Ledger (OPaisa) | `GET /owners/ledger?start_date&end_date&venue_id&court_id&method&booking_status` · `GET /owners/ledger/export` (CSV) | `api.owners.ledger / ledgerExportCsv` | `entries[{entry_id, recorded_at, court, court_id, booking_id, starts_at, player, method, entry_type: payment\|refund\|correction, label, note, amount_pkr}]` + `summary` |
| "Theek karein" (ledger correction) | `POST /payment-entries/{entry_id}/reverse` `{reason}` (perm `record_payments`, flag `split_payments`) | `api.payments.reverseEntry` | `PaymentEntryOut` (a reversing row; never edits). Then record the right amount with `payment-entries`. UI: `components/correct-payment-sheet.tsx`. |
| Refunds | `GET /owners/refunds?venue_id&date&court_ids&booking_id` (perm `mark_refunds`, visible even when the flag is off) · `POST /owners/refunds/{dispute_id}/mark-refunded` multipart `reference` (req), `amount?`, `screenshot?` (flag `refunds`) | `api.owners.refunds / markRefundPaid` | `OwnerRefundOut{id, booking_id, court_name, venue_name, player_name, player_phone, starts_at, reason, refund_amount, refund_status, refunded_amount, remaining_amount, player_sent, payment_id, ...}` |
| History | `GET /owners/bookings-history?date_from&date_to&venue_id&court_ids&statuses&q&page&page_size&sort&booking_id` · `/export.csv` | `api.owners.bookingsHistory / bookingsHistoryCsv` | `OwnerBookingsPageOut` (rows = `OwnerBookingRowOut`) |
| Growth heatmap + ideas | `GET /owners/growth?venue_id` (perm `view_growth`; premium: 403 `PREMIUM_FEATURE_REQUIRED` when enforced) · `GET /owners/digest` | `api.owners.growth / digest` | `{underbooked_slots[{court_id, day_of_week 0-6, hour, booking_rate, venue_average, suggestion, weeks_of_data}], computed_at}`. **PARTIAL:** only the UNDER-booked cells are returned, not a full week×hour grid. A heatmap can show those cells and leave the rest neutral (not "0%"). **Discount amounts are NOT SUPPORTED.** `suggestion` is server text. |
| Reviews (owner) | `GET /venues/{id}/reviews` · `POST /reviews/{id}/reply` `{owner_reply}` (perm `respond_reviews`, flag `reviews`) | `api.reviews.listForVenue / reply` | `ReviewOut` |
| Staff permissions | `GET /staff/permissions` (catalog `{key, label, flag_required, available}`) · `GET /staff` · `POST /staff` `{venue_id, name, phone, password, permissions[]}` · `GET /staff/{id}` · `PATCH /staff/{id}/permissions` `{permissions[]}` · `PATCH /staff/{id}/active` `{is_active}` (owner only) | `api.staff.*` | `StaffMemberOut{id, venue_id, venue_name, staff_user_id, name, phone, is_active, permissions[], created_at}`. Keys: `approve_payments, record_payments, check_in, walkin, cancel_booking, edit_court_settings, manage_photos, respond_reviews, mark_refunds, view_ledger, view_growth` (`models/staff.py:22-32`) |
| My permissions (staff gating) | `GET /owners/me/permissions` | `api.owners.myPermissions` | `{role: owner\|staff\|admin, venue_permissions[{venue_id, permissions[]}]}`. Keep `lib/owner-access.ts`. |
| Premium | `GET /owners/premium` · `GET /owners/premium/notices` · `PUT /owners/premium/selection` `{feature_keys[]}` · `POST /owners/premium/invoices/{id}/payment-proof` | `api.premium.*` | `{payment_instructions, enforced, trial_days, grace_days, features[{key, label, description, monthly_price_pkr, enabled, your_price_pkr, entitled, state, trial_ends_on, paid_through, cancelled}], monthly_total_pkr, invoices[{id, period_start, period_end, total_pkr, status, due_date, lines, last_rejection_reason}]}`; notices `[{level: info\|urgent\|off, feature_key, label, message}]` |
| Timers (OSettings) | `GET /owners/venues/{id}/timers` · `PUT /owners/venues/{id}/timers` (body = the values) | `api.owners.venueTimers / updateVenueTimers` | `{values{hold_minutes, reminders_enabled, first_reminder_after_min, repeat_every_min, max_reminders, auto_cancel_enabled, auto_cancel_after_min} (null = default), defaults{...}, effective{...}}`. PUT needs perm `edit_court_settings`. A field missing from the body keeps its stored value, and an explicit `null` resets it to the default ("Default par wapas"). Bad values return 422 `TIMER_OUT_OF_RANGE` (`api/stage2.py:51-60`). Ranges: hold 5-180, auto-cancel 5-1440, max_reminders 1-10, repeat ≥5 (`models/venue.py:96-100`). |
| Courts & pricing | `GET/POST /venues/{id}/courts` · `GET/PATCH/DELETE /courts/{id}` · `POST /courts/{id}/schedule` · `POST /courts/{id}/pricing` · `POST/GET /courts/{id}/blackouts` · `GET /courts/{id}/advance-explain` | `api.courts.* / api.owners.advanceExplain` | advance-explain: `{mode: default\|fixed\|percent, value, minimum, hourly_price, example_minutes, example_total, example_advance, default_rule}` |
| Venue settings (policy, amenities, horizon) | `PATCH /venues/{id}` `{amenities?, cancellation_allowed?, cancellation_cutoff_hours? (0-720), booking_horizon_days? (1-365), ...}` | `api.venues.update` | |
| Photos | `POST /venues/{id}/photos` (multipart `file`) · `PUT /venues/{id}/photos` `{photos: keys[]}` (perm `manage_photos`, flag `photos`). Same for `/courts/{id}/photos` | `api.venues.uploadPhoto / reorderPhotos` | max 8 per venue (`PHOTO_LIMIT_REACHED`) |
| Wizard (OWizard) | `POST /venues` (VenueCreateIn: `name, address, city, area, latitude, longitude, sports[], amenities[], bank_details, cancellation_*`, `booking_horizon_days`) · `GET/POST /owners/identity` (CNIC) | `api.venues.create / api.owners.identity / submitIdentity` | `VenueOut.status: pending\|approved\|changes_requested\|rejected` + `rejection_reason` (= admin note) via `GET /owners/venues` |
| Announcements | `POST /venues/{id}/announcements` `{message}` (flag `marketing_announcements`) | `api.venues.announce` | `{sent_count}` |
| Owner notifications | same `GET /users/me/notifications/feed` | | |

## (f) Where user-facing lists come from

- **Sports**:
  - `SPORT_OPTIONS` in `court-booking-frontend/packages/types/src/sports.ts:5` (Padel, Futsal, Football (full-field), Ground, Tennis, Cricket, Badminton).
  - They are stored as free strings (`Venue.sports` ARRAY, `Court.sport`), with no DB enum.
  - The chat lists "real sports" from active courts (`services/chat_facts.py`). The venue page should read the sports from `venue.sports` and `courts[].sport`.
- **Amenities**: `AMENITY_OPTIONS` (`sports.ts:16`; keys `floodlights, parking, washrooms, changing_room`) plus localized labels in `AMENITY_LABELS` (`packages/types/src/locale-text.ts:89`) and `amenityLabel()` (`sports.ts:23`). Stored as free strings, so an unknown key falls back to a prettified string.
- **Cities**:
  - Fixed pilot list.
  - Backend: the `City` enum on users (`app/models/user.py:31`); `Venue.city` is a free string.
  - Frontend: `CITY_OPTIONS` (`packages/types/src/user.ts:21`; 10 cities with province labels).
  - Mobile search hardcodes `DEFAULT_CITY = "Karachi"` (`apps/mobile/app/(player)/search.tsx:16`).
- **Areas**: dynamic, from `GET /venues/areas`.
- **Reject reasons**: client-side constant (`apps/mobile/components/approval-card.tsx:15`).
- **Server texts that are English/Roman Urdu as sent**:
  - growth `suggestion`, premium `notices[].message`, `cancellation_reason` (free text from the owner, or the codes `hold_expired` / `payment_review_expired`), and AppError `message`.
  - Prefer mapping the AppError `code` to the copy table, and fall back to `message`.

## BACKEND DEPENDENCIES (not built; each needs a separate go)

| ID | Need | Why it is not here |
|---|---|---|
| B1 | Chat inbox: a list of conversations per venue/booking, an unread state, and owner↔player messaging | There is no endpoint. `ChatHistoryItemOut` does not even expose `venue_id`/`booking_id`. Adding those two fields is read-only and possible later, but an inbox and unread state need new logic, and unread may need a column. |
| B2 | Short manual check-in code (e.g. 6 characters) | Check-in takes the booking UUID only. A short-code lookup would be a new endpoint, plus a uniqueness rule. |
| B3 | Full growth heatmap grid and discount amounts | `/owners/growth` returns only underbooked cells and a text suggestion. |
| B4 | Photo thumbnails (~720 px) | Uploads are stored at one size. A resize-on-upload step, or a CDN image transform, is needed (an infra change, no column). Until then cards use the full URL. |
| B5 | Re-fetch bank details for an existing hold | They come back only in the `POST /bookings/hold` response. Keep the client persistence. |
| B6 | Player-visible hold length before the hold | `hold_minutes` is not in `VenuePublicOut`. Exposing it is read-only, but it was not asked for. |
| B7 | Server-side notification read state | Unread is client-side only. |
| B8 | Bulk approve | There is no batch endpoint. Use sequential calls, keeping the same per-call rules. |
