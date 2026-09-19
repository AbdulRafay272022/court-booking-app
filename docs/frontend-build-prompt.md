# Court Booking Platform — Complete Frontend Build Prompt

> **Hand this entire file to Claude CLI.** It assumes the backend described in `backend-build-prompt.md` (+ the AI provider and audit/hardening addenda) is already built, tested, and running — this document is the frontend counterpart. It contains the tech stack, the app structure, every screen mapped to the backend it calls, the API contract to build against, and a testing strategy, so a separate Claude CLI session (with no memory of the backend build conversation) can build the complete frontend from this file alone.

---

## HOW TO USE THIS DOCUMENT

1. Give this whole file to Claude CLI as the starting prompt.
2. If you have the backend running locally, also tell Claude CLI the base URL (e.g., `http://localhost:8000/api/v1`) and point it at the live Swagger docs (`/docs`) — that's the ground truth for exact request/response shapes if anything here is ambiguous.
3. If you have the 21 UI mockup screens from Claude Design, reference the published artifact for them — they are the visual source of truth; this document is the *behavioral and technical* source of truth (what each screen does, what it calls, what state it manages).
4. Build in the sprint order given in Section 18. Each sprint has an exit criterion — don't move to the next until the current one is verifiably working against the real backend, not mocked data.

---

## SECTION 1: PROJECT CONTEXT

Court Booking Platform for Pakistan (pilot: DHA/Clifton, Karachi — padel + futsal). Company: Logic Link System. Core strategy: **owners get a free operations tool first; the player marketplace opens once venues already run their day on it.** This ordering matters for the frontend too — the owner-facing screens are not a secondary "admin panel," they are as important as the player-facing screens, arguably more important for the pilot phase.

