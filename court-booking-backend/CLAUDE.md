# CLAUDE.md

Project context for future Claude Code sessions working on this repo. README.md
describes the system as it stands today (routes, data model, design rationale).
This file is different: it's the build history and the working conventions —
read it to pick up where things left off and to work the way this project has
been worked so far.

## What this is

A FastAPI backend for a court-booking platform (padel/futsal/etc.), built
section-by-section from a written specification the user feeds in over the
course of a session, one or two sections at a time. Sections delivered so far:

1. Project setup (structure, dependencies, config pattern)
2. Database schema (raw SQL → SQLAlchemy models, with `one_live_booking_per_slot`
   called out as the single most important line of code in the schema)
3. Authentication (phone + OTP, no passwords)
4. Venue & court management
5. Availability engine (on-read slot generation)
6. Booking service (hold → payment_submitted → booked state machine)
7. Payment verification (OCR + perceptual-hash duplicate detection)
8. Notification service (3-tier push/WhatsApp/marketing, escalation ladder)
9. WhatsApp channel adapter (webhook, templates, 24h window)
10. AI chat service (Claude tool-calling, no direct DB access)
11. Waitlist service (FIFO, single-notify)
12. Owner dashboard API (today/pending-approvals/ledger/growth)
13. Background jobs / expiry engine (`run_expiry_job` cron entrypoint)
14. Growth engine (nightly `slot_stats` materialization — guardrail moved
    here from the Section 12 endpoint, see the gotcha below)
15. Admin endpoints (dashboard, bookings/users listing, disputes, suspend)
16. Health & infrastructure (`/health/ready`, error-code envelope, request-id/
    rate-limit/logging middleware)
17. Docker & local dev (Makefile targets, `app/seed.py`)
21. Multi-provider AI configuration (Claude/Gemini/OpenAI behind one
    `AIProvider` interface, `app/services/ai/`; sections 18-20 were not
    delivered as backend spec sections -- 21 followed 17 directly)
23. Pre-launch blocker fixes (2026-09-19): all 9 🔴 BLOCKER findings from a
    pre-launch audit (`AUDIT_FINDINGS.md`, dated 2026-09-09) -- WhatsApp
    webhook HMAC verification, an atomic-transition guard pattern now used
    on payment approve/reject and booking confirm/cancel/mark-submitted, a
    partial unique index stopping double payment-proof submission, a
    Pakistan-local-time conversion point for schedule hours (previously
    interpreted as UTC), a `payment_disputes` refund-queue table, caught
    OTP-send and vision-provider failures, async S3 calls, and a
    fail-loudly guard on the bank-details encryption key. See README.md's
    "Pre-launch hardening (Section 23)" for the full per-finding writeup --
    this file only tracks what was genuinely surprising while doing it
    (below).
24. Pre-launch hardening, IMPORTANT/VERIFY tier (2026-09-19, same session):
    the remaining findings from the same audit -- CORS wildcard startup
    guard, per-user chat rate limit, pixel-bomb upload protection, AI
    chat/auto-approve kill switches, reused-`ocr_ref` duplicate detection,
    two reused `payment_disputes` entries (voluntary paid-booking
    cancellation, passive-owner-inaction venue signal), a waitlist
    redesign (notifies everyone, reserves nothing -- a deliberate product
    decision, not a bug fix), a second player-self-checkin path via a
    per-venue QR token (also a deliberate product decision), court
    deactivation now notifying affected players, client-side request
    timeouts and AppState-aware polling on the frontend, a static in-app
    WhatsApp support link, `RUNBOOK.md`, and a `scripts/run_expiry_job.py`
    CLI wrapper that didn't exist before. Two findings were confirmed as
    non-issues and deliberately NOT fixed -- see the gotchas below. See
    README.md's "Pre-launch hardening (Section 24)" for the full
    per-finding writeup.

All delivered sections are implemented, tested against a real
Postgres/PostGIS instance, and documented in README.md. Current state: 267
tests passing, 76 routes, 19 tables, no Alembic drift. Run the suite with
`AI_PROVIDER=claude AI_VISION_PROVIDER=claude` if your local `.env`
overrides either to `gemini` for manual testing — otherwise several
AI-chat/OCR tests spuriously fail (they mock Claude-specific code paths
that the Gemini provider never touches), which looks like a real failure
count but isn't.

## How this project gets worked

This is the established loop for every section, and it should continue this
way for any new section:

1. **Read the new spec text carefully**, including exact endpoint contracts,
   request/response shapes, and the "how to test" list at the end of each
   section — that list is usually the actual acceptance criteria.
2. **Reconcile against what's already built.** Later sections routinely
   reveal that an earlier ad-hoc implementation doesn't match the real
   contract (e.g. Section 11 revealed the waitlist's `GET /waitlist` should
   have been `/waitlist/mine`, and `POST /waitlist` should return
   `{"position": N}` instead of the full entity). When this happens, fix the
   earlier work — don't leave two inconsistent versions around, and don't
   silently keep the old contract "for compatibility" unless the user asks.
3. **Implement fully**: models → migration → services → schemas → API
   routes → tests. Don't stub anything.
