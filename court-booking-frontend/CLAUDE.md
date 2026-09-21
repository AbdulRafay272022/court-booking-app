# CLAUDE.md

> ## WARNING: a push to `main` that contains a database migration RUNS IT ON PRODUCTION
>
> Every push to `main` deploys, and the deploy script (`infra/scripts/remote-deploy.sh`) runs `alembic upgrade head` on
> the **production** database from the new image before the new backend starts. So **a migration must never be pushed
> without the project owner's explicit "go"** (and a fresh manual RDS snapshot; see "Migration rules" in
> `docs/SECTION_32_PLAN.md`). This is enforced: the `migration-guard` job in `.github/workflows/deploy.yml`
> (`infra/scripts/check-migration-guard.sh`) FAILS the run, and nothing deploys, if any file in
> `court-booking-backend/alembic/versions/` changed since the last successful deploy and no commit in that range contains
> the exact text `[migration-go]`. Add that text to a commit message only AFTER the owner says "go". If you are not sure a
> change contains a migration, it does not need one; do not push it.

Project context for future Claude Code sessions working on this repo. Read this
before writing any code — it tells you what's built, what's verified, what's
deliberately deferred, and how to keep testing the way this project has been
tested so far. The backend has its own `CLAUDE.md` at
`../court-booking-backend/CLAUDE.md` — read that too if you touch anything
backend-adjacent.

## START HERE

**Read `../court-booking-backend/CLAUDE.md`'s "START HERE -- handoff" section first**: it has the current
production state, the prioritised open-items list, how to read production logs (`../court-booking-backend/RUNBOOK.md`
section 4) and the working rules that apply to this side too. Frontend-specific pointers:
- Latest frontend work: **Section 31** below (per-court cancellation UI, stale-draft recovery, and the
  "Can't reach the server" follow-up, which was really a server 500 -- see it before assuming a network problem).
- Frontend items still open: mobile needs a new EAS build for all of it (never device-tested, no `eas.json`);
  the wizard's `createdCourtIds` duplicate-court hazard; the unexplained early session refresh
  (`apps/web/app/providers.tsx`); `SUPPORT_WHATSAPP_NUMBER` placeholder in both `lib/support.ts`.
- The "Next step" section near the end of this file predates Sections 26-31 in places (e.g. it still lists
  OTP-era caveats); trust the numbered Section entries and the backend handoff over it.
- Web verification recipe: `next build && next start --port 3100` (never `next dev`), Playwright scripts as
  throwaway `.cjs` files in `apps/mobile/`, mobile via Expo web on its own port with
  `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`. Don't re-write the session token in `addInitScript` on
  every navigation (the app rotates it).

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
  signup *(closed by Section 26)*, push notifications are a non-functional stub, no SMS OTP fallback).
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
                          injection (skipped for the public auth calls via `skipAuth`),
                          refresh-on-401 that only signs out on a server refusal, proactive
                          `refreshSession()` (Section 26), ApiError with the
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
  **Superseded by Section 26 (below): login is now phone + password, `otp.tsx` and
  `verify-otp` no longer exist.**
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

## Section 26 — password auth, signup forms, onboarding gaps (2026-09-20)

**Login is now phone + password, not OTP.** Signup is one form (player or owner, a
"Signing up as" toggle) followed by a WhatsApp OTP that only *proves the phone*. Sessions
last **8 hours** and are kept alive by proactive refresh. The backend contract is in
`../docs/FRONTEND_INTEGRATION.md` §2 and the backend README ("Auth (Section 26)"). Built
for **both** apps; **not deployed** (see the deploy-order gotcha in the backend CLAUDE.md).

What exists now, on web (`apps/web`) and mobile (`apps/mobile`):
- **Screens**: signup, login, verify (OTP; `purpose=signup` -> "Verify your new account",
  `purpose=reverify` -> "Verify your phone"), forgot-password, reset-password. The old
  phone->OTP `login`/`otp` screens are gone (and with them the dead "Send by SMS instead"
  alert). Web routes: `/signup /login /verify /forgot-password /reset-password`; mobile:
  `(auth)/{login,signup,verify,forgot-password,reset-password}`.
- **Shared, in `packages/`**: `types/src/validation.ts` (the client-side rules behind every
  smart button: PK mobile, email, name, 8-char password + match, 6-digit OTP, `formatCountdown`),
  `types/src/user.ts` (`CITY_OPTIONS`, `GENDER_OPTIONS`, `SignupRole`), `api-client/src/auth.ts`
  (the auth calls) and `api-client/src/session.ts` (`shouldRefreshSoon`, `restoreSession`).
- **Smart submit buttons** everywhere there's a form (also the venue wizard's Next / Send for
  review): grey and inert until every required field is actually *valid*, then brand color;
  a not-ready button ignores clicks (disabled AND guarded). Field errors (red border + message)
  appear only after a field has been touched.
- **OTP screens** show two separate clocks: the code's expiry as `MM:SS` (starts from the
  backend's `expires_in`, remembered per phone+purpose -- `sessionStorage` on web, the
  in-memory store on mobile; at zero the field is disabled and "Code expired" shows) and a 30s
  resend cooldown. Don't merge them.
- **Login routing**: `PHONE_REVERIFICATION_REQUIRED` -> send a code, keep the typed password
  in memory only (`lib/pending-auth.ts`, never persisted), go to the OTP screen, then retry the
  login automatically. `PASSWORD_NOT_SET` -> the forgot-password screen in `mode=set` (the
  existing production user is in this state). `INVALID_CREDENTIALS` is the same message for a
  wrong password and an unknown phone.
