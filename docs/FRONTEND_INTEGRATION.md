# Frontend Integration Guide

What a separate mobile/web frontend needs to integrate against this backend
without reading its source. Generated from the actual implemented and
tested code as of 2026-09-08 — anything not implemented yet is called out
explicitly rather than documented as if it existed. For the exhaustive,
always-current shape of every field, run the backend locally and open
`/docs` (Swagger UI, generated from the same Pydantic schemas this doc is
written from) — this file is the narrative map, `/docs` is the source of
truth for exact field-level types.

## 1. Base URL & versioning

- **Local dev**: `http://localhost:8000` (or whatever port `uvicorn` is
  bound to). There is no staging/production URL yet — this project has no
  deployed environment; `Dockerfile`/`docker-compose.yml` exist for local
  dev and as a deployment starting point, not a live deployment.
- **API prefix**: every route except `/health` and `/health/ready` is
  under `/api/v1` (`API_V1_PREFIX` in `config.py`). E.g. `POST
  /api/v1/auth/login`.
- **CORS**: wide open in the current config (`ALLOWED_ORIGINS=["*"]`,
  `allow_credentials=True`). Fine for local dev against any frontend
  origin; must be locked down to real origins before any real deployment.

## 2. Auth

**Updated 2026-09-20 (Section 26): password login.** Signup is a form plus a
WhatsApp OTP that proves the phone; login is **phone + password**, not OTP. The
old phone+OTP-only flow and `POST /auth/verify-otp` no longer exist.

Session tokens are **opaque bearer tokens**, not JWTs -- the frontend cannot
decode them. Header on every authenticated request:
```
Authorization: Bearer <token>
```

### Signup (player or owner -- one form, one endpoint)

1. **`POST /api/v1/auth/signup`** -> `201 {"message", "phone", "expires_in": 300}`
   ```json
   {"name": "Bilal Ahmed", "email": "bilal@example.com", "phone": "+923001234567",
    "city": "karachi", "gender": "male", "password": "at-least-8-chars",
    "confirm_password": "at-least-8-chars", "role": "player"}
   ```
   `role` is `"player"` (default) or `"owner"`; `"admin"` is rejected. `city` is one of
   `karachi lahore islamabad rawalpindi faisalabad multan gujranwala peshawar kohat hyderabad`;
   `gender` is `male|female|other`. Password: min 8, max 128, no complexity rules.
   Email is required and stored lowercase but is **contact info only -- it can't be
   used to log in.** Creates the account *unverified* and sends the OTP. A phone that
   already has a verified account -> `409 PHONE_ALREADY_REGISTERED`.
2. **`POST /api/v1/auth/verify-signup-otp`** `{phone, otp, device_id?, device_name?, platform?}`
   -> `200 {"token", "expires_at", "user"}` (no more `is_new_user`). Proves the phone and
   issues the first session. Errors: `INVALID_OTP`, `OTP_EXPIRED`, `OTP_RATE_LIMITED`.
3. "Resend code" = `POST /api/v1/auth/request-otp {phone}` -> `200 {"expires_in": 300}`
   (always 200 for a well-formed phone, whether or not an account exists).
   **Start the OTP screen's countdown from that `expires_in`** (300s), separate from a
   ~30s resend cooldown.

A new **owner** goes straight from step 2 into venue setup (`POST /venues`,
courts, schedule, pricing -- the venue starts `pending`).

### Login

**`POST /api/v1/auth/login`** `{phone, password, device_id?, device_name?, platform?}`
-> `200 {"token", "expires_at", "user"}`. Errors to handle specially:

| `error.code` | HTTP | What to do |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | "Invalid phone number or password." Same answer for a wrong password and an unknown phone (no account enumeration). |
| `LOGIN_RATE_LIMITED` | 429 | 5 failures per phone per 15 min. Suggest waiting or resetting the password. |
| `PHONE_REVERIFICATION_REQUIRED` | 403 | Phone never verified (unfinished signup) or **>365 days since the last OTP**. Checked *before* the password. Send `request-otp`, show the OTP screen, then `reverify-phone`, then log in again (keep the typed password in memory for the retry). |
| `PASSWORD_NOT_SET` | 403 | Account predates passwords. Send the user to "set your password" = the forgot-password flow below. |

