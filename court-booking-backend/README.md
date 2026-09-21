# Court Booking API

FastAPI backend for a court booking platform: venue/court management,
on-read slot availability, race-safe bookings with split advance/gate
payments, proof-of-payment verification (OCR + duplicate detection),
waitlists, WhatsApp notifications/chat, and an owner/admin dashboard.

## Stack

- **FastAPI** + **Pydantic v2** for the API layer
- **SQLAlchemy 2.0 (async)** + **asyncpg** + **PostGIS** (via GeoAlchemy2) for persistence and geo queries
- **Alembic** for migrations
- **WhatsApp Cloud API** for OTP delivery, notifications, and an AI-backed chatbot
- **SMS** (pluggable, no provider wired in) as the last rung of the payment-review escalation ladder
- **Claude / Gemini / OpenAI** (config-selected, one active at a time) for payment-proof OCR
  and the chat assistant — see "AI provider abstraction" below
- **Pillow + imagehash** for perceptual-hash duplicate-proof detection
- **cryptography (Fernet)** for app-level encryption of venue bank details
- **S3** for venue photos (public) and payment proofs (private, KMS-encrypted)
- **pytest** + **pytest-asyncio** against a real Postgres/PostGIS instance

Interactive API docs (Swagger UI) are served at `/docs` once the app is
running, generated from the schemas below — that's the fastest way to see
every request/response shape exactly as implemented.

## Project layout

```
app/
├── main.py            FastAPI app factory, middleware, exception handlers
├── config.py           Pydantic Settings (env vars)
├── database.py         Async engine + session factory
├── dependencies.py      Auth, role guards, pagination
├── models/              SQLAlchemy ORM models (19 tables, see below)
├── schemas/             Pydantic request/response schemas
├── api/                 Route handlers, one module per resource
├── services/             Business logic (auth, booking, payment, notifications, ...)
│   └── ai/               Provider-agnostic AI interface (Claude/Gemini/OpenAI), see below
├── middleware/           Request-ID/logging, rate limiting
├── jobs/                 Background jobs (booking expiry, owner digest, nightly stats)
├── errors.py             ErrorCode catalog + AppError
├── seed.py               `make seed` -- idempotent local-dev demo data
└── utils/                Security, S3, geo, text, image helpers
alembic/                 Migrations
tests/                   pytest suite (factories, fixtures, one file per area)
```

## API surface

76 routes across 13 resource areas (`GET /health`/`GET /health/ready` aside,
everything is under `/api/v1`):

| Area | Base path | Highlights |
|---|---|---|
| Auth | `/auth` | `signup`, `verify-signup-otp`, `login`, `request-otp` + `reverify-phone`, `request-password-reset` + `verify-password-reset`, `refresh`, `logout`, `me` (password login; WhatsApp OTP only proves the phone -- see Key design notes) |
| Users | `/users/me` | `fcm-token` (register/delete), `notifications` history |
| Venues | `/venues` | list (geo search), create, get (by id or `by-slug/{slug}`), update, `photos`, `announcements` (Tier 3 marketing) |
| Courts | `/courts`, `/venues/{id}/courts` | create/get/update/deactivate, `schedule`, `pricing`, `blackouts` |
| Availability | `/courts/{id}/availability`, `/venues/{id}/availability` | on-read slot grid, single day or range, venue-wide |
| Bookings | `/bookings` | `hold`, `walkin`, `mine`, get, `cancel`, `checkin` (+`/self`), `payment-proof` |
| Payments | `/payments`, `/bookings/{id}/payments` | `approve`, `reject`, `proof-url` |
| Waitlist | `/waitlist` | join (returns FIFO `position`), `mine`, cancel |
| Reviews | `/reviews`, `/venues/{id}/reviews` | create, owner `reply` |
| Owners | `/owners` | `venues`, per-venue `bookings`/`payments/pending`, `digest`, `today`, `pending-approvals`, `ledger` (+`export`), `growth` (Pro tier) |
| Admin | `/admin` | `dashboard`, `stats`, `venues`(`/pending`), `venues/{id}/approve\|reject\|request-changes`, `bookings`, `users` (`search`/`flagged`), `disputes` (+`/refund-queue`, `/passive-venues`, `/flagged-checkins`), `users/{id}/suspend\|unsuspend` |
| Chat | `/chat` | `message` (AI tool-calling turn, in-app), `history` (filterable by `venue_id`/`booking_id`) |
| Webhooks | `/webhooks/whatsapp` | inbound WhatsApp messages (verify + receive) |

## Local setup

```bash
cp .env.example .env             # fill in real secrets for anything beyond local dev
docker compose up -d db localstack   # Postgres + PostGIS (5433->5432) AND S3 (4566) -- both required
pip install -e ".[dev]"
alembic upgrade head

# One-time per fresh LocalStack start (no persistence across `docker compose down -v`):
aws --endpoint-url=http://localhost:4566 s3 mb s3://court-booking-public
aws --endpoint-url=http://localhost:4566 s3 mb s3://court-booking-private
# .env needs AWS_ACCESS_KEY_ID=test / AWS_SECRET_ACCESS_KEY=test /
# AWS_ENDPOINT_URL=http://localhost:4566 pointing at it (see .env.example).
# Without this, payment-proof upload and venue-photo upload 500 with
# botocore.errorfactory.NoSuchBucket.

uvicorn app.main:app --reload
curl http://localhost:8000/health
```

> **Port note:** the `db` service is mapped to host port **5433**, not 5432 —
> if your machine already runs a native Postgres on 5432, this avoids a silent
> port collision. Container-to-container traffic (e.g. the `app` service in
> `docker-compose.yml`) still talks to `db:5432` internally, unaffected.

### Running tests

```bash
pytest -v --tb=short
```