**Three surfaces, one backend:**
1. **Mobile app (React Native + Expo)** — used by BOTH players and owners. One codebase, role-gated navigation (a user's `role` field from `/auth/me` determines which flows they see — a person is never asked "are you a player or owner," the account itself carries that).
2. **Web app (Next.js)** — public, SEO-indexed venue pages (server-rendered, so Google can crawl "padel courts in DHA Karachi") PLUS a web version of the owner dashboard and the platform admin console (owners and admins are just as likely to be on a laptop as a phone for back-office work; players are mobile-first).
3. **WhatsApp** — not a frontend you build; it's the backend's own channel, already fully implemented server-side. The only frontend responsibility here is: the in-app chat UI should look and feel like a continuation of the same conversation a player might have had on WhatsApp (same message bubbles, same AI assistant voice), since a real player may switch between the two mid-booking.

**Non-goals for the frontend, matching the backend's non-goals:** no custom payment gateway UI (screenshot upload only), no tournament bracket UI (announcement + interest-registration only), no in-app wallet UI yet.

---

## SECTION 2: TECH STACK

| Layer | Choice | Why |
|---|---|---|
| Mobile | **React Native + Expo** (SDK 52+, Expo Router for file-based navigation) | OTA updates without app-store review for most changes; one codebase for iOS/Android; Android-first per the cost-cutting plan, defer iOS build until needed |
| Web | **Next.js 15 (App Router)** | Server-rendered venue pages for SEO; same React mental model as the mobile team already uses |
| Styling (mobile) | **NativeWind** (Tailwind for React Native) | Keeps mobile and web visually consistent using the same utility classes |
| Styling (web) | **Tailwind CSS** | Pairs with NativeWind so both surfaces can share a design-token config |
| State/data fetching | **TanStack Query (React Query)** on both surfaces | Handles caching, polling (the 15-second availability refresh), retries, and loading/error states without hand-rolled fetch logic |
| Forms | **React Hook Form + Zod** | Zod schemas double as runtime validation AND can mirror the backend's Pydantic schemas for consistency |
| Local/session storage | **Expo SecureStore** (mobile), **httpOnly cookie or localStorage** (web) | Session token must never be readable by injected JS on web if avoidable — prefer an httpOnly cookie set by a thin Next.js API route proxy if feasible; SecureStore on mobile is already secure by default |
| Push notifications | **Expo Notifications** wrapping FCM | Matches the backend's `fcm_tokens` table and `POST /users/me/fcm-token` endpoint |
| Maps/location | **expo-location** + a maps library (react-native-maps) for "use my location" search | Backend already does the geo math (PostGIS) — frontend just needs to capture lat/lng and send it |
| E2E testing (mobile) | **Maestro** | Simpler YAML-based flows than Detox, easier to keep passing as screens change |
| E2E testing (web) | **Playwright** | Standard for Next.js |
| Component testing | **React Native Testing Library** (mobile), **React Testing Library** (web) | |
| Monorepo tool | **Turborepo** or plain npm/pnpm workspaces | Keep it simple — a shared API client and types package is the main reason for a monorepo here, not build orchestration complexity |

---

## SECTION 3: PROJECT STRUCTURE

```
court-booking-frontend/
├── apps/
│   ├── mobile/                    # Expo app — Player + Owner (role-gated)
│   │   ├── app/                   # Expo Router file-based routes
│   │   │   ├── (auth)/
│   │   │   │   ├── login.tsx
│   │   │   │   └── otp.tsx
│   │   │   ├── (player)/
│   │   │   │   ├── index.tsx              # Home / search
│   │   │   │   ├── venue/[slug].tsx        # Venue detail + schedule grid
│   │   │   │   ├── booking/[id]/chat.tsx   # In-app chat for a booking
│   │   │   │   ├── booking/[id]/pay.tsx    # Payment proof upload
│   │   │   │   ├── bookings.tsx            # My bookings
│   │   │   │   └── profile.tsx
│   │   │   ├── (owner)/
│   │   │   │   ├── today.tsx
│   │   │   │   ├── approvals.tsx
│   │   │   │   ├── walkin.tsx
│   │   │   │   ├── ledger.tsx
│   │   │   │   ├── growth.tsx
│   │   │   │   └── venue-setup/            # Register venue, add courts, schedule, pricing
│   │   │   └── _layout.tsx                 # Role-based redirect logic lives here
│   │   ├── components/
│   │   └── app.json
│   └── web/                       # Next.js — public site + owner/admin web dashboard
│       ├── app/
│       │   ├── (public)/
│       │   │   ├── page.tsx                # Landing
│       │   │   ├── venues/[slug]/page.tsx  # SEO venue page (server-rendered)
│       │   │   └── search/page.tsx
│       │   ├── (dashboard)/
│       │   │   ├── owner/                  # Web mirror of mobile owner screens
│       │   │   └── admin/                  # Platform admin console (web-only, no mobile equivalent)
│       │   └── api/
│       │       └── session/route.ts        # Thin proxy: sets/reads an httpOnly session cookie
│       └── next.config.js
├── packages/
│   ├── api-client/                # Shared typed client — the ONE place that knows the backend's 63 routes
│   │   ├── src/
│   │   │   ├── client.ts          # Base fetch wrapper: auth header injection, error envelope parsing, retry
│   │   │   ├── auth.ts
│   │   │   ├── venues.ts
│   │   │   ├── courts.ts
│   │   │   ├── availability.ts
│   │   │   ├── bookings.ts
│   │   │   ├── payments.ts
│   │   │   ├── waitlist.ts
│   │   │   ├── chat.ts
│   │   │   ├── owners.ts
│   │   │   ├── admin.ts
│   │   │   └── reviews.ts
│   │   └── package.json
│   └── types/                     # Shared TypeScript types mirroring backend Pydantic schemas
│       └── src/
│           ├── booking.ts         # BookingStatus union, Booking interface, etc.
│           ├── venue.ts
│           ├── availability.ts
│           └── errors.ts          # ErrorCode union matching app/errors.py's catalog
├── package.json                   # workspaces: ["apps/*", "packages/*"]
└── turbo.json
```

**Why one `api-client` package, not per-app fetch calls:** the backend's error envelope (`{"error": {"code", "message", "details"}}`), the auth-header injection, and the "refresh token on 401 once, then retry" logic must behave identically on mobile and web. Writing it once and importing it twice means a backend contract change (e.g., a renamed field) is fixed in one file, not hunted down across two codebases.

---

## SECTION 4: THE SHARED API CLIENT

### 4.1 Base client (`packages/api-client/src/client.ts`)

```typescript
export class ApiError extends Error {
  constructor(
    public code: string,       // matches backend's ErrorCode catalog
    message: string,
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  onUnauthorized: () => Promise<void>;  // called once on a 401 that survives refresh — should log the user out
}

export function createApiClient(config: ApiClientConfig) {
  async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
    const token = await config.getToken();
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (response.status === 401 && !retried) {
      // Attempt one silent session refresh (POST /auth/refresh) before giving up —
      // this is what makes the "1-year session, no repeated OTP" promise feel
      // seamless instead of the user hitting an unexpected logout mid-session.
      const refreshed = await tryRefresh(config);
      if (refreshed) return request<T>(path, options, true);
      await config.onUnauthorized();
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(
        body?.error?.code ?? "UNKNOWN_ERROR",
        body?.error?.message ?? response.statusText,
        response.status,
        body?.error?.details,
      );
    }

    if (response.status === 204) return undefined as T;
    return response.json();
  }

  return { request };
}
```

### 4.2 Example typed endpoint module (`packages/api-client/src/bookings.ts`)

```typescript
import type { Booking, HoldBookingInput, WalkinBookingInput } from "@court-booking/types";

export function createBookingsApi(client: ReturnType<typeof createApiClient>) {
  return {
    hold: (input: HoldBookingInput) =>
      client.request<{ booking: Booking }>("/bookings/hold", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    walkin: (input: WalkinBookingInput) =>
      client.request<{ booking: Booking }>("/bookings/walkin", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    mine: (status?: "upcoming" | "past" | "all") =>
      client.request<{ bookings: Booking[] }>(`/bookings/mine${status ? `?status=${status}` : ""}`),

    get: (id: string) => client.request<{ booking: Booking }>(`/bookings/${id}`),

    cancel: (id: string, reason?: string) =>
      client.request<{ booking: Booking }>(`/bookings/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    checkin: (id: string) =>
      client.request<{ booking: Booking }>(`/bookings/${id}/checkin`, { method: "POST" }),

    submitPaymentProof: (bookingId: string, imageUri: string) => {
      const formData = new FormData();
      formData.append("image", { uri: imageUri, name: "proof.jpg", type: "image/jpeg" } as never);
      return client.request<{ payment: Payment; booking: Booking }>(
        `/bookings/${bookingId}/payment-proof`,
        { method: "POST", body: formData, headers: {} }, // let fetch set multipart boundary
      );
    },
  };
}
```

Build one such module per resource area from the endpoint table in Section 5. Every module is thin — it exists only to give each route a typed function signature and a home, not to hold business logic (that lives in the backend).

---

## SECTION 5: FULL API REFERENCE (build the client against this)

This mirrors the backend's actual implemented surface (63 routes). Treat this as the contract; if the live `/docs` disagrees with this table on any field name, **trust `/docs`** — it's generated from the real code.

**Note: the backend's real, current API surface is also documented in `FRONTEND_INTEGRATION.md` in this same `docs/` folder — generated directly from the actual route/schema code after the audit-and-hardening pass. If anything below conflicts with `FRONTEND_INTEGRATION.md`, trust `FRONTEND_INTEGRATION.md` — it reflects what's actually implemented and tested, including two known gaps called out there (no self-serve owner signup endpoint, and push notifications are currently a non-functional stub).**

```
AUTH                              /auth
  POST   /request-otp             { phone } -> { message, expires_in }
  POST   /verify-otp              { phone, otp, device_id, device_name, platform }
                                     -> { token, user, is_new_user }
  POST   /refresh                 (bearer) -> { token, expires_at }
  POST   /logout                  (bearer) -> 204
  GET    /me                      (bearer) -> { user, session }

USERS                              /users/me
  POST   /fcm-token                { token, platform } -> 201
  DELETE /fcm-token/:token         -> 204
  GET    /notifications            ?page=&per_page= -> notification history