4. **Test against a real database**, not mocks — see `tests/conftest.py`,
   which spins up `court_booking_test` on the same Postgres instance as
   `DATABASE_URL`. This matters specifically because several guarantees in
   this codebase (double-booking prevention, waitlist dedup, message dedup)
   are enforced by real Postgres partial-unique-index behavior that an
   in-process fake cannot reproduce.
5. **Generate and apply the Alembic migration**, then run `alembic check` to
   confirm no drift before calling a section done.
6. **Run the full test suite**, not just the new section's file — changes
   routinely touch shared services (`notification_service.py`,
   `booking_service.py`) that other sections' tests exercise.
7. **Live smoke-test**: boot with `uvicorn`, hit `/health` and the new
   endpoints for real, confirm the log trace looks right, then stop the
   server.
8. **Update README.md**: bump the route count, add new endpoints to the API
   surface table, bump the test count/file list, and add a "Key design
   notes" bullet for any non-obvious decision the new section required.

Work through this autonomously and report a concise summary at the end (what
changed, what's tested, what earlier assumptions got corrected) — no need to
ask for permission at each step within a section.

## Architectural conventions established so far

These recur constantly and should be followed for new sections unless the
spec explicitly calls for something else:

- **Correctness lives in the database, not the application.** Anything that
  looks like "check if X exists, then insert" is a race condition waiting to
  happen — model it as a partial unique index instead and let the insert
  fail with `IntegrityError`, which the service layer translates into the
  right HTTP status. Three examples already in the codebase:
  `one_live_booking_per_slot` (bookings), `unique_active_waitlist`
  (waitlist), `uq_messages_whatsapp_msg_id` (WhatsApp delivery dedup).
- **On-read generation over stored derived state.** Availability slots
  aren't rows; they're computed from `schedule_templates` + `pricing_rules`
  + live bookings at request time. Escalation timing is computed from
  `payment_deadline - PAYMENT_REVIEW_HOURS`, not a stored "sent at" column.
  The WhatsApp 24h window is computed live from `messages`, not a stored
  expiry timestamp. Prefer this pattern over caching/materializing unless
  there's a specific performance reason not to (see `slot_stats`, which
  *is* intentionally materialized nightly for the admin dashboard's trend
  charts — the one deliberate exception, and it's documented as such).
- **Postgres ENUM columns serialize by `.value`, not `.name`.** Use the
  `pg_enum()` helper in `app/models/mixins.py` for every enum column.
- **Every `default=` needs a matching `server_default=`** so raw SQL or
  non-ORM inserts still get correct behavior.
- **GeoAlchemy2 manages its own GIST index** via DDL event listeners — don't
  add an explicit `Index()` on a `Geometry` column, and check
  `alembic revision --autogenerate` output for a spurious duplicate index
  operation on `venues.location` before applying.
- **AI has no direct database access.** Every tool the AI chat service can
  call goes through the same service-layer methods the HTTP API uses,
  scoped to the real requesting user — authorization is inherited, not
  reimplemented. There is deliberately no `approve_payment`/`reject_payment`
  tool. Keep this invariant for any new AI-callable tool.
- **`messages.sender_id` means "thread owner," not literal sender**, for
  `sender_type in ("ai", "system")` rows. This is what makes conversation
  history reconstructable with a single `WHERE sender_id = :user_id` query.
- Background jobs build their own DB session (`AsyncSessionLocal`) by
  default but accept a `session_factory` override for testability — follow
  this signature for any new job function.
- Every job step must be **independently idempotent** — a late or repeated
  cron run should never double-notify or error on an already-processed row.
- **Errors carry a machine-readable code, not just an HTTP status.** Every
  response uses the `{"error": {"code", "message", "details"}}` envelope
  (`app/errors.py`, `main.py`'s exception handlers). When a new raise site
  maps onto one of `ErrorCode`'s named constants, raise `AppError` instead
  of a plain `HTTPException`; a plain `HTTPException` still works and gets
  a generic code derived from its status, so this is additive, not a
  requirement to touch every existing raise site.
- **No vendor SDK is a project dependency, not even lazily.** All three AI
  providers (`app/services/ai/*_provider.py`) speak REST directly via
  `httpx`. If a future provider genuinely needs its SDK (some auth flows
  aren't crackable via plain REST), import it inside that one provider
  module's methods, never at module scope, so a Claude-only deployment
  still doesn't need it installed. This mirrors the WhatsApp adapter
  (Section 9), which also speaks Meta's REST API directly rather than
  pulling in a WhatsApp SDK.
- **A "pure refactor" milestone means byte-for-byte, verified by the
  existing test suite passing unchanged where behavior didn't move.**
  When code relocates behind a new interface (Section 21 moving Claude's
  HTTP calls into `ClaudeProvider`), get that specific migration green
  before adding anything new (Gemini/OpenAI) — if something breaks then,
  it's unambiguously the abstraction's fault, not a new provider's.
  Tests whose *names* moved with the code (e.g. `test_ocr.py`'s "no API
  key" case, now one layer up in `PaymentService` since providers assume
  they're already configured) are expected to change; tests whose
  *behavior* they verify is unchanged should not have their assertions
  altered, just their target.

## Dev commands

```bash
# from court-booking-backend/
docker compose up -d db                    # Postgres+PostGIS on host port 5433
alembic upgrade head
uvicorn app.main:app --reload
pytest -v --tb=short                       # full suite, real Postgres required
alembic check                              # verify no migration drift
alembic revision --autogenerate -m "..."   # new migration (check the two PostGIS gotchas in README first)
```

Windows note: this environment runs Git Bash for the `Bash` tool and
PowerShell 5.1 for the `PowerShell` tool — `.venv/Scripts/python.exe`, not
`.venv/bin/python`. The native Postgres service already owns port 5432
locally, hence the 5433 remap in `docker-compose.yml`.

## Deployment pipeline (2026-09-19, Part 0)

This project's actual **git repository lives one level up**, at the repo
root (`../`), as a single monorepo covering both `court-booking-backend/`
and `court-booking-frontend/` — not two separate repos. It didn't exist as
a git repo at all until this pass (see that root's own history for the
"apps/mobile was a broken gitlink" fix, a real bug worth knowing about if
you ever see `apps/mobile` looking empty after a clone). GitHub:
`AbdulRafay272022/court-booking-app`, private.

This backend's own `Dockerfile` is now actively used by CI (previously
only exercised locally via `docker compose up`) — `../.github/workflows/deploy.yml`
builds it on every push to `main`, pushes to ECR
(`court-booking-app-backend`, account `959666773387`, region
`ap-south-1`), and — once an EC2 instance and its deploy secrets exist (a
later part; provisioned in Section 25, see `../infra/README.md`) pulls and
restarts it there via `../docker-compose.prod.yml`, over SSM Run Command
(no SSH). Nothing about the Dockerfile
itself needed to change for this; it already builds cleanly standalone
(`docker build .` from this directory), confirmed directly rather than
assumed.

**`.env.example` is now also the reference for what the EC2 instance's
real `.env` needs to contain** (that file lives only on the instance
itself once it exists, `docker-compose.prod.yml`'s `env_file: .env` —
never committed). Any new required setting added to `config.py` should
keep `.env.example` current for exactly this reason, not just for local
dev onboarding.

See `../infra/README.md` and `../court-booking-frontend/CLAUDE.md`'s
matching section for the rest of the pipeline (ECR/OIDC Terraform, the
web image, what's deferred to later parts).

## Known gotchas worth remembering

- **Grid-alignment enforcement on `create_hold`
  (`AvailabilityService.is_slot_grid_aligned`, `INVALID_SLOT_TIME`) landed at
  some point without every test file's hold-helper being updated to open a
  `schedule_template` first.** Found during a pre-production concurrency
  audit: `test_concurrency.py`, `test_payments.py`, `test_marketing.py`,
  `test_ai_chat.py`, `test_users.py`, `test_waitlist.py`, and
  `test_webhooks.py` all had at least one test calling `POST /bookings/hold`
  (directly or via `create_hold`) against a court with no active schedule
  for that day, so every attempt 400'd with `INVALID_SLOT_TIME` instead of
  exercising what the test actually wanted to check (409 conflicts, OCR
  verdicts, marketing caps, etc.) — masked because those assertions failed
  on unrelated symptoms (`KeyError: 'booking'`, empty listings) rather than
  visibly on the 400. Fixed by adding `make_schedule` calls (mirroring
  `test_bookings.py`'s `_open_all_week` helper) to each. If a new test file
  holds a booking, always open a wide schedule_template first — `make_court`
  does not create one by default.
- **`.env.example` had a real-looking `GEMINI_API_KEY` value committed to
  it** (found during Section 21) — blanked out to match every other secret
  in that file. `.env.example` must only ever hold placeholders; a real
  value belongs in `.env` alone (gitignored, though this project isn't
  even a git repo yet, so there was no actual leak via history — still
  worth rotating that key if it was ever used/shared anywhere). Check any
  file meant to be shared/committed for this before editing it further.
  Update: the real `GEMINI_API_KEY` sitting in `.env` (same key this
  gotcha already flagged) was actually exercised against the live API
  during Part B.1's manual provider verification (2026-09-07, user
  approved) — rotating it is more clearly warranted now than "if it was
  ever used," since it now definitely has been, by this project.
  Update 2026-09-20: the project owner rotated the key and the new one is in
  production SSM (Section 25, item 13). Whether the local dev `.env` was
  updated to match wasn't checked -- if local Gemini calls start 401/403ing,
  that's the first place to look.
- **`tests/test_gemini.py` was not a real test** — module-level script code
  (no test functions) using the real `google-genai` SDK (installed,
  contradicting this project's own "no vendor SDK dependency" rule) to
  fire 5 live Gemini calls against the real `GEMINI_API_KEY` in `.env` as
  a side effect of pytest merely *collecting* the test suite — every
  `pytest` run, full-suite or not, was silently spending real API
  quota/cost on this, discovered while investigating pro-tier 429s during
  Part B.1. Moved to `scripts/gemini_intent_extraction_experiment.py`
  (user's call, 2026-09-07) so pytest collection no longer touches it —
  confirmed `pytest --collect-only` dropped from ~5s to 0.17s after the
  move. If a new exploratory script needs a real API key, keep it out of
  `tests/` from the start; anything matching `test_*.py` there gets
  imported (and its top-level code executed) on every single test run,
  not just when explicitly invoked.
- **Gemini's model catalog churns fast and `/v1beta/models` listing a
  model doesn't mean `generateContent` will accept it** — Part B.1's live
  verification (2026-09-07) found `gemini-2.0-flash`/`-pro` (this
  project's original defaults) AND `gemini-2.5-flash`/`-pro` (a first
  attempted fix) both dead ("no longer available to new users"), despite
  2.5-flash/-pro still appearing in the models list. `gemini-3.6-flash`
  was confirmed live that day and used briefly as the chat-tier default;
  on 2026-09-08 it was swapped for **`gemini-3.5-flash-lite`** (the
  current `GEMINI_FLASH_MODEL` default) after separately live-verifying
  *that* model too — basic chat, tool-calling, and the thoughtSignature
  round-trip (below) all confirmed working on it directly, not assumed
  from the 3.6-flash result. `GEMINI_PRO_MODEL` (vision) is
  `gemini-pro-latest`, confirmed to exist but this test key's plan hits
  429 quota limits on every "pro" model tried — a billing constraint, not
  a code bug. **Every one of these model names needs re-verifying with a
  real key before being trusted again** — this file has already had to
  correct itself twice in two days. See `gemini_provider.py`'s module
  docstring for the full list of what else Part B.1 found (missing
  `candidatesTokenCount` on thinking-model replies, and a `thoughtSignature`
  round-trip requirement that broke every multi-turn tool-calling
  conversation until fixed via `ToolCall.provider_data` — confirmed
  present on flash-lite too, not just 3.6-flash).
  Note: local `.env` currently has `GEMINI_PRO_MODEL=gemini-3.5-flash-lite`
  too (diverging from `config.py`'s checked-in `gemini-pro-latest`
  default) — that happened outside this instruction's explicit scope
  (only the chat tier was asked to change) and wasn't reverted per the
  "don't undo a deliberate-looking change yourself" rule, but it does
  mean vision/OCR is currently running on a "lite" model locally, which
  cuts against this codebase's own stated rationale ("vision quality
  matters more than latency" — see payment_service.py/README). Worth a
  deliberate decision, not a silent default.
- `notification_log.channel` is `VARCHAR(20)` — template names go in the
  separate `template_name` column, not crammed into `channel`. This was a
  real bug (`StringDataRightTruncationError`) caught and fixed during
  Section 9/10.
- Tests that assert on a WhatsApp "send" need to know whether they're inside
  or outside the 24h free-text window (determined by whether a recent
  inbound `Message` row exists for that user) — outside the window,
  `send_smart()` routes through a template, not free text, so mock
  `WhatsAppService._send` (the shared low-level method) rather than
  `send_text` if the test doesn't control that state.
- `GET /owners/growth`'s guardrail ("weeks of data" / "observations") is
  now enforced exactly once, at write time, in `growth_job.compute_slot_stats`
  (Section 14) — the endpoint itself just reads the latest `slot_stats`
  snapshot per bucket. This changed from Section 12's original design (the
  endpoint computed live, duplicating the guardrail math); if you touch
  either the job or the endpoint, keep the guardrail in the job only.
- A test that seeds a row in one `db_session_factory()` session and later
  needs to *mutate* an object obtained from a *different* session (e.g. a
  `User` fixture returned by `make_user`) must re-fetch it in the new
  session first (`await session.get(Model, obj.id)`) — mutating the
  detached object silently does nothing on that session's next commit. Hit
  in `tests/test_admin.py`'s dispute-seeding helper during Section 15.
- The two-guardrail data-sufficiency check (weeks-of-history AND minimum
  observation count) shows up in two places with the same structural
  tension: under (day_of_week, hour) bucketing, a single bucket can occur
  at most once per calendar week, so a short lookback window can satisfy
  a low weeks-minimum but can never reach a high observations-minimum.
  Section 12 and Section 14's specs both give illustrative test numbers
  (e.g. "8 weeks, 20 observations") that are mathematically incompatible
  under this bucketing — resolved both times by using a longer lookback
  (`GROWTH_LOOKBACK_DAYS`, 180 days) than the spec's pseudocode suggests,
  documented inline where the deviation happens.
- The AI providers weren't installed as real dependencies in this
  environment (no `anthropic`, `openai`, or `google-generativeai` package
  present) when Section 21 landed — turned out the pre-existing Claude
  code already spoke raw REST via `httpx`, never the SDK, so this wasn't a
  blocker; it's *why* all three new providers also speak REST instead of
  pulling in a vendor SDK. If a future section asks for actual SDK usage,
  check what's installed (`.venv/Scripts/python.exe -c "import X"`) before
  assuming a pseudocode import is already satisfied.
- **Local dev has no working S3 by default** — `docker-compose.yml` defines a
  `localstack` service, but it isn't started by `docker compose up -d db`
  alone, and `.env`'s `AWS_ACCESS_KEY_ID`/`AWS_ENDPOINT_URL` were blank, so
  `upload_private_proof`/`upload_public_photo` (payment-proof upload, venue
  photos) 500'd with `botocore.errorfactory.NoSuchBucket` against real AWS.
  Fixed 2026-09-08 (frontend session, Sprint 5 needed real payment-proof
  upload for the booking E2E test): `docker compose up -d localstack`, then
  `.env` needs `AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test` /
  `AWS_ENDPOINT_URL=http://localhost:4566`, then create the two buckets once
  (LocalStack has no persistence across `docker compose down -v` — see
  `.env.example`'s new comment for the one-line `aws s3 mb` commands). A
  restart of `uvicorn` is required after editing `.env` (settings are read at
  import time).
- Gemini/OpenAI's field names (`function_declarations` vs the REST API's
  `functionDeclarations`, `inline_data` vs `inlineData`) were chosen to
  match Section 21.5's own explicit test wording rather than verified
  against either live API (no real key for either in this environment) —
  flagged in the provider modules' docstrings. Verify against the current
  live REST docs before trusting `GeminiProvider` in production.
- **`GEMINI_PRO_MODEL` (vision/OCR) switched from `gemini-pro-latest` to
  `gemini-3.5-flash-lite` on 2026-09-19** (Section 23, finding #7) — same
  model already used for the chat tier since 2026-09-08. `gemini-pro-latest`
  hit 429 quota errors on every vision call tried under this project's
  key/plan, making the checked-in default unusable in practice, not just a
  style mismatch — a real payment-proof upload against it would always
  500 before this fix caught `httpx.HTTPError` at all. Live-verified
  specifically for vision (not assumed from the chat-tier check):
  `GeminiProvider.extract_payment_proof` against a synthetic PIL-rendered
  receipt image (`amount`, `reference`, `timestamp` all extracted
  correctly, `confidence=1.0`, no 429). Local `.env` already had this
  same override from an earlier session (see the entry below); `config.py`'s
  checked-in default now matches it, closing that drift. This reverses
  this codebase's own stated rationale ("vision quality matters more than
  latency") as a deliberate quality-for-availability tradeoff, not a
  silent regression — re-verify OCR quality against real, messy
  JazzCash/Easypaisa screenshots (not just a clean synthetic receipt)
  before trusting it at pilot scale.
- **The PKT-offset fix for schedule hours (finding #4) had to touch three
  places, not one** — found while fixing it: `AvailabilityService.get_day_slots`
  generates the slot grid (walks in naive PKT, converts to a UTC instant
  only when comparing against/returning real stored timestamps), but
  `pricing_rules.start_time`/`end_time` are *also* PKT wall-clock windows
  (an owner configures "peak pricing 5pm-11pm" meaning local hours, same
  convention as `schedule_templates`), and `price_for_range_with_advance`
  (called from `create_hold`/`create_walkin` with a real UTC booking time)
  was matching those PKT-defined rule windows against a UTC time before
  this fix -- correct by accident under the old bug (everything was
  uniformly mislabeled), but would have started mispricing bookings against
  time-restricted pricing rules (e.g. the weekend-peak rule) the moment the
  grid-generation bug alone got fixed without this. `growth_job.py`'s
  per-(day_of_week, hour) bucketing had the same latent issue for the same
  reason (an owner-facing "18:00 slot underbooked" suggestion would have
  silently become a "13:00" UTC bucket) -- fixed alongside, via the same
  `app/utils/timezone.py` helper (`pkt_time_to_utc`/`utc_to_pkt_naive`).
  If a future section adds another naive-local-time comparison against a
  real stored UTC timestamp, route it through that same module rather than
  a fresh `timedelta(hours=5)` inline.
- **This test harness's `asyncio.gather` scheduling has a strong, repeatable
  bias, not true 50/50 nondeterminism** — found while writing
  `test_concurrent_approve_reject_only_one_wins` and
  `test_concurrent_cancel_and_approve_only_one_wins` (Section 23, finding
  #2): racing two *different* endpoints (approve vs reject, cancel vs
  approve) against each other via `client.post(...)` + `asyncio.gather`
  against the ASGITransport-backed test client produces the same winner on
  the overwhelming majority of runs regardless of gather() argument order
  -- confirmed empirically (one direction won 24/25 and 25/25 runs across
  two separate test runs), unlike racing N *identical* requests (e.g.
  `test_fifty_concurrent_bookings_only_one_succeeds`), which has no such
  asymmetry to bias. Don't write a concurrency test that asserts "both
  orderings occur" for two *different* endpoints without verifying that
  empirically first -- it will flake or fail outright. Where the natural
  race doesn't cover a direction, test it deterministically instead
  (run one call fully to completion, then attempt the second, assert the
  specific conflict code) -- see the paired `test_reject_then_approve_gets_clean_conflict_error`
  / `test_cancel_after_approve_still_succeeds` tests next to the two race
  tests above.
- **Removing a Python-level pre-check can be the fix, not a regression** —
  `approve_payment`/`reject_payment` (Section 23, finding #2) used to open
  with `if booking.status != PAYMENT_SUBMITTED: raise HTTPException(400, ...)`
  before the real work. That check was itself the race: under genuine
  concurrency it returns a plain, generically-coded 400 for what is
  actually a conflict, *before* the atomic guard (`_claim_review`) ever
  gets a chance to run and produce the specific `PAYMENT_ALREADY_REVIEWED`/
  `BOOKING_ALREADY_CANCELLED` code — confirmed by a failing test
  (`unexpected status pair approve=200 reject=400`) the first time this
  fix landed. Deleting the pre-check entirely and relying solely on the
  atomic UPDATE's own WHERE clause fixed it, since that single code path
  now correctly covers both the non-concurrent "already actioned" case and
  the genuine race.
- **`upload_bytes`/`upload_public_photo`/`upload_private_proof`/
  `bucket_reachable` became `async def` on 2026-09-19** (Section 23,
  finding #8, `asyncio.to_thread` wrapping the actual boto3 call) — every
  call site needs `await` now, including in tests: a monkeypatched
  replacement for `upload_private_proof` must also be an `async def` (a
  plain `lambda *a, **k: "key"` will make the caller's `await` raise
  `TypeError: object str can't be used in 'await' expression`, not a
  quiet no-op). Hit across `test_concurrency.py`, `test_payments.py`, and
  `test_webhooks.py`'s `_mock_upload` helpers while making this change.
- **A bare `ValueError` raised from a Pydantic v2 field validator 500'd
  this project's custom `RequestValidationError` handler, discovered
  2026-09-19 while adding `BookingHoldIn`'s naive-datetime rejection
  (Section 24, finding #26)** — Pydantic packs the raised exception
  *instance* (not its string) into each error dict's `ctx.error`, and
  `main.py`'s handler was passing `exc.errors()` straight into
  `JSONResponse` without sanitizing it, so `json.dumps` choked with
  `TypeError: Object of type ValueError is not JSON serializable` instead
  of returning the clean 422 the handler exists for. Fixed by routing
  `exc.errors()` through `fastapi.encoders.jsonable_encoder` first (what
  FastAPI's own default handler does). No prior custom validator in this
  codebase happened to raise a bare `ValueError`, so this had never
  surfaced before — **any future field validator that does the same needs
  no special handling now, but keep this in mind if the handler in
  `main.py` is ever rewritten.**
- **Two Section 24 findings were confirmed and deliberately left unfixed
  — worth remembering so they aren't "rediscovered" as bugs later:**
  1. Finding #25 (per-process rate-limit counters): confirmed with the
     project owner (2026-09-19) that the pilot deployment is
     single-worker, so this is correct as-is. **If the deployment model
     ever changes to multiple worker processes, both `RateLimitMiddleware`
     and the chat rate limiter (`app.state.chat_rate_limiter`,
     `FixedWindowCounter`) need a shared store (Redis) — each worker
     currently keeps its own separate in-process count, which silently
     multiplies the effective limit by the worker count.**
  2. Finding #28 (venue photos rendering at full resolution): checked
     `apps/mobile` directly rather than trusting the finding's premise --
     `photo_urls`/`venue.photos` is not referenced anywhere in the mobile
     app as of 2026-09-19. There is no venue-photo rendering in the player
     app at all yet, so there's nothing that could have this problem.
     **Re-check this specific finding once venue-photo rendering actually
     ships on mobile** — the gap it describes could become real then.
- **The waitlist redesign and the self-checkin QR path (Section 24,
  findings #15 and #17) were both deliberate product decisions by the
  project owner, not judgment calls made unilaterally** — see README.md's
  "Pre-launch hardening (Section 24)" for what changed and why. Don't
  "fix" the waitlist back toward reserving a slot for the FIFO-first
  entry, or treat the self-checkin path as redundant with the owner-scan
  one, without checking whether that decision has actually changed.
- **Section 25 (AWS pilot deployment, 2026-09-19) -- Terraform applied, stack
  is live** (items 8-12 record the apply/deploy problems hit along the way;
  item 13 is the verified state as of 2026-09-20). Full layout in
  `../infra/README.md`. Things that were genuinely surprising, worth
  knowing before touching any of it:
  1. **No Alembic migration creates PostGIS.** Locally the
     `postgis/postgis:16-3.4` image pre-creates the extension, which hid
     this. On RDS, `alembic upgrade head` fails on the first geometry
     column unless `CREATE EXTENSION postgis` ran first --
     `infra/scripts/bootstrap.sh db-init` does it (RDS is only reachable
     from inside the VPC, so it can't be a Terraform step).
  2. **`reminder_job.send_booking_reminders` and
     `digest_job.send_owner_daily_digests` had no caller anywhere** --
     only `run_expiry_job` was ever documented as needing a scheduler, so
     the Section 25 spec listed just expiry + growth. Without a schedule,
     booking reminders and owner daily digests would silently never send.
     All four jobs are now cron'd via the new `app/jobs/runner.py`
     (`python -m app.jobs.runner expiry|reminders|digest|growth`).
     `runner.py` lives in `app/` on purpose: the Docker image copies only
     `app/`, `alembic/`, `alembic.ini` -- `scripts/run_expiry_job.py` is not
     in the image and can't be `docker exec`'d.
  3. **Lambda + EventBridge (the spec's design) needed a ~$35/mo NAT
     Gateway**: a Lambda attached to a VPC subnet has no internet, and the
     expiry job sends WhatsApp notifications. Jobs run from the app
     instance's cron instead (user's call). If jobs ever move to Lambda,
     budget the NAT (or accept jobs that can't notify).
  4. **Every API route except `/health*` is mounted under `/api/v1`**, so
     the WhatsApp webhook URL is
     `https://api.<host>/api/v1/webhooks/whatsapp` -- the spec's
     `/webhooks/whatsapp` would 404. (`apiBaseUrl` stays origin-only; the
     api-client adds `/api/v1` itself.)
  5. **Auth to AWS on the instance is the IAM role, not keys**: `_client()`
     in `app/utils/s3.py` only passes explicit credentials when
     `AWS_ACCESS_KEY_ID` is set, so the production `.env` deliberately
     leaves it (and `AWS_ENDPOINT_URL`) blank. The instance metadata hop
     limit is 2 so the containers can reach the role's credentials.
  6. **The RDS password is generated by Terraform (`random_password`) and
     lands in local `terraform.tfstate`** -- deliberately not
     `manage_master_user_password`, whose 7-day automatic rotation would
     silently break the `DATABASE_URL` in the instance's `.env`.
  7. **Not verified until `apply` runs**: SSM agent presence on the
     Ubuntu 24.04 AMI (user-data installs the snap if missing), the
     `?ssl=require` DATABASE_URL against RDS's forced-SSL default, Let's
     Encrypt against `sslip.io` (shared per-domain rate limits are a real
     risk), and the whole bootstrap/deploy sequence. Everything above was
     validated with `terraform validate`/`plan`, `bash -n`, and a YAML
     parse only.
  8. **This AWS account is on the Free plan, which restricts RDS at
     `CreateDBInstance` (`FreeTierRestrictionError`)** -- the first apply
     created 43/45 resources and then failed on RDS because
     `backup_retention_period = 7` exceeded the plan's cap. Backup retention
     is therefore **1 day** (`db_backup_retention_days` in
     `infra/variables.tf`), the user's call over upgrading the plan. That is
     a real limit on recoverability, not a formality -- see RUNBOOK.md's
     backup section for the consequence and how to raise it later (in-place
     change, no rebuild). Watch for other Free-plan restrictions the same
     way if RDS settings change. Also: RDS `engine_version = "16"` resolved
     to 16.13 with PostGIS 3.4.6, matching the local 16-3.4 image.
  9. **GitHub's OIDC `sub` claim now embeds immutable numeric IDs**, so the
     Part 0 trust policy (`repo:<owner>/<repo>:*`) silently never matched:
     the token actually says
     `repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:refs/heads/main`, and the
     `@<id>` segments defeat the wildcard. Every deploy failed at
     `AssumeRoleWithWebIdentity` with a generic "Not authorized" that gives
     no hint about the mismatch. Found 2026-09-19 by reading the real `sub`
     out of the failed CloudTrail events (`aws cloudtrail lookup-events
     --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity`
     -- `userIdentity.userName` is the sub) instead of guessing. The role is
     now pinned to `github_owner_id`/`github_repo_id` in `infra/variables.tf`.
     Note AWS returns the *same* "Not authorized" message when the role ARN
     itself doesn't exist, so a wrong `AWS_ROLE_ARN` Actions variable looks
     identical -- check the variable's exact value if this error ever comes
     back with the trust policy verified. (Thumbprints are irrelevant here:
     AWS stopped validating them for GitHub's provider in 2023.)
  10. **SSM `AWS-RunShellScript` runs commands with `/bin/sh` (dash on
      Ubuntu), never bash -- regardless of any `#!/bin/bash` in the
      payload** (and mid-file that shebang is only a comment anyway). The
      first real CI deploy died on `set: Illegal option -o pipefail`. Fixed at
      the invocation point in `.github/workflows/deploy.yml`, not by weakening
      the script: the assembled script is shipped as base64, written to a temp
      file on the instance, and run with `bash "$f"`. (A file rather than
      `bash -s` so a command that reads stdin can't swallow the script.) Any
      future SSM command with bashisms (`pipefail`, `[[ ]]`, arrays) needs the
      same treatment. Verified 2026-09-19 by running the identical wrapper
      through the real SSM document against the instance: the old form
      reproduced CI's error byte for byte; the wrapper ran under bash 5.2.21.
  11. **`/health/ready` reports `s3: "not_configured"` in production even
      though S3 works**: `_check_s3` in `app/api/health.py` returns
      `not_configured` whenever `AWS_ACCESS_KEY_ID` is empty, but production
      deliberately leaves the keys blank and uses the EC2 instance role. So
      readiness gives no S3 signal here. Confirmed reachable by calling the
      app's own `bucket_reachable()` for both buckets from inside the
      container (both True). Not changed (tests may depend on the current
      behavior) -- if you want readiness to actually cover S3 in prod, key the
      check on the bucket settings instead of the access key.
  12. **Cron starts firing at first boot, before any container exists**, so
      `/var/log/court-booking-jobs.log` opens with a wall of `No such
      container` (and a few `UndefinedTable` between deploy and `migrate`).
      Expected, not a bug; judge the jobs by the most recent
      `jobs.runner.completed` lines.
  13. **Production state as of 2026-09-20** (verified that day, not assumed):
      - SSM `/court-booking-app/secrets/` holds the three generated values
        plus `GEMINI_API_KEY` (rotated by the project owner),
        `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and
        `WHATSAPP_APP_SECRET`. **`ANTHROPIC_API_KEY` is blank on purpose**,
        so `bootstrap.sh env` picks Gemini: inside the running container
        `AI_PROVIDER` and `AI_VISION_PROVIDER` are both `gemini`. `OPENAI_API_KEY`
        and `SENTRY_DSN` are not in SSM either, so **Sentry is still off**
        (the code is wired; the DSN was never provided).
      - `/health` and `/health/ready` both return 200 over the public
        `https://api.<elastic-ip>.sslip.io`, i.e. nginx + the Let's Encrypt cert
        work on sslip.io. `/health/ready` shows `whatsapp: ok`, which only
        means the token and phone-number ID are configured, not that Meta
        accepts them. `s3: not_configured` is the known item 11 quirk.
      - With `WHATSAPP_APP_SECRET` set, `POST /webhooks/whatsapp` now
        enforces `X-Hub-Signature-256` for real (Section 23, finding #1).
      - **Still pending, all outside the code:** registering the webhook with
        Meta (the project owner does this themselves and holds the verify
        token; don't print or ask for it), Meta Business Verification (which
        Authentication templates require), creating the WhatsApp
        Authentication message template, and adding a payment method to the
        WhatsApp Business account. **Until then OTP delivery only works
        through the temporary free-form send described in the gotcha at the
        end of this file -- and fails (`OTP_DELIVERY_FAILED`) for anyone who
        hasn't messaged the business number in the last 24h. Expected, not
        a new bug; don't chase it as an error.**
  14. **Changing a secret after first deploy** (done for real on 2026-09-20):
      put the value in SSM, re-run `bootstrap.sh env`, then **recreate** the
      container -- `docker compose -f docker-compose.prod.yml up -d
      --force-recreate backend`. A plain `restart` keeps the old environment
      because `env_file` is read when the container is created. Run by hand
      (not through `remote-deploy.sh`), that compose command needs
      `ECR_REGISTRY` (`<account>.dkr.ecr.ap-south-1.amazonaws.com`) and
      `IMAGE_TAG` exported first or the image reference doesn't resolve. `env`
      rewrites the whole `.env`, so a hand edit made on the instance is
      silently lost on the next run (the generated secrets are safe: they use
      `--no-overwrite`). To run this from a laptop, send it through SSM Run
      Command as a base64-wrapped script executed with `bash` (same reason as
      item 10) and pass the payload as `--parameters file://params.json`;
      inline JSON quoting is not worth the pain.
  15. **Operator-machine traps when driving AWS from here** (Windows + Git
      Bash): (a) Git Bash rewrites an argument that starts with `/` into a
      Windows path, so `--name /court-booking-app/...` fails validation --
      prefix the command with `MSYS_NO_PATHCONV=1`; (b) the AWS CLI default
      region on this machine is **us-east-1**, not `ap-south-1`, so every
      command needs an explicit `--region ap-south-1` (a `put-parameter`
      without it lands in the wrong region and looks like the secret is
      missing -- on 2026-09-20 the four secrets first appeared absent, then
      present; the cause wasn't established); (c) `gh` isn't installed here, so
      GitHub Actions variables can't be listed from this machine. **Working
      rule for Claude sessions: confirm a secret exists with
      `ssm describe-parameters` (names and dates only) and confirm the app
      loaded it with a set/empty check inside the container -- never print a
      secret's value.**
- **TEMPORARY: OTP is sent as free-form WhatsApp text, not the
  Authentication template (2026-09-20) -- revert once a template is
  approved.** Authentication templates need Meta Business Verification,
  which isn't done. `WhatsAppService.send_otp` (`app/services/whatsapp_service.py`)
  now sends `type: "text"` ("<code> is your verification code. For your
  security, do not share this code. It expires in N minutes.", N from
  `OTP_EXPIRE_MINUTES`) via `send_text`. Nothing in `AuthService.request_otp`
  changed -- generation, hashing, expiry and rate limiting are as before; only
  the delivery call is different.
  - **The catch:** free text is delivered only inside the recipient's open
    24h customer-service window, i.e. they must already have messaged the
    business number. Otherwise Meta answers HTTP 400 / error `131047`. For
    now testers open the window by hand; there is deliberately no app-side
    "message us first" flow. Real users who haven't will not get a code.
  - **Failure path (confirmed by test, no new handling added):** the 400
    makes `_send`'s `raise_for_status` raise `HTTPStatusError`; tenacity
    retries it 3x (~3s of backoff, three calls to Meta -- a 400 like this is
    deterministic, so the retries are wasted, but that's existing `_send`
    behavior and was left alone) and re-raises `RetryError`.
    `request_otp`'s `except Exception` (broader than `httpx.HTTPError`)
    catches it, deletes the OTP row so it doesn't burn a rate-limit slot, and
    returns 502 `OTP_DELIVERY_FAILED` -- never a raw 500. See
    `tests/test_auth.py::test_otp_send_uses_freeform_text_not_template` and
    `::test_otp_send_with_no_open_window_fails_cleanly` (the latter mocks a
    131047 response at the httpx layer so the real retry path runs).
  - **To revert:** in `send_otp`, replace the body with
    `return await self.send_registered_template(to_phone_number, "whatsapp_otp", [code])`
    (the `whatsapp_otp` entry is still in `whatsapp_templates.py`, untouched),
    delete the two tests above (they assert the temporary behavior), and
    remove this note plus the matching README/`infra/README.md` lines.

