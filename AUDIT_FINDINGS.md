# Maidan Pre-Launch Audit Findings

Audited: 2026-09-09. Scope: `court-booking-backend/` (FastAPI, 8,631 lines, 63 routes,
228 tests) and `court-booking-frontend/` (Expo + Next.js monorepo), against the pilot
described in `court-booking-backend/README.md`/`CLAUDE.md`, `court-booking-frontend/CLAUDE.md`,
and `docs/FRONTEND_INTEGRATION.md`.

**Note on scope:** `docs/court-booking-app-prd.md` does not exist in this repo. There is no
single canonical PRD — spec knowledge is split across the two `CLAUDE.md` build histories,
`docs/frontend-build-prompt.md`, and `FRONTEND_INTEGRATION.md`. This audit was conducted
against those three documents plus the actual implementation; see the Documentation section
for the finding this gap itself produced.

Findings below are sorted **severity first, then category**. Every finding was verified by
reading the actual source (file:line cited) — nothing here is a generic best-practice nag.
Three independent investigation angles (security, data-integrity, code-quality) converged
on the same payment-approval race condition; that's presented once, below, as a single
high-confidence finding rather than three.

Legend: 🔴 BLOCKER (fix before pilot) · 🟡 IMPORTANT (fix within pilot) · 🟡 VERIFY (confirm with the stated test) · 🟢 POST-PILOT

---

## 🔴 BLOCKERS

### 1. WhatsApp webhook has no signature verification — phone identity is spoofable
- **Severity:** 🔴 BLOCKER
- **Category:** Security
- **Location:** `app/api/webhooks.py:209-236`, `app/services/whatsapp_service.py` (whole file)
- **Issue:** `POST /webhooks/whatsapp` never verifies Meta's `X-Hub-Signature-256` HMAC. Only the separate `GET` verify-challenge check exists; the POST handler reads `await request.json()` and processes it directly with zero authentication of the sender.
- **Attack scenario:** Anyone who finds the (predictable) webhook URL can POST a forged Meta-shaped payload claiming to be from any phone number. `_find_or_create_guest` treats that phone as verified identity with no OTP — an attacker can submit fake payment proofs against a real player's most recent held booking, spoof `confirm:<court_id>:<starts_at>` button taps to hold slots as another user, or flood the AI chat pipeline (real API cost) without ever controlling the impersonated number. This breaks the "phone = verified identity" assumption the entire WhatsApp channel relies on.
- **Fix:** Compute HMAC-SHA256 of the raw request body with the Meta app secret and compare (constant-time) against `X-Hub-Signature-256` before processing; 403 on mismatch. Requires preserving the raw body before FastAPI's `.json()` consumes the stream.
- **Effort:** Small