VENUES                             /venues
  POST   /                         create -> { venue } (status: pending)
  GET    /                         ?lat=&lng=&radius_km=&sport=&page=&per_page= -> { venues, total, page }
  GET    /:id                      -> full venue (bank_details only if owner/admin)
  GET    /by-slug/:slug            -> public venue page data
  PATCH  /:id                      partial update
  POST   /:id/photos               multipart image upload
  POST   /:id/announcements        Tier 3 marketing send (Pro/Business only)
  GET    /:id/availability         ?date= -> all courts' slots for that day

COURTS                             /courts, /venues/:id/courts
  POST   /venues/:id/courts        create
  GET    /venues/:id/courts        list
  GET    /courts/:id               get
  PATCH  /courts/:id               update
  DELETE /courts/:id               deactivate
  POST   /courts/:id/schedule      { schedules: [{day_of_week, open_time, close_time}] }
  POST   /courts/:id/pricing       { rules: [{name, priority, day_of_week, start_time, end_time,
                                       price_per_slot, advance_percentage}] }
  POST   /courts/:id/blackouts     { title, starts_at, ends_at, reason }
  GET    /courts/:id/availability  ?date= or ?start_date=&end_date= (max 28 days)
                                     -> { slots: [{starts_at, ends_at, status, price,
                                          advance_amount, held_until?}] }

BOOKINGS                           /bookings
  POST   /hold                     { court_id, starts_at } -> { booking } (status: held, held_until)
  POST   /walkin                   { court_id, starts_at, player_name, player_phone, amount_paid }
  GET    /mine                     ?status=upcoming|past|all
  GET    /:id                      get
  POST   /:id/cancel               { reason? }
  POST   /:id/checkin              QR check-in (owner side)
  POST   /:id/payment-proof        multipart { image } -> { payment, booking }

PAYMENTS                           /payments, /bookings/:id/payments
  POST   /:id/approve              owner approves
  POST   /:id/reject               { reason } -> booking cancelled, slot released
  GET    /:id/proof-url            -> { url, expires_in } (5-min signed S3 URL)

WAITLIST                           /waitlist
  POST   /                         { court_id, slot_starts_at } -> { position }
  GET    /mine                     list active entries
  DELETE /:id                      leave waitlist

REVIEWS                            /reviews, /venues/:id/reviews
  POST   /reviews                  { booking_id, rating, comment }
  GET    /venues/:id/reviews       list
  POST   /reviews/:id/reply        owner reply

OWNERS                              /owners  (all require owner role, most take ?venue_id= to scope)
  GET    /venues                    owner's own venues
  GET    /today                     grid + revenue summary for today
  GET    /pending-approvals         oldest-first payment review queue, with OCR verdict + signed proof URL
  GET    /ledger                    ?start_date=&end_date=&court_id= -> bookings + summary
  GET    /ledger/export             CSV download
  GET    /growth                    Pro-tier-gated underbooked-slot suggestions
  GET    /digest                    owner daily digest data

ADMIN                                /admin  (admin role only)
  GET    /dashboard                 platform-wide counts
  GET    /venues/pending            approval queue
  POST   /venues/:id/approve
  POST   /venues/:id/request-changes  { reason }
  POST   /venues/:id/reject           { reason }
  GET    /bookings                  filterable, platform-wide
  GET    /users                     ?search=&flagged=
  GET    /disputes                  players rejected 2+ times
  POST   /users/:id/suspend         { reason }
  POST   /users/:id/unsuspend

CHAT                                /chat
  POST   /message                   { venue_id, booking_id?, message, channel: "app" }
                                       -> { reply, actions: [{type, label, data}] }
  GET    /history                   ?venue_id=&booking_id=&page=

HEALTH                              /health, /health/ready (no auth, no /api/v1 prefix)
```

---

## SECTION 6: AUTH FLOW

### 6.1 What the screens do

**Login screen (`(auth)/login.tsx`)** — single phone number input (Pakistani format, `+92` prefix pre-filled). On submit: call `POST /auth/request-otp`. Show a 5-request/15-minute rate-limit-aware error state (the backend returns 429 — surface "too many attempts, try again in X minutes," not a generic error).

**OTP screen (`(auth)/otp.tsx`)** — 6-digit code entry (auto-advance between boxes, auto-submit on 6th digit). On submit: call `POST /auth/verify-otp` with `phone`, `otp`, and a generated `device_id` (persist a UUID in SecureStore on first app launch, reuse forever — this is what lets the backend tell "same device, different login" apart from "new device"), `device_name` (from `expo-device`'s model name), `platform` (`"android"`/`"ios"`).

On success: store the returned `token` in SecureStore, store `user` in a global auth store (Zustand), and route based on `user.role` — `player` → `(player)/index`, `owner` → `(owner)/today` (or `(owner)/venue-setup` if they have zero venues yet — check `GET /owners/venues`), `admin` → deep-link to the web admin console (the mobile app doesn't need an admin surface).

**Known gap (per `FRONTEND_INTEGRATION.md`): there is currently no self-serve "become an owner" endpoint — every user is created as a player.** Until the backend adds one, the owner-signup entry point in the UI should be built but clearly marked/flagged as blocked on a backend endpoint, not silently wired to a dead call.

### 6.2 Session persistence — the whole point of the backend's design

The backend issues a session token good for ~1 year. **The frontend's job is to never ask for the OTP again unless the backend explicitly says to.** Concretely:

- On app launch, check SecureStore for a token. If present, call `GET /auth/me`. If it succeeds, skip straight past login to the role-appropriate home screen — the user should never see the login screen again after their first successful verification, for up to a year, across app restarts, phone reboots, etc.
- If `GET /auth/me` returns 401, only THEN show the login screen (this correctly handles: token expired, session revoked, or user changed phone).
- Call `POST /auth/refresh` proactively (e.g., on app foreground, if the token is older than some threshold) rather than waiting for a 401 — smoother experience, though the `client.ts` retry-on-401 logic in Section 4.1 is the safety net either way.
- `POST /auth/logout` is the only user-initiated way to force a fresh OTP — make sure it's clearly a deliberate action (confirmation dialog), not a single accidental tap, since it burns the whole point of the long-lived session.

### 6.3 How to test

```
TEST: First-time login flow
  - Enter phone, request OTP, enter correct code → lands on role-correct home screen
  - Kill and relaunch the app → still logged in, no OTP screen shown