### Phone re-verification

`POST /auth/request-otp {phone}` -> code on WhatsApp, then
`POST /auth/reverify-phone {phone, otp}` -> `200 {"message"}`. **No token is returned**
(an OTP proves the phone, not the password): follow with `POST /auth/login`.

### Forgot / set password

`POST /auth/request-password-reset {phone}` -> `200 {"expires_in": 300}` (silent for an
unknown phone), then `POST /auth/verify-password-reset
{phone, otp, new_password, confirm_password}` -> `200 {"message"}`. This **ends every
session for the account** (other devices are logged out) and doesn't log the caller in.

### Sessions: 8 hours, refresh proactively

`expires_at` on every token response is **8 hours** out. You will hit it in normal use, so:

- **`POST /api/v1/auth/refresh`** (Bearer) rotates a still-valid token into a fresh
  8-hour one -> `{"token", "expires_at"}`; the old token stops working. **Call it before
  expiry** (app foreground / tab focus, plus a timer) -- an expired token cannot be
  refreshed. Store `expires_at` next to the token.
- Refresh stops at the 365-day phone-verification limit: `401 PHONE_REVERIFICATION_REQUIRED`.
- A `401` from a call that carried a token means the session is gone -> login screen.
  A **network failure is not a 401**: never sign the user out because the server was
  unreachable (the reference clients retry the launch-time `/auth/me` with backoff and keep
  the token).
- Don't attach a stored token to, or react to 401s from, the public auth endpoints
  (`signup`, `verify-signup-otp`, `login`, `request-otp`, `reverify-phone`,
  `request-password-reset`, `verify-password-reset`).

### Other endpoints

- **`POST /api/v1/auth/logout`** (Bearer) -> revokes this session only.
- **`GET /api/v1/auth/me`** (Bearer) -> `{"user", "session"}`. `user` now also carries
  `email`, `city`, `gender`, `phone_verified_at`.
- **`PATCH /api/v1/auth/me`** (Bearer) -> edits `name`, `email`, `city`, `gender`,
  `avatar_url` (all optional; an explicit `null` for name/email/city/gender is `422`).
  Returns a bare `User`. Email is unique case-insensitively -> `409 EMAIL_ALREADY_IN_USE`
  (also on signup). `phone`, `password`, `role` are **not** editable here (silently
  ignored). Passwords change only through the forgot-password flow.
- **Phone change** (Bearer, two steps; nothing changes until step 2 succeeds):
  - **`POST /api/v1/auth/request-phone-change`** `{new_phone, password}` -> `{message, expires_in}`.
    Sends a code to the **new** number. `password` is the user's *current* password:
    wrong -> `403 INVALID_CREDENTIALS` (403, not 401, so it isn't read as an expired
    session; it shares the login lockout -> `429 LOGIN_RATE_LIMITED`). New number
    already on a verified account -> `409 PHONE_ALREADY_REGISTERED`; same as the
    current number -> `400`; a legacy account with no password -> `403 PASSWORD_NOT_SET`.
  - **`POST /api/v1/auth/verify-phone-change`** `{new_phone, otp}` -> `{message, phone,
    sign_in_again: true}`. Updates the phone, sets `phone_verified_at = now`, and
    **revokes every session including the caller's**: the very next request with the
    old token is `401`. The client must sign out locally and send the user to login
    with the new number and their *existing* password. Wrong/expired code ->
    `INVALID_OTP` / `OTP_EXPIRED` and nothing changes.

### Known limitation (temporary)

OTPs are sent as free-form WhatsApp text until an Authentication template is approved,
so they only arrive for a phone that has **messaged the business number within the last
24 hours**. Otherwise `request-otp`/`signup` may answer `502 OTP_DELIVERY_FAILED`, or a
clean `200` with no message ever arriving. A successful response does not prove delivery.

