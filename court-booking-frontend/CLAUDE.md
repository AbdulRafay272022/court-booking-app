# CLAUDE.md

Project context for future Claude Code sessions working on this repo. Read this
before writing any code — it tells you what's built, what's verified, what's
deliberately deferred, and how to keep testing the way this project has been
tested so far. The backend has its own `CLAUDE.md` at
`../court-booking-backend/CLAUDE.md` — read that too if you touch anything
backend-adjacent.

## What this is

The frontend for a court-booking platform (padel/futsal, Karachi pilot).
Built from three source documents in `../docs/`:

- `frontend-build-prompt.md` — the spec: tech stack, screen-by-screen
  behavior, API contract, and the **Section 18 sprint order**, which this
  project follows strictly (don't skip ahead — each sprint has an exit
  criterion that must be verified against the real backend before moving on).
- `FRONTEND_INTEGRATION.md` — the backend's actual, current API surface,
  written after an audit pass. **Trust this over `frontend-build-prompt.md`
  wherever they conflict** — it documents real gaps (no self-serve owner
  signup, push notifications are a non-functional stub, no SMS OTP fallback).
- `maidan-screens.html` — the approved visual design, 24 screens, self-contained
  as a JSON blob (`<script id="screens-data" type="application/json">`) of
  `{title, w, h, doc}` per screen name. It's a 230KB single line — **don't
  read it raw**. Already extracted once into `../docs/screens/<ScreenName>.html`
  (one small self-contained HTML file per screen) — read those instead. If
  that directory is gone, re-extract with a short Python script pulling the
  `screens-data` JSON blob and writing each `.doc` field to its own file.

Two deliberate design systems, never unify them: player-facing (auth, player
app, public web) is orange `#EF5A2C` / Figtree; owner-facing (owner app, venue
onboarding, admin, owner web dashboard) is teal `#0E6274` / IBM Plex Sans. Both
use IBM Plex Mono for numbers/times/prices. Exact tokens are in
`apps/mobile/tailwind.config.js` (`player-*` / `owner-*` color families,
`figtree-*` / `plex-*` / `mono-*` font families) — extend that file, don't
hardcode hex values in screens.

## Structure

```
packages/types/src/       TypeScript types — mirror the backend's actual Pydantic
                          schemas (app/schemas/*.py in the backend repo), not just
                          FRONTEND_INTEGRATION.md's prose. Several real discrepancies
                          were found this way (see Gotchas below) — when adding a
                          type for a new endpoint, read the backend schema file
                          directly rather than inferring from the docs.
packages/api-client/src/  One module per resource area (auth.ts, venues.ts, ...),
                          all composed by createCourtBookingApi() in index.ts.
                          client.ts has the base fetch wrapper: auth header
                          injection, silent refresh-on-401, ApiError with the
                          backend's error envelope. requestText() exists
                          alongside request() for non-JSON responses (CSV export).
                          submitPaymentProof() takes `string | Blob` for the image
                          (native passes a `uri` string, web passes a real File/Blob
                          from an <input type=file> or drag-and-drop) — never revert
                          this to string-only, web needs the Blob branch.
apps/mobile/              Expo SDK 57 + Expo Router + NativeWind v4. Role-gated
                          routing via Stack.Protected in app/_layout.tsx
                          (signedOut -> (auth), player -> (player), owner ->
                          (owner), admin -> (admin) placeholder).
                          (player)/ is Tabs-in-Stack: (player)/(tabs)/ holds the
                          three tab screens (index/bookings/profile), and
                          (player)/_layout.tsx is a Stack wrapping "(tabs)",
                          "search", "venue/[slug]", "booking/[id]/chat|pay|done",
                          "notifications" as full-screen pushes. Do NOT put
                          non-tab screens inside a Tabs navigator via href:null —
                          see the react-native-web Gotcha below.
apps/web/                 Next.js 16 (App Router), Tailwind v4 (CSS-first config
                          in app/globals.css's @theme block, no tailwind.config.js).
                          Shares packages/types and packages/api-client with mobile
                          — the booking flow (chat/hold/pay/done) is a from-scratch
                          React DOM implementation calling the *same* api-client
                          methods, not a divergent reimplementation of the logic.
                          Session: localStorage-backed (lib/auth-store.ts), a
                          deliberate documented tradeoff over the spec's preferred
                          httpOnly-cookie-via-API-route approach — revisit before
                          scaling past the pilot (Section 9.3 explicitly allows this
                          tradeoff for a pilot). lib/server-api.ts is a SEPARATE
                          fetch client from lib/api.ts, used only by Server
                          Components for public data — lib/api.ts reads a
                          module-level client Zustand store that would leak one
                          user's token across requests if used server-side.
```

## What's built and verified so far

**Sprint 1 (Foundations + auth)** — done, verified.
- `apps/mobile/app/(auth)/login.tsx`, `otp.tsx` — pixel-matched to
  `AuthLogin`/`AuthOtp`. Real `POST /auth/request-otp` / `verify-otp`.
- `lib/auth-store.ts` (Zustand) + `lib/api.ts` (wires the api-client's
  `getToken`/`onTokenRefreshed`/`onUnauthorized` to the store) + `lib/device.ts`
  (persistent `device_id`) + `lib/secure-storage.ts`.
- Verified end-to-end with Playwright against the real local backend: phone →
  OTP → verified → correct role-based redirect (tested both player and owner)
  → session survives a full reload.