TEST: Wrong OTP
  - Enter wrong code → inline error, doesn't advance, attempt counter behavior
    matches backend (5 max, then "request a new code")

TEST: Rate limiting surfaced correctly
  - Trigger 6 OTP requests rapidly → 6th shows a clear "too many attempts" message,
    not a raw error code or a generic "something went wrong"

TEST: Session survives app restart (manual, on a real device)
  - Log in, force-quit the app, reopen days later (or fast-forward device clock
    in a simulator) → still logged in

TEST: Logout actually clears everything
  - Logout → SecureStore token cleared, next launch shows login screen,
    old token if manually replayed gets 401 from the backend
```

---

## SECTION 7: PLAYER APP SCREENS

### 7.1 Home / Search (`(player)/index.tsx`)

**What it does:** the entry point for discovery. Location permission prompt (or manual area text entry as fallback — not every user grants location), sport filter chips (padel/futsal/etc., driven by whatever sports exist in the venues near them), price range slider, date/time picker for "when do you want to play."

**How it works:** calls `GET /venues?lat=&lng=&radius_km=&sport=&page=` via TanStack Query, `radius_km` defaulting to something sensible (10km) with a "expand search" option if results are sparse. Results are cards with venue name, distance, sport icons, a photo, and a "from PKR X" price teaser (lowest price_per_slot across its courts — this requires an extra light query or a backend-provided summary field; if the backend doesn't return a price summary on the list endpoint, fetching each venue's cheapest court's pricing separately is too expensive — flag this to the backend team if a summary field would help here).

**Empty state:** matches the existing `SearchEmpty` mockup screen — no results in radius, offer to expand radius or change sport filter, never just "no results" with nothing actionable.

### 7.2 Venue Detail + Schedule Grid (`(player)/venue/[slug].tsx`)

**What it does:** photos, address, amenities, sports offered, and — the important part — the live schedule grid, matching the `Main` mockup's clickable-slot behavior. A day-by-day (or week view) grid of every court's slots, colored by status.

**How it works:** `GET /venues/:id/availability?date=` on load, **polled every 15 seconds while this screen is focused** (per the plan's "skip WebSockets at MVP, poll every 15s" decision) using TanStack Query's `refetchInterval`, paused when the screen loses focus (don't poll a screen the user isn't looking at). Tapping an `available` slot navigates to the chat/booking flow (7.3). Tapping a `held`/`payment_submitted`/`booked` slot does nothing destructive — maybe shows a small "someone's currently booking this" tooltip. Tapping a `blocked` slot shows the blackout reason if provided.

**Visual states to distinguish clearly** (this matters more than it sounds — a player misreading "held" as "available" and wasting a chat turn is a real UX failure): `available` (bright, tappable), `held` (dimmed, small "in progress" indicator, NOT tappable), `payment_submitted` (dimmed, different from held), `booked` (solid/filled, not tappable), `blocked` (crosshatched or greyed with a reason label).

### 7.3 Booking Chat (`(player)/booking/[id]/chat.tsx`)

**What it does:** tapping an available slot immediately creates a chat context (does NOT immediately call `/bookings/hold` — that only happens once the player confirms intent, matching the backend's `held` state being player-confirmed, not auto-triggered by a tap). The AI assistant's first message references the specific slot ("Court 1, tomorrow 5:00 PM — PKR 3,000. Want to book this?"), with quick-reply buttons matching the backend's `actions` array from `POST /chat/message`.

**How it works:** `POST /chat/message` with `{venue_id, message: "<initial context or user's typed message>", channel: "app"}`. Render `reply` as an assistant bubble; render each `actions[]` entry as a tappable button (`type: "confirm_booking"` → on tap, send the corresponding follow-up message or call the booking hold directly per what the backend's action `data` implies — confirm the exact contract against `/docs`, since this is the one place where the AI's action-suggestion format needs to be pixel-matched against what the backend actually returns). Once a hold is created (either via AI tool-call or the confirm action), the chat should show the payment instructions (bank details, amount, a "I've paid, upload screenshot" button) inline in the same conversation.

### 7.4 Payment Proof Upload (`(player)/booking/[id]/pay.tsx`)

**What it does:** shown once a booking is `held`. Displays payment instructions clearly (bank name, account title, account number, exact amount — this is the moment fraud/confusion happens most, so make the amount huge and unmissable), a "held until" countdown timer (the 15-minute window — show it counting down, not just a static time, so the player feels the urgency correctly), and an image picker/camera button for the screenshot.

**How it works:** `expo-image-picker` for camera/gallery → `POST /bookings/:id/payment-proof` (multipart). On response, show the OCR verdict to the player too (not just the owner) — if `ocr_verdict: "mismatch"`, tell them clearly before they just wait confused ("We noticed the amount in your screenshot doesn't quite match — the owner will review this manually, it may take a bit longer"). If `auto_approved: true` in the response, skip straight to a booking-confirmed celebration screen — don't make them wait for a notification that already-arrived good news happened.

**Held-until countdown expiring:** if the countdown hits zero while the player is still on this screen, show a clear "this hold expired" state with a "try again" button back to availability — don't leave them staring at a dead countdown.

### 7.5 My Bookings (`(player)/bookings.tsx`)

`GET /bookings/mine?status=upcoming|past|all`, tabbed. Each booking card shows status prominently (color-matched to the schedule grid's status colors for consistency), venue/court/time, and contextual actions: `held`/`payment_submitted` → cancel button; `booked` and upcoming → a QR code (for the owner's check-in scan) and a "message venue" button (opens the chat); `completed` → a "leave a review" prompt if none exists yet.

### 7.6 Waitlist entry point

On the schedule grid (7.2), a `booked` slot could show a small "notify me if this opens up" affordance (rather than requiring the player to already know the waitlist exists). `POST /waitlist` on tap, confirmation toast showing their `position`. A "My Waitlist" section (could live in the profile tab) lists active entries via `GET /waitlist/mine`, with a leave option (`DELETE /waitlist/:id`).

### 7.7 How to test the player app

```
TEST: Search → venue → schedule grid renders correct statuses
  - Seed backend with known slot statuses (available/held/booked/blocked)
  - Verify each renders with visually distinct, correct styling — a screenshot
    diff test or explicit testID-based assertions, not just "it renders something"