Roles: a new account is `player` unless it chose `owner` at signup. `admin` is only ever
assigned outside the API.

## 3. Core REST endpoints

All require `Authorization: Bearer <token>` unless marked **public**.

### Venues

| Method | Path | Notes |
|---|---|---|
| GET | `/venues` | **Public.** Query: `city`, `sport`, `lat`+`lng`+`radius_km` (geo search, default 15km), `page`, `per_page` (max 100). Returns `{"venues": [...], "total": N, "page": N}`, each item: `id, name, slug, city, area, sports, photo_urls, status, average_rating, distance_meters`. |
| GET | `/venues/{venue_id}` | **Public** (richer response if authenticated as the venue's owner or an admin — see `bank_details` below). |
| GET | `/venues/by-slug/{slug}` | **Public.** Same shape, plus `available_slots_today` (only this endpoint populates it). |
| POST | `/venues` | Owner/admin only. Body: `name, description?, address, city, area?, latitude, longitude, phone?, whatsapp?, sports[], amenities?, bank_details?`. New venues start `status: "pending"` — not publicly listed until an admin approves them (see Admin below). `201`. |
| PATCH | `/venues/{venue_id}` | Owner (of that venue) or admin. Partial update, same fields as create. |
| POST | `/venues/{venue_id}/photos` | Owner. `multipart/form-data`, field `file`. JPEG/PNG/WebP, max 5MB. |
| DELETE | `/venues/{venue_id}` | Owner/admin. Soft-deactivates (`204`). |

A `VenueOut`'s `bank_details` field is populated **only** when the
requester is that venue's owner or an admin — omitted (`null`) for
everyone else, including other logged-in players. Don't rely on it being
present unless you're rendering the owner's own venue-management screen.

### Courts, schedule, pricing

| Method | Path | Notes |
|---|---|---|
| POST | `/venues/{venue_id}/courts` | Owner. `name, sport, slot_minutes (15-240, default 60), surface_type?, is_indoor?, has_floodlights?, capacity?`. `201`. |
| GET | `/venues/{venue_id}/courts` | **Public.** List, each including its active `schedule_templates` and `pricing_rules`. |
| GET | `/courts/{court_id}` | **Public.** Single court, same shape. |
| PATCH `/courts/{court_id}` , DELETE `/courts/{court_id}` | Owner. Partial update / soft-deactivate. |
| POST | `/courts/{court_id}/schedule` | Owner. Body: `{"schedules": [{"day_of_week": 0-6, "open_time": "06:00:00", "close_time": "23:00:00"}, ...]}`. Upsert — only the days included are touched. |
| POST | `/courts/{court_id}/pricing` | Owner. Body: `{"rules": [{"name", "priority", "day_of_week": [0,6] or null, "start_time"?, "end_time"?, "price_per_slot", "floodlight_surcharge", "advance_percentage"}, ...]}`. **Replaces all existing rules for that court.** |
| POST `/courts/{court_id}/blackouts`, GET `/courts/{court_id}/blackouts` | Owner (POST) / public read. `{"title"?, "starts_at", "ends_at", "reason"?}`. |

### Availability (court schedule/slots)

| Method | Path | Notes |
|---|---|---|
| GET | `/courts/{court_id}/availability?date=YYYY-MM-DD` | **Public.** One day's slot grid. |
| GET | `/courts/{court_id}/availability?start_date=...&end_date=...` | **Public.** Range, max 28 days. |
| GET | `/venues/{venue_id}/availability?date=YYYY-MM-DD` | **Public.** Every active court at that venue, one day. |

Slots are **computed on read**, not stored rows — always reflects live
truth. Response shape (single-day):
```json
{
  "court_id": "uuid", "date": "2026-09-09", "slot_minutes": 60,
  "slots": [
    {
      "starts_at": "2026-09-09T13:00:00Z", "ends_at": "2026-09-09T14:00:00Z",
      "status": "available", "price": 1500.0, "advance_amount": 750.0,
      "held_until": null, "booking_id": null, "reason": null
    }
  ]
}
```
`status` is one of: `available`, `held`, `payment_submitted`, `booked`,
`blocked` (blackout — `reason` populated). `held_until` is only set for
`held` slots (the frontend can render a countdown from it). This is the
endpoint to poll for live availability (see §6 on polling intervals — no
push channel exists for "a slot just opened up" beyond FCM, which is
currently a non-functional stub; see below).

### Bookings

| Method | Path | Notes |
|---|---|---|
| POST | `/bookings/hold` | Body: `{"court_id": "uuid", "starts_at": "2026-09-09T13:00:00Z"}`. `starts_at` **must exactly match** a grid slot from the availability endpoint above (`error.code = "INVALID_SLOT_TIME"` otherwise) — don't let the user type an arbitrary time. `201`, response below. Hold expires after `BOOKING_HOLD_MINUTES`=15 minutes if no payment proof is submitted. |
| GET | `/bookings/mine?status=upcoming\|past\|all&page=&page_size=` | List the current user's bookings. |
| GET | `/bookings/{booking_id}` | Single booking (only the player who owns it, or that venue's owner/admin). |
| POST | `/bookings/{booking_id}/cancel` | Body: `{"reason"?: "string"}`. Idempotent — cancelling an already-cancelled booking is a no-op `200`, not an error. |
| POST | `/bookings/{booking_id}/checkin` | Owner/admin only (QR check-in at the venue). |
| POST | `/bookings/walkin` | Owner/admin only — records a phone/counter booking, booked immediately, no hold/proof step. |

`POST /bookings/hold` response (`201`):
```json
{
  "booking": {
    "id": "uuid", "court_id": "uuid", "player_id": "uuid",
    "starts_at": "...", "ends_at": "...", "status": "held",
    "source": "app", "player_name": null, "player_phone": "+923...",
    "price": 1500.0, "advance_amount": 750.0, "amount_paid": 0.0,
    "balance_due": 750.0, "held_until": "2026-09-09T12:15:00Z",
    "payment_deadline": null, "cancelled_by": null,
    "cancellation_reason": null, "checked_in_at": null, "created_at": "..."
  },
  "payment_instructions": {
    "bank": "...", "account_title": "...", "account_number": "...",
    "iban": "...", "amount": 750.0
  }
}
```
`payment_instructions` is what to render for "transfer this amount to
this account, then upload your screenshot." **The booking state machine**
(render screen state directly off `booking.status`):

```
held → payment_submitted → booked → completed
  ↓         ↓                              ↑ (no-show if not checked in)
cancelled ←┘                          → no_show
```
- `held`: waiting for the player to pay and upload proof. `held_until` is
  the deadline; past it, a background job cancels it automatically.
- `payment_submitted`: proof uploaded, waiting on the owner (or
  auto-approve) to review. `payment_deadline` is that deadline.
- `booked`: confirmed. `completed` after check-in; `no_show` if the venue
  never checked them in.
- `cancelled`: `cancelled_by` (`player`/`owner`/`system`) and
  `cancellation_reason` explain why — a rejected payment also lands here
  (not back to `held`), freeing the slot for anyone (including the same
  player) to hold again.
- There is no literal `"rejected"` booking status — a rejected *payment*
  (see below) cancels the *booking*. If the frontend spec expects a
  `rejected` booking state, that's a mismatch with what's implemented;
  render it as `cancelled` with `cancellation_reason` from the payment
  rejection.

### Payment proof upload

| Method | Path | Notes |
|---|---|---|
| POST | `/bookings/{booking_id}/payment-proof` | `multipart/form-data`, field name **`image`**. JPEG/PNG/WebP only, max 10MB. Must be the booking's own player. `201`. |
| GET | `/bookings/{booking_id}/payments` | List payment attempts for a booking. |
| GET | `/payments/{payment_id}/proof-url` | Owner/admin only — short-lived (5 min) signed URL to view the uploaded image. |

Response (`201`) — this is what confirms received vs. rejected:
```json
{
  "payment": {
    "id": "uuid", "booking_id": "uuid", "proof_url": null,
    "proof_hash": "...", "expected_amount": 750.0, "ocr_amount": 750.0,
    "ocr_ref": "TXN123", "ocr_verdict": "match", "ocr_confidence": 0.95,
    "is_duplicate": false, "duplicate_of": null, "review_verdict": null,
    "rejection_reason": null, "reviewed_at": null, "auto_approved": false,
    "created_at": "..."
  },
  "booking": { "...": "...", "status": "payment_submitted" }
}
```
There is no separate "rejected" response for a bad *upload* — a `400` (see
§7) means the upload itself was rejected (wrong file type, too large, not
your booking). A successfully **received** upload always returns `201`;
whether the *payment* looks legitimate is `payment.ocr_verdict`
(`match`/`mismatch`/`unreadable`) plus `booking.status`:
- `booking.status` jumps straight to `"booked"` in the same response if
  `auto_approved: true` (the venue has auto-approve on and conditions were
  met) — no owner action needed, render success immediately.
- Otherwise `booking.status` stays `"payment_submitted"` — render "waiting
  for the venue to confirm," and poll or wait for a push/notification (§6)
  for the eventual `approved`→`booked` or `rejected`→`cancelled` outcome.

**Owner-side approval** (this is the "owner approval" endpoint):
| Method | Path | Notes |
|---|---|---|
| POST | `/payments/{payment_id}/approve` | Owner/admin. No body. → `booking.status = "booked"`. |
| POST | `/payments/{payment_id}/reject` | Owner/admin. Body: `{"reason": "string"}`. → `booking.status = "cancelled"`, `cancelled_by: "owner"`. |

### Waitlist

| Method | Path | Notes |
|---|---|---|
| POST | `/waitlist` | Body: `{"court_id": "uuid", "slot_starts_at": "..."}`. Response: `{"position": N}` (FIFO position), `201`. Duplicate join on the same slot → `409`. |
| GET | `/waitlist/mine` | List the player's own active/past entries. |
| DELETE | `/waitlist/{entry_id}` | Leave the waitlist for that entry. |

Only the single earliest-queued person is notified when a slot frees up;
everyone else stays queued (see §6 for how that notification reaches
them — currently push-only, no in-app real-time push).

### Admin (venue approval, not owner-approval — different thing)

Distinguish this from "owner approval" above: **admin** approves new
*venues*; **owner** approves *payments*. Both are real, separate steps.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/venues/pending` | Admin only. Venues awaiting review. |
| POST | `/admin/venues/{venue_id}/approve` | Admin only. → publicly listed. |
| POST | `/admin/venues/{venue_id}/reject` | Admin only. Body: `{"reason": "string"}`. |
| POST | `/admin/venues/{venue_id}/request-changes` | Admin only. Body: `{"reason": "string"}`. |

(There's also `GET /admin/dashboard`, `/admin/stats`, `/admin/venues`,
`/admin/bookings`, `/admin/users`, `/admin/disputes`,
`/admin/users/{id}/suspend` — an internal admin tool surface, not
something a player/owner-facing frontend build needs; see `/docs` if an
admin panel is in scope.)

### Owner dashboard (if the owner app needs it)

`GET /owners/venues`, `/owners/today`, `/owners/pending-approvals`,
`/owners/ledger` (+ `/export` CSV), `/owners/growth` (Pro/Business tier
only). Not detailed here since the task's core list didn't call these
out — see `/docs` for exact shapes if the owner-side app needs them.

## 4. The chat-to-book flow

**`POST /chat/message`**
Request: `{"message": "is court 1 available tomorrow at 5pm?", "venue_id"?: "uuid", "booking_id"?: "uuid"}`
(`venue_id`/`booking_id` are optional context tags, purely for filtering
chat history later — not required for the AI to function.)

Response (`200`):
```json
{
  "reply": "Yes! 5pm is available for PKR 1,500. Want me to hold it?",
  "actions": [
    {"type": "confirm_booking", "label": "Yes, book it", "data": {"court_id": "uuid", "starts_at": "2026-09-09T17:00:00Z"}},
    {"type": "decline", "label": "No, thanks", "data": {}}
  ]
}
```

**How tool calls surface to the client: they don't, directly.** The AI's
internal tool-calling loop (search venues, check availability, hold a
slot, etc.) is entirely server-side — the frontend never sees a raw tool
call. What it gets back is:
- `reply`: plain text to show as the assistant's chat bubble.
- `actions`: zero or more button-like affordances the frontend should
  render (currently only two `type` values exist: `confirm_booking` —
  render a "Yes, book it" button that, when tapped, should call `POST
  /bookings/hold` with `data.court_id`/`data.starts_at` — **the chat
  endpoint does not hold the slot itself when proposing it, only when the
  AI's `hold_slot` tool actually runs**, which happens on a *later* chat
  turn if the user says yes in text, or the frontend can just call
  `/bookings/hold` directly using the `data` payload instead of another
  chat round-trip; and `decline` — dismiss, no request needed).
- If the AI actually calls its `hold_slot` tool itself (e.g. the user
  typed "yes, book it" as a chat message rather than tapping a button),
  the booking already exists server-side by the time `reply` comes back
  — the frontend finds out via `GET /bookings/mine` or by parsing
  confirmation language in `reply`; there's no structured "a booking was
  just created, here's its id" field in `ChatMessageOut`. If the frontend
  needs that, it's a gap to raise — currently it isn't there.
- The AI can **never** approve/reject a payment or cancel another
  player's booking — there's no tool for the former at all, and the
  latter is blocked by the same ownership check the REST endpoints use.

**`GET /chat/history?venue_id=&booking_id=&page=&page_size=`** — past
turns for the current user, oldest first: `{"id", "sender_type" ("player"
or "ai"), "channel", "content", "created_at"}`.

**Model/provider is entirely a backend concern.** The response shape is
identical no matter which AI vendor is configured server-side — the
frontend does not need to know or care whether Claude, Gemini, or OpenAI
is active.

## 5. Payment screenshot upload

Already covered under §3 above — repeated here since the task called it
out separately:
- **Endpoint**: `POST /bookings/{booking_id}/payment-proof`
- **Field name**: `image` (multipart form field)
- **Accepted types**: `image/jpeg`, `image/png`, `image/webp` only —
  anything else → `400`, `error.code = "INVALID_IMAGE_FORMAT"`
- **Size limit**: 10MB — over that → `400`, `error.code = "PROOF_TOO_LARGE"`
- **Confirms received**: HTTP `201` with the `payment`+`booking` body
  shown above. There is no separate "processing" state — OCR extraction
  happens synchronously in that same request/response (so this endpoint
  can take a few seconds; show a spinner, don't assume it's instant).
- **Confirms rejected at upload time**: a `4xx` with the error envelope
  (§7) — this is about the *upload* being invalid, not the payment being
  disbelieved (that's `ocr_verdict`/`review_verdict` inside a successful
  `201`, see §3).

## 6. Real-time / push notifications

**Be direct with the frontend team about this: there is no WebSocket, and
push notifications are currently a non-functional stub in this codebase.**

- **FCM push**: `POST /users/me/fcm-token` registers a device token
  (`{"token": "...", "platform": "android|ios|web"}`), `DELETE
  /users/me/fcm-token/{token}` unregisters it. The backend *would* push
  through Firebase Cloud Messaging on booking-state events (confirmed,
  cancelled, payment rejected, slot reopened, new booking for owners,
  venue approved/rejected, etc.) — **but** `NotificationService._push`
  posts to a literal placeholder URL
  (`fcm.googleapis.com/v1/projects/placeholder/...`) and no-ops entirely
  unless `FCM_SERVICE_ACCOUNT_KEY` is configured (it isn't, in this
  project's `.env`). Until a real Firebase project is wired in, **no push
  notification will ever actually arrive on a device**, regardless of
  whether the frontend registers a token correctly.
- **Even once FCM is wired up**, the push payload is title/body text only
  — `{"notification": {"title": "...", "body": "..."}}`, no `data` field
  with a booking id, event type, or deep-link target. A tap handler can't
  currently route to a specific screen from the payload alone; it would
  need to open the app to a general screen and let the app's own state
  refresh from the API.
- **No WebSocket exists.** The only way to learn about a state change
  today is polling REST endpoints:
  - `GET /bookings/{id}` or `/bookings/mine` — for a specific booking's
    status transitions (held → payment_submitted → booked/cancelled).
  - `GET /courts/{id}/availability?date=` — for "did a slot open up"
    (the held-slot's `held_until` countdown is also derivable from here
    without polling, once fetched once).
  - `GET /users/me/notifications?page=&page_size=` — a durable log of
    every push/WhatsApp/SMS send this user was owed, `{"id", "channel"
    ("push"/"whatsapp"/"sms"), "event_type", "status", "cost_category",
    "reference_id", "created_at"}`. `event_type` values that exist today:
    `slot_reopened`, `booking_reminder`, `booking_confirmed`,
    `booking_cancelled`, `payment_rejected`, `owner_new_booking`,
    `venue_pending_review`, `venue_approved`, `venue_changes_requested`,
    `venue_rejected`, `payment_submitted_whatsapp`,
    `payment_submitted_sms`, `tournament_announcement`. This endpoint is
    actually reliable today (it's written regardless of whether the
    underlying push/WhatsApp/SMS send itself succeeded) and is the
    closest thing to a real-time feed currently available — polling *this*
    is more useful than polling availability blindly.
- If the frontend spec assumes a 15-second availability poll: nothing
  backend-side prevents that (`RATE_LIMIT_PER_MINUTE`=1000 requests/min
  per IP is nowhere close to being hit by one client polling every 15s —
  see §9), but there's no server-push alternative to fall back to if that
  cadence needs to drop for battery/data reasons — it's poll-or-nothing
  today.

## 7. Error format

Every error response (this backend never returns a bare unstructured
error) is:
```json
{"error": {"code": "SLOT_ALREADY_TAKEN", "message": "This slot was just booked by someone else", "details": {}}}
```
`details` is usually `{}` but can carry structured extras (e.g. validation
errors put the field-level breakdown there).

**Error codes the frontend should handle specially** (from
`app/errors.py` — anything not in this list still comes through the same
envelope with a generic status-derived code, e.g. a plain `404` → code
`"NOT_FOUND"`):

| `error.code` | HTTP status | Meaning / what to show |
|---|---|---|
| `INVALID_OTP` | 400 | Wrong code — let them retry |
| `OTP_EXPIRED` | 400 | Code expired/not found — offer to resend |
| `OTP_RATE_LIMITED` | 429 | Too many attempts/requests — back off |
| `OTP_DELIVERY_FAILED` | 502 | WhatsApp send failed — offer a retry |
| `INVALID_CREDENTIALS` | 401 | Wrong password or unknown phone (deliberately the same) |
| `LOGIN_RATE_LIMITED` | 429 | Too many failed logins for this phone |
| `PHONE_REVERIFICATION_REQUIRED` | 403 / 401 | Phone unverified or >365 days — route to OTP re-verification |
| `PASSWORD_NOT_SET` | 403 | Pre-password account — route to the set-password (reset) flow |
| `PHONE_ALREADY_REGISTERED` | 409 | Signup, or a phone change, to a number that already has an account |
| `EMAIL_ALREADY_IN_USE` | 409 | Signup or profile update with an email another account uses (case-insensitive) |
| `SESSION_EXPIRED` | 401 | Token invalid/expired — send to login (or try `/auth/refresh` first if you still have a token) |
| `SESSION_REVOKED` | 401 | Session was revoked (logged out elsewhere) — send to login |
| `SLOT_ALREADY_TAKEN` | 409 | **The slot no longer available** — someone else booked it first; refresh availability, don't retry the same request |
| `INVALID_SLOT_TIME` | 400 | `starts_at` isn't grid-aligned — a client bug (always source times from the availability response) |
| `SLOT_IN_PAST` | 400 | Requested a hold for a time already passed |
| `SLOT_BLOCKED` | 400 | Slot is blacked out by the venue |
| `BOOKING_NOT_FOUND` | 404 | — |
| `INVALID_BOOKING_STATE` | 400 | Action doesn't apply to this booking's current status (e.g. checking in a booking that isn't `booked`) |
| `NOT_YOUR_BOOKING` | 403 | Acting on someone else's booking |
| `VENUE_NOT_APPROVED` | 400 | Trying to book at a venue still pending admin review |
| `VENUE_NOT_FOUND` / `NOT_VENUE_OWNER` | 404 / 403 | — |
| `DUPLICATE_PROOF` | — | *(reserved in the code, not currently raised anywhere — duplicates surface as `payment.is_duplicate: true` in a normal `201`, not as this error)* |
| `PROOF_TOO_LARGE` | 400 | Upload over 10MB |
| `INVALID_IMAGE_FORMAT` | 400 | Wrong content-type on upload |
| `RATE_LIMITED` | 429 | Generic per-IP rate limit (1000/min) hit |
| `FORBIDDEN` | 403 | Role check failed (e.g. a player hitting an owner-only route) |
| `VALIDATION_ERROR` | 422 | Request body failed schema validation — `details.errors` has FastAPI's field-level breakdown |
| `NOT_FOUND` | 404 | Generic fallback |

"**Payment already verified**" (from the task's example list) isn't a
distinct error code — re-approving/rejecting an already-actioned payment
returns a plain `400` with a human-readable message ("Payment already
actioned"), fallback code `VALIDATION_ERROR`. If the frontend wants a
dedicated code for that, it doesn't exist yet.

## 8. Environment variables the frontend needs

Realistically, almost none — this backend has no frontend-facing feature
flags or public keys exposed today. The frontend's own build just needs:
- **API base URL** (e.g. `NEXT_PUBLIC_API_BASE_URL` / whatever the
  frontend's own convention is) — pointed at `http://localhost:8000`
  locally; there is no staging/prod value yet (§1).
- That's it. There's no public Maps/analytics/feature-flag key this
  backend issues or expects the frontend to send. **Never** put
  `SESSION_TOKEN_SECRET`, any `*_API_KEY` (Anthropic/Gemini/OpenAI/AWS/
  WhatsApp/SMS/FCM), or `BANK_DETAILS_ENCRYPTION_KEY` in a frontend build
  — all of those are backend-only secrets and none of them have a
  frontend-safe counterpart in this codebase today.

## 9. Rate limits

- **Global**: 1000 requests/minute per IP (`RATE_LIMIT_PER_MINUTE`),
  every endpoint except `/health`/`/health/ready`. Exceeding it →
  `429`, `error.code = "RATE_LIMITED"`, `details.limit_per_minute`.
  This is a single shared bucket across *all* endpoints from one IP —
  a mobile app behind carrier-grade NAT sharing an IP with many other
  users could theoretically hit this from aggregate traffic, but a single
  user's own polling (even at a few requests per 15s) is nowhere close.
- **OTP requests**: 5 per phone number per 15 minutes
  (`OTP_MAX_ATTEMPTS`/`OTP_RATE_LIMIT_WINDOW_MINUTES`) — keyed by phone,
  not IP, enforced at the service layer, separate from the global limit.
- **No other endpoint has its own rate limit.** Booking holds, chat
  messages, availability polling, etc. are only subject to the global
  1000/min-per-IP ceiling above.