### 2. Payment approve/reject/cancel have no atomic status guard — real-money race condition
- **Severity:** 🔴 BLOCKER
- **Category:** Security / Data
- **Location:** `app/services/payment_service.py:231-292` (`approve_payment`, `reject_payment`), `app/services/booking_service.py:199-230` (`cancel_booking`); no coverage in `tests/test_concurrency.py`
- **Issue:** Unlike every other stateful transition in this codebase (`one_live_booking_per_slot`, `unique_active_waitlist`, WhatsApp dedup, and `expire_stale_bookings`'s own `UPDATE ... WHERE status = X`), these three methods are plain read-then-mutate-then-commit: they check `payment.review_verdict`/`booking.status` in Python, then issue an unconditional `UPDATE` by primary key with no re-check of current DB state at write time.
- **Attack/failure scenario:** Owner double-taps "Approve" on a slow connection, or approve/reject fire from two staff devices near-simultaneously, or a player cancels the instant an owner approves. Both requests read the same pre-mutation status, both proceed — a booking can end up simultaneously "confirmed" and "cancelled" depending on commit order, the player gets duplicate contradictory notifications, and `total_rejections`/`reliability_score` can be decremented for a payment that was actually approved. This is a real-money integrity bug, independently surfaced by three separate audit angles (security, data-integrity, and test-coverage review), which is why it's flagged as the single highest-confidence blocker in this report.
- **Fix:** Apply the same conditional-`UPDATE ... WHERE status = 'payment_submitted'` (or `review_verdict IS NULL`) pattern already used in `expire_stale_bookings` to `approve_payment`, `reject_payment`, and `cancel_booking`. Add `tests/test_concurrency.py::test_concurrent_approve_reject_only_one_wins`.
- **Effort:** Small (the fix mirrors a pattern already in the codebase)

### 3. Double payment-proof submission has no lock — can un-confirm an already-approved booking
- **Severity:** 🔴 BLOCKER
- **Category:** Security / Data
- **Location:** `app/services/payment_service.py:109-166` (`submit_payment`), `app/services/booking_service.py:232-269` (`mark_payment_submitted`, `confirm_booking`)
- **Issue:** `submit_payment` reads `booking.status` with no row lock, then does a slow S3 upload + synchronous OCR call, and only afterward calls `mark_payment_submitted`/`confirm_booking` — both unconditional `UPDATE`s with no `WHERE status = ...` guard.
- **Attack/failure scenario:** A player double-taps "upload proof" on a slow 2G/patchy-4G connection (an explicit target condition for this pilot). Two concurrent requests both read `status == HELD` before either commits, both proceed through OCR. If request A auto-approves and confirms (`status = BOOKED`) while request B is still mid-flight, B's later `mark_payment_submitted` call unconditionally resets status back to `PAYMENT_SUBMITTED` — silently un-confirming a paid, approved booking, which the expiry job can then cancel hours later as "payment review expired," costing the player a slot they already paid for and were confirmed on. Related but distinct from Finding 2 (different call site, same missing-guard pattern) — also allows two `Payment` rows + two real OCR API calls for one booking.
- **Fix:** Add a partial unique index limiting one `payments` row with `review_verdict IS NULL` per `booking_id` (consistent with this codebase's "let the DB enforce it" philosophy), and guard `mark_payment_submitted`/`confirm_booking` the same way as Finding 2.
- **Effort:** Small

### 4. Schedule hours are stored/interpreted as UTC, not Pakistan local time — every venue's grid is off by 5 hours
- **Severity:** 🔴 BLOCKER
- **Category:** Data
- **Location:** `app/services/availability_service.py:57,92-93`, `app/schemas/court.py:9-10`, `apps/mobile/lib/venue-setup-store.ts:96`, `apps/mobile/app/(owner)/venue-setup/courts.tsx:32-33`
- **Issue:** `schedule_templates.open_time`/`close_time` are naive `time` values. The owner-facing wizard collects them as raw local wall-clock strings (e.g. default `"06:00"`, meant as Karachi local time) and sends them through unchanged. The availability engine then does `datetime.combine(target_date, template.open_time, tzinfo=timezone.utc)` — treating "6:00 AM" as **06:00 UTC**, i.e. **11:00 AM Pakistan time**. No `Asia/Karachi` conversion exists anywhere in the backend.
- **Attack/failure scenario:** Every venue that types normal local hours ("open 6 AM, close 11 PM") is actually bookable from 11:00 AM to 4:00 AM PKT the next day. This silently shifts the entire booking grid by 5 hours for every venue in the pilot — the core product is wrong for every single tenant on day one.
- **Fix:** Since Pakistan has no DST, apply a fixed 5-hour offset when combining `open_time`/`close_time` into UTC datetimes (or store a venue timezone field for correctness/future-proofing).
- **Effort:** Small (single conversion point) — but re-verify every schedule/pricing test and any already-seeded data after the fix.

### 5. No refund/dispute record when a paid booking auto-cancels — money can silently vanish from the system's view
- **Severity:** 🔴 BLOCKER
- **Category:** Business Logic
- **Location:** `app/services/booking_service.py:323-390` (`expire_stale_bookings`, `payment_review_expired` branch), `app/jobs/expiry_job.py:20-51`; confirmed by `grep -rn "refund" app/` returning zero matches anywhere in the codebase
- **Issue:** If an owner never acts on a submitted payment (and SMS — the final escalation rung — is unconfigured per the README), the booking auto-cancels at `PAYMENT_REVIEW_HOURS`. There is no refund record, dispute flag, or any trail that a real bank/JazzCash transfer likely happened and was never compensated.
- **Attack/failure scenario:** A player transfers real money, uploads proof, the owner ignores every WhatsApp/push nudge for 2 hours, the booking cancels, and the platform has zero record that money is owed back. This is the single most damaging real-money failure mode for a pilot built entirely on trust with new users.
- **Fix:** At minimum, write a `payment_disputes`/`refund_owed` row (or feed the existing `admin/disputes` queue) whenever a `payment_submitted` booking expires with `is_duplicate=false` and a non-`mismatch` OCR verdict, so admins have a queue of "player probably paid, got no booking" cases to chase manually before the pilot's first real incident becomes a trust-destroying surprise.
- **Effort:** Medium

### 6. OTP send failure is uncaught — burns the rate limit and 500s instead of degrading gracefully
- **Severity:** 🔴 BLOCKER
- **Category:** Ops / Security
- **Location:** `app/services/auth_service.py:47-49` (`request_otp`), `app/services/whatsapp_service.py:26-34` (`_send`)
- **Issue:** `request_otp` commits the OTP row to the DB *before* calling `whatsapp.send_otp`. `_send` retries 3x then re-raises on failure; nothing between there and the `/auth/request-otp` endpoint catches it.
- **Attack/failure scenario:** WhatsApp Cloud API is the *only* OTP channel (no SMS fallback). Any outage/latency spike means every `request-otp` call both (a) still counts against the 5-per-15-minute rate limit despite delivery failing, and (b) returns a raw unhandled 500 outside the app's own error envelope. A user can burn all 5 attempts with zero OTPs delivered and get locked out for 15 minutes, repeating for the duration of the outage — a total, silent login/signup outage with a confusing error screen and no way for the user (or support) to tell what's wrong.
- **Fix:** Wrap `send_otp` in try/except; on failure, roll back the OTP write (so it doesn't consume a rate-limit slot) and return a distinct `error.code` (`OTP_DELIVERY_FAILED`) the frontend can render meaningfully.
- **Effort:** Small

### 7. Vision-provider (OCR) outage is uncaught — can 500 every payment-proof submission platform-wide
- **Severity:** 🔴 BLOCKER
- **Category:** Business Logic / Ops
- **Location:** `app/services/payment_service.py:58-75` (`_extract_payment_proof`), `app/services/ai/http.py:40-55` (`post_json`, tenacity `reraise=True`)
- **Issue:** Only `PaymentExtractionValidationError` (malformed response shape) is caught around the vision call. A genuine vendor outage/timeout (`httpx.TimeoutException`/`NetworkError`/5xx) is retried 3x then re-raised — uncaught anywhere in `submit_payment`.
- **Attack/failure scenario:** This project's own CLAUDE.md documents the configured Gemini model being deprecated/renamed three times in two days — vendor instability is a proven near-term risk, not a hypothetical. When it recurs, every payment-proof upload 500s, contradicting the code's own comment that "a vendor-side glitch doesn't block the player's payment submission" (that guarantee only covers validation errors, not outages). The screenshot is already uploaded to S3 by this point, but the DB transaction never commits — the booking stays `held`, the player sees a raw 500, and may re-upload (duplicate-detection confusion) or believe their payment vanished. This can silently halt all bookings platform-wide during the pilot.
- **Fix:** Catch `httpx.HTTPError` (and the exhausted-retry case) alongside `PaymentExtractionValidationError`, degrading to the same `unreadable`/`_UNCONFIGURED_EXTRACTION` path so a vendor outage routes to manual owner review instead of failing the request outright.
- **Effort:** Small

### 8. Synchronous boto3 S3 calls block the entire asyncio event loop
- **Severity:** 🔴 BLOCKER
- **Category:** Ops
- **Location:** `app/utils/s3.py:11-18,26-47` (`_client()`, `upload_bytes`), called directly (not via `asyncio.to_thread`) from `app/services/payment_service.py:119` and `app/services/venue_service.py:121` inside `async def` handlers
- **Issue:** boto3 is synchronous and blocking, with no explicit timeout configured (default connect/read timeouts are ~60s each). Calling it directly inside an async request handler blocks the whole event loop for the call's duration.
- **Attack/failure scenario:** On a typical small pilot deployment (single worker), if S3 is slow or briefly unreachable, one payment-proof or venue-photo upload can freeze the **entire server** for up to a minute — no other request (OTP, availability, health check, unrelated bookings) can be served on that worker during that window. This directly answers "what happens when S3 upload times out": it doesn't error gracefully, it hangs the process for every user.
- **Fix:** Wrap the boto3 calls in `await asyncio.to_thread(...)`, and set explicit `connect_timeout`/`read_timeout` (e.g. 10s) via `BotoConfig`.
- **Effort:** Small

### 9. `BANK_DETAILS_ENCRYPTION_KEY` is missing from `.env.example` and silently falls back to the session-token secret
- **Severity:** 🔴 BLOCKER
- **Category:** Security
- **Location:** `app/utils/encryption.py:21`, `.env.example`
- **Issue:** `BANK_DETAILS_ENCRYPTION_KEY` doesn't appear in `.env.example` at all, so an operator copying the template for the pilot deployment has no signal it exists. `_fernet()` silently derives the encryption key from `SESSION_TOKEN_SECRET` when unset — real venue bank/IBAN/JazzCash account details end up protected by the same secret that's load-bearing for session-token integrity.
- **Attack/failure scenario:** Pilot ships with `.env` copied from `.env.example` (the documented setup flow) → the key stays unset by default → real Pakistani venue owners' bank details are encrypted with a secret that, if it ever leaks (log, backup, misconfigured error page), also compromises every user's session.
- **Fix:** Add `BANK_DETAILS_ENCRYPTION_KEY=` to `.env.example` with a comment requiring a distinct value; make `_fernet()` raise at startup (not silently fall back) when unset and `DEBUG=false`.
- **Effort:** Small

---

## 🟡 IMPORTANT

### 10. CORS wildcard + credentials ships as the default with no production guard
- **Severity:** 🟡 IMPORTANT
- **Category:** Security
- **Location:** `app/config.py:12`, `.env.example`, `app/main.py:49-55`
- **Issue:** `ALLOWED_ORIGINS` defaults to `["*"]` with `allow_credentials=True` in both `config.py` and `.env.example`, and nothing prevents this from shipping to the pilot as-is — there's no separate prod template or startup check.
- **Attack/failure scenario:** Reduced defense-in-depth for the web app: if a token is ever exposed to attacker JS by any other bug, an arbitrary site can make credentialed cross-origin requests. Bearer tokens aren't ambient like cookies, so this alone isn't directly exploitable, but it removes a layer other bugs could otherwise be caught by.
- **Fix:** Set explicit `ALLOWED_ORIGINS` for the pilot deployment; add a startup assertion that fails boot if `DEBUG=false` and `ALLOWED_ORIGINS == ["*"]`.
- **Effort:** Small

### 11. No per-user rate limit on the AI chat endpoint — direct cost-abuse vector
- **Severity:** 🟡 IMPORTANT
- **Category:** Security
- **Location:** `app/api/chat.py:14-20`, `app/middleware/rate_limit.py`
- **Issue:** `POST /chat/message` has only the blanket 1000 req/min-per-IP limiter; no per-user throttle.
- **Attack/failure scenario:** A single authenticated user can hammer the chat endpoint; each turn triggers a real, paid multi-turn Claude/Gemini tool-calling loop. With a fixed pilot AI budget this is a direct cost-abuse vector, and carrier-grade NAT (common in Pakistan) makes the per-IP limiter weaker than it looks for mobile users generally.
- **Fix:** Add a per-user rate limit on `POST /chat/message` (mirroring the OTP pattern), tuned to a realistic conversational rate (e.g. 20/min).
- **Effort:** Small

### 12. Payment-proof upload trusts client content-type only; no pixel-bomb protection
- **Severity:** 🟡 IMPORTANT
- **Category:** Security
- **Location:** `app/api/payments.py:54-58`, `app/services/payment_service.py:119-120`, `app/utils/image.py:7-15`
- **Issue:** File-type validation checks only the client-supplied `Content-Type` header. The file is uploaded to S3 *before* Pillow ever attempts to decode it for the perceptual hash, and `perceptual_hash` sets no `PIL.Image.MAX_IMAGE_PIXELS` cap and silently swallows decode exceptions.
- **Attack/failure scenario:** A crafted file with a spoofed `image/png` label and a huge declared pixel dimension ("pixel bomb") passes validation, gets stored regardless of what Pillow does with it, and consumes large memory/CPU synchronously inside the request handler when decoded. A handful of concurrent malicious uploads is a real resource-exhaustion risk against a small pilot-scale server.
- **Fix:** Set `PIL.Image.MAX_IMAGE_PIXELS` to a sane ceiling; reject (400) rather than silently proceeding when Pillow can't decode the "image."
- **Effort:** Small

### 13. Player-initiated cancellation of an already-paid booking has no refund tracking
- **Severity:** 🟡 IMPORTANT
- **Category:** Business Logic
- **Location:** `app/api/bookings.py:105-134`, `app/services/booking_service.py:199-230`
- **Issue:** `POST /bookings/{id}/cancel` lets a player cancel a `booked` (already-paid) booking with no refund-status field or record — same underlying gap as Finding 5, but for voluntary cancellation.
- **Attack/failure scenario:** Player pays the advance, then cancels for a legitimate reason; the app has no record the venue owes them anything back, so it's entirely dependent on the owner remembering an out-of-band cash refund with no system prompt or accountability.
- **Fix:** If refunds are genuinely meant to stay manual/out-of-app for the pilot, say so explicitly in the cancellation confirmation UI ("refunds are handled directly with the venue") so it isn't a silent gap; otherwise add a refund-status field.
- **Effort:** Small (UI copy) to Medium (real tracking)

### 14. Passive owner inaction is invisible to the dispute/admin system
- **Severity:** 🟡 IMPORTANT
- **Category:** Business Logic
- **Location:** `app/services/payment_service.py` (no code path sets `review_verdict` on timeout) vs. `app/services/admin_service.py`'s dispute query (counts `Payment.review_verdict == "rejected"` only)
- **Issue:** A payment that times out via `payment_review_expired` never gets `review_verdict` set — it stays `null` forever, and the admin disputes view only flags players with ≥2 explicit `rejected` payments from owners.
- **Attack/failure scenario:** An owner who simply never opens the approvals screen produces zero explicit rejections and thus zero dispute flags, even though every one of their players silently lost bookings (and possibly money, per Finding 5). The dispute system only catches owners who actively reject, not owners who passively ignore — likely the more common failure mode with new, untrained pilot venues.
- **Fix:** Count `payment_review_expired` cancellations per venue as a signal in the admin dashboard/disputes view, separate from explicit rejections.
- **Effort:** Small

### 15. Waitlist notification doesn't reserve the slot — FIFO order is advisory only
- **Severity:** 🟡 IMPORTANT
- **Category:** Business Logic
- **Location:** `app/services/waitlist_service.py:114-130` (`notify_matching_entries`)
- **Issue:** When a slot frees up, the FIFO-first waitlister is only *notified* — nothing reserves the slot for them. The availability endpoint shows it as bookable to anyone immediately.
- **Attack/failure scenario:** Two players are both polling the same court's availability (the frontend's documented 15s poll). The moment the waitlist winner is pushed a notification, any other player who refreshes first can hold the slot — the "first in line" guarantee doesn't actually hold.
- **Fix:** Give the notified waitlist entry a short exclusive hold window (e.g. 2 minutes) on the slot before it's shown as generally available, or auto-create a `held` booking for them directly.
- **Effort:** Medium

### 16. Duplicate-payment detection can be defeated with a different real receipt image (fraud vector for trusted repeat players)
- **Severity:** 🟡 IMPORTANT
- **Category:** Business Logic
- **Location:** `app/services/payment_service.py:85-107` (`_find_duplicate`) — perceptual-hash only; `ocr_ref` (extracted transaction reference) is never checked for reuse across visually different images
- **Issue:** A "trusted" repeat player (meets the venue's auto-approve threshold, zero prior rejections) could submit a screenshot of **someone else's real transfer** to the same venue's account — a visually different image, so the Hamming-distance dedup never flags it — and get auto-approved if the OCR-extracted amount happens to match.
- **Attack/failure scenario:** Real financial fraud against the venue owner, bounded to trusted/repeat players, invisible to the app since it never cross-checks the extracted `ocr_ref` against prior payments.
- **Fix:** Also treat a re-used `ocr_ref` within the lookback window as a duplicate signal; recommend venues periodically reconcile the ledger against actual bank statements during the pilot regardless.
- **Effort:** Small (code) / process change (reconciliation)

### 17. No-show marking has no owner-accountability path for missed check-ins
- **Severity:** 🟡 IMPORTANT
- **Category:** Business Logic
- **Location:** `app/services/booking_service.py:392-406` (`mark_overdue_no_shows`), `:18-23` (`recompute_reliability`)
- **Issue:** A booking becomes `no_show` purely from "no check-in by `NO_SHOW_GRACE_MINUTES` after `starts_at`," denting the player's `reliability_score` — with no way to distinguish "player never showed" from "venue staff forgot/was too busy to scan the QR," a plausible scenario at a small venue during peak hours.
- **Attack/failure scenario:** A reliable player is repeatedly marked unreliable through no fault of their own, with no appeal path.
- **Fix:** Give the player a way to dispute a no-show from My Bookings, or allow retroactive check-in within a grace window.
- **Effort:** Medium

### 18. No client-side request timeout anywhere — payment-proof upload can hang indefinitely on poor networks
- **Severity:** 🟡 IMPORTANT
- **Category:** Market Fit
- **Location:** `packages/api-client/src/client.ts` (`request`, `requestUpload`) — no `AbortController`, no `xhr.timeout`
- **Issue:** No request timeout exists on any API call, including the payment-proof upload, which uses raw `XMLHttpRequest`.
- **Attack/failure scenario:** On patchy 2G/4G (the stated target network), a stalled payment-proof upload spins the progress bar indefinitely with no error. The player doesn't know if their payment screenshot (and money) went through, may force-close mid-transfer, or re-upload — triggering duplicate-detection confusion on the single highest-stakes screen in the app.
- **Fix:** Set `xhr.timeout` (30-45s) with `xhr.ontimeout` → a distinct "upload timed out, check your connection" error; add `AbortController`-based timeouts to `fetch()` calls in `request()`.
- **Effort:** Small

### 19. Polling doesn't pause when the mobile app is backgrounded — battery/data drain
- **Severity:** 🟡 IMPORTANT
- **Category:** Market Fit
- **Location:** `apps/mobile/lib/query-client.ts` (no `focusManager`/`AppState` wiring); `refetchInterval` usage in `pay.tsx:39-42`, `venue/[slug].tsx`, `today.tsx`, `approvals.tsx`
- **Issue:** TanStack Query's React Native integration needs an explicit `AppState`-driven `focusManager.setEventListener` for `refetchInterval` to pause when backgrounded; this project never wires it up.
- **Attack/failure scenario:** Polling (payment status every 4s, availability grids, owner approvals) keeps firing on its raw interval even with the screen off, burning battery and mobile data on the cheap Android hardware this pilot targets.
- **Test to confirm severity:** Background the app for a few minutes and watch device network activity to confirm polling continues.
- **Fix:** Call `focusManager.setEventListener` with an `AppState` listener in `query-client.ts`.
- **Effort:** Small

### 20. No backup/restore procedure exists anywhere, documented or automated
- **Severity:** 🟡 IMPORTANT
- **Category:** Ops
- **Location:** N/A — process/infra gap (confirmed absent: no `.github/workflows`, no backup script, no `pg_dump` reference anywhere in the repo; `docker-compose.yml` volumes are local-only)
- **Issue:** README's entire plan is "production expects a managed Postgres" — there's no verification anywhere that automated backups and a tested restore will actually be configured before real booking/payment data goes live.
- **Attack/failure scenario:** A bad migration, accidental prod `DELETE`, or managed-Postgres misconfiguration during the pilot has no recovery path.
- **Fix:** Confirm the chosen managed Postgres provider's automated daily backups are enabled, and do one dry-run restore to a scratch instance before the pilot starts.
- **Effort:** Medium (mostly infra/verification, not code)

### 21. No platform-wide kill switch for AI chat / auto-approve
- **Severity:** 🟡 IMPORTANT
- **Category:** Ops
- **Location:** `app/config.py` (full scan) — only per-venue `auto_approve_enabled` exists (`app/models/venue.py`); no global flag for AI chat or OCR/auto-approve
- **Issue:** No boolean flag exists to globally disable AI chat or payment auto-approve without a code deploy.
- **Attack/failure scenario:** If the AI chat gets manipulated into an abusive tool-calling loop, or the vision OCR starts mis-extracting amounts and auto-approving underpaid bookings once multiple venues opt in, the only remedy today is an emergency code change + redeploy — slow and error-prone under pressure in week one of a live pilot with real money moving.
- **Fix:** Add a `GLOBAL_AUTO_APPROVE_ENABLED`/`AI_CHAT_ENABLED` settings flag read at request time, even as a simple env-gated short-circuit in `_maybe_auto_approve`/`ai_chat_service.process_message`.
- **Effort:** Small

### 22. No in-app support/help channel exists for players or owners
- **Severity:** 🟡 IMPORTANT
- **Category:** Market Fit / Ops
- **Location:** N/A — confirmed absent across `docs/screens/*.html` and both frontend apps
- **Issue:** No "report a problem"/contact/help path exists anywhere in either app.
- **Attack/failure scenario:** A player who sent real money and got stuck (owner unresponsive, OCR misread, app bug) has no designated in-app channel — they'll resort to calling the venue directly or disputing with their bank, with no record on the platform side. Given WhatsApp is already a first-class channel here, this is a cheap gap to close.
- **Fix:** At minimum, add a static "Need help? WhatsApp us at +92…" link/screen and route it into the existing dispute/flagged-user admin machinery where possible.
- **Effort:** Small

### 23. README's Local Setup omits LocalStack and the AI-provider test-alignment gotcha
- **Severity:** 🟡 IMPORTANT
- **Category:** Documentation
- **Location:** `court-booking-backend/README.md` "Local setup" (lines 69-78) and "Running tests" (lines 85-89)
- **Issue:** Neither section mentions starting `localstack`/creating the two S3 buckets, nor the `AI_PROVIDER`/`AI_VISION_PROVIDER` alignment needed for the suite to show 228/228 rather than a false-looking failure count — both are documented only in the two `CLAUDE.md` files (session context, not conventional onboarding docs).
- **Attack/failure scenario:** A new developer follows README verbatim, gets a clean `/health`, then hits `botocore.errorfactory.NoSuchBucket` on the first payment-proof upload with no clue why, or runs `pytest -v` and sees ~9 unexplained failures and reasonably concludes the checkout is broken.
- **Fix:** Fold the LocalStack bucket-creation step and the `AI_PROVIDER=claude AI_VISION_PROVIDER=claude` test-run note into README.md's actual Local Setup/Running Tests sections.
- **Effort:** Small

### 24. No operational runbook for the most likely real incidents
- **Severity:** 🟡 IMPORTANT
- **Category:** Documentation
- **Location:** Repo-wide — no `RUNBOOK`/`TROUBLESHOOTING`/`OPERATIONS` file or heading exists anywhere
- **Issue:** No documented response exists for: a payment stuck in `payment_submitted` past its escalation ladder, the configured OCR provider going down mid-pilot (already happened during dev, per CLAUDE.md's own Gemini history), or an owner disputing that "a booking looks wrong."
- **Attack/failure scenario:** Three weeks before a real-money pilot with non-technical venue owners, the first live incident has no documented response — whoever's on call reads service code cold, under time pressure, with a real player's money in limbo.
- **Fix:** Write a one-page runbook: how to manually approve/reject a payment via `/docs` or DB if the API misbehaves, how to check AI provider health and fail over `AI_VISION_PROVIDER`, and how to manually re-trigger `run_expiry_job` after a missed cron run.
- **Effort:** Small

---

## 🟡 VERIFY

### 25. Rate-limit counters are per-process — multi-worker deployment silently weakens the global limit
- **Severity:** 🟡 VERIFY
- **Category:** Security
- **Location:** `app/middleware/rate_limit.py:31`
- **Issue:** `self._buckets` is a plain dict on the middleware instance (per-process state).
- **Test to confirm:** Run with `--workers 2`, send requests from one IP at 1000-2000/min, confirm no 429 is ever returned.
- **Fix if confirmed:** Move to a shared store (Redis) if a multi-worker deployment is planned.
- **Effort:** Medium

### 26. Naive (offset-less) datetime input can 500 instead of returning a clean validation error
- **Severity:** 🟡 VERIFY
- **Category:** Data
- **Location:** `app/schemas/booking.py:9-12` (`BookingHoldIn.starts_at`), `app/services/booking_service.py:76`
- **Issue:** Pydantic v2 accepts an ISO datetime with no offset as naive; comparing it against `timezone.utc`-aware `datetime.now()` raises an uncaught `TypeError`.
- **Test to confirm:** `POST /bookings/hold` with `starts_at` lacking a `Z`/offset suffix; confirm it 500s. Normal app usage always sources times from the availability response (which includes `Z`), but the AI chat's `hold_slot` tool or a future client change could hit this.
- **Fix:** Add a Pydantic field validator that rejects/normalizes naive datetimes into a clean 400.
- **Effort:** Small

### 27. Court deactivation doesn't handle existing live bookings or waitlist entries
- **Severity:** 🟡 VERIFY
- **Category:** Data
- **Location:** `app/api/courts.py:102-108` (`deactivate_court`)
- **Issue:** Deactivating a court only flips `is_active=False`; it doesn't touch existing `held`/`payment_submitted`/`booked` bookings or active waitlist entries tied to that court.
- **Test to confirm:** Seed a future `booked` booking on a court, deactivate the court, confirm the booking silently remains `booked` with no notification to the player.
- **Fix:** Notify players with live/future bookings on deactivation and decide whether those bookings should auto-cancel (mindful of Finding 5/13) or be flagged for owner follow-up.
- **Effort:** Small

### 28. Venue photos render at full resolution with no resize/lazy-load — possible low-RAM device impact
- **Severity:** 🟡 VERIFY
- **Category:** Market Fit
- **Location:** `apps/mobile` player screens — plain `<Image>` usage, no resize pipeline found
- **Issue:** Venue photo lists render full-resolution S3-hosted images.
- **Test to confirm:** Load `/search` with 10+ seeded venues with real (non-placeholder) photos on a low-RAM Android emulator profile (e.g. 2GB RAM) and watch for scroll jank/crashes.
- **Fix if confirmed:** Serve resized thumbnails or use `expo-image` with `contentFit`/caching for list views.
- **Effort:** Medium

### 29. Admin suspend/unsuspend has no concurrency test
- **Severity:** 🟡 VERIFY
- **Category:** Code Quality
- **Location:** `tests/test_admin.py` — no concurrent-call test for `suspend_user`
- **Issue:** Low actual risk since `is_active=False` is naturally idempotent, but untested.
- **Test to confirm it's fine:** Two concurrent `POST /admin/users/{id}/suspend` calls; assert the user ends up suspended exactly once with one audit-log row.
- **Fix:** Add the test if audit-log double-writes matter for compliance reporting; otherwise accept as low-risk.
- **Effort:** Small

---

## 🟢 POST-PILOT

### 30. Upload buffers fully into memory before the 10MB size check runs
- **Severity:** 🟢 POST-PILOT
- **Category:** Security
- **Location:** `app/api/payments.py:56`
- **Issue:** `proof_bytes = await image.read()` reads the entire upload before the size check; no evidence of a reverse-proxy/ASGI-level body size cap in this repo.
- **Fix:** Confirm the eventual production reverse proxy (nginx/ALB) sets a max body size independently of the app-level check.
- **Effort:** Small (infra config)

### 31. Walk-in `amount_paid` has no sanity bound relative to court pricing
- **Severity:** 🟢 POST-PILOT
- **Category:** Data
- **Location:** `app/schemas/booking.py:14-19` (`WalkInBookingIn.amount_paid`), `app/services/booking_service.py:127-176`
- **Issue:** No upper bound or comparison against the court's actual computed price — an owner could fat-finger the amount with no confirmation step.
- **Fix:** Show the computed expected price/advance on the walk-in form and warn on large deviations.
- **Effort:** Small

### 32. OCR-extracted transaction timestamp is never validated against the booking window
- **Severity:** 🟢 POST-PILOT
- **Category:** Data
- **Location:** `app/services/payment_service.py` — `ocr_timestamp` stored but unused for validation
- **Issue:** Only image-hash dedup (90-day lookback) guards against reuse; nothing flags a screenshot whose own transaction timestamp predates the booking by, say, weeks.
- **Fix:** Flag (not necessarily reject) proofs whose `ocr_timestamp` is more than a day or two before the booking's hold time, for manual owner review.
- **Effort:** Small

### 33. `bank_details` is a generic JSONB blob, not JazzCash/Easypaisa-aware
- **Severity:** 🟢 POST-PILOT
- **Category:** Market Fit
- **Location:** `app/schemas/venue.py`, `app/models/venue.py`
- **Issue:** No distinct fields for a mobile-wallet account (phone number + title, no IBAN/bank name) — a JazzCash-only owner has to awkwardly stuff a phone number into bank-shaped fields.
- **Fix:** Add a `payment_method` discriminator (`bank`/`jazzcash`/`easypaisa`) with method-appropriate fields/copy in the venue-setup wizard.
- **Effort:** Medium

### 34. WhatsApp image handler guesses which booking a screenshot belongs to
- **Severity:** 🟢 POST-PILOT
- **Category:** Market Fit
- **Location:** `app/api/webhooks.py` `_handle_image`/`_most_recent_held_booking` (lines ~79-86)
- **Issue:** A payment screenshot sent via WhatsApp only ever matches the player's single most recent `held` booking — a player with two concurrent holds has no way to specify which.
- **Fix:** If more than one active held booking exists, reply asking which booking the screenshot is for instead of guessing.
- **Effort:** Small

### 35. DB pool exhaustion surfaces as a raw 500 rather than a clean 503
- **Severity:** 🟢 POST-PILOT
- **Category:** Ops
- **Location:** `app/database.py:10-14` — no explicit `pool_size`/`max_overflow` set (SQLAlchemy async defaults apply)
- **Issue:** No circuit breaker on pool exhaustion; the resulting `TimeoutError` is unhandled.
- **Fix:** Set explicit `pool_size`/`max_overflow` sized to expected concurrency; catch `sqlalchemy.exc.TimeoutError` for a clean 503.
- **Effort:** Small

### 36. Inconsistent `AppError` vs. bare `HTTPException` usage across route handlers
- **Severity:** 🟢 POST-PILOT
- **Category:** Code Quality
- **Location:** `app/api/*.py` — 8 of 9 route modules still use bare `HTTPException` (26 sites) vs. `payments.py`'s `AppError` (4 sites); this is an already-documented, intentional, additive migration per `CLAUDE.md`
- **Issue:** Most route-level errors outside payments still return a generic status-derived code, giving the frontend's `error.code` handling less to work with for those paths.
- **Fix:** No pilot-blocking action; migrate remaining sites opportunistically per the existing pattern.
- **Effort:** Medium (spread across files)

### 37. No canonical single-source PRD
- **Severity:** 🟢 POST-PILOT
- **Category:** Documentation
- **Location:** N/A — `docs/court-booking-app-prd.md` does not exist
- **Issue:** Spec knowledge is fragmented across both `CLAUDE.md` build histories and `docs/frontend-build-prompt.md`, with no single document a new contributor or pilot partner could read end to end. This has already caused a real drift once — the frontend build prompt describes an "Apply discount" growth button the backend never implemented.
- **Fix:** Consolidate into one `PRD.md`, or explicitly document in both CLAUDE.md files that the three-part spec (CLAUDE.md + frontend-build-prompt.md + FRONTEND_INTEGRATION.md) is authoritative together.
- **Effort:** Small

### 38. Duplicate-detection's 90-day lookback boundary is untested
- **Severity:** 🟢 POST-PILOT
- **Category:** Code Quality
- **Location:** `app/utils/image.py`, `tests/test_payments.py:162-232`
- **Issue:** No test exercises a proof at day 89 vs. day 91 relative to `now()` — an off-by-one in the lookback query would silently auto-approve a genuine duplicate submitted just past 90 days.
- **Fix:** Add `test_duplicate_outside_lookback_window_not_flagged` seeding a payment with `created_at` explicitly 91 days back.
- **Effort:** Small

---

## Confirmed non-findings (verified during this audit, no action needed)

- Sentry **is** wired (`app/main.py:39-40`) but `SENTRY_DSN` is blank in `.env.example` — a deployment checklist item, not a code defect. **Turn it on before pilot.**
- `create_walkin` goes through the same unique-index-protected insert path as app-side holds — no walk-in-vs-app double-booking race.
- The SMS escalation rung is a genuine, harmless no-op when unconfigured — doesn't break the escalation job.
- FCM push-send failures don't cascade into the calling request (confirmed no call site rolls back a booking confirmation because a push failed).
- WhatsApp genuinely supports a full search→hold→pay→confirm loop with zero app install (chat, image payment proof, and button-tap confirmation all route through real service methods) — the "WhatsApp-first" framing is accurate, not aspirational.
- No function over 100 lines found in the 7 largest backend files checked; largest was 75 lines.
- `packages/types`/`packages/api-client` have zero `any` usage — the type-mirroring discipline holds.
- Every documented endpoint/schema spot-checked (booking hold response, chat actions, error-code table) matched the actual implementation exactly — no drift found in the samples checked.
- The relocated `scripts/gemini_intent_extraction_experiment.py` is confirmed clean — zero references from `app/`/`tests/`.
- No CI/CD pipeline exists — expected and non-blocking for a pre-git-init project three weeks out, but worth setting up before or immediately after the pilot starts.

---

## Top 10 must-fix before pilot

Ranked by real-money/trust impact, not just severity label:

1. **No refund/dispute record when a paid booking auto-cancels** (#5) — the single scenario most likely to produce a player who lost real money and has no recourse. Fix the notification/flagging path even if actual refund execution stays manual.
2. **Payment approve/reject/cancel race condition** (#2) — corroborated independently three ways; a double-tap or two-device race can leave a booking in a contradictory state with real money attached.
3. **Schedule hours interpreted as UTC instead of PKT** (#4) — every venue's booking grid is wrong by 5 hours from day one of the pilot. Trivial fix, catastrophic if shipped as-is.
4. **WhatsApp webhook has no signature verification** (#1) — phone identity, the foundation of the entire WhatsApp channel, is currently spoofable by anyone who finds the URL.
5. **Double payment-proof submission can un-confirm an approved booking** (#3) — directly hits the pilot's core "did I get my slot" trust question on the exact network conditions (2G/patchy 4G) this pilot expects.
6. **OTP send failure burns the rate limit and 500s** (#6) — with no SMS fallback, a WhatsApp API hiccup becomes a total, silent login outage.
7. **OCR vendor outage can 500 every payment-proof submission** (#7) — this project has already lived through real Gemini instability; catch it before it takes down bookings platform-wide during the pilot.
8. **Synchronous S3 calls can freeze the entire server** (#8) — a slow S3 response hangs every user, not just the uploader.
9. **Bank details fall back to the session-token secret when the dedicated encryption key isn't set** (#9) — the exact failure mode a copy-pasted `.env.example` walks straight into.
10. **No platform-wide kill switch for AI chat/auto-approve** (#21) — cheap insurance against the first live incident during week one, when redeploying under pressure is the worst possible response.

Everything else in this document (🟡 IMPORTANT and below) is real and worth scheduling, but none of it is as likely to produce a headline-grade failure — a player who paid and has nothing to show for it, or a venue's entire schedule being silently wrong — in the pilot's first three weeks.