TEST: Grid polls while focused, stops when unfocused
  - Mock the availability endpoint, navigate to the screen, verify repeated calls
    at ~15s; navigate away, verify polling stops (check no further calls after
    a wait longer than the interval)

TEST: Full booking happy path (E2E, against a real or staging backend)
  - Tap available slot → chat opens → confirm booking → hold created → payment
    screen shown with correct instructions → upload a test image → verdict shown
  - This is the single most important E2E test in the whole frontend — treat it
    like the backend's 50-concurrent-request test: it must never be allowed to
    silently break

TEST: Held countdown expiring mid-screen
  - Mock a booking with held_until 5 seconds in the future, verify the countdown
    reaches zero and the UI switches to the expired state without a crash

TEST: Cancel button only shown for cancellable statuses
  - held/payment_submitted → cancel visible; completed/cancelled → not visible

TEST: Waitlist join/leave
  - Join → position shown; appears in My Waitlist; leave → removed from list
```

---

## SECTION 8: OWNER APP SCREENS

### 8.1 Venue Setup Wizard (`(owner)/venue-setup/`)

A multi-step flow, matching the `VenueRegister` → `VenueCourts` → `VenuePending` mockups: (1) venue basic info + location picker (map pin drop, reverse-geocoded to an address), (2) add one or more courts (name, sport, slot length, surface), (3) set weekly schedule (a simple "same hours every day" toggle with per-day override, not 7 separate identical forms by default), (4) set pricing (start with one flat rate, offer "add a peak-hours rule" as a progressive-disclosure step, not a wall of pricing-rule fields up front), (5) bank details for payment instructions, (6) submit → show the `VenuePending` "under review" state clearly, with an explanation of what admin review means and roughly how long it takes.

**Why the progressive disclosure matters here specifically:** owners are the least technical users in this whole product and the ones most likely to abandon a long form. Every extra required field before "submit" is a real risk to the wedge strategy — default to the simplest valid configuration and let owners add complexity later from the same screens.

### 8.2 Today View (`(owner)/today.tsx`)

**What it does:** matches `OwnerToday` mockup — today's full schedule grid across all their courts, with player names and amounts visible on booked slots (this screen, unlike the player-facing grid, is allowed to show personal details since it's the venue's own owner viewing their own bookings).

**How it works:** `GET /owners/today` (optionally `?venue_id=` if they have more than one venue — show a venue switcher only if `GET /owners/venues` returns more than one). Poll like the player grid (15s) since this is the screen an owner keeps open during business hours. Prominent counts at the top: total bookings, revenue, pending approvals (tapping this count jumps straight to 8.3).

### 8.3 Pending Approvals Queue (`(owner)/approvals.tsx`)

**What it does:** matches `OwnerApproval` mockup — the single most important owner screen, since slow approvals are flagged repeatedly across your planning docs as the #1 trust risk.

**How it works:** `GET /owners/pending-approvals`, oldest-first (already sorted by the backend). Each card shows: player name, slot details, the OCR verdict prominently (green "✅ Amount matches" or a clear red "⚠️ mismatch — expected PKR X, screenshot shows PKR Y"), the proof image itself (fetch via `GET /payments/:id/proof-url` and display inline, don't make the owner tap through to see it — an extra tap here directly costs approval speed), and two big, unambiguous buttons: Approve / Reject (reject requires a reason — a short reason-picker with common options like "amount doesn't match," "unreadable," "duplicate," plus free text, rather than a blank text box every time).

**Real-time-ish freshness matters here too:** poll this screen while focused — a new payment submission triggers a push notification anyway (per the backend's escalation ladder — though see `FRONTEND_INTEGRATION.md`'s note that push is currently a non-functional stub, so **in-app polling on this screen is the only reliable freshness signal today**, not a nice-to-have on top of push), and the in-app list should refresh so an owner staring at the screen sees new submissions appear without a manual pull-to-refresh.

### 8.4 Walk-in Entry (`(owner)/walkin.tsx`)

**What it does:** matches `OwnerWalkIn` — the "biggest adoption killer" fix per your plan. Must be FAST: court picker, date/time (defaulting to now/next available slot), player name, player phone (optional but recommended — enables linking to a real account later), amount. One screen, no wizard, submit in under 15 seconds for a returning owner.

**How it works:** `POST /bookings/walkin`. On the 409 case (someone already grabbed that slot, e.g., via the app, moments earlier) show a clear "this slot was just booked through the app — pick another" rather than a generic error, since this exact race is the reason the backend enforces it at the database level.

### 8.5 Ledger (`(owner)/ledger.tsx`)

**What it does:** matches `OwnerLedger` — date range picker, court filter, a scrollable list of every booking with amount/source/status, summary totals at top, and an export button.

**How it works:** `GET /owners/ledger?start_date=&end_date=&court_id=`. Export button triggers `GET /owners/ledger/export` and uses the platform's native share/save-file flow (Expo's `expo-sharing` on mobile, a plain download link on web) rather than trying to render a CSV in-app.

### 8.6 Growth Suggestions (`(owner)/growth.tsx`)

**What it does:** matches `OwnerGrowth` — Pro/Business tier only. If the owner's venue is Free tier, show an upsell state explaining what this screen would show, not a blank/broken page. If Pro/Business, show each underbooked-slot suggestion as a concrete card ("Tuesdays 10-11 AM books 15% of the time vs. your 65% average — try a 20% discount?") with a one-tap "Apply discount" action (this likely needs a backend endpoint to actually create a temporary pricing rule — confirm this exists; if not, this button should be flagged back rather than built as a dead end).

**How it works:** `GET /owners/growth`. Handle the "not enough data yet" case gracefully (a court that's too new returns no suggestions — show "check back in a few weeks" rather than an empty, unexplained screen).

### 8.7 How to test the owner app

```
TEST: Venue setup wizard end-to-end
  - Complete all steps with minimal required fields only → venue created,
    status=pending, correct redirect to pending screen
  - Abandon partway through and resume later → progress isn't lost (persist
    wizard state locally until final submit)