**Sprint 2 (Owner venue setup)** — done, verified.
- `apps/mobile/app/(owner)/venue-setup/register.tsx` (step 1: basics, sports,
  address, real GPS pin via `expo-location` + reverse-geocode, optional bank
  details), `courts.tsx` (step 2: courts, hours, pricing — progressive
  disclosure, one flat rate by default), `pending.tsx` (real venue data from
  `GET /venues/:id`, status timeline).
- `apps/mobile/app/(owner)/index.tsx` — gate that calls `GET /owners/venues`
  on every owner-group entry and routes to the wizard / pending screen / Today
  accordingly.
- `lib/venue-setup-store.ts` — Zustand + AsyncStorage-persisted wizard draft,
  so abandoning mid-wizard doesn't lose progress. Tracks `createdVenueId` once
  `POST /venues` succeeds so a retry after a later step fails (e.g. court
  creation) doesn't create a duplicate venue — **repeat this idempotency
  pattern for any future multi-step submit flow** (e.g. a booking flow that
  chains multiple POSTs).
- Verified end-to-end: full wizard run through Playwright, then checked
  Postgres directly (not just the UI) — venue status/coords/sports, court
  slot length, all 7 days of schedule, and the pricing rule all landed
  correctly. Also verified the abandon-and-resume case and that reloading a
  submitted venue routes to the pending screen, not the wizard again.

**Sprint 3 (Owner operations)** — done, verified. `(owner)/today.tsx`,
`approvals.tsx`, `walkin.tsx`, `ledger.tsx` all built and E2E-tested against real
seeded data (approve/reject, 409 slot-conflict handling, CSV export). Growth
(8.6) deliberately deferred — not in Sprint 3's scope per Section 18.

**Sprint 4 (Player discovery)** — done, verified. `(player)/(tabs)/index.tsx`
(Home), `search.tsx`, `venue/[slug].tsx` (schedule grid, day tabs, 15s polling
while focused). Confirmed per-day status distinction (OPEN vs BOOKED) against
real seeded bookings.

**Sprint 5 (Booking core, mobile)** — done, verified end-to-end with two
concurrent actors (player + owner): `booking/[id]/chat.tsx` (real AI
tool-calling round trip, not canned text), `booking/[id]/pay.tsx` (held-until
countdown, payment-proof upload, polling-driven state transitions,
owner-rejection screen), `booking/[id]/done.tsx`, `(tabs)/bookings.tsx` (My
Bookings, cancel). The full happy path — tap slot → chat → hold → upload
proof → owner approves → auto-redirect to confirmation — was verified for
real, not mocked.

**Sprint 6 (Notifications + waitlist)** — done, verified. Push registration
(`lib/push-notifications.ts`, uses `getDevicePushTokenAsync` not
`getExpoPushTokenAsync` — see Gotchas) wired to sign-in/logout; deep-link
routing in `app/_layout.tsx` written and ready but untestable until the
backend adds a push `data` payload (documented, not a bug). Real in-app
notification list screens (`(owner)/notifications.tsx`,
`(player)/notifications.tsx`) reading `GET /users/me/notifications`. Waitlist
join/leave wired into `venue/[slug].tsx` ("Notify me" on booked slots) and
`(tabs)/profile.tsx` ("My Waitlist" section) — verified working end-to-end.