If your local `.env` overrides `AI_PROVIDER`/`AI_VISION_PROVIDER` to `gemini`
for manual testing (this repo's own dev `.env` does), run the suite with:

```bash
AI_PROVIDER=claude AI_VISION_PROVIDER=claude pytest -v --tb=short
```

Otherwise several AI-chat/OCR tests spuriously fail — they mock
Claude-specific HTTP call shapes that the Gemini provider never touches,
since the app actually constructs a `GeminiProvider` at runtime instead.
This looks like a real failure count (e.g. ~9 failures) but isn't; it's not
something to "fix" by editing `.env` (that override is what lets manual
chat/OCR testing exercise a real key) — just don't mistake this
environment-specific noise for a real regression when running the suite
from a `.env` with that override.

379 tests across 27 files, one per resource area (`test_auth.py`,
`test_venues.py`, `test_courts.py`, `test_availability.py`,
`test_bookings.py`, `test_concurrency.py`, `test_payments.py`,
`test_waitlist.py`, `test_owners.py`, `test_marketing.py`, `test_users.py`,
`test_admin.py`, `test_jobs.py`, `test_notifications.py`, `test_whatsapp.py`,
`test_webhooks.py`, `test_ai_chat.py`, `test_ai_providers.py`,
`test_ai_retry.py`, `test_chat.py`, `test_ocr.py`, `test_s3.py`,
`test_errors.py`, `test_health.py`, `test_encryption.py`,
`tests/factories.py` + `tests/conftest.py` for shared fixtures). Tests run
against a real `court_booking_test` database (created
and schema-rebuilt automatically on the same Postgres instance as
`DATABASE_URL`) — not sqlite — since several models use PostGIS geometry
columns and the concurrency test needs a real unique-constraint conflict,
which an in-process fake can't reproduce. `tests/conftest.py` truncates
tables around each test; no external services (WhatsApp/SMS/S3/Anthropic/
Gemini/OpenAI/FCM) are called unless their API tokens are configured — with
empty tokens (the default), those service methods no-op locally, so most
tests that need to observe a "send" monkeypatch the relevant
`Service.send_text`/`_push` method rather than relying on that no-op. (A
stray, non-pytest script that violated this by firing 5 real Gemini calls
on every test-suite collection was found and moved out of `tests/` during
Part B.1 — see CLAUDE.md's gotchas.)

### Creating a new migration

```bash
alembic revision --autogenerate -m "add something"
```

Two things to check by hand afterward, both PostGIS/GeoAlchemy2 quirks:

1. If the diff touches the `venues.location` `Geometry` column, add
   `import geoalchemy2` to the migration's imports — autogenerate doesn't add
   it automatically.
2. GeoAlchemy2 creates/drops the GIST spatial index (`idx_venues_location`)
   itself via DDL event listeners on `create_table`/`drop_table`. If
   autogenerate also emits an explicit `op.create_index`/`op.drop_index` for
   that same column, remove it — otherwise you get a duplicate-index error on
   upgrade, or an already-dropped error on downgrade.

Alembic is configured (`alembic/env.py`) to ignore tables it didn't create
(PostGIS's own `tiger`/`topology` schema tables), so autogenerate won't ever
propose dropping them. Postgres ENUM columns (`user_role`, `venue_status`,
`booking_status`, `booking_source`, `cancelled_by`, `plan_tier`) also aren't
auto-dropped on downgrade by Alembic — the initial migration (and
`ca2c0190ac2a_add_venue_plan_tier.py`, for the one added later) does it
explicitly at the end of `downgrade()`; carry that pattern forward if you add
a new enum. Adding an enum column to an *existing* table (unlike a brand-new
table, where `op.create_table` creates the type as a side effect) also needs
an explicit `sa.Enum(...).create(op.get_bind(), checkfirst=True)` before the
`op.add_column` call — the plan_tier migration is the reference example.

## Data model

PostgreSQL is the single source of truth (PostGIS extension for geo). **Slots
are not rows** — `schedule_templates` (recurring weekly hours) and
`pricing_rules` (priority-ordered price/advance-% by day/time) define the
grid; `app/services/availability_service.py` generates it on read, minus
`blackouts` and live bookings. Changing a venue's hours or prices is a normal
write, never a migration.

The schema mirrors this shape, table by table:

- `users` (argon2id `password_hash`, `email` with a case-insensitive unique index on `lower(email)`, `city`, `gender`, `phone_verified_at`), `sessions` (per-device, revocable, 8h), `otp_requests` (purpose-bound: signup / reverify / password_reset / phone_change; phone_change codes are also bound to the requesting `user_id`), `login_attempts` (failed-password rate limit) — password login; OTP only proves phone ownership
- `venues` (slug, geo `location`, `sports[]`, encrypted `bank_details` JSONB, approval workflow, `plan_tier`), `courts`
- `schedule_templates`, `pricing_rules`, `blackouts` — the availability inputs
- `bookings` — the core state machine (see below)
- `payments` — proof submissions with OCR extraction + perceptual-hash duplicate detection (partial unique index: at most one row with `review_verdict IS NULL` per booking)
- `payment_disputes` — booking-centric "player probably paid, got no booking" queue, written when a `payment_submitted` booking auto-cancels on a plausible (non-mismatch, non-duplicate) proof; see `GET /admin/disputes/refund-queue`
- `waitlist`, `reviews` (with owner replies), `messages` (unified WhatsApp/in-app log)
- `audit_log` (BIGSERIAL, before/after diffs), `notification_log`, `fcm_tokens`, `slot_stats` (nightly-materialized)
- `ai_usage_log` (BIGSERIAL) — one row per AI provider call (chat turn or vision/OCR), for real cost-per-provider reporting

## Key design notes

- **Auth (Section 26): signup form + password login; WhatsApp OTP only proves
  the phone.** This replaced the original phone+OTP-only model, in which
  every login was an OTP and every session lasted a year.
  - **Signup**: `POST /auth/signup` takes name, email (required, stored
    lowercase, *contact info only -- not a login identifier*), phone, `city`
    (fixed pilot list of ten, a Postgres enum), `gender`, password (min 8, no
    complexity rules, max 128) + confirm, and `role` (`player` | `owner`;
    `admin` is not selectable). It creates the account with
    `phone_verified_at = NULL` and sends an OTP; `POST /auth/verify-signup-otp`
    sets `phone_verified_at` and issues the first session. Signing up on a
    phone that already has a *verified* account is `409 PHONE_ALREADY_REGISTERED`
    (never overwrites); an abandoned, never-verified signup *can* be
    overwritten by a retry, so nobody can squat on someone else's number.
  - **Login**: `POST /auth/login` (phone + password). **The phone-verification
    check runs before the password check**: if `phone_verified_at` is NULL or
    older than `PHONE_VERIFICATION_TRUST_DAYS` (365) the answer is
    `403 PHONE_REVERIFICATION_REQUIRED` (even for a wrong password) so the
    client can route to OTP instead of saying "wrong password". A pre-Section-26
    account with no password is `403 PASSWORD_NOT_SET` (it sets one through the
    reset flow). Otherwise wrong password / unknown phone are the *same*
    `401 INVALID_CREDENTIALS` (an unknown phone still pays for one argon2
    check, so latency doesn't reveal it either). Failed attempts are rows in
    `login_attempts`: 5 per phone per 15 min then `429 LOGIN_RATE_LIMITED`,
    counted for unknown phones too, cleared on success or a password reset.
    Deliberate consequence: PHONE_REVERIFICATION_REQUIRED / PASSWORD_NOT_SET do
    tell a caller that a phone has an account -- the spec needs those codes.
  - **Re-verification**: `POST /auth/request-otp` (sends a code; silent for an
    unknown phone; for a pending signup it's the "resend" and yields a signup
    code) then `POST /auth/reverify-phone` (sets `phone_verified_at`, issues
    **no** session -- an OTP proves the phone, not the password, so the client
    follows with a normal password login). `verify-signup-otp` only completes a
    *pending* signup, and OTPs are purpose-bound (`otp_requests.purpose`), so a
    code minted for one flow can't be redeemed in another. There is no OTP
    login any more: the old `POST /auth/verify-otp` is gone (it would have
    bypassed the password).
  - **Forgot / set password**: `POST /auth/request-password-reset` then
    `POST /auth/verify-password-reset` (phone, code, new password + confirm).
    It ends **every** session for the account (other devices are logged out),
    refreshes `phone_verified_at` and clears the login lockout, and does not log
    anyone in. It is also how an existing (pre-Section-26) account sets its
    first password. Same free-form WhatsApp send, same caveats (below).
  - **Sessions**: `SESSION_TOKEN_EXPIRE_HOURS` = **8**, fixed per token,
    opaque bearer tokens HMAC-hashed at rest, per-device rows. Clients must
    call `POST /auth/refresh` **proactively** (it rotates a still-valid token
    into a fresh 8h one; an expired token cannot be refreshed). Refresh does
    not outlive phone verification: past 365 days it answers
    `401 PHONE_REVERIFICATION_REQUIRED`, otherwise an always-active user would
    never be re-verified.
  - **Profile editing**: `PATCH /auth/me` edits `name`, `email`, `city`,
    `gender` (and `avatar_url`) for both roles; all optional, but an explicit
    `null` for name/email/city/gender is rejected (they're required at signup).
    `phone`, `password` and `role` are not accepted here (unknown fields are
    ignored, so a client can't sneak them in). Password change is *only* the
    forgot-password flow -- there is deliberately no second, "old password"
    path.
  - **Email is unique, case-insensitively.** A functional unique index
    `uq_users_email_lower` on `lower(email)` makes it a database guarantee (two
    racing signups can't both win). The API answers `409 EMAIL_ALREADY_IN_USE`
    on signup and on profile update (the IntegrityError is caught and mapped, not
    a 500). An email held only by an **abandoned, never-verified signup** does not
    block anyone: it is released (nulled, with an `email_released_abandoned_signup`
    audit row) exactly like an abandoned phone, so nobody can squat. Migration
    `651abc777d2c` resolves pre-existing duplicates *before* creating the index --
    earliest account (by `created_at`) keeps the address, later ones are NULLed,
    every change is an `email_deduplicated_by_migration` audit row, and the
    migration prints what it did.
  - **Phone change**: `POST /auth/request-phone-change` (`new_phone` +
    **current password**) then `POST /auth/verify-phone-change` (`new_phone` +
    code). The code goes to the **new** number (purpose `phone_change`, bound to
    the requesting user so another user's code can't be redeemed). Requirements /
    behavior: authenticated; the new number must not belong to a *verified*
    account (`409 PHONE_ALREADY_REGISTERED`; a stale unverified holder is deleted
    on success); the password is required so a stolen 8h token can't take over
    the account (`403 INVALID_CREDENTIALS` -- deliberately not 401, so clients
    don't read it as an expired session; wrong guesses share the login lockout,
    `429 LOGIN_RATE_LIMITED`; `PASSWORD_NOT_SET` for a legacy account without a
    password). Nothing changes until the code is verified: a failed or abandoned
    attempt leaves the original number, sessions and login untouched. On success,
    in one transaction: phone updated, `phone_verified_at = now`, **every**
    session revoked (`revoked_reason = "phone_changed"`, this one too -- the
    response says `sign_in_again: true`), lockouts cleared; any failure rolls the
    whole thing back. The user then logs in with the new number and the
    *existing* password. **Old-number notice (Section 28):** once the change has
    committed, the *old* number gets a best-effort WhatsApp ("Your Maidan account's
    phone number was just changed to the number ending 1234. If this wasn't you,
    contact support immediately.") -- account-takeover detection. It runs as a
    FastAPI background task after the response is built and swallows every failure,
    so it can never fail, delay or roll back the change; the outcome is only logged
    (`phone_change.old_number_notice` with `outcome` = `accepted` / `no_open_window`
    (Meta 131047) / `send_failed`). **It is best-effort by design**: it's free-form
    text like the OTP, so under the temporary setup it only delivers to an old number
    with an open 24h window (most won't), and `accepted` means Meta took it, not that
    it arrived (see the `whatsapp.status` log). It becomes reliable when the verified
    business account and an approved Utility template exist -- then switch
    `WhatsAppService.send_phone_changed_notice` to `send_registered_template`.
  - **Passwords** are argon2id (`argon2-cffi`, hashed/verified off the event
    loop with `asyncio.to_thread`) -- deliberately *not* the Fernet used for
    bank details (reversible encryption is the wrong tool) and not the plain
    SHA-256 used for OTPs (fine for a 5-minute, attempt-capped 6-digit code,
    not for a reusable password). OTPs stay plain SHA-256: ~20 bits of entropy
    regardless of hash cost, dead in 5 minutes; the real protection is the
    expiry, the 5-attempt cap and the 5-request/15-minute limit.
  FCM tokens and notification history live under `/users/me/*`, not `/auth`.
  **Temporary (Meta Business Verification pending):** OTPs are currently
  sent as free-form WhatsApp text rather than the `whatsapp_otp`
  Authentication template (`WhatsAppService.send_otp`), so they only reach a
  recipient who has messaged the business number within the last 24h.
  Anyone else either gets `502 OTP_DELIVERY_FAILED` (Meta rejects the send
  outright -- the finding #6 path, not a 500) or, more commonly, a plain 200
  with no message, because Meta accepted the send and failed it afterwards in
  a delivery-status webhook. Those outcomes are now logged
  (`whatsapp.send.accepted` / `.rejected`, `whatsapp.status`) so the real
  reason is visible. **This matters more now**: a brand-new player cannot
  finish signup without an open window. Revert to the template send once one
  is approved -- steps in CLAUDE.md's "TEMPORARY: OTP is sent as free-form
  WhatsApp text" gotcha.
  **`DEV_FIXED_OTP`** (blank by default) lets local dev skip WhatsApp
  delivery / DB brute-forcing entirely — set it (e.g. `111111`) in a local
  `.env` and every OTP request returns that code instead of a random
  one. Double-gated on `DEBUG=true` so it can't silently activate in a
  shared/staging environment; never give it a real value in `.env.example`.
  `app/seed.py`'s three demo accounts are phone-verified and share
  `DEMO_PASSWORD` for local login.

- **Booking concurrency is enforced by the database, not the application.**
  `bookings` has a partial unique index —
  `one_live_booking_per_slot ON bookings (court_id, starts_at) WHERE status
  IN ('held', 'payment_submitted', 'booked')` — so a second live booking for
  the same court+time is physically impossible; there is no check-then-write
  race window to get wrong. `booking_service.create_booking` just inserts and
  translates the resulting `IntegrityError` into a 409. Verified against real
  Postgres by `tests/test_concurrency.py` (50 concurrent requests for the
  same slot → exactly one 201, 49 409s) and by the raw-SQL check in this
  README's history (insert / duplicate insert fails / cancel / re-insert
  succeeds).
  That index only matches on *exact* `starts_at` equality, though, so on its
  own it does nothing about an off-grid `starts_at` (e.g. 19:30) that
  overlaps an existing on-grid booking's window (19:00-20:00) without
  colliding with it. `create_hold` closes that gap by requiring `starts_at`
  to be grid-aligned (`AvailabilityService.is_slot_grid_aligned`, reusing
  `get_day_slots` rather than a second copy of the grid math) before it ever
  reaches the insert, raising `INVALID_SLOT_TIME` otherwise. Every booking
  the API can create is therefore always exactly one `court.slot_minutes`
  block on the grid (`ends_at = starts_at + court.slot_minutes`, both in
  `create_hold` and `create_walkin` — there is no multi-slot/"book 2 hours
  straight" path anywhere in this codebase), which is what makes the single
  partial unique index sufficient on its own; a Postgres exclusion
  constraint (`EXCLUDE USING gist`) for true range overlap is only needed if
  a future section introduces bookings whose `ends_at` isn't derived that
  way. Locked in by `tests/test_concurrency.py::test_off_grid_overlap_rejected`.

- **Booking state machine**: `held` (`POST /bookings/hold`, `held_until` hold
  window; `ends_at` is derived from `court.slot_minutes`, callers only send
  `starts_at`) → `payment_submitted` (proof uploaded, `payment_deadline` for
  the owner to act) → `booked` (owner approves, or auto-approve) →
  `completed` (QR check-in, `POST /bookings/{id}/checkin`) / `no_show`
  (`jobs/expiry_job.mark_overdue_no_shows`, `NO_SHOW_GRACE_MINUTES` after
  `starts_at` with no check-in — dents `reliability_score`).
  A **rejected payment cancels the booking outright** (releasing the slot for
  anyone, including the same player, to hold again) rather than returning it
  to `held` — `payments` is one-to-many with `bookings` so a second proof on
  a *new* hold still has a paper trail. `POST /bookings/walkin` (owner/staff,
  cash already collected) skips the hold/proof steps entirely and inserts
  straight into `booked`, auto-linking `player_id` if `player_phone` matches
  a registered user. `expire_stale_bookings` cancels holds/reviews that blow
  through their deadline and wakes up the waitlist for that slot; it also
  notifies the *owner* (not just the player) when a payment review timed out
  on them specifically (`cancellation_reason == "payment_review_expired"`).
  **A player cancelling an already-`booked` (paid) booking is gated by that
  court's own cancellation policy** (`courts.cancellation_allowed`/
  `cancellation_cutoff_hours`, Section 29 Part C) — `CANCELLATION_NOT_ALLOWED`
  or `CANCELLATION_WINDOW_CLOSED` otherwise. `held`/`payment_submitted`
  cancels are never gated by this — only a paid booking has anything for the
  policy to protect.

- **Pricing**: `price` is resolved from the highest-priority matching
  `pricing_rules` row at booking time; `advance_amount` = `price *
  rule.advance_percentage / 100`, `balance_due` = the rest (paid at the
  gate). Availability listing doesn't gate on pricing (a slot with no rule
  still shows as `available`, priced at 0, so owners can see and fix gaps in
  their pricing) — but *booking* a slot with no matching rule is rejected
  with a 400, since there'd be nothing to charge.

- **Availability** (`GET /courts/{id}/availability`) generates the slot grid
  on read from `schedule_templates` (a court has at most one active template
  per day, enforced by a partial unique index) and returns each slot's
  `status` — `available`, `blocked` (blackout, with a `reason`), or the
  live booking's own status (`held`/`payment_submitted`/`booked`) — plus
  `price`/`advance_amount` and, for `held` slots, `held_until`. Accepts
  either `?date=` or `?start_date=&end_date=` (max 28 days); there's also a
  venue-wide `GET /venues/{id}/availability?date=` across all its courts.

- **Venue bank details** are encrypted app-side (Fernet, key derived from
  `BANK_DETAILS_ENCRYPTION_KEY`) before being stored in the `bank_details`
  JSONB column, and only decrypted back out for the venue's own owner or an
  admin — `VenueService.to_out(..., requesting_user=)` is the one place
  that decision is made, so every route that serializes a venue goes
  through it rather than deciding visibility itself. `BANK_DETAILS_ENCRYPTION_KEY`
  falling back to `SESSION_TOKEN_SECRET` when unset is **local-dev
  convenience only** (`DEBUG=true`, logged loudly); outside `DEBUG`,
  `app/utils/encryption.py::_fernet` raises at first use instead of
  silently encrypting real bank/IBAN/JazzCash details with the same secret
  that's load-bearing for session-token integrity — see "Pre-launch
  hardening" below. In production, `BANK_DETAILS_ENCRYPTION_KEY` should
  itself come from a KMS-decrypted envelope key rather than a bare env var;
  that's infra-specific and left as the integration seam.

- **Payment review** (`POST /bookings/{id}/payment-proof`, field name
  `image`): the configured vision `AIProvider` (see "AI vendor is a config
  choice" below) extracts amount/reference/timestamp/confidence from the
  proof; the expected amount is always
  `booking.advance_amount` (the player never types an amount), compared
  within `OCR_MATCH_TOLERANCE_PERCENT` (5%) to set `ocr_verdict`
  (match/mismatch/unreadable). `utils/image.py` computes a perceptual hash;
  duplicate detection compares its **Hamming distance** (not string
  equality) against every proof from the trailing `DUPLICATE_LOOKBACK_DAYS`
  (90) — a screenshot forwarded twice is rarely byte-identical after transit,
  but its hash barely moves. Auto-approve requires `venue.auto_approve_enabled`,
  a clean `match`, no duplicate, and the player's booking/rejection counts
  **at this venue specifically** (a live query, not the player's global
  `total_bookings`/`total_rejections` columns, which are platform-wide).
  `GET /payments/{id}/proof-url` mints a short-lived signed S3 URL on demand,
  scoped to the booking's own venue owner (or admin) — a different venue's
  owner gets a 403, not a leaked URL.

- **Notifications are tiered** (`notification_service.py`): Tier 1 (push
  only) for `slot_reopened` and the 2-hour `booking_reminder`
  (`jobs/reminder_job.py`); Tier 2 (push + WhatsApp) for confirmed/cancelled/
  rejected events; `payment_submitted` gets its own escalation ladder to the
  *owner* — push immediately, WhatsApp at `ESCALATION_WHATSAPP_MINUTES` (5),
  SMS at `ESCALATION_SMS_MINUTES` (15), then the booking auto-releases at
  `PAYMENT_REVIEW_HOURS` (2). There's no task scheduler here, so elapsed time
  is derived from `payment_deadline - PAYMENT_REVIEW_HOURS` rather than a
  stored "sent at" column, and each step is idempotent via a
  `notification_log` lookup before sending — `jobs/expiry_job.escalate_pending_payment_reviews`
  fires whichever steps are due (both at once, if the job hasn't run in a
  while) each time it runs. Tier 3 (`POST /venues/{id}/announcements`, paid
  marketing) is gated by `venues.plan_tier` against a monthly send cap
  (`MARKETING_CAP_FREE/PRO/BUSINESS`) computed by counting
  `notification_log` rows for that venue this calendar month — no separate
  counter to keep in sync or reset. Every send is logged to `notification_log`
  regardless of tier, for delivery/cost reporting.

- **WhatsApp is a full channel, not just an OTP transport.**
  `POST /webhooks/whatsapp` (Meta Cloud API format) fans an inbound payload
  out into text/image/interactive-button handlers. A phone number is treated
  as verified identity for guest creation — no OTP step — since WhatsApp
  itself already verified the sender owns that number
  (`_find_or_create_guest`). Text goes to the AI chat service; an image is
  routed deterministically (not via AI intent-detection) to
  `payment_service.submit_payment` against the player's most recent `held`
  booking; a button tap on a prior `propose_booking_confirmation` reply
  (`confirm:<court_id>:<starts_at>` / `decline`) calls
  `booking_service.create_hold` directly. **Delivery dedup is a database
  constraint, not an app-level check** — a partial unique index on
  `messages.whatsapp_msg_id` — matching the same "let the DB enforce it"
  philosophy as the booking-slot unique index; `_record_message` just
  catches the resulting `IntegrityError` and treats it as "already
  processed." **The 24-hour customer-service window** (WhatsApp allows
  free-form text only within 24h of the customer's last inbound message,
  else a pre-registered Meta template is required) is computed live from
  the `messages` table (`last_inbound_whatsapp_at`) rather than a stored
  "window expires at" timestamp — `WhatsAppService.send_smart()` checks it
  and falls back to `app/services/whatsapp_templates.py`'s registry
  (`booking_confirmed`, `payment_rejected`, `payment_submitted_owner`,
  `venue_approved`, `tournament_announcement`, etc., or `generic_notification`
  as a 1-param catch-all) when outside it. Because a webhook reply is always
  a direct response to an inbound message, it's always inside the window and
  always sent as free text. `messages.venue_id` is nullable since a
  first-contact WhatsApp conversation has no venue context yet.

- **`messages.sender_id` means "thread owner," not literal sender**, for
  `sender_type in ("ai", "system")` rows — it's set to the human on the
  other end of the conversation, not an AI/system user id (there isn't one).
  This is what makes reconstructing a conversation a single `WHERE sender_id
  = :user_id` query, with no separate "conversations" table, across both
  `channel="whatsapp"` and `channel="app"` history.

- **The AI chat service (`app/services/ai_chat_service.py`) has no direct
  database access.** Every tool the model can call (`search_venues`,
  `check_availability`, `hold_slot`, `cancel_booking`, ...) invokes the same
  service-layer methods (`BookingService`, `AvailabilityService`,
  `VenueService`) that the HTTP API itself calls, scoped to the real
  requesting `User` — so authorization guardrails are enforced by existing
  code, not reimplemented or prompt-engineered. Concretely: there is no
  `approve_payment`/`reject_payment` tool at all, and `cancel_booking`
  routes through the same ownership check the HTTP endpoint uses, so the AI
  physically cannot cancel another player's booking regardless of what it's
  asked (`tests/test_ai_chat.py::test_cannot_cancel_another_players_booking`
  calls the tool directly and asserts a 403, not a refusal string). Also
  idempotent by construction: cancelling an already-cancelled booking is a
  safe no-op (same booking returned, no re-notify), not an error, in case a
  duplicate WhatsApp delivery or an AI retry after a perceived timeout calls
  it twice — `BookingService.cancel_booking` itself special-cases the
  already-`cancelled` status, so both the HTTP endpoint and the AI tool get
  it for free. Model routing is cost-driven: `"routine"` tier by default,
  `"complex"` once the conversation history exceeds
  `COMPLEX_TIER_TURN_THRESHOLD` (6) messages — both provider-neutral (the
  labels used to be the Claude-specific "haiku"/"sonnet", predating
  providers other than Claude; renamed since `ChatResult.model` is a value
  every provider's replies flow through, not just Claude's). With no AI
  provider configured, `process_message` returns a graceful static
  fallback reply instead of erroring. `POST /chat/message` /
  `GET /chat/history` (`channel="app"`) are the in-app counterpart to the
  WhatsApp text handler, sharing the same `AIChatService`.

- **AI vendor is a config choice, not something hardcoded into business
  logic** (Section 21, `app/services/ai/`). `booking_service.py`,
  `payment_service.py`, and `ai_chat_service.py` never import a vendor SDK
  or call a vendor API directly — only `AIProvider` (`base.py`), obtained
  from `get_chat_provider(settings)` / `get_vision_provider(settings)`
  (`factory.py`), selected by `AI_PROVIDER` (`claude` | `gemini` | `openai`)
  with an independent `AI_VISION_PROVIDER` override for just the OCR path.
  All three providers (`claude_provider.py`, `gemini_provider.py`,
  `openai_provider.py`) speak REST directly via `httpx` rather than a vendor
  SDK — `anthropic`/`google-generativeai`/`openai` are dependencies of
  nothing in this project, not even a lazily-imported one, since the
  pre-Section-21 Claude code this wraps was itself never written against
  the `anthropic` SDK. The wire format `chat()` passes between turns is
  Claude's own native shape (text/tool_use/tool_result content blocks) —
  chosen because that's what the pre-existing tool-calling loop already
  used, not a new invention; Gemini's and OpenAI's providers translate it
  to and from their own native call internally, so `ai_chat_service.py`
  never needs to know which provider is active. The factory is
  deliberately **not** cached (unlike this section's own reference
  pseudocode) — a cached provider instance would go stale the moment a test
  (or a live config reload) changes `AI_PROVIDER` or an API key, since
  building one is cheap enough that caching buys nothing but a testability
  footgun. `ai_usage_log` records one row per provider call (chat turn or
  vision call) with real token counts, specifically so "did switching to
  Gemini actually save money" has real numbers behind it. Before ever
  flipping `AI_VISION_PROVIDER` away from `claude` in production, compare
  extraction accuracy against real local payment screenshots first — vision
  quality on messy JazzCash/Easypaisa screenshots doesn't reliably track
  generic vision benchmarks.

  **Gemini and OpenAI were verified against mocked HTTP only until Part
  B.1** (2026-09-07), which ran real calls against a live Gemini key end
  to end (`/chat/message` through a full multi-turn tool-calling
  conversation to a real `hold_slot` confirmation, plus a structured-
  output vision extraction against a synthetic receipt) and fixed three
  real gaps the mocks couldn't have caught: two generations of dead model
  IDs (`gemini-2.0-*` and even `gemini-2.5-*`), missing
  `candidatesTokenCount` on thinking-model replies (now summed with
  `thoughtsTokenCount` in `raw_usage`), and a `thoughtSignature` that must
  be echoed back on any replayed `functionCall` or the API 400s on the
  second turn of any tool-calling conversation (`ToolCall.provider_data`).
  The chat-tier model was live-verified again on 2026-09-08 when switched
  to its current default, **`gemini-3.5-flash-lite`** (`GEMINI_FLASH_MODEL`
  in `config.py`) — chat, tool-calling, and the thoughtSignature
  round-trip all independently confirmed on this exact model, not assumed
  from the previous one (`gemini-3.6-flash`, itself confirmed live on
  2026-09-07 but superseded the next day). `GEMINI_PRO_MODEL` (vision) was
  switched from `gemini-pro-latest` to **`gemini-3.5-flash-lite`** on
  2026-09-19 (Section 23 pre-launch hardening) — the former was
  429-quota-limited on every "pro" model tried under this key's plan,
  making it unusable in practice regardless of the original "vision
  quality matters more than latency" rationale above. Live-verified
  end-to-end that day (`GeminiProvider.extract_payment_proof` against a
  synthetic receipt image, real API key): amount/reference/timestamp/
  confidence all extracted correctly, no 429. A deliberate quality-for-
  availability tradeoff, not a silent regression — re-verify against real
  local payment screenshots (not just a synthetic receipt) before trusting
  OCR quality at pilot scale. **Re-verify any of these model IDs against
  a live key before trusting them again** — see `gemini_provider.py`'s
  module docstring and CLAUDE.md's gotchas for the full history; this
  project has already had to correct its Gemini model default three
  times in two days as Google deprecated/renamed models out from under
  it. OpenAI has still never been exercised against its real API in this
  project — no key was available when either pass ran.

- **Waitlist is strictly FIFO, one notification at a time.** Joining is
  gated by a partial unique index (`unique_active_waitlist`, mirroring the
  same "let the DB enforce it" pattern as `one_live_booking_per_slot`) —
  `WaitlistService.join` just inserts and translates the resulting
  `IntegrityError` into a 409, and since the index is partial on
  `is_active`, cancelling and rejoining the same slot later is unaffected.
  When a slot frees up (`notify_matching_entries`, called from every release
  path — hold expiry, payment-deadline expiry, payment rejection, and
  player/owner cancellation), only the single earliest not-yet-notified
  entry is told; everyone else stays queued. If that person doesn't act
  within `WAITLIST_RENOTIFY_GRACE_MINUTES` (10), `advance_stale_notifications`
  (run as part of the expiry job) gives up on them and notifies the next
  person in line instead, so one unresponsive waitlister can't block the
  rest of the queue indefinitely. `slot_reopened` stays Tier 1 (push-only).

- **Owner dashboard** (`app/services/owner_dashboard_service.py`, `/owners/*`)
  aggregates across every venue an owner has (or one, via `?venue_id=`).
  `GET /today` reuses `AvailabilityService.get_day_slots` for the grid shape
  and separately joins in `player_name`/`amount_paid` from the day's actual
  `Booking` rows — deliberately not added to the shared `SlotOut` schema,
  since that would leak a player's name into the public-facing availability
  endpoint that schema is also used by. `GET /pending-approvals` is oldest-
  submission-first (longest-waiting player served first), each row carrying
  the OCR verdict/amount and a short-lived signed proof URL. `GET /ledger`
  (+`/ledger/export` as CSV) includes every booking in the date range
  regardless of status — a cancelled/held booking just contributes ¤0, so
  the row count reflects total activity, not just revenue-generating bookings.
  `GET /growth` is gated to `plan_tier` Pro/Business (403 if a specific
  `venue_id` is Free tier; silently excluded from the aggregate view
  otherwise).

- **Growth suggestions are nightly-materialized, not computed live**
  (Section 14). `growth_job.compute_slot_stats` (run as part of
  `materialize_nightly_stats`) is the *only* place the underbooked-slot
  guardrail is evaluated: a (court, day_of_week, hour) bucket only gets a
  `slot_stats` row at all if the court has at least `GROWTH_MIN_WEEKS` of
  history *and* that weekday occurred at least `GROWTH_MIN_OBSERVATIONS`
  times within `GROWTH_LOOKBACK_DAYS` (180 days — long enough for both
  thresholds to be jointly reachable under weekly bucketing; the spec's
  illustrative 12-week pseudocode window can't satisfy both at once, since
  a single weekday can occur at most once a week). `GET /owners/growth`
  then just reads each court's latest snapshot, averages it, and flags
  anything under `GROWTH_UNDERBOOKED_RATE_THRESHOLD` — no guardrail logic
  is duplicated between the job and the endpoint. If the job hasn't run yet
  for a court, that court simply contributes no rows and no suggestions,
  rather than a separate "not enough data" code path to keep in sync.

- **Background jobs** (`app/jobs/`) build their own DB session by default
  (`AsyncSessionLocal`) since they run outside request scope, but accept an
  optional `session_factory` override for testability. `run_expiry_job`
  (`app/jobs/expiry_job.py`) is the single cron entrypoint described in
  Section 13 — expire stale holds/payment-submissions, mark no-shows,
  fire the payment-review escalation ladder, and clean up the waitlist, all
  in one pass, each step independently idempotent so a late or repeated run
  never double-notifies or errors on an already-processed row. `growth_job`
  additionally snapshots platform stats to the audit log for the admin
  dashboard's trend charts.
  `BookingService.expire_stale_bookings` cancels each expired branch (HELD
  past `held_until`, PAYMENT_SUBMITTED past `payment_deadline`) with its own
  single `UPDATE ... WHERE status = <status> AND <deadline> < now()
  RETURNING *`, not a SELECT-then-mutate-then-commit — keeping `status =
  <status>` in the UPDATE's own `WHERE` means Postgres re-checks it against
  the row's current committed value at write time, so a booking whose
  status moved out from under the job mid-run (e.g. the player submitted
  payment proof concurrently, HELD -> PAYMENT_SUBMITTED) is a no-op there
  instead of a lost update that silently cancels a booking under review.
  This composes with `one_live_booking_per_slot`/grid alignment above:
  racing `expire_stale_bookings` against a fresh `POST /bookings/hold` for
  the same slot can only ever end with the new hold winning (0 -> 1 live
  row) or the old hold's cancellation losing the race (409, an acceptable
  "false rejection" — the caller retries a slot the availability endpoint
  now shows as free) — never two live rows for the same slot. Verified by
  `tests/test_concurrency.py::test_expiry_race_with_new_booking` (30
  repeated races; empirically the hold always won in this environment,
  since it does far more work per attempt than the job's single UPDATE, but
  the assertion only requires "never more than one live row," not "never a
  409," since the latter is a timing-dependent UX detail, not a
  correctness one).

- **Two booking guardrails were missing before Section 16's error-code
  catalog surfaced them**: `create_hold` now checks `blackouts` before
  inserting (`AvailabilityService.is_slot_open` — blackout only, deliberately
  *not* also re-checking live-booking overlap there, since
  `one_live_booking_per_slot` already owns that), and now also requires the
  court's venue to be `APPROVED` (`VENUE_NOT_APPROVED`) — previously a
  pending/rejected venue's court was still bookable by anyone who had its
  `court_id`, since public venue search already filtered to approved venues
  but direct booking never re-checked. Both are new, tested behavior, not
  just new error codes on existing checks.

- **Every error response shares one envelope**
  (`{"error": {"code", "message", "details"}}`, `app/errors.py`): a raise
  site that maps onto a named `ErrorCode` uses `AppError` (a thin
  `HTTPException` subclass carrying `code`/`details`); everything else
  still works as a plain `HTTPException` and gets a generic code derived
  from its HTTP status by the handler in `main.py` — so the envelope is
  consistent everywhere without every one of the ~50 pre-existing raise
  sites needing to be touched. Only the call sites that map cleanly onto
  Section 16.3's named codes (OTP/session errors, booking state errors,
  venue ownership/approval, payment proof validation) were actually
  migrated to `AppError`.

- **Three middlewares** (`app/middleware/`), applied in this order —
  CORS, then `RateLimitMiddleware`, then `RequestContextMiddleware`:
  a global per-IP fixed-window limiter (`RATE_LIMIT_PER_MINUTE`, default
  1000/min; `/health*` is exempt) whose counters live on the middleware
  instance itself rather than a module global, so a fresh `create_app()`
  (as every test's `app` fixture makes) starts with an empty counter
  instead of accumulating across the whole test session; and a request-ID
  stamper (`X-Request-ID`, generated if the client didn't send one) that
  also logs one structured `request.completed` line per request with
  `request_id`/`user_id`/`endpoint`/`duration_ms`/`status` — `user_id` is
  populated by `get_current_user`/`get_optional_current_user` setting
  `request.state.user_id` once auth succeeds, since that's the earliest
  point a user identity actually exists for the request.

- **Admin** (`app/services/admin_service.py`, `/admin/*`): `GET /dashboard`
  aggregates platform-wide counts read fresh on every call (not
  materialized, unlike `/owners/growth`, since this is a low-traffic
  internal page where a full-table-scan cost is acceptable).
  `GET /disputes` flags players rejected `DISPUTE_MIN_REJECTIONS` (2) or
  more times, platform-wide — Section 15.2 also describes a second
  criterion ("player flagged the rejection as unfair") for which no
  player-facing flagging flow exists anywhere in this codebase (no
  endpoint, no model field), so only the rejection-count leg is
  implemented; a real self-service dispute flag is a separate feature with
  its own contract; it isn't faked with a spare boolean here.
  `GET /disputes/refund-queue` is a second, distinct queue (Section 23):
  booking-centric rather than player-centric, populated by
  `BookingService._flag_unclaimed_payments` whenever a `payment_submitted`
  booking expires on a proof that looked like a real payment (OCR verdict
  != `mismatch`, not a flagged duplicate) — see "Pre-launch hardening"
  below.
  `POST /users/{id}/suspend` sets `is_active=False` +
  `suspension_reason` (mirrors `Venue.rejection_reason`'s pattern) — no
  separate session-revocation step is needed, since `AuthService.get_user_from_token`
  already rejects any session for an inactive user, so suspension takes
  effect on their very next request.

## Pre-launch hardening (Section 23)

Nine 🔴 BLOCKER findings from a pre-launch audit (`AUDIT_FINDINGS.md`,
2026-09-09) were fixed on 2026-09-19, ranked by real-money/trust impact.
The two patterns that recur across several of these are worth understanding
once rather than per-finding:

- **The atomic-transition guard.** `expire_stale_bookings`'s own
  `UPDATE ... WHERE status = <expected> RETURNING *` pattern (see "Booking
  state machine" above) is now also how `BookingService.confirm_booking`,
  `cancel_booking`, and `mark_payment_submitted` change a booking's status,
  via a shared `BookingService._atomic_transition` helper — a plain
  `if booking.status != X: booking.status = Y` read-then-mutate is a lost-
  update race under concurrent requests (two staff devices approving the
  same payment, a player cancelling the instant an owner approves), since
  the UPDATE it eventually issues is keyed only on the primary key and
  blindly overwrites whatever the row's real status became in the
  meantime. The atomic version re-checks the WHERE clause against the
  row's current committed value at write time (Postgres's EvalPlanQual
  under a blocked concurrent UPDATE), so a status that moved out from
  under a request is a clean no-op/error, not corruption. The mirror
  version for payments is `PaymentService._claim_review` (`UPDATE payments
  ... WHERE review_verdict IS NULL`), which `approve_payment`/
  `reject_payment` now use instead of a Python-level `if payment.review_verdict
  is not None` pre-check — removing that pre-check was deliberate, not an
  oversight: the check itself was the race, and the atomic UPDATE covers
  both the legitimate "already reviewed" case and the genuine concurrent
  race with the same code path and the same `PAYMENT_ALREADY_REVIEWED`/
  `BOOKING_ALREADY_CANCELLED` error codes. Verified by
  `tests/test_concurrency.py::test_concurrent_approve_reject_only_one_wins`
  and `test_concurrent_cancel_and_approve_only_one_wins` (real concurrent
  HTTP requests, 25 runs each, asserting the DB never ends up in a
  contradictory state) plus deterministic sequential tests for the
  ordering this harness's scheduling doesn't naturally race into
  (`test_reject_then_approve_gets_clean_conflict_error`,
  `test_cancel_after_approve_still_succeeds`).

- **Schedule hours are Pakistan-local time, not UTC.** `schedule_templates.open_time`/
  `close_time` are PKT wall-clock (an owner types "6 AM", meaning Karachi
  local time); Pakistan has no DST, so `app/utils/timezone.py`'s
  `PKT_OFFSET = timedelta(hours=5)` is a fixed, single conversion point —
  `pkt_time_to_utc(date, time)` for schedule → UTC (used by
  `AvailabilityService.get_day_slots`, which now walks the slot grid in
  naive PKT and only converts to a UTC instant at the point of comparing
  against/returning real stored booking/blackout timestamps), and
  `utc_to_pkt_naive(datetime)` for the reverse (used by
  `price_for_range_with_advance` when matching a real UTC booking time
  against `pricing_rules`' own PKT-defined time windows, and by
  `growth_job.py` when bucketing bookings by the PKT hour an owner
  actually thinks in). Previously every venue's booking grid was silently
  off by 5 hours from day one. Verified by
  `tests/test_availability.py::test_schedule_local_time_converts_correctly_to_utc`.

The nine findings:

1. **WhatsApp webhook signature verification** (`app/api/webhooks.py`) —
   `POST /webhooks/whatsapp` now verifies Meta's `X-Hub-Signature-256`
   (HMAC-SHA256 of the raw body, `WHATSAPP_APP_SECRET`, constant-time
   compare) before processing anything; unset + `DEBUG=false` refuses
   every webhook rather than silently accepting unauthenticated payloads.
   `tests/test_webhooks.py::test_webhook_rejects_missing_signature`/
   `test_webhook_rejects_invalid_signature`/`test_webhook_accepts_valid_signature`.
2. **Payment approve/reject/cancel race condition** — see the
   atomic-transition guard above.
3. **Double payment-proof submission** — a new partial unique index,
   `one_pending_payment_per_booking ON payments (booking_id) WHERE
   review_verdict IS NULL`, stops two concurrent `submit_payment` calls
   for the same booking outright (the loser's `INSERT` fails and is
   translated to `PAYMENT_ALREADY_SUBMITTED`), and `mark_payment_submitted`
   is now guarded the same atomic way as `confirm_booking` so a late/slow
   duplicate call can never reset an already-BOOKED booking back to
   `payment_submitted`. `tests/test_concurrency.py::test_double_submit_payment_only_one_payment_row`/
   `test_late_mark_payment_submitted_cannot_downgrade_confirmed_booking`.
4. **Schedule hours UTC/PKT bug** — see above.
5. **No refund/dispute record on auto-cancel** — a new `payment_disputes`
   table + `GET /admin/disputes/refund-queue` — see above.
6. **OTP send failure uncaught** (`AuthService.request_otp`) — a WhatsApp
   delivery failure now rolls back the OTP row (so it doesn't burn a
   rate-limit slot for a code that never arrived) and returns
   `OTP_DELIVERY_FAILED` through the normal error envelope instead of a
   raw 500. `tests/test_auth.py::test_otp_send_failure_does_not_consume_rate_limit`.
7. **OCR/vision provider outage uncaught** (`PaymentService._extract_payment_proof`)
   — `httpx.HTTPError` (timeout/network/exhausted-retry 5xx) now degrades
   to the same `unreadable`/manual-review path as an unconfigured
   provider, alongside the pre-existing `PaymentExtractionValidationError`
   handling, instead of 500ing the player's payment submission.
   `tests/test_payments.py::test_vision_provider_timeout_degrades_to_manual_review`.
   `GEMINI_PRO_MODEL` was also switched to `gemini-3.5-flash-lite` in the
   same pass — see the Gemini section above.
8. **Synchronous boto3 blocking the event loop** (`app/utils/s3.py`) —
   `upload_bytes`/`upload_public_photo`/`upload_private_proof`/
   `bucket_reachable` are now `async def`, running the actual boto3 call
   via `asyncio.to_thread` (plus explicit 10s connect/read timeouts on the
   client, down from boto3's ~60s defaults) so a slow/unreachable S3 can't
   freeze every other in-flight request on a single-worker deployment.
   `tests/test_s3.py::test_s3_upload_does_not_block_event_loop` races a
   deliberately-slow upload against a concurrent health check and asserts
   the health check wins.
9. **`BANK_DETAILS_ENCRYPTION_KEY` silent fallback** — now documented in
   `.env.example` (previously absent entirely), and `app/utils/encryption.py::_fernet`
   raises at first use if it's unset and `DEBUG=false`, instead of
   silently deriving the key from `SESSION_TOKEN_SECRET`. The fallback
   still works under `DEBUG=true` (logged loudly) for local dev.
   `tests/test_encryption.py`.

## Pre-launch hardening (Section 24)

The 🟡 IMPORTANT and 🟡 VERIFY findings from the same audit
(`AUDIT_FINDINGS.md`), closed 2026-09-19 alongside Section 23. Two product
decisions here were made by the person who owns this project, not inferred
— both are called out explicitly below since they change what "waitlist"
and "checked in" mean in this app, not just how a bug was fixed.

**Waitlist no longer reserves a slot for anyone (finding #15, decision).**
`WaitlistService.notify_matching_entries` used to notify only the
FIFO-first entry; it now notifies *every* active, not-yet-notified entry
for the freed court+slot at once, with zero hold created for any of them —
a deliberate departure from FIFO exclusivity. "Waitlist" means "you'll
hear about it first," not "your place in line reserves the slot"; whoever
actually completes `POST /bookings/hold` first gets it, resolved by the
same `one_live_booking_per_slot` index as any other two players racing for
a slot. `create_hold` is completely unchanged. The notification copy says
this explicitly ("other waitlisted players were notified too") so it
isn't a surprise. See `tests/test_waitlist.py::test_cancelling_booking_notifies_all_matching_waitlisters`
and `test_first_waitlisted_player_to_hold_wins_others_see_slot_gone`.

**A second, player-initiated check-in path exists now (finding #17,
decision).** Alongside the existing owner-scans-the-player's-QR flow
(`POST /bookings/{id}/checkin`), a player can now self-check-in via
`POST /bookings/{id}/checkin/self` by scanning a QR code physically posted
at the venue (`venues.checkin_qr_token`, a per-venue — not per-court —
random token generated at venue creation, visible via `GET /venues/{id}`
to the venue's own owner/admin only, same visibility rule as
`bank_details`). Both paths funnel through `BookingService._do_check_in`,
which is idempotent: whichever happens first wins, the second is a safe
no-op (`checked_in_by` records which one actually landed). A check-in
timestamp implausibly outside the booking's own window (`starts_at ±
NO_SHOW_GRACE_MINUTES`, `ends_at + NO_SHOW_GRACE_MINUTES`) sets
`bookings.checkin_flag_reason` — flagged for an admin to spot-check via
`GET /admin/disputes/flagged-checkins`, never blocked; same "flag, don't
block" philosophy as the passive-owner-inaction signal below. See
`tests/test_bookings.py`'s three `*checkin*` tests.

**The `payment_disputes` table/queue (Section 23, finding #5) is reused,
not duplicated, for two more cases:**
- **Voluntary player cancellation of an already-paid booking** (finding
  #13) — `BookingService.cancel_booking` writes a `payment_disputes` row
  (`reason="player_cancelled_paid_booking"`) whenever a `CancelledBy.PLAYER`
  cancel lands on a booking that was `BOOKED` (i.e. had an `approved`
  Payment), the same "refund possibly owed, nothing tracked it" gap as the
  auto-expiry case, just for the voluntary path. `GET
  /admin/disputes/refund-queue` shows both reasons together.
- **Passive owner inaction** (finding #14) is a *separate*, venue-centric
  signal — `GET /admin/disputes/passive-venues` counts
  `payment_review_expired` cancellations per venue
  (`DISPUTE_MIN_PASSIVE_EXPIRIES`, default 2) so an owner who simply never
  opens the approvals screen (zero explicit rejections, so invisible to
  `GET /admin/disputes`'s rejection-count query) still surfaces. This one
  is a plain query over existing `bookings` rows, not a new table.

**Other findings closed:**
- **CORS wildcard startup guard** (finding #10) — `create_app()` now
  raises `RuntimeError` if `DEBUG=false` and `ALLOWED_ORIGINS == ["*"]`;
  `.env.example`'s default is now an explicit local-dev origin list, not
  the wildcard, with a comment on what to replace it with for the pilot.
- **Per-user chat rate limit** (finding #11) — `CHAT_RATE_LIMIT_PER_MINUTE`
  (default 20/min), a new `FixedWindowCounter` (extracted from
  `RateLimitMiddleware`'s own per-IP bucket logic, same fixed-window
  pattern, keyed by user id instead) on `app.state.chat_rate_limiter`,
  enforced by a dependency (`enforce_chat_rate_limit`) on `POST
  /chat/message` only — each turn is a real paid AI call, so this is a
  cost-abuse guard specifically.
- **Pixel-bomb / spoofed-content-type upload protection** (finding #12) —
  `app/utils/image.py`'s new `validate_image()` (called from `POST
  /bookings/{id}/payment-proof` before anything else happens with the
  bytes) rejects a file Pillow can't decode at all, or one over
  `MAX_IMAGE_PIXELS` (40 megapixels); `PIL.Image.MAX_IMAGE_PIXELS` is also
  set globally as defense-in-depth for every other Pillow call in this
  codebase (e.g. `perceptual_hash`).
- **Kill switches** (finding #21) — `AI_CHAT_ENABLED` and
  `GLOBAL_AUTO_APPROVE_ENABLED`, read fresh on every request (no
  redeploy, no caching). The former degrades to the exact same free
  canned fallback reply as an unconfigured provider; the latter forces
  every payment to manual owner review regardless of any venue's own
  `auto_approve_enabled`.
- **Reused-`ocr_ref` duplicate detection** (finding #16) —
  `PaymentService._find_duplicate` now also flags a payment whose
  OCR-extracted transaction reference matches another payment's within the
  lookback window, independent of image similarity — closes the gap where
  a trusted repeat player submits a screenshot of *someone else's* real
  transfer (visually different, so the perceptual hash never caught it).
- **Court deactivation now notifies affected players** (finding #27) —
  `DELETE /courts/{id}` still doesn't touch existing live bookings on that
  court (deliberately: a deactivation might be temporary, and
  auto-cancelling a paid booking reopens the same refund-tracking
  question as finding #5/#13), but now notifies each affected player and
  leaves an audit trail (`court.deactivated_with_live_booking`) instead of
  the previous total silence.
- **A latent bug in the validation-error handler, found while fixing
  finding #26** — `app/schemas/booking.py`'s new naive-datetime rejection
  (`BookingHoldIn`/`WalkInBookingIn.starts_at`, plus the same guard
  directly in `BookingService.create_hold` for the two other call sites
  that bypass Pydantic entirely — the AI chat's `hold_slot` tool and the
  WhatsApp button-reply handler) raises a bare `ValueError` from a
  Pydantic field validator, which put the raw exception *instance* (not a
  string) into `RequestValidationError.errors()`'s `ctx.error`. `main.py`'s
  validation handler was passing that straight into `JSONResponse` without
  `jsonable_encoder`, so any such validator 500'd on JSON serialization
  instead of returning the clean 422 the handler exists for — fixed by
  routing `exc.errors()` through `jsonable_encoder` first, which is what
  FastAPI's own default handler does. Would have affected any future
  custom validator that raises `ValueError`, not just this one.
- **Admin suspend/unsuspend** (finding #29, VERIFY) — confirmed a real
  (if low-stakes) issue: two concurrent suspend calls never corrupted
  `is_active` (naturally idempotent either way) but each wrote its own
  duplicate `audit_log` row. `AdminService.suspend_user`/`unsuspend_user`
  now short-circuit as a no-op if the user's already in the target state —
  a best-effort guard, not the full atomic-transition pattern
  booking/payment state changes use, since a duplicate audit row doesn't
  warrant that much machinery.

**Confirmed non-issues (verified, not fixed):**
- **Rate-limit counters being per-process** (finding #25) — confirmed
  with the project owner that the pilot deployment is single-worker, so
  the in-process `FixedWindowCounter` is correct as-is. **If this
  deployment ever moves to multiple worker processes, both the per-IP and
  per-user (chat) limiters need a shared store (Redis) — they will
  silently under-enforce their configured limits otherwise, each worker
  keeping its own separate count.**
- **Venue photos rendering at full resolution** (finding #28) — checked
  the actual mobile codebase rather than assuming the finding's premise:
  `photo_urls`/`venue.photos` is not referenced anywhere in
  `apps/mobile` as of 2026-09-19 — there is no venue-photo rendering in
  the player app at all yet, so there's nothing that could have this
  resolution problem. Re-check this once photo rendering actually ships.

**Client-side reliability, `court-booking-frontend`:**
- **No request timeout anywhere** (finding #18) —
  `packages/api-client/src/client.ts`'s `request()`/`requestText()` now
  wrap every `fetch()` in a 30s `AbortController` timeout
  (`fetchWithTimeout`); `requestUpload()` (the `XMLHttpRequest`-based
  payment-proof upload — `fetch` has no reliable cross-platform upload-
  progress event, see the existing comment there) sets `xhr.timeout` to
  45s. Both reject with a distinct `ApiError(code: "REQUEST_TIMEOUT")`
  instead of hanging indefinitely. Live-verified (not just typechecked):
  a request to a deliberately-stalled local server rejected cleanly at
  ~30s with that exact code.
- **Polling doesn't pause when backgrounded** (finding #19) —
  `apps/mobile/lib/query-client.ts` now wires TanStack Query's
  `focusManager` to React Native's `AppState` (the standard integration
  pattern; this isn't automatic on React Native the way it is on web).
  **Not verified on a real device/emulator** — none was available in this
  environment; the wiring is code-reviewed and typechecks, but confirm by
  backgrounding the app and watching network activity stop before
  trusting it fully.
- **In-app support channel** (finding #22) — a static "Need help? WhatsApp
  us" link now exists on the highest-stakes screen (payment/pay) on both
  mobile and web, plus the player profile (mobile) and owner sidebar
  (web). `SUPPORT_WHATSAPP_NUMBER` in each app's `lib/support.ts` is a
  **placeholder** (`+923000000000`) — replace with the pilot's real
  support number before launch. Routes through the same WhatsApp number
  already used for OTP/chat/notifications, so it lands in the existing
  inbound-message pipeline (`app/api/webhooks.py`) with no new backend
  support system needed.

**Docs:** `RUNBOOK.md` (new) covers the three most likely real incidents
— a stuck payment, an AI provider outage (with the `AI_VISION_PROVIDER`
failover and kill-switch steps), and a missed scheduled-job run (now has
a real `scripts/run_expiry_job.py` CLI wrapper, since none existed
before). Local Setup and Running Tests above now document the LocalStack
bucket-creation step and the `AI_PROVIDER=claude` test-run note that
previously lived only in `CLAUDE.md`. **Backups (finding #20) remain
undocumented on purpose** — no managed Postgres provider had been chosen
for the pilot as of this writing; see the Deployment section's "Backups"
subsection for what's still needed once one is picked.

## Post-audit fixes (Section 29)

Four fixes from a follow-up "Full Feature & Flow Audit" (a separate, deeper pass than
`AUDIT_FINDINGS.md`, covering every screen's actual UI quality, not just security/data-integrity),
landed 2026-09-20. Tier 1 (must-fix) only — see the frontend `CLAUDE.md` for the same work's
frontend half.

**Part A — the `isLoading` bug (root cause, fixed once).** `useOwnerVenues()`'s own `isLoading`
was already correct (true while the owner's venues are being fetched) but nothing consumed it —
every dependent screen (Today, Approvals, Ledger, Growth, both platforms) ran its own query as
`enabled: !!activeVenueId`, and a *disabled* TanStack Query v5 query reports `isLoading: false`
(`isPending && isFetching` — `isFetching` is false while disabled), not `true`, during the window
before `activeVenueId` resolves. A screen that only checked its own query's `isLoading` could
render its empty state during a genuine loading window — confirmed as the exact cause of
Approvals' false "nothing to review" flash. Fixed by combining `ownerVenues.isLoading` into each
screen's own loading check (`venuesLoading || query.isLoading`), consistently across all 8
screens; also gave `Approvals` an `enabled: !!activeVenueId` guard it never had (it fired once
unscoped across every venue the owner has, then again once scoped — a related bug found while
fixing this one). No dedicated test suite exists for either frontend app (see the frontend
CLAUDE.md's own gotcha on this) — verified by code review of the identical pattern across all 8
screens plus a live Playwright check of the wizard/court-creation half of this same pass.

**Part B — owner daily digest silently broke most mornings.** `digest_job.py` called
`whatsapp.send_text` directly, skipping the 24h-window check every other WhatsApp send in this
codebase goes through (`send_smart`), with no per-owner error isolation in its `for owner in
owners` loop. Since the digest is outbound-initiated (not a reply to anything), most owners
won't have an open window on a given morning — `send_text` → `_send`'s retry-then-raise then
propagates an uncaught exception that aborted the entire run, silently skipping every owner
after the first failure in that morning's iteration order. Never previously documented anywhere.
Fixed with a new `NotificationService.notify_owner_daily_digest` (routes through `send_smart`,
logs to `notification_log` like every other send) and a try/except around each owner's send
inside the job, logging `digest_job.owner_failed` per failure and returning
`{"sent": N, "failed": [owner_id, ...]}` instead of a bare count. `tests/test_jobs.py::test_digest_job_one_owner_failure_does_not_block_others`
— confirmed this test fails against the pre-fix code (temporarily reverted the try/except to
verify, then restored) before trusting it as a real regression guard.

**Part C — a real per-venue cancellation policy, not just a UI fix.** The audit found a paid
(`booked`) booking had no cancel action anywhere in either frontend, even though the backend's
refund-dispute path for it already existed. Rather than a flat global rule, this shipped as a
genuine per-**court** policy (matching where `schedule_templates`/`pricing_rules` already live) —
a project-owner decision, not something picked unilaterally:
- `courts.cancellation_allowed` (bool, default `true`) and `courts.cancellation_cutoff_hours`
  (nullable int, default `NULL` = no cutoff) — migration `19cf7e553535`, additive/nullable, so
  every existing court keeps today's de facto unrestricted behavior until an owner opts into a
  stricter policy. `tests/test_payments.py::test_existing_courts_default_to_unrestricted_cancellation`
  exercises this via a raw Core insert (bypassing the ORM's Python-side default) to specifically
  test the migration's *server* default — what actually backfills a pre-existing production row.
- Enforced in `BookingService._enforce_cancellation_policy`, called from `cancel_booking` only
  when `cancelled_by == PLAYER` and the booking is currently `BOOKED` — a plain pre-check, not
  the atomic-transition pattern used elsewhere in this file, since this is a business-rule gate
  (nothing bad happens if the policy changes between the check and the commit), not a
  concurrency-integrity concern like payment approval races are.
- Two new error codes: `CANCELLATION_NOT_ALLOWED` (court disallows it outright) and
  `CANCELLATION_WINDOW_CLOSED` (allowed, but too close to start — the message and `details`
  include the actual cutoff timestamp, not just a generic 400).
- `POST /venues/{id}/courts` and `PATCH /courts/{id}` both accept the two new fields (the PATCH
  path needed no code change — it already applies `payload.model_dump(exclude_unset=True)`
  generically); `CourtOut` returns them so the frontend can render the policy before a player
  pays.
- `tests/test_payments.py::test_cancel_blocked_when_venue_disallows_cancellation`,
  `test_cancel_blocked_within_cutoff_window`, `test_cancel_succeeds_outside_cutoff_window_and_creates_refund_record`
  — the two "blocked" tests use a `days_ahead=1` hold (tomorrow 10:00 UTC, so between ~10h and
  ~34h out depending on time of day) against cutoffs chosen to be deterministic either way (48h
  always inside the window, 2h always outside it) rather than freezing the clock.

**Part D — Terms of Service / Privacy Policy** — see the frontend CLAUDE.md; no backend changes
beyond what Part C's schema needed.

## Per-court cancellation policy in the owner UI (Section 31)

No backend change: the policy has been per **court** since Section 29 Part C, and
`_enforce_cancellation_policy` already judges each booking by its own court, so two courts at one
venue can differ (pinned by `test_two_courts_at_one_venue_enforce_cancellation_independently` and
`test_patching_one_courts_policy_leaves_sibling_court_alone` in `tests/test_payments.py`). What
changed is the owner UI, which used to set one shared value for every court in the venue-setup
wizard and had no cancellation controls after setup: each court now carries its own
Allowed / Not allowed + optional cutoff, in the wizard and on the Venue Settings screen (which
saves through `PATCH /courts/{id}`; send `cancellation_cutoff_hours: null` to clear a cutoff).
See the frontend `CLAUDE.md`'s Section 31, which also covers how the wizard now recovers when its
saved draft points at a venue that no longer exists.

## Local development extras

`app/seed.py` (`make seed`) creates a small idempotent demo dataset (one
admin/owner/player, one approved venue+court+schedule+pricing) for poking at
the API by hand — it looks each row up by its natural key (phone/slug) before
creating it, safe to run repeatedly. `docker-compose.yml` deliberately keeps
the **5433** host-port mapping from Section 1 (see "Port note" above) even
though Section 17's own compose example uses 5432 directly — that remap
exists specifically to dodge a native local Postgres install, a real
constraint this environment has that the spec's generic example doesn't
account for, so a section arriving later doesn't get to silently reopen an
already-solved problem.

## Deployment

`Dockerfile` builds on `python:3.12-slim` regardless of the local dev Python
version. `docker-compose.yml` is for local dev only (Postgres/PostGIS +
LocalStack for S3). The pilot runs on AWS `ap-south-1`, defined entirely in
Terraform under `../infra/` -- **see `../infra/README.md` for the layout, the
`terraform apply` steps, how to connect (SSM Session Manager, no SSH), and how
the jobs are scheduled.** In short: one `t3.micro` (host nginx + the backend and
web containers pulled from ECR), RDS Postgres 16 in private subnets, a
KMS-encrypted private payment-proofs bucket, venue photos behind CloudFront, and
background jobs from the instance's cron (`python -m app.jobs.runner <job>`).

**The URLs are `sslip.io` hostnames -- a deliberate placeholder for a real
domain, not a mistake.** For Elastic IP `A.B.C.D`: web is
`https://A.B.C.D.sslip.io`, API is `https://api.A.B.C.D.sslip.io`. Moving to a
purchased domain later is small and contained (point A records at the same
Elastic IP, re-run Certbot, update `server_name`/`ALLOWED_ORIGINS`/`apiBaseUrl`)
-- not a redeploy. Full steps are in `../infra/README.md`.

### Backups (finding #20 / D.1 -- resolved: RDS)

RDS Postgres, **1-day** automated backups with point-in-time restore (the AWS Free
plan caps retention there -- see RUNBOOK.md for what that means), final
snapshot on delete, deletion protection on. The settings, the restore command,
and the still-open **dry-run-restore checklist item** are in `RUNBOOK.md`'s
"Database backup / restore (RDS)" section. The dry-run restore has not been done
yet -- an unrestored backup is unverified.