TEST: Today view shows correct booking details
  - Seed known bookings, verify names/amounts/times render correctly per court

TEST: Approval flow
  - Tap Approve on a pending payment → booking status updates to booked in the
    UI immediately (optimistic update or refetch), disappears from the queue
  - Tap Reject, select a reason → booking cancelled, disappears from queue

TEST: Walk-in against an already-taken slot
  - Attempt a walk-in for a slot that's concurrently held by another flow
    → clear, specific error shown, not a generic failure

TEST: Ledger export
  - Trigger export → file is produced/shared successfully on both platforms

TEST: Growth screen tier-gating
  - Free-tier venue → upsell state shown, no API error surfaced to the user
  - Pro-tier venue with insufficient data → "check back later" state
  - Pro-tier venue with real suggestions → cards render with correct numbers
```

---

## SECTION 9: WEB APP (NEXT.JS)

### 9.1 Public SEO pages (`(public)/`)

**Landing page** — matches `WebLanding` mockup. Server-rendered, fast, minimal client JS. Search bar that leads into...

**Search results** (`/search`) — same filtering as the mobile search, but as a full web page with URL-encoded query params (`?sport=padel&area=dha`) so results are shareable/bookmarkable and, more importantly, so Google can index filtered result pages.

**Venue page** (`/venues/[slug]`) — matches `WebVenue`. **This must be server-rendered (SSR or static + revalidation), not client-fetched**, since the entire point of this page existing on web at all is organic search traffic per your plan's "public, SEO-indexed court pages" growth lever. Use Next.js's `generateMetadata` for per-venue title/description tags ("Padel Courts in DHA Phase 6 Karachi — [Venue Name]"), and structured data (schema.org `SportsActivityLocation` or similar) so it can show up richly in search results.

**Decided: web supports full booking, not just discovery.** A player browsing on web must be able to complete the entire flow without downloading the app — tap a slot, chat with the AI, hold the booking, upload payment proof, get confirmed — the same journey as Sections 7.3/7.4, rebuilt as a web equivalent sharing the same `api-client` package (never a second, divergent implementation of the booking logic itself; only the presentation layer differs between native and web). Concretely:

- `/venues/[slug]` renders the schedule grid as an interactive client component nested inside the server-rendered page shell — the SEO-critical content (name, address, description, static schedule summary) stays server-rendered for crawlers, while the live/pollable grid and the booking interaction hydrate client-side on top of it. Don't let adding interactivity here regress the server-rendering requirement above — verify with JS disabled that the core content is still present, even though the booking grid itself naturally requires JS to be interactive.
- The chat UI, payment-proof image upload (a plain `<input type="file">` + drag-and-drop, no camera requirement on web), and held-until countdown all need web equivalents of Sections 7.3/7.4 — same states, same copy, same urgency cues.
- This roughly doubles the size of Sprint 5 and Sprint 7 below (Section 18) — budget for that rather than treating web as a quick reskin of the dashboard.

### 9.2 Web Dashboard (`(dashboard)/owner/`, `(dashboard)/admin/`)

These are the same screens as Sections 8.2–8.6 and the admin console, rebuilt as web pages sharing the same `api-client` package. Since owners and admins are equally likely to want this on a laptop, don't treat the web dashboard as a lesser afterthought — the underlying data and actions are identical, just a different layout (a wider table-based ledger view suits a laptop better than a mobile card list, for instance).

### 9.3 Session handling on web specifically

Since a bearer token in `localStorage` is readable by any injected script (XSS risk), prefer: a thin Next.js API route (`app/api/session/route.ts`) that receives the token from the client-side login flow and sets it as an httpOnly, secure cookie, then a server-side fetch wrapper for any server components that need to call the backend, plus the same `api-client` package configured to read the token via a same-origin request to that API route rather than directly from client-side storage. If this is more complexity than the team wants for a pilot, a documented, deliberate tradeoff of using `localStorage` for now (with a note to revisit before scaling past the pilot) is acceptable — just make the choice consciously, not by default.

### 9.4 How to test the web app

```
TEST: Venue page is actually server-rendered
  - Fetch the page with JS disabled (or check the initial HTML response directly,
    not after hydration) → venue name/address/schedule are present in the raw HTML

TEST: SEO metadata present
  - Check <title>, meta description, and structured data are correctly populated
    per venue, not a generic site-wide value

TEST: Search results are shareable via URL
  - Apply filters, copy the URL, open in a fresh session → same filtered results

TEST: Full booking happy path works on web, not just mobile
  - Tap available slot → chat → hold → payment proof upload → confirmed,
    entirely on web, no app download required — the same critical E2E test
    from Section 7.7, run again against the web build

TEST: Owner web dashboard parity
  - Every action available on mobile owner screens (approve, reject, walk-in,
    export) works identically on web against the same backend

TEST: Admin console access control
  - Non-admin user hitting /admin routes → redirected/blocked, not shown a
    broken page
```

---

## SECTION 10: PUSH NOTIFICATIONS

**Before building this section: read `FRONTEND_INTEGRATION.md`'s notifications section first.** As of the audit, push is a non-functional stub server-side (FCM posts to a placeholder URL and no-ops without a configured service account key), and even once wired up, the payload is title/body text only — no `data` field, so no push-based deep-linking is possible without a backend change. Build the registration flow below so it's ready, but do not treat push as a reliable delivery mechanism yet — `GET /users/me/notifications` (polling) is the only currently-real way a client learns about approvals, rejections, and reopened slots. Prioritize polling-based freshness on the screens in Sections 7.5, 8.2, and 8.3 over push-dependent UX.

### 10.1 Registration flow

On login success (or app launch if already logged in), request notification permission (Android 13+/iOS both require explicit permission — handle the "denied" case gracefully, the app must still function without push, just less proactively). On grant, get the Expo push token, call `POST /users/me/fcm-token` with `{token, platform}`. On logout, call `DELETE /users/me/fcm-token/:token` to stop notifications going to a device the user signed out of.

### 10.2 Handling incoming notifications (once the backend stub is wired up)

Map the backend's notification event types to in-app behavior when the app is foregrounded vs. backgrounded:
- `payment_submitted` (owner) → tapping the notification deep-links straight to the Pending Approvals screen (8.3), not just the app's home screen.
- `payment_approved`/`payment_rejected` (player) → deep-links to the specific booking (7.5).
- `slot_reopened` → deep-links to that venue's schedule grid (7.2), ideally scrolled/highlighted to the specific slot.

**Deep linking is not optional polish here** — a notification that just opens the app to a generic home screen, forcing the user to re-navigate to what the notification was actually about, defeats the point of the whole tiered-notification system the backend was built around. **This depends on the backend adding a `data` payload to push notifications — flag this as a backend dependency, not something the frontend can work around alone.**

### 10.3 How to test

```
TEST: Token registration on login
  - Grant permission, log in → POST /users/me/fcm-token called with a valid token