**Sprint 7 (Web app)** — done, verified. `apps/web/` bootstrapped from scratch
(Next.js 16, Tailwind v4). Public pages: `/` (venue-acquisition marketing
landing — matches the actual `WebLanding` mockup, which is NOT a player search
page despite the build prompt's prose implying one), `/search` (server
component, filters via URL query params, confirmed shareable), `/venues/[slug]`
(server-rendered with `generateMetadata` + schema.org JSON-LD — confirmed via
raw `curl`, no JS, that name/address/structured-data are in the initial HTML).
Full booking flow rebuilt for web as real React DOM (not React Native Web):
`/booking/[id]/chat|pay|done`, using a plain `<input type=file>` +
drag-and-drop for payment proof (no camera requirement, and no synthetic-click
limitation the way mobile's picker has on web — see Gotchas). Owner dashboard:
`/dashboard/owner/today|approvals|walkin|ledger` (ledger is a real table, per
the spec's own suggestion that a wider view suits a laptop better). Admin
console: `/dashboard/admin/venues` — venue approval/reject/request-changes
queue, genuinely new functionality that didn't exist on mobile or anywhere
else; before this, there was no UI path at all for a venue to go from
`pending` to `approved` short of a raw API call. Access control
(`lib/use-require-auth.ts`) verified: signed-out → `/login`, wrong role →
redirected away.

**Sprint 8 (Growth + error/offline hardening)** — done, verified.
`(owner)/growth.tsx` (mobile) and `/dashboard/owner/growth` (web): reads
`GET /owners/growth`, distinguishes three real states rather than mocking
any of them — 403 `FORBIDDEN` (venue not Pro/Business) shows a Pro-upsell
card, empty `underbooked_slots` shows a "check back in a few weeks" state,
and real suggestions render as cards with a THIS SLOT vs VENUE AVG
comparison bar. **No "Apply discount" button** — confirmed the backend has
no endpoint to actually create a temporary pricing rule from a suggestion,
so per the spec's own instruction this was flagged back rather than built
as a dead end (see Gotchas if a backend endpoint shows up later). Verified
live against the real backend for all three states, including seeding a
real `slot_stats` row and confirming the rendered numbers matched exactly.
Error/offline hardening (Section 12) done as a dedicated pass across both
apps: a shared `ErrorState` retry component wired into ~22 screens that
previously either spun forever or silently showed "empty" on a failed
fetch; exponential-backoff polling (`lib/polling.ts`'s `pollInterval`) on
all 6 live-polling screens; a real upload-progress bar for payment-proof
submission (`client.ts` gained `requestUpload`, using `XMLHttpRequest`
instead of `fetch` — see Gotchas); and a dependency-free offline banner in
both root layouts, verified live via Playwright's network simulation.
Section 11 (Roman Urdu / i18n) needed no code — verified no LTR-only text
rendering exists anywhere, and Section 15 explicitly excludes full Urdu UI
localization from scope.

**Sprint 9 (Pilot readiness)** — partially blocked, not done.
Backend's automated suite was **226/226 passing** under its checked-in
defaults at the time this paragraph was written (confirmed by isolating
and fixing a false-failure report — see the `AI_PROVIDER`/
`AI_VISION_PROVIDER` Gotcha below); it's grown substantially since via the
backend's own Section 23/24 pre-launch hardening passes — see
`../court-booking-backend/CLAUDE.md` for the current count, don't trust
the number above as still current. Two things this environment
genuinely cannot do: **real device testing** (no physical Android
phone or emulator available here) and **an EAS production build
submission** (needs your own Expo account login — an external,
consequential action, not something to do without you present). Readiness
gaps found while checking: no `eas.json` exists yet (`eas build:configure`
needs an interactive login), `app.json` is missing `android.package` and
`ios.bundleIdentifier`, and `extra.apiBaseUrl` is hardcoded to
`http://localhost:8000` — none of that will work off a real device without
a reachable backend URL and your EAS credentials.

**Not built / deliberately deferred**: Admin console's other tabs
(bookings/users/disputes/suspend — "internal admin tool surface,"
FRONTEND_INTEGRATION.md explicitly says a player/owner-facing build doesn't
need these; only the venue-approval queue was built since that's a real,
previously-total gap). My Bookings' QR check-in code and
review-prompt-on-completed (7.5 niceties) — no owner-side QR *scanning*
exists anywhere to make a player-side QR meaningful yet, and no review
submission screen was speced.

**Backend pre-launch hardening pass (2026-09-19, Section 23/24 on the
backend side) touched this frontend too** — code only, done from the
backend session without a matching frontend sprint number, so recorded
here rather than as a new "Sprint N":
- `packages/api-client/src/client.ts`: every `request()`/`requestText()`
  call now goes through a 30s `AbortController` timeout
  (`fetchWithTimeout`), and `requestUpload()` (the payment-proof XHR
  upload) sets `xhr.timeout = 45_000`. Both reject with a distinct
  `ApiError(code: "REQUEST_TIMEOUT")` instead of hanging indefinitely on
  the patchy 2G/4G this pilot targets. **Live-verified** (not just
  typechecked) with a throwaway Node script (`npx tsx`) against a
  deliberately-stalled local HTTP server — rejected cleanly at ~30s with
  that exact code. If any caller was relying on a request hanging forever
  (none found), it'll now see `ApiError` instead.
- `apps/mobile/lib/query-client.ts`: wired TanStack Query's `focusManager`
  to React Native's `AppState` (`AppState.addEventListener("change", ...)`
  → `focusManager.setFocused(status === "active")`, skipped on
  `Platform.OS === "web"`) — this is what actually makes
  `refetchInterval` polling pause when the app is backgrounded; it isn't
  automatic on React Native the way it is on web. **Not verified on a
  real device/emulator** (none available) — confirm by backgrounding the
  app and watching network activity actually stop before trusting this
  fully.
- New `lib/support.ts` in both `apps/mobile` and `apps/web`
  (`SUPPORT_WHATSAPP_NUMBER` + a `wa.me` link helper) — wired into the
  player profile screen and owner `today.tsx` header (mobile), and the
  owner dashboard sidebar + the payment `pay` screen header (web, the
  highest-stakes screen in the app). **`SUPPORT_WHATSAPP_NUMBER` is a
  placeholder (`+923000000000`)** — replace with the pilot's real support
  number before launch; grep both `lib/support.ts` files for the `TODO`.
- Backend now has a second, player-facing check-in path
  (`POST /bookings/{id}/checkin/self`, a per-venue QR token) alongside
  the existing owner-scans-the-player's-QR flow — **no frontend UI exists
  for either the scanning or the venue-QR-display side of this yet**,
  same gap as the pre-existing "My Bookings' QR check-in code" line above.
  Building it needs: an owner-facing screen to view/print the venue's
  `checkin_qr_token` (`GET /venues/{id}`, owner/admin-only field) and a
  player-facing camera-scan screen calling the new endpoint — neither
  speced in the original screens, so check with the project owner on
  design before building.

## How this project gets worked (recipe for the next sprint)

1. **Read the relevant screen(s) from `../docs/screens/*.html`** before
   writing that screen — don't approximate from memory or from the build
   prompt's prose description alone.
2. **Cross-check any new API usage against the backend source**
   (`../court-booking-backend/app/api/*.py` and `app/schemas/*.py`), not just
   `FRONTEND_INTEGRATION.md`. The docs are a good map but have already been
   caught out on a few field-level details (see Gotchas).
3. **Build the screen**, reusing existing lib/ helpers (`api`, `auth-store`,
   `error-messages`, `colors`, `secure-storage`) and existing components
   (`components/icons.tsx`) rather than duplicating them. Add new SVG icons
   there with exact paths copied from the mockup, not from an icon library —
   pixel-fidelity is the point.
4. **Typecheck**: `cd apps/mobile && npx tsc --noEmit`, `cd apps/web && npx tsc
   --noEmit` (or `npm run typecheck --workspaces --if-present` from the repo
   root, though that currently skips `apps/mobile` since it has no
   `typecheck` script — run it directly there), and the same in
   `packages/types`, `packages/api-client` if those changed.
5. **Run the real backend and test end-to-end**, not against mocked data —
   see "How to run and test" below. This project's own spec explicitly
   requires this before moving to the next sprint.
6. **Clean up**: delete any scratch E2E/screenshot scripts you wrote (Sprint
   3-7 sessions wrote these into `apps/mobile/` even when testing the *web*
   app, since that's where the working Playwright install lives — see the
   Gotcha below) and any test users/venues/bookings you created in the
   database (`DELETE FROM payments; DELETE FROM bookings; DELETE FROM
   otp_requests;` — never touch the seeded users/venue/court from
   `app/seed.py`, they're meant to persist).
7. **Report the sprint's exit criterion explicitly** (each sprint in Section
   18 has one). The default working rhythm has been to ask before continuing
   to the next sprint, but when the user pre-authorizes a range up front
   ("start sprint 3,4,5,6,7"), work through the whole range and report at the
   end (or at natural checkpoints) rather than stopping after each one.

## How to run and test

Backend (from `../court-booking-backend/`):
```bash
docker compose up -d db localstack   # Postgres+PostGIS (5433) AND S3 (4566) -- both required now
.venv/Scripts/python.exe -m uvicorn app.main:app --reload   # http://localhost:8000
```
**`localstack` didn't used to be started by habit** (only `db` was) — as of
Sprint 5 this matters: payment-proof upload (`POST
/bookings/:id/payment-proof`) needs real S3, and `.env` now has
`AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test` /
`AWS_ENDPOINT_URL=http://localhost:4566` pointing at it (see Gotchas). If
LocalStack was just started fresh (no persisted volume, or after `docker
compose down -v`), the two buckets need creating once — `.env.example` has the
one-line `aws s3 mb` commands. **`.env` also has `AI_PROVIDER=gemini`**, not
the checked-in default `claude` — Claude/OpenAI have no API key configured in
this environment and silently degrade to a canned no-actions reply (see
Gotchas); Gemini's key is real and verified working. Restart `uvicorn` after
touching `.env` — settings load once at import time.

No staging environment exists — this is the only backend there is. WhatsApp
delivery is NOT configured in this env, so OTPs are never actually delivered.
To complete a real login/signup flow in testing, brute-force the OTP from the
local DB (it's plain unsalted SHA-256, `app/utils/security.py`'s own comment
says this is intentional given the 5-minute expiry/5-attempt/rate-limit
protections — legitimate only because it's your own local dev DB). **Watch
the `OTP_MAX_ATTEMPTS`-per-15-minutes rate limit** when scripting repeated
logins in a test loop — `DELETE FROM otp_requests WHERE phone = ...` resets it
instantly and is the standard fix, not waiting it out:

```python
# query otp_requests for the phone, ORDER BY created_at DESC LIMIT 1, then:
import hashlib
for i in range(1_000_000):
    code = f"{i:06d}"
    if hashlib.sha256(code.encode()).hexdigest() == stored_hash:
        print(code); break
```

Mobile:
```bash
cd apps/mobile
npx expo start --web --port 8081   # fastest local iteration loop in a sandboxed/headless env
```
Real device testing (Android/iOS via Expo Go) is the actual target platform
and the only way to test push notifications, camera/image-picker, and
Alert.alert-based confirmations (see Gotchas) — but the web target is good
enough for testing screen logic, forms, and API integration without a device.
**After installing a new native package (`expo install X`), restart the
Metro/Expo dev server** if one was already running — it resolves
`node_modules` from before the install and 500s on the new import with a
confusing "package itself specifies a main module field that could not be
resolved" error even though the file genuinely exists on disk. Hit this in
Sprint 6 with `expo-notifications`; a fresh `--clear` restart fixed it
immediately. (`expo-file-system`, added in Sprint 3, only ever got imported
inside a `Platform.OS !== "web"` branch that the web test loop never
executes, so it never actually got resolution-tested this way — worth
double-checking on a real device before trusting it blindly.)

Web:
```bash
cd apps/web
npx next dev --port 3100
```
Needs `apps/web/.env.local` with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`
(already checked in). First hit to any route is slow (on-demand compile) —
account for that in any test script's timing, don't assume a click fired
just because the wait elapsed.

**Driving either web target headlessly**: Playwright (`npx playwright install
chromium` once) works well — `chromium.launch()`, `newContext({viewport,
storageState})` to persist a logged-in session across scripts, `page.goto`,
`getByPlaceholder`/`getByText`, `page.keyboard.type` for the mobile OTP boxes
(they're one hidden `TextInput` behind 6 visual boxes, not 6 real inputs; the
web OTP screen is a single real `<input>`, no such trick needed). The
Playwright *npm package* only got installed under `apps/mobile/`'s
`node_modules` (from earlier sprints, undeclared in any package.json) — an
unrelated `npm install` at the repo root can prune it as "extraneous" (hit in
Sprint 7); `npm install --no-save playwright` from `apps/mobile/` brings it
back without re-touching any package.json, and the downloaded Chromium
browser binary itself survives in a user-level cache dir either way. Write
scratch driver scripts as one-off `.cjs` files inside `apps/mobile/` (so
`require("playwright")` resolves) **regardless of which app they're actually
testing** — a Sprint 7 script driving `localhost:3100` (the web app) still
has to live there — and **delete them when done**; they're not meant to
accumulate. A hidden-but-still-mounted previous screen in the same Stack (or
React root, for the Playwright-driven browser tests) commonly has its own
copy of whatever text/label you're matching — filter to
`await locator.isVisible()` rather than blindly taking `.first()`, or you'll
silently interact with the wrong screen's element. Icon-only buttons (no
visible text, e.g. a bell) need `accessibilityLabel` (RN) / `aria-label`
(web) added deliberately so `getByLabel()` can find them — there's no
reliable positional/coordinate way to hit them headlessly.

## Deployment pipeline (2026-09-19, Part 0)

This project's git repository lives **one level up**, at the repo root
(`../`), as a single monorepo covering both `court-booking-frontend/` and
`court-booking-backend/` — it didn't exist as a git repo at all until this
pass. GitHub: `AbdulRafay272022/court-booking-app`, private.

**`apps/web/Dockerfile` is new** (didn't exist before this pass) and
**`apps/web/next.config.ts` gained `output: "standalone"`** — both
required for a production image, and both live-verified for real
(`docker build` + `docker run`, a genuine 200 on `/login`), not just
typechecked. Two things worth knowing if you ever touch either:

- **The Docker build context must be the workspace root
  (`court-booking-frontend/`), not `apps/web/`** — this is an npm
  workspaces monorepo (`apps/web` depends on `packages/types` and
  `packages/api-client`, raw-TS packages with no build step of their
  own), so `npm ci` needs the root `package.json`/`package-lock.json` in
  scope to resolve workspace linking. `docker build -f apps/web/Dockerfile .`
  run from `apps/web/` itself will fail; it has to be
  `docker build -f apps/web/Dockerfile -t <tag> .` run from
  `court-booking-frontend/`. `../.github/workflows/deploy.yml` gets this
  right (`context: court-booking-frontend`); don't "fix" it to look more
  conventional.
- **Next's `output: "standalone"` build, in a monorepo, puts `server.js`
  at `.next/standalone/apps/web/server.js`, not at the standalone root**
  (mirrors the workspace path) — confirmed by actually inspecting the
  build output rather than assuming the single-app-repo layout most
  Next.js Docker examples show. `public/` and `.next/static` have to be
  copied to sit *next to* `server.js` (i.e. into `apps/web/public` and
  `apps/web/.next/static` inside the final image), not to the image
  root — got this wrong on the first pass (assets 404'd), caught by
  actually running the container rather than trusting the Dockerfile
  logic on paper.

`apps/mobile` has **no Dockerfile and isn't part of this pipeline** — it
ships via Expo/EAS (see Sprint 9 above), a completely different
distribution path, not a container at all.

See `../infra/README.md` for the ECR/GitHub-Actions-OIDC Terraform (no
long-lived AWS keys — the deploy workflow assumes an IAM role via OIDC,
scoped to only this repo) and `../court-booking-backend/CLAUDE.md`'s
matching section for the backend-image half of the pipeline. EC2
provisioning itself is deliberately deferred to a later part — the
workflow's SSH-deploy step checks for `EC2_HOST`/`EC2_SSH_KEY` secrets
and skips cleanly (a warning, not a failure) until they exist.

## Gotchas worth remembering

- **`VenueOut` (the backend's actual read schema) does not return
  `latitude`/`longitude`** — they're write-only (accepted by
  `POST`/`PATCH /venues`). `packages/types/src/venue.ts`'s `Venue` interface
  reflects this; don't add them back without checking the backend schema
  changed.
- **`PATCH /auth/me` returns a bare `User`, not `MeOut`** (unlike `GET
  /auth/me`, which returns `{user, session}`). Easy to get backwards.
- **`Court`/`ScheduleTemplate`/`PricingRule` all carry `id`/`is_active`** in
  their real `Out` schemas — the build prompt's Section 13 stub omits these.
  Always check `app/schemas/court.py` directly for court-related shapes.
- **NativeWind v4 + react-native-web crashes on boot if `tailwind.config.js`
  doesn't set `darkMode: "class"`** (defaults to `"media"`, which throws
  `Cannot manually set color scheme...` from a `MutationObserver` inside
  `react-native-css-interop` the moment anything else gets inserted into
  `<head>`). Already fixed — don't remove that line. The app is light-only per
  the approved design anyway, so this has no visible effect beyond avoiding
  the crash.
- **`expo-secure-store` has no web implementation.** `lib/secure-storage.ts`
  shims to `localStorage` on web, real SecureStore on native. Use this
  wrapper (not `expo-secure-store` directly) for anything that needs to work
  under `expo start --web`.
- **`Alert.alert` is a no-op under `react-native-web`** — no dialog renders,
  no button callback fires. This affects `confirmLogout()` and every
  "coming soon" dead-end tap when testing via the web target — they're fully
  functional on real iOS/Android (confirmed this is a react-native-web
  limitation, not an app bug), but you cannot verify them through the
  Playwright/web loop. Trust the code, don't chase a false negative here.
- **Backend gaps that are deliberately NOT worked around** (per
  `FRONTEND_INTEGRATION.md` and the build prompt's Section 15): no self-serve
  owner signup (the "I run a venue" tap on login shows an explanatory alert,
  doesn't fake a flow), no SMS OTP fallback (the "Send by SMS instead" button
  is the same treatment), no venue verification document upload endpoint (the
  `VenueRegister` mockup's ID/proof-of-address/NTN upload cards were dropped
  from `register.tsx` entirely — don't add them back without a real backend
  endpoint).
- **Windows + Git Bash**: use `.venv/Scripts/python.exe`, not
  `.venv/bin/python`, when shelling into the backend's venv from here.
- **Local dev has no working S3 or working chat by default** — see the
  LocalStack/`AI_PROVIDER` fixes under "How to run and test" above. Without
  them, payment-proof upload 500s and `/chat/message` silently degrades to a
  canned no-tool-calling reply (no exception, no error — it just never
  produces a `confirm_booking` action, which looks like an AI/prompt problem
  but is actually a missing-API-key config issue). Check both before
  assuming a booking-flow bug is real.
- **The AI doesn't know "today's date."** A relative phrase like "available
  on Wednesday" in a chat message can resolve to a date in the wrong
  week (or the wrong year) since the model has no injected current-date
  context — this is a backend system-prompt gap, not something the frontend
  can fully fix. Worked around in `booking/[id]/chat.tsx` (both apps) by
  spelling out the exact ISO calendar date (`toISOString().slice(0,10)`) in
  the auto-generated opening message instead of a weekday name. If a
  freeform user-typed message uses a relative date and gets misresolved,
  that's this same gap surfacing somewhere it can't be worked around client-side.
- **`expo-image-picker`'s web implementation can't be driven headlessly.** It
  opens the file chooser via `input.dispatchEvent(new MouseEvent("click"))`
  (not the `.click()` method), which doesn't carry real user-activation in
  automated/headless Chromium, so the picker "cancels" instantly and no
  `[data-testid="file-input"]` element sticks around to hand `setInputFiles`
  to. Same category as the `Alert.alert` web gotcha below — real on-device
  behavior is untouched, only the automated web test loop is blocked. Verify
  the picker's *call site* (permission request → launch → asset shape) by
  reading the code, and verify the actual upload endpoint integration by
  calling `submitPaymentProof` directly (or via a raw `httpx` proof upload in
  a scratch script) while watching the same live screen's polling react to
  the resulting state change — that's what Sprint 5's E2E test did. Not an
  issue on `apps/web` — a plain `<input type=file>` has no such restriction,
  confirmed working there with `setInputFiles` directly.
- **Don't put a non-tab screen inside a `Tabs` navigator via `href: null`** to
  hide it from the tab bar while still navigating to it with `router.push`.
  It technically works on native, but on `react-native-web` the hidden
  screen's container can end up stacked *above* the actually-focused tab
  screen in the DOM and silently swallow every click geometrically inside its
  bounds — surfaced in Sprint 4 as sport-filter chips on `/search` being
  unclickable. Fix: keep non-tab full-screen routes (search, venue detail,
  the booking flow, notifications) as siblings of the `Tabs` navigator inside
  a wrapping `Stack`, not children of the `Tabs` group itself — see
  `(player)/_layout.tsx` (the `Stack`) vs `(player)/(tabs)/_layout.tsx` (the
  `Tabs`).
- **A shared non-route file living inside an Expo Router directory (e.g.
  `_components.tsx`) needs an explicit `<Tabs.Screen name="_components"
  options={{href: null}} />`** if that directory is wrapped in a `Tabs`
  navigator — unlike `Stack`, which silently ignores extra files, `Tabs`
  auto-registers every matching route file as a real tab unless told
  otherwise, which showed up as a broken extra tab labeled "_components".
- **Two routes with the same bare path under different top-level role groups
  (e.g. both `(owner)/notifications.tsx` and `(player)/notifications.tsx`)
  are fine in real usage** (only one role's group is ever mounted at a time,
  and in-app navigation always uses the fully-qualified path like
  `/(player)/notifications`) **but ambiguous for a raw `page.goto("/notifications")`
  in a test script** — it isn't guaranteed to resolve to the currently
  logged-in role's screen. Test bell-icon-style navigation by clicking the
  real in-app button (via `accessibilityLabel`/`aria-label`), not by
  hardcoding the bare URL.
- **Next.js 16's `PageProps<'/route'>` / `LayoutProps<'/route'>` typed-route
  helpers pass `params`/`searchParams` as `Promise`s even to client
  ("use client") page components** — unwrap with React's `use()` hook, not
  `await` (client components can't be `async`). Confirmed by reading the
  generated `.next/types/routes.d.ts` rather than assuming Next 15-era
  behavior, since this repo's `apps/web/AGENTS.md` warns this Next version
  may differ from training-data conventions.
- **Tailwind v4 in `apps/web` is CSS-first** (`@theme` block in
  `app/globals.css`), not a `tailwind.config.js` — don't add one expecting it
  to be read; extend the `@theme` block instead. Font families loaded via
  `next/font/google` need their `variable` CSS custom property re-exposed
  through `@theme` (`--font-figtree: var(--font-figtree-x)`) for a Tailwind
  utility class like `font-figtree` to actually resolve to the loaded font
  rather than a static fallback stack.
- **Workspace packages that ship raw `.ts` source with no build step
  (`packages/types`, `packages/api-client`) need
  `transpilePackages: [...]` in `apps/web/next.config.ts`** — Next only
  transpiles `node_modules` packages (symlinked workspace packages included)
  that are explicitly listed there; without it, importing them 500s at
  runtime even though `tsc` typechecks fine (types resolve via the `types`
  field regardless; only the *runtime* JS bundling needs the config).
- **The backend's `.env` has BOTH `AI_PROVIDER=gemini` AND a separate
  `AI_VISION_PROVIDER=gemini`** (payment OCR reads `AI_VISION_PROVIDER or
  AI_PROVIDER`, `app/services/payment_service.py`) — both deliberate local
  overrides from an earlier session, not the checked-in defaults
  (`claude`/blank). This makes 9 backend tests *look* broken
  (`test_ai_chat.py` x5, `test_ai_providers.py::test_default_provider_is_claude`,
  `test_payments.py`'s 3 OCR tests) when running the suite in this
  environment — they all monkeypatch Claude-specific code paths
  (`httpx.AsyncClient.post` with Anthropic-shaped JSON, or
  `ClaudeProvider.extract_payment_proof` directly), which never fire
  because the app actually constructs a `GeminiProvider` at runtime instead.
  Confirmed via `AI_PROVIDER=claude AI_VISION_PROVIDER=claude .venv/Scripts/python.exe
  -m pytest` — **226/226 pass**. Not a regression, not something to "fix" by
  editing `.env` (that override is what lets manual chat/OCR testing exercise
  a real key) — just don't mistake this env-specific noise for a real
  failure count when running the backend suite from this repo's `.env`.
- **`fetch` has no reliable cross-platform upload-progress event** (needed
  for Section 12's payment-proof upload progress bar) — `client.ts` gained a
  second entry point, `requestUpload()`, built on `XMLHttpRequest` instead
  (`xhr.upload.onprogress`), which browsers and React Native's XHR polyfill
  both support. Mirrors `request()`'s auth-header injection, 401-refresh-retry,
  and `ApiError` envelope by hand since `XMLHttpRequest` doesn't share any of
  that machinery with `fetch`. `submitPaymentProof()` takes an optional
  trailing `onProgress: (fraction: number) => void` — verified live (real
  XHR upload, real progress events, real state transition), don't revert it
  back to `request()`/`fetch`.
- **No NetInfo/expo-network package is installed on mobile** for Section
  12's offline banner, and installing one couldn't be verified without a
  real device this session (see the "restart Metro after `expo install`"
  gotcha above) — `lib/network-status.ts` polls the backend's own `/health`
  every 8s instead on mobile (`lib/network-status.ts` + `components/offline-banner.tsx`).
  Web's equivalent uses the browser's real `online`/`offline` events
  instead (`navigator.onLine` is reliable there) — don't try to unify the
  two implementations, they're deliberately different per-platform.
- **`GET /owners/growth` has no matching "apply a discount" endpoint** —
  confirmed by reading `app/services/owner_dashboard_service.py` and
  `app/schemas/owner_dashboard.py` directly; `GrowthSuggestionOut` carries no
  pricing-rule-creation action. The `OwnerGrowth` mockup shows an "Apply
  discount" button and a couple of suggestion types (churn, sell-out) this
  backend doesn't compute at all — `growth.tsx`/`growth/page.tsx`
  deliberately only render what `GrowthOut.underbooked_slots` actually
  provides, with no action button. If a backend endpoint for this shows up
  later, wire it in rather than assuming the mockup's button was already
  meant to be non-functional.
- **A brand-new Expo Router route file won't typecheck until the dev server
  has run at least once** — `npx tsc --noEmit` errors with "not assignable
  to... 155 more... route strings" for a route that exists on disk but isn't
  in `.expo/types/router.d.ts` yet; that file only regenerates while `expo
  start` (or `expo export`) is actively scanning the `app/` directory. Hit
  this adding `(owner)/growth.tsx` — fixed by briefly running `expo start
  --web` and hitting the dev server once (a plain `curl` to it is enough to
  trigger the scan) before re-running `tsc`.
- **This sandboxed environment blocks WebSocket upgrades**, which breaks
  Next dev's Turbopack HMR client badly enough that pages never finish
  hydrating (`getByRole(...).click()` fires with no error but no `onClick`
  handler runs) — `npx next dev` is not reliable for scripted/Playwright
  testing here. `npx next build && npx next start` (production mode, no HMR
  websocket) hydrates and behaves normally and is what actually caught the
  login-flow-works confirmation this session. Prefer production mode for
  any future scripted web verification in this environment.
- **A freshly-started LocalStack has no S3 buckets** even after `docker
  compose up -d localstack` succeeds — `aws s3 mb` (see `.env.example`'s
  one-line commands) still needs running once per fresh start/`down -v`.
  Symptom if skipped: the payment-proof upload 500s, the booking never
  leaves `held`, and no `payments` row is created — but the failure is easy
  to miss in a headless/scripted test since it surfaces as a plain browser
  `alert()` (not page text), which Playwright auto-dismisses silently unless
  a `dialog` handler is registered. Check bucket existence
  (`aws --endpoint-url=http://localhost:4566 s3 ls`) before assuming a
  booking-flow bug is in the frontend code.
- **`api-client`'s TypeScript can be exercised directly with `npx tsx`
  without needing Jest/a test runner set up** (2026-09-19) — neither
  `apps/mobile` nor `apps/web` nor any package here has a configured test
  framework, but `packages/api-client` has no build step either (ships
  raw `.ts`, `main`/`types` point straight at `src/index.ts`), so a
  throwaway `.mjs` script placed *inside* that package directory (not an
  absolute path elsewhere — `tsx` errors with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` on an absolute Windows path passed
  as a bare module specifier) and importing `./src/client.ts` with a
  relative path runs it directly, real `fetch`/`AbortController`/Node
  `http` server and all. Used this to live-verify `client.ts`'s new
  request-timeout behavior; delete the script when done, same convention
  as the Playwright scratch-driver scripts below.
- **`SUPPORT_WHATSAPP_NUMBER` in both `apps/mobile/lib/support.ts` and
  `apps/web/lib/support.ts` is a placeholder (`+923000000000`) — replace
  before launch.** Deliberately routes through the same WhatsApp number
  already used for OTP/notifications/chat (not a new support channel) so
  it lands in the backend's existing inbound-message pipeline with zero
  new backend work — see the backend's `AUDIT_FINDINGS.md` finding #22.

## Next step

Sprints 1 through 8 (foundations, owner venue setup, owner ops, player
discovery, booking core, notifications + waitlist, the web app, and growth +
error/offline hardening) are all done and verified end-to-end against the
real backend — see "What's built and verified so far" above. Sprint 9 (pilot
readiness) is the only one not done, and most of what's left in it needs you
directly rather than more frontend code:

- **Real device testing on a cheap Android phone** — needs an actual device;
  couldn't be done from this environment.
- **EAS production build** — needs `eas build:configure` (interactive Expo
  account login) to generate `eas.json`, then `app.json` needs
  `android.package` / `ios.bundleIdentifier` added, and `extra.apiBaseUrl`
  needs to point at a real reachable backend instead of
  `http://localhost:8000` before a device build is useful at all.
- **Revisit the web session-storage tradeoff** (`apps/web/lib/auth-store.ts`)
  before scaling past the pilot — localStorage was chosen deliberately for
  now per Section 9.3's explicit allowance, not by default.
- **Rotate the `GEMINI_API_KEY`** committed in the backend's `.env` (flagged
  in the backend's own `CLAUDE.md`) now that it's been exercised for real by
  this project's chat *and* OCR flows, and eventually get a real
  `ANTHROPIC_API_KEY` so `AI_PROVIDER`/`AI_VISION_PROVIDER` can move back to
  the checked-in defaults — until then, remember the backend test suite
  reads as short of its real total from this repo's `.env` for reasons
  that have nothing to do with the code (see the Gotcha below and the
  backend's own `CLAUDE.md` for the current real count/reason) — it's not
  an actual regression.
- **Admin console's other tabs** (bookings/users/disputes/suspend) if a real
  need for them shows up — currently out of scope per
  `FRONTEND_INTEGRATION.md`'s own framing of admin as an internal tool
  surface; only venue approval was built since nothing else provided any UI
  path to approve a venue at all. Note the backend now has three *more*
  admin-only endpoints with no frontend surface at all yet
  (`GET /admin/disputes/refund-queue`, `/passive-venues`,
  `/flagged-checkins` — all from the backend's Section 23/24 hardening
  passes) — same "internal tool, build if a real need shows up" framing
  applies.
- The error/offline hardening pass covered every screen's *primary* data
  fetch but not every `useQuery` call in the codebase (e.g.
  `lib/use-owner-venues.ts`'s own failure isn't surfaced — a failed venues
  list silently leaves every owner screen looking empty rather than erroring)
  — worth a follow-up pass if this shows up in practice, not urgent.
- **The player-self-checkin QR endpoint and the two new admin queues above
  have zero frontend UI** — see the "Backend pre-launch hardening pass"
  paragraph under Sprint 9 above for what exists API-side and what
  building the UI would need.
- **`NEXT_PUBLIC_API_BASE_URL` is baked into the client bundle at `next
  build`, NOT read from the running container's environment** (found
  2026-09-19, Section 25). `apps/web/lib/config.ts` reads it for client
  components too, and Next inlines `NEXT_PUBLIC_*` at build time, so the
  Part 0 image -- whose Dockerfile comment claimed it was runtime-only --
  would have shipped a site whose browser code calls
  `http://localhost:8000`. The Dockerfile now takes it as a build `ARG`;
  `.github/workflows/deploy.yml` passes the `API_BASE_URL` Actions
  variable (`terraform output api_base_url`). Consequence: **changing the
  API hostname requires rebuilding the web image**, not just editing
  `.env.web` on the instance. Server Components read it at runtime too,
  which is why `.env.web` still sets it -- but that only covers server
  fetches.
- **The EC2 deploy path is SSM Run Command, not SSH** (Section 25, user's
  decision -- no port 22, no key pair; see `../infra/README.md`).
  `deploy.yml`'s old `EC2_HOST`/`EC2_SSH_KEY` secrets are gone; the deploy
  job is gated on the `EC2_INSTANCE_ID` Actions variable and refuses to
  run if `API_BASE_URL` is unset (which would deploy a localhost-pointing
  web image).
- **Still open before a useful device build**: `apps/mobile/app.json`
  `extra.apiBaseUrl` is still `http://localhost:8000` -- it needs the real
  `https://api.<elastic-ip>.sslip.io`, which doesn't exist until
  `terraform apply` allocates the Elastic IP (deliberately not filled in
  with a made-up value). `SUPPORT_WHATSAPP_NUMBER` in both `lib/support.ts`
  files is also still the `+923000000000` placeholder -- needs the real
  number from the project owner.