- **Session handling** (the fix for the audit's "refresh is dead code"): each app stores
  `expires_at` beside the token and refreshes when < 1h of the 8h remains -- on foreground /
  tab focus / reconnect and on a 60s timer (`Providers` on web, root `_layout.tsx` on mobile).
  Cold-start `/auth/me` is retried with backoff (`restoreSession`); **only a real 401 signs the
  user out.** If the server is unreachable the app runs on a cached profile (`maidan.cached_user`),
  or with none shows a "Can't reach Maidan -- Try again" screen with the token kept. The api-client
  no longer signs anyone out on a refresh that failed because the *network* was down, and public
  auth calls pass `skipAuth` (a wrong password is a 401 that must not trigger refresh/sign-out).
  Web now also sends a persistent `device_id`.
- **Owner onboarding (closes the audit's biggest gap)**: an owner can sign up and register a
  venue with no DB promotion. **Web got its own venue-setup wizard** (`/venue-setup/register`,
  `/courts`, `/status`; draft persisted in localStorage like mobile's) -- it uses the browser's
  geolocation for the pin (no reverse-geocode, so the address is typed). Owner gate: web's
  `dashboard/owner/layout.tsx` (only on Today, so pending owners can still reach Add booking)
  and mobile's `(owner)/index.tsx` now look at *all* of an owner's venues (the API allows
  several; Today has a switcher) -- any approved venue -> Today, else the most actionable one:
  pending/changes_requested -> status screen, all rejected -> the **new rejected screen**
  (mobile `venue-setup/rejected.tsx`, web `/venue-setup/status`) with the reason and next steps
  (message support / register a new venue). The rejected case used to fall through to Today
  with no message. Owner logout added on mobile (Today header, pending, rejected).
  `useOwnerVenues` defaults to an approved venue, not `venues[0]`.
- **Web gaps closed**: header reflects the real session (`components/nav-auth.tsx`: Log in /
  Sign up vs name + My bookings/Dashboard + Log out; also a `SiteHeader` on search, venue and
  bookings pages); players can log out; `/booking/[id]/chat|pay|done` are gated with
  `useRequireAuth`; `/login`, `/signup`, `/verify`, forgot/reset redirect an already-signed-in
  user home; landing CTAs go to `/signup?role=owner`.
- **Design**: reuses the two existing systems (player orange/Figtree, owner teal/Plex; owner
  tone switches live when the toggle is "Venue owner"). **The real logo exists now** (added in
  the Section 26 follow-up, below -- an earlier version of this paragraph said there was none and
  that `Logo` was an improvised wordmark; that is no longer true). `docs/screens/` has **no** mockup for the signup form (`PlayerSignup.html`
  is a different, post-signup "Almost done" profile step), nor for password login or
  forgot-password -- those screens extrapolate from `AuthLogin`/`AuthOtp`/`PlayerSignup`'s
  tokens (11px tracked labels, 56px/14px inputs, 1.5px ink focus border, white sticky footer).
  The player-side background is 4-6 faint orange sports icons, re-randomized on every mount,
  each floating on its own slow loop (web: CSS keyframes in `globals.css`, `prefers-reduced-motion`
  respected; mobile: `Animated`); `aria-hidden`, behind the form, player tone on auth screens only.
  No frontend-design skill was available in this environment.
- **Live-tested, not just typechecked**: against the real local backend + Postgres -- 35 HTTP
  checks (`live_auth_flow`: signup, verify, login, 8h, refresh, expiry, 365-day, reset, legacy),
  53 headless-Chromium checks on the web app (every screen, smart buttons, both timers,
  refresh, offline launch, reverify, forgot password, owner wizard -> DB rows, rejected state)
  and 30 on the mobile app via Expo's web target. **Not run on a real device**: AppState-driven
  refresh, SecureStore, `Alert.alert` logout (a no-op on RN-web), the Animated floating icons'
  actual smoothness.

Things to know / not built (flagged to the project owner, not silently decided):
- **Password rules are length-only (min 8)** by design -- no complexity rules until decided.
- ~~Phone-number change has no UI or endpoint~~ and ~~no way to add a second venue~~ -- both
  built in the follow-up below.
- **An owner can't resubmit a rejected / changes_requested venue** -- there is no such endpoint
  and no venue-edit UI; they message support or register a new venue (the project owner confirmed
  this is fine for now). The existing pending screen's
  "update the details we flagged and resubmit" line still promises more than exists.
- Under the temporary free-form OTP (see the backend CLAUDE.md), a brand-new player can only finish
  signup after messaging the business number first -- nothing in the UI says so yet.

## Section 26 follow-up -- multi-venue, profile, phone change, unique email, real logo (2026-09-20)

Built for **web and mobile**, live-tested, **not committed or deployed**. Backend half: see the
backend README ("Profile editing", "Email is unique", "Phone change") and its CLAUDE.md gotchas 10-12.

- **Multi-venue dashboard.** An owner's venues each keep their own status (`Live` / `Under review` /
  `Changes requested` / `Not approved`) shown on the switcher chip / sidebar entry. **One global
  selected venue per owner id** (`lib/selected-venue.ts` on each app, `lib/use-owner-venues.ts`
  resolves it: saved choice -> first approved -> first venue) is shared by *every* owner screen --
  Today, Approvals, Add booking, Ledger, Growth. Before this each screen kept its own selection, so
  Today could show venue A while Add-booking's court list silently belonged to venue B. A non-live
  selected venue shows a banner ("… is under review. Players can't find or book it yet -- walk-ins
  still work") with a link to its status screen. **"+ Add another venue"** (web sidebar / mobile
  switcher) clears the persisted wizard draft (`useVenueSetupStore.reset()`) and opens the same
  wizard; the wizard's status screens gained "← Back to your dashboard" when a live venue exists.
  **Decision (flagged): the selected venue persists across sessions** -- localStorage (web,
  `maidan.selected_venue`) / AsyncStorage (mobile), keyed by user id so a shared device doesn't leak one
  owner's choice to another; if the saved venue no longer exists it falls back. Say if you want it
  reset on login instead.
- **Real bug found and fixed while testing this:** `api.owners.ledger(start, end, courtId)` passed the
  selected **court** id in the **venue** slot. The endpoint only filters by `venue_id`, so the ledger was
  never venue-scoped (a multi-venue owner saw every venue's bookings mixed) and the court tabs sent a
  court UUID as a venue id. Now the ledger is fetched per selected **venue** and the court filter is
  client-side (`filterLedgerByCourt` / `ledgerRowsToCsv` in `packages/api-client/src/owners.ts`; the
  summary is recomputed from the filtered rows, and the CSV export for a court-filtered view is built
  client-side with the server's columns).
- **Edit profile + account screens.** Web `/account` (own layout, outside `/dashboard/owner`, works for
  both roles), mobile `(player)/edit-profile.tsx` and `(owner)/account.tsx` (owner: "Account" button in the
  Today header; player: "Edit profile" on the You tab). Fields: name, email, city, gender via
  `api.auth.updateMe`; Save is a smart button (needs a valid *and* changed form). Phone and password are
  **not inputs**: phone shows read-only with **Change phone number**; password has **Change password**,
  which goes through forgot-password (web: link; mobile: inline confirm -> sign out -> reset screen) --
  deliberately no second "old password" path. Duplicate email -> inline "That email address is already in use."
- **Phone change** (`/account/phone`, mobile `(player|owner)/change-phone.tsx`, shared
  `components/account/forms.tsx`): new number + **current password** -> code to the new number ->
  verify. The password is required (flagged decision -- the endpoint spec only said "authenticated"; without
  it a stolen 8h token could hijack the account). Wrong password shows **"Incorrect password."** (not the
  login wording -- `INVALID_CREDENTIALS`'s global message says "phone number or password", wrong here).
  On success every session is dead including this one, so the app **signs out locally and lands on login**
  with the new number prefilled and "Phone number updated. Log in with your new number." (`?notice=phone-changed`);
  web calls `suppressAuthRedirect()` first so the sign-out isn't intercepted by the auth guard. The screen
  says up front that the user will be logged out everywhere. Abandoning / failing at any step leaves the
  original number and sessions intact.
- **Email uniqueness in the UI**: signup and profile edit show the inline error on the email field
  (`EMAIL_ALREADY_IN_USE`), not a generic banner.
- **Logo** (source: `docs/maidan-logo-{icon,full-light,full-dark}-v2.svg` -- the three files in that folder;
  no ambiguity about *which* files, some about *use*, below):
  - `maidan-logo-full-light-v2.svg` -> web `public/brand/maidan-logo-full-light.svg` (header/nav, landing, auth
    screens, venue-setup, owner sidebar, admin, session-unreachable) and mobile `assets/brand/maidan-logo-full-light.png`
    (auth screens + player Home header; `Logo` in `components/auth/kit.tsx` renders it with `Image`).
  - `maidan-logo-icon-v2.svg` -> mobile `assets/icon.png` (1024 opaque RGB -- iOS rejects alpha),
    `splash-icon.png`, `android-icon-{foreground,background,monochrome}.png`, `favicon.png`; web
    `public/brand/maidan-logo-icon.svg` and `app/favicon.ico` (16-256).
  - `maidan-logo-full-dark-v2.svg` -> shipped as `public/brand/maidan-logo-full-dark.svg` and
    `assets/brand/...-dark.png` but **not referenced anywhere yet** (no dark surface exists; every screen is
    light-only). Ambiguity, not decided: swap it in if a dark header is ever added.
  - Processing you should know about: the SVGs carried **C2PA / Content Credentials metadata** (stripped);
    their wordmark was live `<text>` in Figtree, so it was **outlined** to paths (HarfBuzz + fontTools) so it
    renders identically without the font installed -- checked pixel-for-pixel against the original (3 of 165,600
    px differ); the app icon was rasterized with Chromium (Playwright) because there's no SVG renderer in the
    Expo pipeline. The Android adaptive-icon glyph is scaled to 0.8 to stay inside the safe zone.
    `app.json`: `expo-splash-screen` previously had **no `image` configured** (so the template splash would
    have shipped regardless of `splash-icon.png`) -- it now points at the new asset on `#FAF8F6`; the adaptive
    icon `backgroundColor` is `#E44E1F`.
  - **Not verified on a device**: the files on disk and the web/Expo-web rendering are verified (logo
    `naturalWidth` >= 500/700, favicon served). Whether the launcher icon and native splash *actually change* needs a
    native rebuild (`eas build` or `expo prebuild` + run). `expo prebuild` was blocked in the dev session's
    permission mode, and there's no device/emulator here -- so **treat the native icon/splash as unverified until
    the first EAS build**. Expo Go always shows Expo's own icon regardless.
- **Live-tested (this follow-up)**: backend 338 tests; 33 HTTP checks against the real local server + Postgres
  (32 pass; the 1 non-pass was a test bug, ledger scoping re-confirmed 1 row per venue); **43 web Playwright checks**
  (two venues with independent status badges, per-venue request scoping by URL, persistence across reload and
  logout/login, add-another-venue wizard, profile edit + duplicate email, phone change end-to-end incl. old
  token 401 and abandoned attempts, real logo/favicon served); **27 mobile checks** via Expo web (switcher, banner,
  `+ Add venue`, Account, Edit profile, phone change -> signed out -> login notice -> login with new number).
  Test-only gotcha: the Expo dev server must be started with `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`
  -- `app.json`'s `apiBaseUrl` is **production**, and a scripted test that forgets it drives real accounts.
- **Not built / flagged**: ~~the old number is not notified when a phone change happens~~ (closed in Section
  28: the backend sends the old number a best-effort WhatsApp, no frontend change; it is unreliable until the
  verified business account + template exist, so the phone-change screens deliberately don't promise it); no "sign in again"
  push to other devices (they just get 401 on next use); Meta's Authentication template + verified business
  account are **not confirmed live**, so OTP delivery is still the temporary free-form send (revert steps in the
  backend CLAUDE.md) -- I did not reintroduce or extend any workaround for the 24h window.

## Section 29 — post-audit fixes, Tier 1 (2026-09-20)

Four fixes from a follow-up "Full Feature & Flow Audit" (a UI-quality pass distinct from the
earlier onboarding audit) -- Tier 1 (must-fix) only, both apps unless noted. Live-tested against
the real local backend + a production build of the web app (`next build && next start`, per the
existing WebSocket/Turbopack gotcha below), not just typechecked.

- **The `isLoading` race (root cause of the Approvals false-empty-state bug and, it turned out,
  a latent risk on every owner screen).** `lib/use-owner-venues.ts`'s `isLoading` was already
  correct -- nothing downstream combined it with each screen's own query. A screen whose query is
  `enabled: !!activeVenueId` reports that query's own `isLoading: false` while disabled (TanStack
  Query v5: `isPending && isFetching`, and a disabled query isn't fetching), so during the window
  before `activeVenueId` resolves, Today/Approvals/Ledger/Growth (both platforms, 8 screens total)
  could render their empty state instead of a loading state. Fixed by combining
  `venuesLoading || query.isLoading` at each call site -- not a new abstraction, since the fix is
  the same one-line pattern everywhere and the hook's own doc comment now says so explicitly for
  future screens. Also gave web's `Approvals` an `enabled: !!activeVenueId` guard it never had
  (confirmed via the audit: it fired once unscoped across every venue the owner has, then again
  once scoped -- a related bug found while fixing this one, not a separate audit item).
- **Digest job fix is backend-only** -- see the backend CLAUDE.md's Section 29 Part B.
- **A real per-venue (per-court) cancellation policy**, not just a "add a cancel button" fix --
  see the backend CLAUDE.md's Section 29 Part C for the full design (this was a project-owner
  decision, not something decided unilaterally: cancellation policy needed to be configurable per
  court, disclosed to the player before they pay, and honest about refunds being manual). Frontend
  half:
  - `packages/types/src/court.ts`'s `Court`/`CreateCourtInput` gained
    `cancellation_allowed`/`cancellation_cutoff_hours`; `packages/api-client/src/courts.ts` gained
    `cancellationPolicyText()`, a shared plain-language renderer used identically by the pay screen
    and My Bookings so the wording never drifts between the two.
  - **Venue setup wizard** (`venue-setup/courts.tsx` mobile, `venue-setup/courts/page.tsx` web)
    gained a "Cancellations" section, following the same pattern as hours/pricing already in that
    wizard: one shared setting applied to every court created in that run (not configured
    per-court in the wizard, even though the backend stores it per-court) **[superseded by
    Section 31: it is per court now, inside each court's card]** -- "Allowed"/"Not
    allowed" chips plus an optional cutoff-hours field, defaulting to unrestricted (matches the
    model's own default, so a wizard run that never touches this section behaves exactly like
    before this feature existed). Live-verified via Playwright + direct API calls (real signup,
    real venue, real court): toggling "Not allowed" produces a `POST /venues/{id}/courts` body
    with `cancellation_allowed: false`, and the resulting DB row genuinely has it set (confirmed by
    querying the dev DB directly, not just trusting the network request -- caught and fixed a stale
    `uvicorn --reload`-less dev server along the way, which silently ignored the new fields on the
    first verification pass).
  - **Pay screen** (`booking/[id]/pay.tsx` mobile, `booking/[id]/pay/page.tsx` web): fetches the
    booking's court and renders `cancellationPolicyText()` as a real pre-purchase disclosure,
    before the player submits payment -- not just discoverable later at cancel time.
  - **My Bookings** (`(tabs)/bookings.tsx` mobile, `bookings/page.tsx` web): a `booked` booking now
    shows a real Cancel action when the court's policy allows it *and* (if a cutoff is set) enough
    time remains before start -- computed client-side from the same court data already fetched for
    that card (a cutoff only ever gets more restrictive as start approaches, so this can't go stale
    the way a one-shot fetch elsewhere might; the server re-checks it regardless, this is a UX
    convenience not the source of truth). When cancellation isn't currently possible, the card shows
    *why* (the policy text, or "The cancellation window for this booking has closed") instead of
    just omitting the button with no explanation. The confirm dialog and the post-cancel message
    are both explicit that a refund is manual, not automatic ("A refund request has been sent to the
    venue -- refunds are handled manually and aren't automatic"), so the UI never implies money
    comes back instantly when it doesn't.
  - `packages/types/src/errors.ts` gained `CANCELLATION_NOT_ALLOWED`/`CANCELLATION_WINDOW_CLOSED`;
    both apps' `lib/error-messages.ts` map them to specific text.
- **Terms of Service / Privacy Policy** -- real content (not a generic template: describes what
  this specific app actually collects and does -- phone/email/bank-detail collection, WhatsApp-
  based OTP and notifications, an AI provider reading chat messages and payment screenshots,
  S3-hosted payment-proof storage, no self-service account deletion yet), hosted as real Next.js
  pages at `/terms` and `/privacy` (server-rendered, confirmed via raw `curl` -- no JS needed to
  see the content, matching the SEO bar the rest of the public site holds itself to). Both signup
  screens' previously-inert "Terms and Privacy Policy" text is now real tappable links
  (`target="_blank"` on web; `Linking.openURL` on mobile). **Mobile links out to the web pages
  rather than duplicating the legal text natively** -- one canonical source, no drift risk between
  two copies of a legal document; needed a new `WEB_BASE_URL` constant (`lib/config.ts`, mirrors
  `API_BASE_URL`'s resolution order) and `app.json`'s `extra.webBaseUrl`. Web-side link-through
  live-verified with Playwright (click "Terms" on the real signup page, confirm it opens `/terms`
  with the right heading); the mobile tap handler is code-reviewed and typechecks but **not
  verified on a real device/emulator** -- none was available in this session, same limitation as
  other mobile-only gotchas below.
- **Flagged, not decided silently**: the cancellation cutoff design above was a real back-and-forth
  with the project owner (not a global rule, not simply "any time before start") -- see the backend
  CLAUDE.md's Section 29 Part C for the shape that was actually agreed. The Terms/Privacy *content*
  was written from this codebase's own actual data-handling (not a generic template) but has not
  been reviewed by anyone with legal authority to sign off on it -- do that before treating it as
  final for a real launch.

## Section 29, Tier 2 -- venue photos, post-setup editing, walk-in date, web waitlist (2026-09-20)

Four more fixes from the same audit, all live-verified against the real local backend + a
production build of the web app (not just typechecked), same session as Tier 1 above.

- **Venue photos now actually render** (`photo_urls` was fetched everywhere already, just never
  displayed). Mobile: `VenueCard` (`(player)/_components.tsx`, exported `gradientFor` so the venue
  detail screen's new hero section reuses the same per-venue color instead of a second hash
  function) and a new photo-strip hero on `venue/[slug].tsx` (paginated horizontal scroll if
  photos exist, falls back to the gradient it never had before if none do). Web: `search/page.tsx`'s
  card and the venue detail page's 3-photo mosaic (`venues/[slug]/page.tsx`, new `PhotoTile` helper)
  now render the real `photo_urls[0..2]` with the existing gradients as a genuine per-slot fallback,
  not the default.
- **Post-setup schedule/pricing/blackout editing** -- the wizard's own copy has always promised
  "you can change this later"; now it's true. New screen, both platforms (`(owner)/venue-settings.tsx`
  mobile, `/dashboard/owner/settings` web, linked from Today's icon row / the sidebar nav) that
  fetches a court via the already-existing `api.courts.get`/`api.courts.update` (confirmed these
  were already in the api-client, unused until now), lets an owner edit hours and pricing (same
  UI shape as the wizard's step 2, reusing `venue-setup/_components.tsx` / `components/setup/ui.tsx`,
  pre-filled from the live `schedule_templates`/`pricing_rules` rather than wizard-draft state) and
  add blackout dates (`GET`/`POST /courts/{id}/blackouts`, additive, no new backend work needed --
  every endpoint this screen calls already existed). One bug caught and fixed while live-verifying
  this on web: the save-confirmation message flashed and immediately vanished, because
  `handleSave`'s own `invalidateQueries()` triggers a refetch that re-runs the "seed local state
  from the server" effect a moment later, and that effect unconditionally cleared the confirmation
  along with reseeding the form -- fixed by only clearing it on an explicit court switch, not on
  every data refresh.
- **Walk-in booking date picker** -- `walkin.tsx` (mobile) / `walkin/page.tsx` (web) were hardcoded
  to `toDateInputValue(new Date())`; both now have a 7-day picker (Today/Tomorrow/weekday+date
  chips, matching the venue detail screen's own day-tab pattern) and re-query availability for
  the selected date. Live-verified: picking "Tomorrow" changes the actual `?date=` query param and
  a walk-in booked there lands on tomorrow's availability, not today's.
- **Waitlist on web** -- mobile has had "Notify me" on a taken slot for a while; web had zero
  implementation (no join affordance, no "my waitlist" view, `api.waitlist` never called from web
  at all). Added to `venue-schedule-client.tsx` (a `booked` cell becomes a real "Notify me" /
  "On waitlist" button, same `409`-on-double-join handling and the same "we'll let you know" copy
  as mobile -- deliberately not "reserved," matching the earlier notify-all-reserve-nothing
  redesign) and to `/account` (a player-only "My waitlist" section, mirroring mobile's profile-tab
  placement, with a working Leave action). Live-verified end to end with a real walk-in booking
  (fastest way to get a slot to `booked` without wiring up payment-proof upload in the test), a
  real player joining via the actual UI, the alert copy, the server-side entry, `/account` showing
  it, and Leave clearing both the UI and the server row.

## Section 30 -- signup page visual polish: more icons, real owner theming (2026-09-20)

Two fixes to the auth-screens' floating-icon background, both platforms. **Checked the actual
code before assuming the premise** ("owner theming doesn't appear to be implemented"): the
color/font tone system (`TONES`/`toneColors`, threaded through every field/button/label) was
already fully wired and switching correctly -- confirmed live by reading the computed CSS color
of an owner-tone link (`rgb(14, 98, 116)` = `#0E6274` exactly) before touching anything. The
**real** gap was narrower than the ticket assumed: owner tone rendered no background treatment
at all (`tone === "player" ? <FloatingIcons .../> : null`), and the player icon set was thin (4-6
icons, opacity 0.07-0.14).

- **Richer player icons**: `floating-icons.tsx` (web) / `kit.tsx` (mobile) both went from 6 hand-
  drawn sport icons to 12 (added whistle, stopwatch, medal, racket, flag, cone), count per mount
  from 4-6 to 8-10, opacity from 0.07-0.14 to 0.10-0.19.
- **A real owner background, not a recolor**: new `OWNER_ICONS` set (building, calendar, chart,
  pin, clipboard, clock) on both platforms, rendered in owner tone with the owner accent color --
  previously owner tone got nothing. `FloatingIcons` now takes an `icons` prop (defaults to the
  sport set) instead of being sport-only.
- **Real bug found and fixed while wiring this up**: `FloatingIcons` only randomizes its
  placement once per mount (`useEffect`/`useMemo` with `[]` deps) -- toggling Player <-> Venue
  owner changed the `icons` prop but the already-mounted instance would have kept showing
  whichever set rendered first, just recolored. Fixed with `key={tone}` at both call sites
  (`auth-shell.tsx` web, `AuthScreen` in `kit.tsx` mobile) so switching roles forces a clean
  remount into the correct icon set -- verified live by toggling Player -> Venue owner -> Player
  again and confirming a full reroll back to sport icons each time, not leftover teal shapes.
- **Venue-setup wizard confirmed already fully teal** (a separate, pre-existing owner design
  system -- `venue-setup/_components.tsx` / `components/setup/ui.tsx`, not the auth kit at all)
  -- no changes needed there; screenshotted step 1 live to confirm rather than assuming from the
  code. Deliberately did NOT add a floating-icon background to the wizard itself: it's a dense
  multi-step form, not a lightweight auth screen, and no other functional/dashboard screen in the
  app has this decorative treatment -- a judgment call, flagged here rather than made silently.
- **Login intentionally unchanged in tone** (still always player/orange, per the ticket -- no
  role context exists before authentication), only got the icon-richness improvement.
- Live-verified on both platforms: web via Playwright screenshots (login, signup as player,
  signup as owner, toggle back to player, wizard step 1) and mobile via the Expo web target
  (login, signup as player, signup as owner) -- not device-tested, same standing limitation as
  everywhere else in this file.

## Section 31 -- per-court cancellation in the UI, stale-draft recovery (2026-09-20)

**Premise check first:** the ticket said the policy lived on the *venue* and needed moving to
`courts`. It has only ever been on `courts` (backend CLAUDE.md, Section 31), and enforcement and the
pay-screen disclosure already read the booking's own court. So this is frontend-only work, no
migration. The real gaps were that the wizard set ONE value for every court and the post-setup
Venue Settings screen had no cancellation controls.

- **Wizard (both apps):** the Cancellations block moved out of its own venue-wide card into each
  court's card (below Slot length), stored on `CourtDraft.cancellationAllowed` /
  `cancellationCutoffHours`. `POST /venues/{id}/courts` sends that court's own values.
- **Draft migration:** `useVenueSetupStore` is now persist `version: 2` with a `migrate` that copies a
  v1 draft's shared setting onto every court and drops the old top-level fields, so an owner mid-wizard
  keeps their choice and no court renders with undefined chip state. Verified with a real v1 draft in
  localStorage on both platforms.
- **Venue Settings (both apps):** already per court (court tabs), so it just gained a Cancellations
  card seeded from the selected court; **Save changes** now also calls `api.courts.update` first
  (`PATCH /courts/{id}`; cutoff `null` clears it), then schedule and pricing, and invalidates
  `owner-venues`. Verified independent per-court edits, including clearing a cutoff.
- **Wording:** `cancellationPolicyText` now says "This **court** does not allow cancellations once
  booked" (it said "venue", which is wrong when courts differ).
- **Stale draft recovery (Part 2):** `isStaleVenueDraftError` (`packages/api-client/src/venue-draft.ts`)
  matches `404 VENUE_NOT_FOUND`, `404 NOT_FOUND` (a remembered court id whose court is gone) and
  `403 NOT_VENUE_OWNER` (a draft left over from another account on a shared browser -- the draft key is
  global, not per user). The wizard applies it **only when the failing call used an id read from the saved
  draft**, never to an id created in the same run. On a match it clears `createdVenueId` /
  `createdCourtIds` immediately (so a reload can't loop), and shows "Your previous session for this venue
  has expired. Let's start fresh." with a **Start fresh** button that calls `store.reset()` and reopens
  step 1. A genuine network failure (`REQUEST_TIMEOUT`, no status) still gets the normal error and keeps
  the ids. Note the typed form fields survive until the owner presses Start fresh.
- **Live-tested, not just typechecked:** web production build on :3100 -- 34/34 Playwright checks; mobile
  via Expo web on :8082 -- 24/24. Backend suite 350 passing. The mobile Expo server was started with
  `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000` and the script asserts no request ever left for a
  non-local API host (`app.json` points at production). **Not device-tested** (same standing limit).

Things worth knowing / not done:
- **Existing hazard, unchanged:** `updateCourt`/`addCourt`/`removeCourt` in the store clear
  `createdCourtIds`, so editing ANY court field after a partial submit failure makes the retry
  `POST /courts` every court again (duplicates -- the same shape as the 2026-09-20 production incident).
  Per-court cancellation fields make that edit path slightly more likely. Fix is to PATCH already-created
  courts instead of re-creating; left alone as out of scope.
- **Unexplained, not investigated:** in the scripted web run the app rotated a brand-new owner session
  (`revoked_reason = refreshed`) about 8 seconds after it was created, although ~8h remained and
  `shouldRefreshSoon` should have been false. Another tab holding the old token would be logged out by
  that. Worth a look at what `expiresAt` the store holds after `restoreSession`.
- **Test-harness traps hit here:** don't re-write the session in `addInitScript` on every navigation
  (the app rotates its token, so the old one 401s -- seed only when localStorage is empty); RN-web
  `SectionLabel` puts UPPERCASE text in the DOM (match case-insensitively); `page.waitForFunction` with an
  `async` predicate resolves immediately (poll from Node instead); the local dev DB has no seeded admin
  (make one by `UPDATE users SET role='admin'` on a throwaway user); `.test` is a rejected email TLD.
- Test data from these runs (users `92300#######@example.com`, venues "S31 ...") was left in the local dev
  DB because the bulk-delete was blocked; see the session summary for the cleanup SQL.

### Section 31 follow-up: "Can't reach the server" on Send for review (2026-09-20, from the live logs)

The second report after the stale-draft fix was NOT a network problem. Production logs (`docker logs
court-booking-backend` via SSM, `--region ap-south-1`) showed venue and court created (`201`) and then
`POST /courts/{id}/schedule` -> **500**: the owner had set closing time **02:00**, and
`schedule_templates` has `CHECK (open_time < close_time)` (`valid_times`); the availability grid is built
within one calendar day, so **hours past midnight are not supported**. Nothing validated the times, the
INSERT threw, and a bare 500 carries **no CORS headers**, so the browser reported a failed fetch, which
`friendlyErrorMessage` maps to "Can't reach the server". Lesson: **that message can be a server 500**, so
check the server logs before blaming the user's connection.
- Fixed: `ScheduleTemplateIn` now rejects `close_time <= open_time` with a normal 422
  (`test_schedule_closing_before_opening_is_a_clean_422_not_a_500`), and
  `weeklyHoursError`/`scheduleHoursError` (`packages/types/src/validation.ts`) block Send for review / Save
  with an inline message naming the day and suggesting 23:59, on both wizards and both settings screens.
- **Known limitation, not built:** an owner who really closes after midnight can only enter 23:59, and a
  60-min grid then loses its last slot. Real overnight hours need a DB constraint change, availability-engine
  work (which day a 1 AM slot belongs to), pricing windows and the PKT conversion. Ask before building.
- **Not fixed (recommended):** an unhandled 500 still reaches the browser without CORS headers. An inner
  catch-all in `RequestContextMiddleware` (inside CORS) returning the JSON error envelope would make every
  unexpected 500 show "Something went wrong" instead of "Can't reach the server".

## Section 32 -- FCM push notifications wired end to end (Android) (2026-09-21)

The push stub is real now. **Not committed/deployed; the Firebase-console half is manual** (steps
were given to the project owner, not automated).

- **Backend:** `app/services/fcm.py` sends via FCM HTTP v1 over plain `httpx`; the OAuth token is minted
  from the service-account JSON with python-jose (RS256 JWT -> Google's token endpoint) and cached per
  process -- no `firebase-admin`/`google-auth`, per the backend's "no vendor SDK" rule.
  `FCM_SERVICE_ACCOUNT_KEY` takes raw JSON **or base64** (production uses base64 in SSM;
  `bootstrap.sh env` now renders it). Blank = push skipped. Every push now carries a `data` payload
  `{event_type, reference_id?}` (that is what `routeForNotification` in `app/_layout.tsx` reads), and a token
  FCM reports as UNREGISTERED is set `is_active=false`. `NotificationService._push` gained a 4th `data`
  arg and returns a `PushOutcome`; the test fakes in 5 files take `data=None`.
- **Mobile:** `app.json` got `android.package` / `ios.bundleIdentifier` = `com.maidan.app`,
  `android.googleServicesFile: ./google-services.json` (**the file is not in the repo until the owner
  downloads it from Firebase; commit it -- it is public config, and EAS only uploads tracked files**), and the
  `expo-notifications` plugin (96x96 white `assets/notification-icon.png` generated from the monochrome logo,
  orange tint, `defaultChannel: "default"`). New `eas.json` (development/preview/production).
  `registerForPushNotifications` now creates the Android channel `default` first -- Android 13+ never shows the
  permission prompt without one, and the backend names that channel in every message.
- **iOS goes straight to Apple, not through FCM.** On iOS `getDevicePushTokenAsync` returns a raw APNs token,
  which FCM's HTTP API rejects. Instead of adding the Firebase native SDK to the app, the backend routes tokens
  registered with `platform="ios"` to `app/services/apns.py` (HTTP/2 + an ES256 provider JWT from an Apple `.p8`
  key; settings `APNS_KEY`/`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_BUNDLE_ID`/`APNS_USE_SANDBOX`). The `data` payload
  is sent under the payload's `body` key, which is where expo-notifications reads it from for a native APNs push.
  `BadDeviceToken` is deliberately NOT treated as "dead token" (a sandbox/production mix-up returns it for every
  token); only 410 Unregistered deactivates one. **Written and unit-tested against mocks only -- nothing has
  ever been sent to real APNs**, and it needs a paid Apple Developer account + a real iPhone to verify.
  **Push does not work in Expo Go** -- Android or iOS needs a development/preview EAS build.
- **Deep links:** `payment_submitted` -> Approvals and `slot_reopened` -> Search work. `booking_confirmed` /
  `payment_rejected` are wired in `routeForNotification` but the backend does not pass a `reference_id` for
  them yet (`notify_booking_confirmed` / `notify_payment_rejected` take no booking id), so they just open the app.
- **Verified:** 18 DB-free tests in `tests/test_fcm.py` (real RS256 signature check, token caching, 401 retry,
  error classification, bad key never raises). **Not run:** the one DB-backed test in that file and the rest of
  the backend suite (no Postgres/Docker here), `tsc` (no `node_modules`), and everything on a real device.

## Section 32, Parts 1-2 -- 12-hour Pakistan time, the date-shift bug, own-slot state (2026-09-21)

**Deployed to production 2026-09-21, commit `94ac837f372d`, verified there (proof recipe in backend CLAUDE.md START HERE).** Backend half and root causes: backend CLAUDE.md item 32. The rules:
- **Every time/date a player or owner sees is 12-hour Pakistan time with human dates** ("7:30 PM", "Wed, 23 Sep",
  "Today"/"Tomorrow"). The ONLY implementation is `packages/types/src/datetime.ts`, re-exported by each app's
  `lib/format.ts`. It uses a fixed +5h offset, never the device timezone. **Never** write `toLocaleTimeString`,
  `getHours`, `hour12`, or `toISOString().slice(0, 10)` in a screen: the last one is the UTC date and made the tab
  labelled "Wed 23" query the 22nd between midnight and 5 AM in Karachi. `pktDayTabs(n)` builds date tabs,
  `pktDateString()` is "today" for any `?date=` parameter. Tests: `cd packages/types && npx tsx --test src/datetime.test.ts`
  (run it under `TZ=UTC`, `TZ=Asia/Karachi`, `TZ=America/Los_Angeles`).
- **Owner time inputs are 12-hour** (`TimeField12` hour/minute/AM-PM, `DayPicker` chips) on web
  (`components/setup/time-fields.tsx`) and mobile (`components/time-fields.tsx`), replacing `<input type=time>` and
  free-text "06:00"/"YYYY-MM-DD HH:MM" boxes (blackouts now use date + time pickers, sent via `pktInstant`).
  They still STORE "HH:MM". `weeklyHoursError` messages are 12-hour text.
  **No native time/date control anywhere** (a browser `<input type=time>` prints whatever the machine's locale
  says, 24-hour on many): `npm run check:time-inputs` (root, `scripts/check-no-native-time-inputs.mjs`) fails on
  `type="time|date|datetime-local"`, `toLocale*String`, `hour12:` and `toISOString().slice`. Layout rule for the
  web `TimeField12`: each box has a floor width for its widest text ("Any", "00", "AM") and the field a floor of
  11.5rem, so **every container holding them must be `flex-wrap`** -- otherwise on a phone the minute/AM-PM boxes
  squeeze to blank (this shipped once in the first cut; found with a 390px check). The owner dashboard shell
  (fixed sidebar) was never phone-sized, so Venue settings still overflows sideways below ~600px; the wizard is fine.
- **Own slots:** `Slot.is_mine` (the availability call is per-viewer). Mine + booked = "Your booking" (opens the done
  screen), mine + held/payment pending = "Payment pending" (opens pay); "Notify me" only for somebody else's booked
  slot. The web availability query waits for auth to settle (`enabled: status !== "hydrating"`, keyed on signed-in) --
  otherwise the first request has no token and the own slot flashes "Notify me" until the next poll.
- Chat opening bubble is human ("Is Court 1 at X available on Mon, 21 Sep at 6:00 AM?"); done screen shows
  DATE/TIME/PAID/"DUE AT VENUE"+"Nothing due" (was "AT VENUE 0" = the "Venue 0" the owner saw); owner Today shows
  "PKR 400 / PKR 3,100 due at venue" and a human date header.
- **Verification recipe used** (`scratchpad/shots.cjs`, not committed): Playwright with the clock frozen at 3:14 AM
  Mon 21 Sep PKT and `timezoneId: "Asia/Karachi"`; a local fixture (approved venue, 90-min court, a booked slot, a
  held slot, someone else's booked slot, own waitlist row) seeded through the API. Harness traps: the apps rotate
  session tokens, so log in fresh before every run; the shell strips backslashes (use plain-string selectors);
  restart Expo with `--clear` or it serves a stale bundle; start Expo with `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`.
- **Not done in Parts 1-2:** the web schedule grid still keys rows off the first court's slots (breaks with per-court
  slot lengths -- Part 4); "Booked"/"Payment pending" labelling for OTHER players' slots and closed hours (Part 4);
  duration picker (Part 4). Local dev DB test data from these runs (fixture users +923002064788, +923005963856,
  +923002050429, +923005804435 and their venue "S32 Padel Arena") is still there; cleanup was blocked earlier.

## Section 32, Part 4 -- per-court setup, per-venue cancellation, duration (2026-09-22, not deployed)

Backend half and production facts: backend CLAUDE.md (START HERE). Rules that came out of building it:
- **One `CourtSetup` per court** (`packages/types/src/court-setup.ts`: slot length, hours, price rules) edited by ONE component per
  platform (`components/setup/court-setup-fields.tsx` web, `components/court-setup-fields.tsx` mobile) in both the wizard and Venue
  Settings. The wizard store (v3, migrated from v2 -- an owner mid-wizard keeps what they typed) holds `courts[]` each with its own
  hours and prices; a new court starts as a copy of the previous one. Cancellation is ONE venue-level control (venue step + Venue
  Settings), never per court. The live slot preview (`slotPreview`, mirrors the backend grid) says "11 slots a day, 6:00 AM to 10:30 PM".
- **Weekdays are Monday-first (Mon = 0)** everywhere an owner picks or a request sends a day: `DAY_LABELS` / `backendWeekdayOf` /
  `WEEKDAY_NUMBERS` / `WEEKEND_NUMBERS`. The old screens were Sunday-first against a Monday = 0 API (a real one-day-off bug).
- **`placeholderData: prev => prev` is on in both query clients**, so right after a query key changes `data` is still the PREVIOUS
  key's data (and `isLoading` is false). Never seed form state from `useQuery` data on mount without checking the data belongs to
  the key (`data.id === selectedId`); Venue Settings does, and a live test found the bug (Save would have overwritten one court with
  another's hours and prices).
- **Duration:** tapping an open slot opens the duration sheet (`components/booking/duration-sheet.tsx`, `components/duration-sheet.tsx`):
  chips from `durationChoices` (only lengths whose slots are all free and back to back, max 4 h), the TOTAL from
  `GET /courts/:id/quote` (server pricing, so peak boundaries are right), then the chat opens with `slotCount`/`minutes`; the Yes
  button carries `slot_count` into `api.bookings.hold`.
- **Schedule display:** one list per court (courts have different slot lengths; the old shared-row table broke), only open hours are
  listed (closed time is never shown as bookable), other players' slots read "Payment pending" / "Booked" (+ Notify me) /
  "Unavailable" and are not tappable; mine read "Your booking" / "Payment pending".
- The chat's opening effect is guarded with a ref (dev mode ran it twice and asked the paid AI twice).
- Tests: `cd packages/types && npx tsx --test src/datetime.test.ts src/court-setup.test.ts` (in 3 time zones). Live verification scripts
  (not committed) drove web and the Expo web target with a two-court fixture; the eslint errors that used to be in the Venue Settings
  page are gone (the effects that copied server data into state were removed).

## Section 32, Part 3 -- overnight courts (2026-09-22, not deployed)

A schedule day belongs to the day it OPENS (Thu 3 PM to 3 AM covers Fri 1 AM). What the screens do: the day tab is the OPENING day;
`Slot.after_midnight` slots sit under an "AFTER MIDNIGHT" divider and read "Fri 1:00 AM to 2:00 AM" (`formatSlotTimes`);
`formatTimeRange` names the end day when a range ends on a later Pakistan day ("11:00 PM to Fri 1:00 AM") but not at midnight;
owner hours accept close <= open (`hoursKind`: same-day / next-day / 24-hours) with a "Closes next day" / "Open 24 hours" note,
`weeklyHoursError` refuses an overnight day that runs into the next day's opening, and `slotPreview` counts across midnight.
Duration choices need no change (contiguity is by `ends_at == next starts_at`). Tests: `court-setup.test.ts`.

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

**Section 26 shortcut for local testing:** the local backend's `.env` has
`DEBUG=true` + `DEV_FIXED_OTP=111111`, so every OTP is `111111` and no brute-forcing is
needed (`app/seed.py`'s demo accounts also log in with `DEMO_PASSWORD`). Point the
apps at the local backend with `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000` (mobile;
`app.json` now points at production!) / `apps/web/.env.local` (web).

No staging environment exists — this is the only backend there is. WhatsApp
delivery is NOT configured in this env, so OTPs are never actually delivered.
The older way to complete a login in testing was to brute-force the OTP from the
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
matching section for the backend-image half of the pipeline. **EC2 is
provisioned now (Section 25) and deploys go over SSM Run Command, not SSH**
— the `EC2_HOST`/`EC2_SSH_KEY` secrets this paragraph used to describe no
longer exist. The workflow reads three Actions **variables** (Settings →
Secrets and variables → Actions → *Variables*, not Secrets): `AWS_ROLE_ARN`,
`EC2_INSTANCE_ID` (`terraform output ec2_instance_id`) and `API_BASE_URL`
(`terraform output api_base_url`, origin only, no `/api/v1`). Missing
`EC2_INSTANCE_ID` skips the deploy step with a warning; `EC2_INSTANCE_ID`
set without `API_BASE_URL` fails the job on purpose. `gh` isn't installed
on this machine, so the current values weren't checked from here — look at
the repo's Variables page.

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
  owner signup *(closed by Section 26: owners sign up themselves now)*, no SMS OTP fallback (the
  dead "Send by SMS instead" button was removed with the old OTP screen), no venue verification document upload endpoint (the
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
- **`GEMINI_API_KEY` was rotated (2026-09-20, per the project owner)** and
  the new key is in production SSM; whether the local backend `.env` was
  updated to match wasn't checked. **Production deliberately runs on Gemini**
  (`AI_PROVIDER`/`AI_VISION_PROVIDER` both `gemini`, `ANTHROPIC_API_KEY`
  blank on purpose -- verified inside the running container), so "get a real
  `ANTHROPIC_API_KEY`" is no longer a blocker, just an option. The local
  backend test suite still reads as short of its real total from this repo's
  `.env` for reasons that have nothing to do with the code (see the Gotcha
  below and the backend's own `CLAUDE.md`) — not an actual regression.
- **Production OTP delivery only works for testers who messaged the
  business WhatsApp number first (temporary)**: Meta Business Verification,
  the Authentication template and a payment method on the WhatsApp Business
  account don't exist yet, so the backend sends the code as free-form text
  (2026-09-20), which needs an open 24h window; anyone else gets either
  `OTP_DELIVERY_FAILED` **or a plain 200 "OTP sent" with no message ever
  arriving** (Meta accepts the send, then fails it in a status callback the
  request can't see -- the second one is what really happened in the first
  live test). So a successful `request-otp` response does not prove delivery. That's a known
  external prerequisite, not a frontend or backend bug -- don't debug the
  login screens over it. **The login screens have no hint telling a user to
  message the number first** (deliberately not built; testers do it by hand),
  so real users would just see the failure. Details and the revert steps are
  in the backend `CLAUDE.md`. **One
  real frontend gap this exposes** (checked 2026-09-20): `OTP_DELIVERY_FAILED`
  is not in `packages/types/src/errors.ts`'s `ErrorCode` union or either
  app's `lib/error-messages.ts`, so the login screen falls back to the
  backend's own `error.message` text rather than a purpose-written one. It
  works, but add the code to all three when convenient.
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
- **Still open before a useful device build** (re-checked 2026-09-20):
  `apps/mobile/app.json` `extra.apiBaseUrl` **is** now the real
  `https://api.3.6.48.6.sslip.io` (set in the Section 25 commit, after
  `terraform apply` allocated the Elastic IP) -- earlier text saying it's
  still `localhost` is out of date. What's genuinely still missing: no
  `eas.json`, and `app.json` has no `android.package` /
  `ios.bundleIdentifier`. `SUPPORT_WHATSAPP_NUMBER` in both `lib/support.ts`
  files is also still the `+923000000000` placeholder -- needs the real
  number from the project owner. If the API hostname ever changes
  (sslip.io → a real domain), `app.json` needs updating too, and the web
  image needs a rebuild (see the `NEXT_PUBLIC_API_BASE_URL` note above).
- **The web Dockerfile's builder stage must be `FROM deps`, not a fresh image
  with only the root `node_modules` copied in** (found 2026-09-19, first real
  CI run). This workspace has two Tailwinds: mobile's NativeWind needs 3.x
  (hoisted to the root `node_modules`), web needs 4.x (nested at
  `apps/web/node_modules` per `package-lock.json`). Copying only the root
  `node_modules` lost the nested one, so `next build` resolved Tailwind 3 (no
  `index.css`) and failed with `Can't resolve 'tailwindcss'`. It had only ever
  built locally because there was no `.dockerignore`, so `COPY apps/web` swept
  in the host's untracked `apps/web/node_modules`. `court-booking-frontend/.dockerignore`
  now excludes host `node_modules`/`.next`/`.env*` so a local Docker build
  matches CI. **Lesson: "verified with `docker build` locally" only counts if
  the context is a clean checkout** -- verify with `git archive HEAD
  court-booking-frontend | tar -x -C <dir>` as the build context.
  (Reproducing this outside Docker is easy: `npm ci`, delete
  `apps/web/node_modules`, `next build` -> identical error.)