TEST: Token cleanup on logout
  - Logout → DELETE /users/me/fcm-token/:token called

TEST: Deep link routing (per notification type, once backend data payload exists)
  - Simulate each notification type being tapped → verify correct screen +
    correct entity (e.g., the RIGHT booking, not just "a booking screen")

TEST: Permission denied doesn't break the app
  - Deny notification permission → app remains fully usable, no crash,
    a non-blocking banner/setting to enable it later is acceptable

TEST: App remains fully usable with push non-functional
  - With no FCM key configured (today's actual state), verify polling alone
    keeps the approvals queue, my-bookings, and schedule grid screens fresh
```

---

## SECTION 11: ROMAN URDU / i18n

The backend's AI chat already responds in Roman Urdu or Urdu when the player writes in it — **the frontend's job is just to not get in the way of that**, not to translate the whole UI on day one (per the plan's "multi-language support beyond English + Urdu is a fast-follow, not v1" framing... though note the plan already ships Urdu in AI chat as a P0 requirement, so at minimum, chat bubbles must render Urdu script correctly).

**Concretely:**
- Ensure text rendering components handle Urdu script (RTL considerations for Urdu specifically are limited since Roman Urdu is Latin-script left-to-right, and full Urdu script is less likely to be the dominant chat mode — but don't hard-code a LTR-only text renderer that would break if a user does type in Urdu script).
- Static UI chrome (buttons, labels, screen titles) can stay English-only for v1, using a lightweight i18n library (`i18next` or `expo-localization` + a simple key-value dictionary) set up from day one even with only one language populated — this makes adding Urdu UI strings later a content task, not a re-architecture.

---

## SECTION 12: ERROR HANDLING & OFFLINE/POOR-NETWORK TOLERANCE

This is explicitly called out in your plan as a Pakistan-specific requirement ("cheap-Android / poor-network tolerance," and the manual QA checklist item "test on a cheap Android phone on throttled 3G").

**Concrete requirements, not just "handle errors":**
- Every network call has a visible loading state AND a distinct timeout/failure state with a retry button — never an infinite spinner.
- The 15-second polling on the schedule grid must back off gracefully on repeated failures (don't hammer a struggling connection every 15 seconds regardless of success) — exponential backoff up to some cap, resuming normal interval once a request succeeds.
- Form submissions (especially payment proof upload, which sends an image over a possibly slow connection) need an explicit upload progress indicator, not just a spinner — an owner or player on 3G uploading a 3MB screenshot needs to see it's actually progressing.
- TanStack Query's cache should be configured so previously-loaded data (e.g., a venue page already viewed) remains visible while a background refetch happens, rather than blanking the screen to a loading spinner on every revisit.
- Map every backend `ErrorCode` (Section 16.3 of the backend spec — `SLOT_ALREADY_TAKEN`, `INVALID_BOOKING_STATE`, `VENUE_NOT_APPROVED`, etc.) to a specific, human-readable message. Never show a raw error code or a generic "something went wrong" when the backend has already told you exactly what happened.

### How to test

```
TEST: Throttled network (manual, using device network throttling or Chrome DevTools
      for web)
  □ Complete the full booking flow on simulated 3G — every step remains usable,
    no silent failures, no indefinite spinners

TEST: Offline handling
  - Airplane mode mid-session → clear "you're offline" state, not a crash;
    reconnecting resumes normal operation without requiring an app restart

TEST: Error code mapping
  - Trigger each backend ErrorCode via a crafted request (e.g., try to book an
    already-blackout-blocked slot) → verify the specific, correct message shows,
    not a generic fallback
```

---

## SECTION 13: SHARED TYPES PACKAGE

Keep `packages/types` as the single place TypeScript interfaces mirror the backend's Pydantic schemas. Concretely, at minimum:

```typescript
// packages/types/src/booking.ts
export type BookingStatus =
  | "held" | "payment_submitted" | "booked"
  | "completed" | "no_show" | "cancelled";

export type BookingSource = "app" | "whatsapp" | "walkin" | "phone";

export interface Booking {
  id: string;
  court_id: string;
  player_id: string | null;
  starts_at: string;   // ISO 8601
  ends_at: string;
  status: BookingStatus;
  source: BookingSource;
  price: number;
  advance_amount: number;
  amount_paid: number;
  balance_due: number;
  held_until: string | null;
  payment_deadline: string | null;
  created_at: string;
}

// packages/types/src/errors.ts — keep this in sync with app/errors.py's ErrorCode catalog
export type ErrorCode =
  | "INVALID_OTP" | "OTP_EXPIRED" | "OTP_RATE_LIMITED"
  | "SESSION_EXPIRED" | "SESSION_REVOKED"
  | "SLOT_ALREADY_TAKEN" | "BOOKING_NOT_FOUND" | "INVALID_BOOKING_STATE"
  | "NOT_YOUR_BOOKING" | "SLOT_IN_PAST" | "SLOT_BLOCKED"
  | "VENUE_NOT_APPROVED" | "VENUE_NOT_FOUND" | "NOT_VENUE_OWNER"
  | "DUPLICATE_PROOF" | "PROOF_TOO_LARGE" | "INVALID_IMAGE_FORMAT"
  | "RATE_LIMITED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR";
```

**Whoever builds the frontend should periodically diff these types against the backend's real Pydantic schemas** (visible at `/docs` → the OpenAPI JSON at `/openapi.json`) — better yet, if time allows, generate these types automatically from the backend's OpenAPI schema (`openapi-typescript` is a good tool for this) rather than hand-maintaining a parallel copy that can silently drift.

---

## SECTION 14: DESIGN SOURCE

**The real, approved UI screens are in `docs/maidan-screens.html`, in this same folder — open it first, before writing any screen.** It's a self-contained, clickable reference containing all 24 actual screens (Auth & venue approval, Player app, Owner app, and Web), extracted directly from the approved design canvas — exact colors, exact layout, no interpretation needed. Two color systems are used deliberately, not a mistake to unify: player-facing screens (auth, player app, public web pages) use **Figtree** font with accent **#EF5A2C** (orange); owner/business-facing screens (owner app, venue onboarding, admin console, owner web dashboard) use **IBM Plex Sans** with accent **#0E6274** (teal). Background is `#FAF8F6`, ink is `#141A1D` on both. Build every screen pixel-matched to this reference — same fonts, same colors, same spacing, same component shapes — do not invent a new visual style or unify the two accent colors into one.

Screens referenced above by name (`AuthLogin`, `AuthOtp`, `VenueRegister`, `VenueCourts`, `VenuePending`, `Main`, `SearchEmpty`, `OwnerToday`, `OwnerApproval`, `OwnerWalkIn`, `OwnerLedger`, `OwnerGrowth`, `WebLanding`, `WebVenue`, `WebDashboard`) map directly to the matching screen in `maidan-screens.html`'s sidebar. This document tells you *what each screen does and connects to*; the HTML file tells you exactly what it looks like.

---

## SECTION 15: WHAT NOT TO BUILD YET

Matching the backend's own non-goals, don't build frontend UI for: a custom payment gateway/checkout flow, tournament brackets or live scoring (only an announcement + "I'm interested" tap), an in-app wallet/balance screen, or a fully localized (Urdu UI chrome) experience. Building ahead of the backend's actual capabilities creates dead-end screens that call endpoints that don't exist — this now explicitly includes the two gaps `FRONTEND_INTEGRATION.md` flagged: don't build a working self-serve owner-signup flow (the endpoint doesn't exist) or rely on push notification payloads carrying a `data` field (they don't, today).

---

## SECTION 16: BUILD & DEPLOY

**Mobile:** Expo Application Services (EAS) — `eas build` for both platforms, `eas update` for OTA JS updates (skip store review for most bugfixes/content changes). Android-first per the cost-cutting decision — defer the Apple Developer Program enrollment and iOS build until the pilot explicitly needs it.

**Web:** Vercel is the natural fit for Next.js (zero-config SSR, preview deployments per PR) — confirm this doesn't conflict with keeping everything else on AWS; if it must stay on AWS, Next.js can run on ECS Fargate or via AWS Amplify Hosting instead, at the cost of losing some of Vercel's zero-config SSR conveniences.

---

## SECTION 17: TESTING STRATEGY SUMMARY

**Must never be allowed to break silently:**
1. The full booking happy path E2E test (Section 7.7) — search → venue → hold → pay → confirmed — **run on both mobile and web** (Section 9.4), since web now carries the same booking flow, not just discovery.
2. The full payment approval E2E test — owner sees a pending payment, approves it, player sees the update.
3. Auth persistence across app restarts (Section 6.3) — this is the entire point of the backend's 1-year-session design; a frontend bug that re-prompts for OTP unnecessarily defeats it completely.

**Test pyramid:**
- Component tests (React Native/React Testing Library) for individual screens' rendering logic given mocked API responses — fast, run on every commit.
- Integration tests against a real running backend (not mocked) for the API client package itself — catches contract drift between frontend assumptions and actual backend behavior.
- E2E tests (Maestro/Playwright) for the critical user journeys listed above — slower, run before each release, not necessarily every commit.

---

## SECTION 18: SPRINT ORDER

Follow this sequence, matching the backend's own sprint pacing where dependencies allow:

**Sprint 1: Foundations** — monorepo setup, shared api-client + types packages, auth flow (login/OTP/session persistence) on mobile. Exit: a real phone number can log in and stay logged in across restarts, against the real backend.

**Sprint 2: Owner venue setup** — the wizard (8.1), since the backend's owner-operations wedge strategy means owners need to get venues live before players can do anything. Exit: a real venue with real courts/schedule/pricing can be created and reaches `pending`.

**Sprint 3: Owner operations (the wedge)** — Today view, walk-in entry, pending approvals, ledger (8.2–8.5). Exit: an owner can run a full day using only the app, mirroring the backend's own Sprint 3 exit criterion.

**Sprint 4: Player discovery** — search, venue detail, schedule grid (7.1–7.2). Exit: a player can find a venue and see accurate live availability.

**Sprint 5: Booking core (mobile)** — chat, hold, payment proof upload, my bookings (7.3–7.5). Exit: the full booking happy path E2E test passes against the real backend, on mobile.

**Sprint 6: Notifications + waitlist** — push registration, deep linking, waitlist UI (Section 10, 7.6). Exit: given push is currently a stub, the realistic exit criterion is: polling keeps all relevant screens fresh, and the registration/deep-link code is written and ready for when the backend push payload is fixed.

**Sprint 7: Web** — public SEO pages, the full booking flow rebuilt for web (chat/hold/payment-proof, not just discovery — Section 9.1), and web dashboard parity (Section 9.2). This is now a full sprint's worth of booking-flow work, not a reskin — budget accordingly. Exit: a venue page is real server-rendered, indexable HTML; the full booking happy path completes end to end on web with no app download; owner/admin actions work identically to mobile.

**Sprint 8: Growth + polish** — growth suggestions screen, reviews, error/offline hardening (Sections 8.6, 12). Exit: throttled-3G manual QA checklist passes clean.

**Sprint 9: Pilot readiness** — full E2E suite green, real device testing on a cheap Android phone, EAS production build submitted.

---

**End of prompt. Build sprint by sprint, verify each exit criterion against the real running backend (not mocked data) before moving to the next, and treat the full booking happy-path E2E test with the same seriousness the backend team gave its 50-concurrent-request test — it is the equivalent proof that the whole system actually works end to end.**
