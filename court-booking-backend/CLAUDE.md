# CLAUDE.md

Project context for future Claude Code sessions working on this repo. README.md
describes the system as it stands today (routes, data model, design rationale).
This file is different: it's the build history and the working conventions —
read it to pick up where things left off and to work the way this project has
been worked so far.

## START HERE -- handoff as of 2026-09-21 (read this first)

The project owner is a non-engineer running a real pilot (Karachi padel/futsal) and often writes in
Roman Urdu; answer in plain English, keep it short, and **verify before claiming** (they were burned
by "fixed" things that weren't). Everything below is on `main`, deployed, tests green
(**449 backend tests** (419 before Part 4) after merging the teammate's push-notification work: `AI_PROVIDER=claude AI_VISION_PROVIDER=claude .venv/Scripts/python.exe -m pytest`. **Do not run pytest without those two variables**: this machine's `.env` sets `AI_PROVIDER=gemini` with a real key, so 10 tests fail and `test_no_api_key_returns_graceful_fallback` makes a real, billed Gemini call. Also needs `httpx[http2]` in the venv now).

**Deployed today (all through GitHub Actions on push to `main`; none needed a migration):**
`c87f2fe` per-court cancellation policy in both UIs + stale wizard-draft recovery; `475b296`
schedule hours the DB can't store (close <= open) rejected with a 422 + inline UI message;
`3fdb175` WhatsApp notifications made best-effort (a Meta failure no longer 500s venue/payment
approval); `cb58693` WhatsApp booking chat (real Yes/No buttons, typed "yes" books the proposed slot,
Pakistan time only, today's date in the prompt). Details are the numbered follow-ups under item 31 of
the section list below and in the frontend `CLAUDE.md`'s Section 31.

**Production right now (verified 2026-09-20/21, read-only):**
- Venue **"Maidan COurt"** (`edf835c9-...`, owner phone ends 3809) is **approved** and bookable, 1 court.
  Hours 06:00-23:59 PKT (closing after midnight is not supported, see open items).
- One **admin** exists: the project owner's own number (ends 6981), promoted by hand. An account has
  one role, so that number no longer sees the player screens. See `RUNBOOK.md` section 5.
- Users: 2 owners, 1 player, 1 admin (that admin was a player until promoted). AI runs on **Gemini** (`gemini-3.5-flash-lite`).
- **Meta/WhatsApp is not finished**: no business verification, so the approved message templates
  (`venue_approved` etc.) don't exist in Meta; anything sent outside the recipient's 24h window fails
  (`notification_log.status='failed'`, harmless to the request now). OTP is temporary free-form text.
  The interactive Yes/No buttons follow Meta's documented payload but were **never sent to a real
  phone**; if Meta rejects them the code falls back to text and a typed "yes" still works.

**SECTION 32 IS IN PROGRESS (project owner's spec, 8 parts). Parts 1-2 are DONE, APPROVED and DEPLOYED to production
2026-09-21 (commit `94ac837f372d`, GitHub Actions green, both containers on that tag, no migration). Next: Part 4, then
3, 5, 7+8, 6.** How Parts 1-2 were proven on production (read-only, no login): Playwright on the public venue page with
the clock frozen at 3:14 AM PKT -- before, the "MON 21" tab asked for `date=2026-09-20` and "WED 23" asked for
`2026-09-22`, times read `06:00`; after, `2026-09-21` / `2026-09-23`, "Today"/"Tomorrow" tabs, `6:00 AM`. The AI chat
was exercised with a REAL Gemini call inside one outer transaction that is rolled back (row counts identical before/after;
script pattern: `AsyncSession(bind=conn, join_transaction_mode="create_savepoint")` under `conn.begin()`, then rollback).
Also on 2026-09-21 the one production waitlist row for the owner's own booked 23 Sep 6:00 PM slot was deactivated (owner
approved; proved first with a SELECT that the waitlister is the booking's own player).
Standing rules the owner set for Parts 3-5 -- follow them, do not re-ask:
- Decisions accepted: (1) overnight = explicit `schedule_templates.closes_next_day` column (close<=open means next
  day; open==close+flag = 24h; midnight close is `00:00` + flag); (2) multi-slot bookings via a `btree_gist`
  EXCLUDE constraint on `tstzrange(starts_at, ends_at, '[)')` for the live statuses (held, payment_submitted,
  booked); (3) advance rule lives on the COURT (fixed or percent + minimum), `pricing_rules.advance_percentage` stays
  as fallback; (4) slot lengths offered 30/60/90/120; (5) keep the old per-court `courts.cancellation_*` columns
  one release.
- **A.** The moment `venues.cancellation_allowed`/`cancellation_cutoff_hours` exist, the code must neither READ nor
  WRITE the court columns (only the venue's); mark them "deprecated, drop next release" -- never two sources of truth.
  (Section 32 Part 4 deliberately REVERSES Section 31's per-court policy to per-venue.)
- **B.** Keep `one_live_booking_per_slot` until the new constraint is proven, then TELL the owner whether it is
  redundant; never drop it without asking. Same live statuses. `[)` so 6-7 PM and 7-8 PM do not clash. Verify every
  existing booking has a valid `ends_at` BEFORE the migration. Put `CREATE EXTENSION btree_gist` in the migration or in
  `bootstrap.sh db-init` and say which and why (RDS rules). Tests: re-run the 50-concurrent-request test; add a
  90-minute vs 60-minute booking overlapping by 30 minutes, and two back-to-back bookings across midnight.
- **C.** Before ANY migration touches production: show the plan and the exact commands; tell the owner to take a manual
  RDS snapshot first (backups are 1 day, restore dry-run never done); test upgrade AND downgrade on a copy of
  production-shaped data; after migrating, read the output and report it. Run migrations from the NEW image BEFORE
  restarting the backend so the code never runs against a missing column. Ask before any production write/deploy.
(Parts 1-2 details: item 32 below and the frontend CLAUDE.md's Section 32.)

**SECTION 32 PROGRESS TABLE (order set by the owner 2026-09-22: 4, then 3, 5, 9, 10, 7, 8, 6, 11):**

| Part | What | Status |
|---|---|---|
| 1-2 | 12-hour Pakistan time, date-shift bug, own-slot state | **Deployed** as `94ac837f372d` (2026-09-21). **Mobile needs an EAS build** to reach phones. The docs commit after it is local, **pending push (goes out with the next deploy)**. |
| 4 | Per-court slot length + pricing, per-VENUE cancellation, closed/booked labelling, duration picker | **DEPLOYED 2026-09-22 as `cabd2f2ccf4a`; migration `dd23d75cf310` applied on production** (from the new image before the backend restarted; output: backfilled, no disagreeing venues, constraint added, 8 bookings satisfied it, head = `dd23d75cf310`, `alembic check` clean). Verified live on production: schedule, quote (3 h = PKR 7,000), AI reply. Live venue policy stays "not allowed". Mobile needs an EAS build. **Full plan and rules: `docs/SECTION_32_PLAN.md`.** |
| 3 | Overnight courts (`closes_next_day`) | Not started |
| 5 | Split payments + `payment_entries` ledger | Not started |
| 9, 10 | **Spec text not received** -- the spec pasted so far has Parts 1-8 only. Ask the owner for Parts 9 and 10 before starting them. | Blocked on the spec |
| 7 | OCR improvements | Not started |
| 8 | WhatsApp/Gemini prompts. Added findings: AI money is always "PKR 3,500" (never "Rs. 3500.0"; hand the model a ready-made string like the slot `label`); the model must NEVER invent a reason for an unavailable slot ("fixed 90-minute blocks" when it was simply booked) -- only say what the tool returned. | Not started |
| 6 | Photos + reviews | Not started |
| 11 | Screen audit: the owner dashboard's fixed sidebar overflows below ~600px, owners are on phones, fix it as part of the audit. Also fix the 2 existing eslint errors (`react-hooks/set-state-in-effect`, settings page lines ~98 and ~115) the next time `apps/web/app/dashboard/owner/settings/page.tsx` is touched (Part 4 touches it). | Not started |

**SECTION 32 PART 4 (built and DEPLOYED 2026-09-22).** `infra/scripts/remote-deploy.sh` now runs `alembic upgrade head`/`current`/`check` from the NEW image before `up -d` on every deploy (a refusing migration aborts the deploy with the old containers still up), so pushing a migration IS running it: never push one without the owner's go. Old `one_live_booking_per_slot` is still there; once the overlap constraint has run in production for a while, TELL the owner whether it is redundant (do not drop it unasked). What exists: migration `dd23d75cf310` (venue cancellation columns +
backfill, `btree_gist` `EXCLUDE` constraint `no_overlapping_live_bookings` on `tstzrange(starts_at, ends_at, '[)')` for
held/payment_submitted/booked, with a preflight that refuses and changes nothing on a bad `ends_at` or an existing overlap);
`one_live_booking_per_slot` is KEPT (owner decides later whether it is redundant). `CREATE EXTENSION btree_gist` is in the
migration, not `bootstrap.sh db-init`, because it is a trusted extension (PG13+) that `court_admin` may create and it keeps the
migration self-contained. The cancellation policy is read ONLY from `venues.cancellation_*`; `courts.cancellation_*` are mapped as
`_deprecated_*`, unused, **drop next release**; `CourtOut.cancellation_*` is a read-only mirror computed by the database from the
venue (`column_property`) so app builds from before this change keep working. Slot length is 30/60/90/120 per court.
`create_hold(..., slot_count)` books several consecutive slots as one booking; `AvailabilityService.quote_range` is the ONLY place a
multi-slot total is computed (slot by slot with each slot's own rule: peak boundaries, closing time, blackouts) and backs
`GET /courts/{id}/quote`, the hold, and the AI. AI/WhatsApp: `quote_booking` tool, `duration_minutes` on propose/hold, money as
`format_pkr()` text, WhatsApp Yes button id `confirm:<court>:<starts_at>|x<slot_count>`. Facts read from production 2026-09-22
(read-only): DB at `19cf7e553535`; 8 bookings, none with a bad `ends_at`, no overlapping live pairs; 1 venue/1 court; that court has
`cancellation_allowed = false` (so the venue will inherit "not allowed" -- tell the owner); no venue's courts disagree; schedule is
uniform 6 AM-11 PM; no day-specific price rules; `court_admin` is `rds_superuser` and `btree_gist` 1.7 is available and trusted.
Found and fixed during Part 4 (not in the spec): (1) **the owner screens numbered weekdays Sunday-first while the API is Monday = 0**,
so per-day hours set for "Sun" landed on Monday (no live venue was affected: production hours are uniform); the screens now use
`DAY_LABELS` Monday-first from `packages/types/src/court-setup.ts`. (2) A refactor of Venue Settings would have saved one court
with ANOTHER court's hours and prices because the app's query client keeps the previous query's data as a placeholder -- caught by
the live test, fixed (the form mounts only when `data.id === selected court`); see the frontend CLAUDE.md rule. (3) The chat's
opening question was sent twice in dev (effect ran twice); guarded with a ref. Known flaky test: `test_typed_yes_books_the_slot_...`
compares a host-clock timestamp with a DB-clock one and failed once under load (passes alone and on rerun).

**Open items, roughly by priority (none started unless noted):**
0. **Found while proving Parts 1-2 on production (for Part 8):** the AI sometimes writes the price as "Rs. 3500.0"
   (the tool result hands it a raw float; give it a ready-made "PKR 3,500" like the slot `label`), and explained an
   unavailable slot with an invented reason ("Court 1 has fixed 90-minute blocks" when 6:00 PM was simply booked).
   Another person (fasih1712) also pushes to `main` (FCM/APNs push, EAS): `git fetch` and rebase before pushing.
1. **Ask the owner: do venues close after midnight?** Hours like 06:00 -> 02:00 are impossible today
   (DB `CHECK (open_time < close_time)`, per-day availability engine); the UI now says so and suggests
   23:59, which loses the last slot of a 60-min grid. Real overnight support = constraint migration +
   availability engine + pricing windows + PKT conversion. Do not build without asking.
2. **Unhandled 500s reach the browser without CORS headers**, so they look like "Can't reach the server"
   and mislead everyone. Fix: an inner catch-all in `RequestContextMiddleware` (inside CORS) returning the
   JSON error envelope. Not done; it caused two of today's three incidents to be misread.
3. **Venue review gaps** (traced, not changed): no resubmit path after `changes_requested`/`rejected`
   (editing a venue doesn't change its status and the UI has no edit screen); the admin queue only lists
   `pending`, so a changes-requested venue never comes back; no automatic screening (duplicate/spam);
   admin gets no reliable notification (push stub, WhatsApp needs an open window).
4. **Wizard duplicate-court hazard**: `updateCourt/addCourt/removeCourt` clear `createdCourtIds`, so editing
   a court after a partial submit failure re-POSTs every court. Fix = PATCH already-created courts.
5. **Unexplained session rotation**: in a scripted run the web app refreshed a fresh 8h session after ~8s
   (`shouldRefreshSoon` should be false). A second tab holding the old token would be logged out. Look at
   what `expiresAt` the store holds after `restoreSession` (`apps/web/app/providers.tsx`).
6. **Mobile** needs a new EAS build for any of today's fixes (no `eas.json`, no `android.package`, never
   device-tested); `SUPPORT_WHATSAPP_NUMBER` is still the placeholder `+923000000000` in both `lib/support.ts`.
7. Ops leftovers: Sentry DSN unset (errors are invisible), RDS backups 1 day (Free-plan limit) and the
   dry-run restore was never done, sslip.io hostnames, Meta business verification + templates.
8. Small: the assistant sometimes writes `**bold**` (WhatsApp shows it literally); `WhatsAppService._send`
   retries deterministic 4xx (404 template missing) three times, ~4s of latency on every affected request.

**Local dev DB has leftover throwaway test data** (users with email `92300#######@example.com`
created after 2026-09-20 19:40 UTC, ~30+ of them, and the venues they own: "S31 Live Venue",
"S31 Mobile Venue", "S31 Other Venue", "S31 Mobile Other Venue", "Hours Test Venue"; the older
`Mob ...`/`... Arena` fixtures belong to earlier sessions and are not covered by this filter). A bulk delete was blocked by the permission system, so it was left. To
remove it (dev DB only, container `court-booking-backend-db-1`, db `court_booking`, one transaction):
delete `payment_disputes`, `payments`, `reviews`, `waitlist`, `bookings` for their courts/players, then
`notification_log`, `messages`, their `venues`, `otp_requests`/`login_attempts` by phone, `audit_log` by
user, then the `users`. Filter strictly on `email ~ '^92300[0-9]{7}@example\.com$'`; nothing older matches.

**How to work here (hard-won this session):**
- **Diagnose from production before theorising.** Logs and chat history: `RUNBOOK.md` section 4.
  Three "network error" reports were a DB constraint 500, an uncaught WhatsApp error after a commit, and
  a chat design gap; none was a connection problem.
- **A side effect after a commit must never fail the request** (notifications, WhatsApp, push). Route
  WhatsApp through `NotificationService._whatsapp_smart_best_effort`; keep OTP the exception.
- **Reproduce the bug in a test first**, confirm it fails on the old code, then fix (done for all three).
- Live-test with real Postgres, Playwright on the web build (`next build && next start`, not `next dev`)
  and Expo's web target started with `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000` (app.json points at
  PRODUCTION). Real Gemini smoke tests are fine locally (key in `.env`).
- **Shell traps on this machine:** the Bash wrapper mangles backslashes and long heredocs. Use the
  Edit/Write tools for code, put scratch files in the session scratchpad, and never rely on `\n` inside
  `python - <<EOF` patches. AWS CLI: always `--region ap-south-1`, prefix `MSYS_NO_PATHCONV=1`, use
  Windows paths (`pwd -W`); `gh` isn't installed.
- **Ask before** production writes, deploys' side effects on data, or anything outward-facing; the
  permission system also blocks some production reads/bulk deletes, so hand the user the exact command
  instead of working around it.
- Commits end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. The repo root is the
  monorepo (`../`); pushing to `main` deploys (~2 min; backend restart shows as `uptime_seconds` resetting
  in `https://api.3.6.48.6.sslip.io/health`, web as new strings in the `/_next/static` chunks).

## What this is

A FastAPI backend for a court-booking platform (padel/futsal/etc.), built
section-by-section from a written specification the user feeds in over the
course of a session, one or two sections at a time. Sections delivered so far:

1. Project setup (structure, dependencies, config pattern)
2. Database schema (raw SQL → SQLAlchemy models, with `one_live_booking_per_slot`
   called out as the single most important line of code in the schema)
3. Authentication (originally phone + OTP; replaced by password login in Section 26 below)
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
26. Password-based auth (2026-09-20): signup form + password login replace
    phone+OTP-only login; WhatsApp OTP now only *proves the phone* (signup,
    re-verification after 365 days, password reset). 8-hour sessions kept
    alive by proactive refresh, argon2id passwords, per-phone failed-login
    rate limit, purpose-bound OTPs, `PASSWORD_NOT_SET` path for pre-existing
    accounts, and the frontends' matching screens (signup for player and
    owner, login, verify, forgot/reset, web venue-setup wizard). README.md's
    "Auth (Section 26)" bullet is the full description of the model; this
    file only tracks what was surprising (gotchas at the end). **Deployed
    2026-09-20** (commit `95607c7`; both migrations, `4785869bebe6` and
    `651abc777d2c`, applied to production with `bootstrap.sh migrate` right after the
    image landed). The follow-up added profile editing, unique email and phone change.
28. Old-number notification on phone change (2026-09-20): after a phone change
    commits, the OLD number gets a best-effort WhatsApp (background task, never
    affects the change). See gotcha 13 in the Section 26 list at the end.
29. Post-audit fixes, Tier 1 (2026-09-20): four independent fixes from the Full
    Feature & Flow Audit -- (A) a `use-owner-venues.ts` isLoading race that let
    Today/Approvals/Ledger/Growth flash their empty state during cold load on
    both platforms (root cause: a disabled TanStack Query v5 query reports
    `isLoading: false`, not `true`, while waiting on `activeVenueId` to resolve
    -- fixed by combining `ownerVenues.isLoading` into each screen's own loading
    check); (B) `digest_job.py` calling `send_text` directly instead of
    `send_smart` (skipping the 24h WhatsApp window check) with no per-owner
    error isolation, so the first owner with a closed window silently aborted
    the whole morning's run -- fixed via a new
    `NotificationService.notify_owner_daily_digest` plus a try/except per
    owner in the loop; (C) a real per-venue cancellation-policy feature (not
    just a UI fix) so a player can cancel an already-paid booking where the
    court allows it -- new `courts.cancellation_allowed`/
    `cancellation_cutoff_hours` columns (migration `19cf7e553535`), enforced in
    `BookingService._enforce_cancellation_policy`, two new error codes
    (`CANCELLATION_NOT_ALLOWED`/`CANCELLATION_WINDOW_CLOSED`), set in the venue
    setup wizard on both platforms, disclosed to the player before they pay,
    and surfaced as a real Cancel action (with honest "refund is manual, not
    automatic" copy) on My Bookings; (D) a real Terms of Service and Privacy
    Policy, hosted at `/terms`/`/privacy` on the web app, linked from both
    signup screens (mobile links out to the web pages rather than duplicating
    the text natively). See README.md's "Post-audit fixes (Section 29)" for
    the full per-part writeup and gotchas. **Tier 2** (venue photos, post-setup
    schedule/pricing/blackout editing, a walk-in date picker, web waitlist --
    all frontend-only, no backend changes) followed the same day; see the
    frontend CLAUDE.md's own Section 29 Tier 2 entry.

    **A separate, real production incident surfaced between Tier 1 and Tier 2**
    (found live by the project owner, not from the audit): the venue-setup
    wizard's "Send for review" showed a false-negative network error on the
    LAST call in its per-court submit loop (`POST courts` -> `POST schedule`
    -> `POST pricing`, repeated per court) even though every step had actually
    committed server-side -- reproduced by letting a request reach and complete
    on the server, then dropping the client's connection before it saw the
    response (Playwright `route.fetch()` + `route.abort()`), which is a genuine
    network-layer failure mode, not a bug in how `client.ts` reads a response.
    The real gap was resilience: retrying replayed the ENTIRE per-court loop
    with no memory of what had already succeeded, so `POST /courts` (which
    always inserts) fired again for a court that already existed -- confirmed
    both in the local repro (2 duplicate "Court 1" rows) and, worse, for real
    in production (venue "Maidan Court", 2 duplicate court rows 30 minutes
    apart, matching the reported incident exactly). Fixed with
    `createdCourtIds: Record<index, courtId>` in the venue-setup store
    (both platforms, alongside the existing `createdVenueId`), so a retry
    skips `courts.create` for any court already recorded and only re-runs
    `setSchedule`/`setPricing` (safe -- the backend replaces, not appends).
    Verified live: `POST /courts` fires exactly once across two submit
    attempts with the same induced failure, where it fired twice before the
    fix. **The affected production venue was deleted** (cascades to its
    courts/schedule/pricing; verified zero dependent bookings/waitlist rows
    first) at the project owner's request, returning production to zero
    venues for a clean re-registration.
31. Per-court cancellation policy in the UI + venue-not-found recovery (2026-09-20).
    **The spec's premise was wrong, verified before writing anything:** it said
    `cancellation_allowed`/`cancellation_cutoff_hours` live on the *venue* and asked for a
    migration moving them to `courts`. They have only ever been on `courts` (Section 29
    Part C, migration `19cf7e553535`; `venues` has no such columns), enforcement
    (`BookingService._enforce_cancellation_policy`) already reads the booking's own court, and
    the pay screen already fetched that court. So **no migration was written** (a
    backfill-then-drop would have failed on the missing venue columns) and there is **no
    backend code change**: only two tests pinning the behaviour that was already true
    (`test_two_courts_at_one_venue_enforce_cancellation_independently`,
    `test_patching_one_courts_policy_leaves_sibling_court_alone`). The real gap was
    frontend-only: the wizard applied ONE shared setting to every court it created, and the
    post-setup Venue Settings screen had no cancellation controls at all. Both fixed on both
    platforms; see the frontend CLAUDE.md's Section 31 for that half and for Part 2 (a
    stale wizard draft -- `createdVenueId` pointing at a deleted venue -- is now a recoverable
    state instead of a dead-end error). Backend-relevant facts: `PATCH /courts/{id}` with an
    explicit `cancellation_cutoff_hours: null` clears the cutoff (`exclude_unset` keeps explicit
    nulls); a missing venue on `POST /venues/{id}/courts` is `404 VENUE_NOT_FOUND`, a missing
    court elsewhere is a generic `404 NOT_FOUND`, another owner's venue is
    `403 NOT_VENUE_OWNER` -- the three codes the frontend now treats as "stale draft".

    **Follow-up incidents the same day (both found from production logs, read with
    `aws ssm send-command --region ap-south-1` running `docker logs court-booking-backend`):**
    (1) *"Can't reach the server" on Send for review* was a **500** from `POST /courts/{id}/schedule`:
    hours 06:00 -> 02:00 violate `schedule_templates` `CHECK (open_time < close_time)`; hours past
    midnight are not supported (engine and constraint are per calendar day), so `ScheduleTemplateIn`
    now rejects `close_time <= open_time` with a 422 and the frontends validate first.
    (2) *"Server connection error" after approving a venue* -- the approval had committed, then
    `notify_venue_approved` -> `WhatsAppService.send_smart` failed (Meta `132001`, the
    `venue_approved` template isn't registered) and the uncaught `RetryError` made the request a 500.
    **`NotificationService._send_push_and_whatsapp` (used by venue approve/reject/changes, payment
    approve/reject, booking cancel, court deactivation...) and the escalation WhatsApp leg now go
    through `_whatsapp_smart_best_effort`: a WhatsApp failure is logged
    (`notification.whatsapp_failed`) and recorded as a `notification_log` row with `status='failed'` +
    `error_message`, and never fails the triggering request.** Tests:
    `test_venue_approval_survives_a_failed_whatsapp_notification`,
    `test_payment_approval_survives_a_failed_whatsapp_notification`. Do NOT route OTP delivery through
    it (a failed OTP send must still surface as `OTP_DELIVERY_FAILED`). Consequence to know: until the
    Meta templates are approved, most of these notifications simply do not arrive outside the 24h window
    -- check `notification_log WHERE status='failed'`, not the API response. Both incidents shared one
    amplifier: an unhandled 500 has **no CORS headers**, so the browser reports it as a network failure
    (not fixed; an inner catch-all in `RequestContextMiddleware` would).

    **(3) WhatsApp booking chat looped on "yes" and said "UTC" (same day, from the `messages` table
    -- chat content is in the DB, not `docker logs`).** Four causes, all fixed: (a) `_handle_text`
    sent only `result.reply` as plain text, so the assistant's Yes/No **buttons were stored in
    `messages.metadata.actions` but never sent** -- now `WhatsAppService.send_buttons` sends real
    interactive buttons (falls back to text; **payload shape follows Meta's docs but has not been
    exercised against the live API**); (b) chat history is plain text, so a typed "yes" had no memory
    of WHICH slot was proposed and the model re-guessed a different date each turn -- now
    `webhooks._pending_confirmation` reads the previous AI message's stored `confirm_booking` action and
    a *plain* affirmative (`_is_plain_affirmative`: "Yesss", "haan bhai book kardo"; anything with a time,
    a date, "but" or "no" still goes to the model) books it directly, max 30 min old, no LLM call; the
    "Held!" reply now includes the PKT slot and the venue's bank details (it used to say "send your
    screenshot" without saying where to pay); (c) the model had no clock ("15 May" in September) and was
    handed UTC -- `build_system_prompt(now)` injects today's PKT date, rule 7 forbids ever mentioning UTC,
    and `check_availability` returns a ready-made PKT `label` (and no longer caps at 15 slots, which hid
    the evening slots of 60-minute courts); (d) `propose_booking_confirmation` now rejects a time that is
    not a real available slot (it returns an error instead of buttons), `_attach_proposal_for_named_slot`
    ties a plain-text "shall I book X?" to X when exactly one slot from that turn's availability is named,
    and `MAX_TOOL_ITERATIONS` went 5 -> 8: at 5 a normal turn (search x2, courts, availability, propose)
    ran out before the model could answer and the player got "I'm having trouble completing that".
    Verified against the real Gemini model (`gemini-3.5-flash-lite`) locally, not just mocks. Known
    leftover: the model sometimes writes `**bold**`, which WhatsApp shows literally (it uses `*bold*`).
    The in-app (web/mobile) chat path is unchanged: its client renders the buttons itself.
32. Time/date display and the date-shift bugs (Parts 1-2, 2026-09-21; **committed locally, not deployed**).
    Root causes, each proven against production data/logs before fixing: (a) **every date the UI sent to the API was
    the UTC date** (`toISOString().slice(0,10)`), so between midnight and 5 AM in Karachi the tab labelled "Wed 23"
    queried the 22nd (all the owner's night-time test bookings landed in that window) -- the "booked 23rd, shows
    24th" bug; (b) the same UTC/`date.today()` "today" in owner Today (showed yesterday and covered 5 AM-5 AM),
    the ledger range, venue "slots today", the growth job and slot alignment (`starts_at.date()` made a 12-4 AM
    court unbookable); (c) times reached players as 24-hour and as raw UTC ISO strings (notification texts were
    `starts_at.isoformat()`, the `booking_confirmed` WhatsApp template went out with a blank venue and time), and
    the AI was handed UTC in tool results and quoted "17:30" (= 10:30 PM) as the last slot, so it told a player 9 PM
    was unavailable; (d) "Notify me" showed on the player's OWN booking (slots had no "mine" flag; the API even
    accepted the join) and "Venue 0" was the done screen's `AT VENUE` label over `balance_due = 0`.
    Fix: ONE formatter per platform -- backend `app/utils/timezone.py` (`pkt_today`, `pkt_date_of`, `format_time`,
    `format_when`, `format_slot_label` = "7:30 PM to 9:00 PM, Wed 23 Sep", `enforce_display_format` safety net
    for model text) and frontend `packages/types/src/datetime.ts` (fixed +5h offset, independent of the device's
    timezone; tested under 4 zones). Never `date.today()`/UTC date for "today", never `.isoformat()` in text.
    `SlotOut.is_mine` (optional-auth availability), `ALREADY_YOUR_SLOT` on waitlist join, a hold retires the
    player's own waitlist entry, owner Today rows carry `price`/`balance_due`. The AI prompt says "copy the label
    exactly, never 24-hour, never UTC". Tests: `test_time_formatting.py`, `test_my_slot_and_dates.py` (proved RED
    on the old code, GREEN now), extended `test_ai_chat.py`/`test_payments.py`. Existing tests that used the UTC date
    for "today" (`test_owners.py`) were themselves the bug and now use `pkt_today()`.
    **Production data note (not changed, needs a go-ahead):** the owner's real account has an active waitlist row
    for its own booked 23 Sep 6:00 PM slot; the UI now hides it, but the row should be deactivated.
    Not done yet: CSV export still writes ISO dates (Part 5 rewrites the ledger).

All delivered sections are implemented, tested against a real
Postgres/PostGIS instance, and documented in README.md. Current state: 379
tests passing (2026-09-20, run with `AI_PROVIDER=claude AI_VISION_PROVIDER=claude`), 83 API
operations, 20 tables, no Alembic drift (`alembic check` clean; the newest migration
round-trips upgrade -> downgrade -> upgrade). Run the suite with
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
        end of this file -- and does not work for anyone who hasn't messaged
        the business number in the last 24h (either `OTP_DELIVERY_FAILED`,
        or -- more often -- a silent 200 with no message; see that gotcha).
        Expected, not a new bug; don't chase it as an error.** Verified
        working 2026-09-20 03:32 UTC for a tester whose window was open
        (request-otp, delivery callbacks, verify-otp all succeeded).
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
  - **Failure has TWO shapes, and only one of them returns an error.**
    (1) *Meta rejects the send synchronously* (HTTP 400): `_send`'s
    `raise_for_status` raises `HTTPStatusError`; tenacity retries it 3x (~3s
    of backoff, three calls to Meta -- deterministic 400s make the retries
    wasted, but that's existing `_send` behavior, left alone) and re-raises
    `RetryError`; `request_otp`'s `except Exception` catches it, deletes the
    OTP row so it doesn't burn a rate-limit slot, and returns 502
    `OTP_DELIVERY_FAILED`. Covered by
    `tests/test_auth.py::test_otp_send_with_no_open_window_fails_cleanly`.
    (2) *Meta accepts the send (HTTP 200) and fails it afterwards* -- this is
    what actually happened on 2026-09-19 22:48 UTC (the first live test, the
    recipient's window was closed): the API returned a clean 200
    `"OTP sent via WhatsApp"`, the OTP row stayed, and **nothing arrived**.
    The failure exists only in a later `statuses` webhook. Nothing in the
    request path can see that, so no `OTP_DELIVERY_FAILED` is possible.
    An earlier version of this note claimed a closed window always
    degrades to `OTP_DELIVERY_FAILED`; that was only true for shape (1), and
    it was verified only against a mocked 400.
  - **How to diagnose a "200 but nothing arrived" OTP** (logging added
    2026-09-20, none of it existed on 09-19): `docker logs court-booking-backend`
    and look for, in order, `whatsapp.send.accepted` (Meta returned 2xx --
    carries the `wamid`), `whatsapp.send.rejected` (Meta's error object:
    `meta_error.code`/`message`/`error_data`), and `whatsapp.status` (the
    delivery callback for that `wamid`: `sent`/`delivered`/`read`, or
    `failed` at WARNING with `errors[].code` -- 131047 = window closed, 131030
    = recipient not on the allowed list, 131042 = payment/eligibility). Phones
    are masked to the last 4 digits; the token is never logged. Status
    callbacks are **logged only** -- not stored, and nothing reacts to them
    (no retry, no user-facing error).
  - **To revert:** in `send_otp`, replace the body with
    `return await self.send_registered_template(to_phone_number, "whatsapp_otp", [code])`
    (the `whatsapp_otp` entry is still in `whatsapp_templates.py`, untouched),
    delete the two tests above (they assert the temporary behavior), and
    remove this note plus the matching README/`infra/README.md` lines.
- **Section 26 (password auth) -- things that were genuinely surprising or
  are easy to get wrong** (2026-09-20). The model itself is in README.md.
  1. **Deploy order matters: migrate immediately after the new image lands.**
     The new code selects `users.password_hash/email/city/gender/phone_verified_at`
     and `otp_requests.purpose`, so between the new container starting and
     `bootstrap.sh migrate` every user query 500s. The migration
     (`4785869bebe6`) is additive/nullable so the *old* code tolerates the new
     schema, but `alembic` lives inside the image, so it can't run first.
     Sequence: push -> deploy finishes -> `sudo /opt/court-booking-app/bootstrap.sh migrate`
     at once (pilot traffic makes the window seconds). It also backfills
     `phone_verified_at = created_at` for existing users (every one was created
     by passing an OTP) and fixes the `sessions.last_active_at` default (below).
  2. **The one existing production user has no password.** They hit
     `403 PASSWORD_NOT_SET` on login and must use "forgot password" (which needs
     an open 24h WhatsApp window under the temporary free-form send). Not
     locked out, but not a click either.
  3. **`extra="ignore"` in `config.py` silently swallows renamed settings.**
     A stale `SESSION_TOKEN_EXPIRE_DAYS=365` in an old `.env` does nothing now;
     sessions get the 8h default. `.env.example` was updated (and says so).
  4. **`sessions.last_active_at`'s default was frozen at migration time**:
     the initial migration wrote `server_default='now()'` as a *string*, which
     Postgres folded into the constant `'2026-09-19 17:01:34+00'` at DDL time,
     so every session started with that timestamp. Fixed in the Section 26
     migration (`server_default=sa.text('now()')`) and in the model
     (`func.now()`); it was the only column with the mistake (checked).
  5. **A login client must never send a stored token to the auth endpoints or
     react to their 401s.** A wrong password is a normal `401 INVALID_CREDENTIALS`;
     the api-client used to treat any 401 as "session expired -> refresh ->
     sign out". Public auth calls now pass `skipAuth`. The client also no longer
     signs the user out on a refresh that failed because the *network* was down
     (`RefreshOutcome`: ok / rejected / network) -- only a server refusal does.
  6. **Refresh is only useful *before* expiry** (an expired token can't be
     refreshed), and only works because the session is still valid -- which is
     why the audit found the old reactive refresh to be dead code. It is now
     driven on app foreground / tab focus and a 60s timer, when < 1h of the 8h
     window remains (`packages/api-client/src/session.ts`).
  7. **OTP rate limit is shared across purposes**: 5 codes per phone per 15 min
     total (signup + resend + re-verify + reset all count). A user who fumbles
     signup and then forgets their password can hit `OTP_RATE_LIMITED`.
  8. **Test fixtures**: `make_user` now defaults `phone_verified_at` to now (the
     login gate would otherwise reject every fixture user); pass
     `phone_verified_at=None` for a pending signup. `make_auth_headers` builds
     sessions with `SESSION_TOKEN_EXPIRE_HOURS`.
  9. **Decisions made without being asked (flagged in the Section 26 report):**
     password rule is length-only (min 8 -- confirmed by the project owner);
     refresh also stops at the 365-day limit (confirmed correct); owners can
     self-select the `owner` role at signup (venues still need admin approval
     before going live); an owner with a *rejected/changes_requested* venue has no
     resubmit endpoint (they contact support or register another venue --
     confirmed as-is). (Email uniqueness and phone change were on this list;
     both now exist -- see 10-13.)
  10. **Second migration, `651abc777d2c` -- deploy it together with the first.**
     After the image lands, `bootstrap.sh migrate` runs BOTH `4785869bebe6` and
     `651abc777d2c` in one go (it's `alembic upgrade head`). The new code
     selects `otp_requests.user_id` and the `phone_change` enum value, so the
     same "migrate immediately" rule as (1) applies. The email-uniqueness step
     **reads production data**: it finds `lower(email)` duplicates, keeps the
     earliest account, NULLs the later ones, writes `audit_log` rows and prints a
     summary -- so read the migrate output. Note pre-Section-26 production users
     have *no* email at all (column is new), so on the current single production
     user it is expected to report "0 duplicates". `ALTER TYPE ... ADD VALUE`
     can't be undone by `downgrade` (Postgres can't drop an enum value), so the
     downgrade leaves `phone_change` in the type -- harmless.
     **The production duplicate check could not be run from the dev session**
     (the SSM read was denied), so the migration's own output is the evidence.
  11. **Email uniqueness has three moving parts that must stay together**:
     `EmailStr` lowercases at the schema, the `uq_users_email_lower` index on
     `lower(email)` is the real guarantee, and `_claim_email` /
     `_commit_unique_email` in `auth_service.py` turn a clash into
     `EMAIL_ALREADY_IN_USE` (and release an abandoned signup's email). The index is
     declared at module level in `models/user.py` (`Index(..., func.lower(User.email))`)
     so `alembic check` sees no drift. Test fixtures now derive the default
     signup email from the phone (`signup_body`), because a shared default
     email would collide.
  12. **Phone change reuses the login lockout table on purpose**: wrong
     current-password guesses on `request-phone-change` write `login_attempts`
     rows for the *user's current phone*, so an attacker holding a stolen token
     can't get unlimited password guesses through this endpoint that the login
     endpoint would have refused. Verification codes get the usual OTP attempt cap.
     Both *codes* go to the new number.
  13. **Old-number notice (Section 28, closes the "old number isn't notified"
     gap from 12).** After `verify_phone_change` commits, the endpoint queues
     `AuthService.notify_old_number_of_phone_change` as a `BackgroundTasks` job (it
     runs after the response, so the ~seconds of tenacity retries in `_send` never
     delay the user, and it uses only `self.whatsapp`, not the request's DB session).
     The service method catches **everything**; `verify_phone_change` returns the
     old number so the notice is only ever queued for a change that really committed
     (no notice on wrong code / abandoned attempts). Log line:
     `phone_change.old_number_notice outcome=accepted|no_open_window|send_failed`.
     `no_open_window` is Meta error 131047 and is the *expected* result for most old
     numbers under the temporary free-text send; `accepted` only means Meta took the
     message (delivery shows later in `whatsapp.status`). Not a bug to fix today --
     reliability arrives with the verified account + Utility template
     (`send_phone_changed_notice` is the one place to swap). `otp_box` (tests) also
     stubs this method, so no test can reach the real send.
     `describe_send_failure` unwraps tenacity's `RetryError` (because `_send`'s
     `@retry` has no `reraise`) to read Meta's code -- keep that in mind if `_send` changes.
