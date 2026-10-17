# Owner Round 2: shared contract (Stage 1, NO migration)

Spec: `docs/round2-spec.md` (the owner's full text). All API changes are ADDITIVE (old mobile builds are installed): never rename/remove a field or endpoint. TS mirror: `packages/types/src/round2.ts`, client: `packages/api-client/src/owners.ts` + `users.ts` (lead added them). Backend agent BE implements exactly this; if something here is impossible without schema, BE reports it and the UI hides that piece.

## A1 + A5 Approvals queue
`GET /owners/approvals-queue?venue_id&date&court_ids&page=1&page_size=50` -> `ApprovalsQueuePage {items, total, page, page_size}`. Items sorted `submitted_at` DESC. Same scope/permissions as `/owners/pending-approvals` (unchanged; it stays for old builds).
`ApprovalQueueItem` = every field of `PendingApprovalOut` plus:
- `state`: `"awaiting"` (booking payment_submitted) | `"cancelled_by_player"` (booking cancelled by the player while this payment was unreviewed) | `"expired"` (booking cancelled by the system, review/hold expired) | `"cancelled_by_owner"`.
- `cancelled_at: datetime|null`, `has_screenshot: bool` (proof_key present).
- `overpayment: {expected: number, ocr_amount: number, excess: number} | null` (ocr_amount > expected advance).
- `date_label` is NOT sent: the UI formats `starts_at` (Aaj / Kal / "Sat, 24 Oct" + time range) with the existing PKT formatters.
Badge `GET /owners/badges` `approvals` must equal the queue `total` (both count awaiting + cancelled states still needing an acknowledgement).
`POST /owners/payments/{payment_id}/acknowledge` body `{money_received: boolean}` (A5) -> `{ok: true, refund_dispute_id: uuid|null}`. Only for state != awaiting. Sets the payment reviewed (verdict `"acknowledged"`, reviewed_by/at) so it leaves the queue + badge; writes audit_log `payment.cancelled_acknowledged` (who/when, money_received). `money_received=true` creates a refund-owed `payment_disputes` row through the existing refund path (amount = the payment's claimed/OCR amount, documented) so it appears in Refunds; never messages the player. Permission: same as approve (owner, or staff with approve permission).
Approve/reject on a cancelled/expired booking -> 409 `BOOKING_NO_LONGER_PENDING` with `details: {state}`; reject never asks a reason in that case and never messages the player.
Approve body gains optional `accept_mode: "advance_only" | "full"` (A10.3). Default = today's behaviour. BE reports what today's behaviour is and whether `advance_only` (credit the expected advance, create an `overpayment_excess` refund-owed dispute for the rest) works without schema.

## A6 Notification feed
`GET /users/me/notifications/feed?page=1&page_size=30` -> `NotificationFeedPage {items, page, page_size, has_more}`; newest first; the old `/users/me/notifications` stays.
`NotificationFeedItem`:
- `id` (the first log row id of the group), `event_type` (raw), `kind` (normalized, see list), `created_at`.
- `params`: `{player_name?, court_name?, sport?, venue_name?, starts_at?, ends_at?, amount?, reason?}` all optional, derived from `reference_id` -> booking / payment / dispute / venue. Missing data = omitted (never invented).
- `link`: `{kind: "approvals"|"refunds"|"booking"|"bookings"|"overview"|"venue_status"|"none", booking_id?: uuid}`.
- `deliveries`: `[{channel: "push"|"whatsapp"|"sms"|"web_push", status: "sent"|"failed"}]` (one entry per channel tried; rows of the same event + reference within 10 minutes fold into ONE item).
Kinds: `payment_waiting`, `payment_approved`, `payment_rejected`, `player_cancelled`, `refund_owed`, `refund_sent`, `new_booking`, `slot_freed`, `daily_summary`, `venue_approved`, `venue_rejected`, `venue_changes`, `booking_confirmed`, `booking_cancelled`, `booking_reminder`, `hold_expiring`, `other`. The sentence is built CLIENT side from kind + params by `notificationText(item, lang)` in `packages/types/src/notification-text.ts` (one implementation for web and mobile). Never the words "New notification".

## A7 Overview
`OwnerOverview` gains `pending_all: {count, awaiting_approval, awaiting_payment}` = held + payment_submitted bookings for ANY date (venue + court filter applied, date ignored). Old `bookings.pending` (date-based) stays.

## A8 Completion
`POST /owners/bookings/{id}/completion` body gains optional `received_now: int` (new semantics; when present `received_pkr` is ignored). `result="no"` + `received_now` (0..due): adds a POSITIVE ledger entry of `received_now` (no entry when 0); never lowers total paid; if `received_now == due` it is stored as `yes` (Mukammal). `reason` required only when due remains > 0 (400 `REASON_REQUIRED`). `result="yes"`: unchanged. Old `received_pkr` path unchanged for old clients. Detail timeline gains kind `balance_received` (amount, actor, at).

## A10 Refund breakdown
`OwnerRefundOut` gains: `player_sent: number|null` (what the player actually paid in for this booking: sum of positive ledger entries, else approved payment amount), `refund_due: number` (= refund_amount, the policy amount), `already_refunded: number`, `remaining_amount` (exists), `reason_label_key: string`. Mark-refunded over the remaining -> 400 `REFUND_EXCEEDS_OWED_AMOUNT` with `details: {remaining, typed}`. Status label "Hissa wapas" when 0 < refunded < refund_due (`refund_status` stays "owed").

## A11 Advance explain
`GET /courts/{court_id}/advance-explain` (owner/staff of that venue) -> `{mode: "default"|"fixed"|"percent", value: number|null, minimum: number|null, hourly_price: number|null, example_minutes: number, example_total: number, example_advance: number, default_rule: {source: "pricing_rule"|"none", percentage: number|null, value_if_nothing_set: number}}`. The SAME math is in `packages/types/src/advance-example.ts` (`advanceFor(total, rule)`), checked by shared cases in `packages/types/src/fixtures/advance-cases.json` (BE writes the cases from the real backend function; web/mobile tests load them).

## B1 Timers (Stage 1 = no schema)
- Read time: availability / hold / quote treat `status=held AND held_until <= now` as FREE immediately.
- Expiry job runs every minute (cron line; report the current schedule); moves expired holds to cancelled(system, hold_expired), sends slot-freed + player message.
- A screenshot arriving after expiry: refused with a clear player message and an owner bell row (no silent loss).
- Player reminder at 2/3 of the hold time (only if none exists today; dedupe via notification_log).
- `packages/types/src/reminder-schedule.ts` `reminderSchedule({first, every, max, autoCancel})` + Python twin `app/services/reminder_schedule.py`, both tested against `packages/types/src/fixtures/reminder-schedule-cases.json` (BE writes it). Per-venue settings need schema (Stage 2); Stage 1 UI shows the preview with today's values.

## i18n namespaces (web) per agent; each agent edits ONLY its own files `messages/{ru,en}/<ns>.ts`
W1: `appr` (approvals), `media` (thumbnail/lightbox), and existing `detail`, `hist`. W2: existing `ovw`, new `voice`. W3: new `rfd` (refunds), `adv` (advance), `timer` (reminders preview), existing `notif`. Do not edit `odash*` files except W3 may move nothing. Mobile has no i18n: plain Roman Urdu/English labels as on web.

## Shared web components and their owners
- `components/media/screenshot-thumb.tsx`, `components/media/lightbox.tsx` (W1). Props: `ScreenshotThumb {paymentId: string; alt: string}` (fetches the signed URL on open via `api.payments.proofUrl`, refetches once on expiry); `Lightbox {src: string; alt: string; onClose(); onExpired?()}`.
- `components/voice/voice-textarea.tsx` (W2). Props: `VoiceTextarea {id: string; label: string; value: string; onChange(v: string): void; required?: boolean; rows?: number; maxLength?: number}`. W1/W3 import it for reject/cancel/refund reasons. A stub exists (lead) so imports compile from day one.
