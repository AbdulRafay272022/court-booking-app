# Full audit (2026-10-28)

This audit was read only. No code was changed, nothing was committed or pushed, and production was not touched beyond the public `GET /api/v1/venues`. Code base: `main` = `origin/main` = `b708a20`, which is what is deployed.

- **Platform column:** **web**, **app** (Expo mobile), **both**, or **backend** (affects both).
- **"needs device":** means it could not be confirmed without a real phone.
- **Paths:** `W/` = `court-booking-frontend/apps/web/`, `M/` = `court-booking-frontend/apps/mobile/`, `BE/` = `court-booking-backend/app/`.
- **Screenshots:** 196 PNGs (26 MB) in `docs/audit-screens/`, untracked. Do not commit them, or add them to `.gitignore` the same way as `docs/floodlight-qa`.
- **How screenshots were taken:** local backend on :8765, web `next build && next start` on :3765, and Expo web on :8082 against the local dev DB. Seed accounts: player +923000000003, owner +923000000002, admin +923000000001. No staff login exists in the seed, so staff screens were not captured.
- **Note:** `W/.next` on this machine was rebuilt pointing at `localhost:8765`. Rebuild before using it locally. CI builds its own image, so production is not affected.

## Top 12 (what matters most)

| # | Finding | Platform | Where | Severity |
|---|---|---|---|---|
| 1 | Venue page and availability endpoints show **pending, rejected and soft-deleted venues** to anyone who has the slug or id. No status or `is_active` check. | backend (both) | `BE/api/venues.py:146-177`, `BE/api/availability.py:33-151` | high |
| 2 | **CNIC is never checked on the server.** An admin can approve a venue whose owner has no CNIC or an unverified one. There is no reject action, no reason field and no owner notification. Any image passes. | backend + web (admin) | `BE/services/owner_identity_service.py`, `BE/api/admin.py:127-170`, `W/app/dashboard/admin/identities/page.tsx` | high |
| 3 | **Venue approve has zero completeness checks.** A venue can go live with no courts, schedule, pricing or bank details. | backend | `BE/api/admin.py:166-170`, `BE/services/venue_service.py:174-180` | high |
| 4 | **The owner web dashboard rotates the session on every page load.** `GET /owners/venues` goes out before the token is attached, gets a 401, and forces a refresh. Four parallel calls then 401 again. A second tab gets logged out. This is the likely cause of the old "unexplained session rotation" item in CLAUDE.md. | web | `W/lib/use-owner-venues.ts:11` (query not gated on auth) + api-client refresh | high |
| 5 | **`GET /auth/me` returns 500 instead of 401** when the session is rotated between the two lookups in the same request. | backend | `BE/api/auth.py:193` (`SessionOut.model_validate(None)`) | med |
| 6 | **AI replies in Devanagari.** The prompt invites "Urdu", and neither the validator nor the sanitizer can see Devanagari. | backend (app chat + WhatsApp) | `BE/services/ai_chat_service.py:75`, `chat_validator.py:217-222`, `chat_language.py:13-14`, `ai_chat_service.py:271-281` | med |
| 7 | **AI chat pins one venue and hides the rest.** The model is told "no need to call search_venues". Named-venue matching is weak. | backend | `BE/services/chat_state.py:889-894, 279, 286-315`; `chat_facts.py:220-232, 247`; `ai_chat_service.py:1301-1311` | med |
| 8 | **Rejecting a payment always cancels the booking.** This is fine for the advance, but it blocks any "balance screenshot" feature, which would cancel a paid booking. | backend | `BE/services/payment_service.py:960-962` | high (for G1) |
| 9 | **No refund row** when a player cancels a `payment_submitted` booking, or a booked booking paid in cash. In the cash case the owner is still told "refund owed". | backend | `BE/services/booking_service.py:433-556`, `BE/api/bookings.py:191-208` | med |
| 10 | **Staff actions are logged as the player.** Owner/staff check-in, owner/staff cancel, the cancel caused by a reject, and `booking.confirmed` all record `actor_id = booking.player_id`. | backend | `BE/services/booking_service.py:708-716, 476-484, 630-637` | med |
| 11 | **No player notification** for no-show, short payment ("kam mila") or balance due. **No owner notification** for the CNIC result. **SMS is never used.** | backend | `BE/services/notification_service.py` | med |
| 12 | **The mobile app has no admin at all.** It shows only "Use the web console". | app | `M/app/(admin)/index.tsx` | med |

---

## A. Web vs app parity

**How roles are routed:**
- **Mobile:** `M/app/_layout.tsx` (`Stack.Protected`) sends players to `(player)`, owners **and staff** to `(owner)`, and admins to `(admin)`.
- **Web:** owner and staff share `W/components/owner/owner-shell.tsx`; admin uses `W/app/dashboard/admin/layout.tsx`.

### A1. Player
| Screen / action | Web path | App | App path | Note |
|---|---|---|---|---|
| Login / signup / OTP verify / forgot / reset | W/app/(auth)/* | Yes | M/app/(auth)/* | |
| Search + filters | W/app/search | Yes | M/app/(player)/search.tsx, (tabs)/index.tsx | |
| Venue page: calendar, slots, duration quote, hold | W/app/venues/[slug] + components/booking/* | Yes | M/app/(player)/venue/[slug].tsx | the app uses a 4-step picker, not a calendar and popup |
| **Join waitlist for a full slot** | W/components/booking/court-day-popup.tsx | **Missing** | — | the app never calls `waitlist.join` |
| **Court hours / blackouts panel** | W/components/booking/court-hours-panel.tsx | **Missing** | — | |
| Reviews list | W/components/venue-reviews.tsx | Yes | venue/[slug].tsx | |
| Favourite + saved venues | W/components/favorite-button.tsx, account?tab=saved | Yes | (player)/_components.tsx, (tabs)/profile.tsx | |
| Pay (upload proof) | W/app/booking/[id]/pay | Yes | booking/[id]/pay.tsx | the app can also cancel here |
| Done / confirmation | W/app/booking/[id]/done | Yes | booking/[id]/done.tsx | the app also lists payments and shows the policy |
| Self check-in (venue QR) | W/app/booking/[id]/checkin | Yes | booking/[id]/checkin.tsx | |
| Booking chat | W/app/booking/[id]/chat | Yes | booking/[id]/chat.tsx | |
| My bookings (tabs, filters, stats, next card) | W/app/bookings | Yes | (tabs)/bookings.tsx | |
| Cancel from the list card | W/components/bookings/booking-card.tsx | **Partial** | pay.tsx, done.tsx | only from the booking screens, not the list |
| Write / edit review | booking-card.tsx | Yes | (tabs)/bookings.tsx | |
| My waitlist | W/components/account-hub/bookings-panel.tsx | Yes | (tabs)/profile.tsx | |
| Edit profile + avatar, change phone, settings, logout | W/app/account, account/phone | Yes | edit-profile.tsx, change-phone.tsx, profile.tsx | |
| Notifications | header bell + web push | Yes | (player)/notifications.tsx + FCM | the app has a full screen |
| Marketing pages | W/app/{page,about,blog,contact,features,for-owners,terms,privacy} | Partial | links only | web-only by nature |

### A2. Owner
| Screen / action | Web path | App | App path | Note |
|---|---|---|---|---|
| Venue setup (register, courts, pricing, schedule, timers, CNIC, status) | W/app/venue-setup/* | Yes | M/app/(owner)/venue-setup/* | |
| Overview / Today (KPIs, slots) | W/app/dashboard/owner/today | Yes | (owner)/(tabs)/today.tsx | |
| Completion Haan/Nahi, no-show | today, W/components/owner/booking-detail.tsx | Yes | components/completion-sheet.tsx, booking-detail-sheet.tsx | |
| Booking detail | W/components/owner/booking-detail.tsx | Yes | booking-detail-sheet.tsx | the app adds direct check-in and record payment |
| Approvals (approve / reject / acknowledge / screenshot) | W/app/dashboard/owner/approvals | Yes | (tabs)/approvals.tsx | |
| Walk-in | W/app/dashboard/owner/walkin | Yes | (owner)/walkin.tsx | |
| History + CSV | W/app/dashboard/bookings | Yes | (owner)/history.tsx | |
| Ledger + CSV + correction | W/app/dashboard/owner/ledger | Yes | (tabs)/ledger.tsx | |
| Refunds (list, mark paid) | W/app/dashboard/owner/refunds | Yes | (tabs)/refunds.tsx | |
| Check-in hub / manual code | W/app/dashboard/owner/checkin/** | Yes | checkin.tsx, checkin-scan.tsx | |
| Venue QR | W/app/dashboard/owner/checkin/qr | **Partial** | checkin-qr.tsx | no print; the code is never shown as text, so the player's "type the venue code" box cannot be used |
| Growth, reviews (feature flags) | W/app/dashboard/owner/{growth,reviews} | Yes | growth.tsx, reviews.tsx | |
| Settings (basics, photos, courts, pricing, schedule, blackouts, advance, timers, CNIC) | W/app/dashboard/owner/settings | Yes | venue-settings.tsx | web has **no `booking_horizon_days` control**; the app has one |
| Staff, Premium | W/app/dashboard/owner/{staff,premium} | Yes | staff.tsx, premium.tsx | |
| Badges, bell, account | owner-shell.tsx, W/app/account | Yes | owner-tab-bar.tsx, notifications.tsx, account.tsx | |
| **Owner/staff cancel a booking** | — | — | — | no UI on either platform, though the backend permission `cancel_booking` exists |
| **Record cash payment** (`payments.recordEntry`) | `W/components/owner/record-payment-sheet.tsx` exists but **nothing imports it** | app only | booking-detail-sheet.tsx | missing on web |

### A3. Staff
- **Web:** staff see the owner shell; only Staff and Premium are hidden. Buttons are gated through `W/lib/my-permissions.ts` on today, approvals, refunds, booking-detail, history and the timers card. **Walk-in, ledger, check-in, growth, reviews and venue settings are not gated in the web UI.** A staff member sees the page, and the backend's 403 is the only guard.
- **App:** gating is stricter. `M/lib/owner-access.ts` hides tabs and More items, and `firstAllowedTabRoute` picks the start tab.

| Screen / action (permission) | Web | App | Note |
|---|---|---|---|
| Overview (`view_ledger`) | shown to every staff member | Yes, gated | web gap |
| Completion (`record_payments`), no-show (`check_in` or `record_payments`) | Yes, gated | Yes, gated | |
| Approvals (`approve_payments`) | Yes, gated | Yes (tab needs `view_ledger`) | |
| Refunds (`mark_refunds`) | Yes, gated | Yes, gated | |
| Ledger, History (`view_ledger`) | Yes, not gated in the UI | Yes, gated | web gap |
| Walk-in (`walkin`) | Yes, not gated in the UI | Yes, gated | web gap; the permission is also hidden in the staff form |
| Check-in (`check_in`) | Yes, not gated | Yes, gated (the QR itself is owner-only) | |
| Growth (`view_growth`), Reviews (`respond_reviews`) | Yes, not gated | Yes, gated | |
| Settings (`edit_court_settings`, `manage_photos`) | only the timers card is gated | read-only parts | web gap |

### A4. Super admin: the app has nothing
`M/app/(admin)/index.tsx` is a static "Use the web console" screen with Log out. **Needed in the app (all Missing):**

| Admin screen / action | Web path |
|---|---|
| Overview metrics | W/app/dashboard/admin/overview |
| Venues: pending list, approve, reject, request changes | W/app/dashboard/admin/venues |
| Owner CNIC: list, detail, verify (+ reject, which needs building, see D) | W/app/dashboard/admin/identities |
| Feature flags | W/app/dashboard/admin/feature-flags |
| Premium pricing | W/app/dashboard/admin/pricing |
| Premium payments + invoices (approve / reject / reverse / record) | W/app/dashboard/admin/premium-payments |
| Revenue summary + owner billing detail | W/app/dashboard/admin/billing, billing/[ownerId] |
| Hide / unhide a review | W/components/venue-reviews.tsx |

**Backend admin endpoints with no UI on either platform** (`BE/api/admin.py`):
- `/admin/stats`, `/admin/dashboard`
- `/admin/venues` (all venues, not only pending)
- `/admin/bookings`, `/admin/users`, suspend/unsuspend, role change
- `/admin/disputes`, `/disputes/refund-queue`, `/disputes/passive-venues`, `/disputes/flagged-checkins`

**Mobile-only features:**
- camera QR scan
- direct check-in from the booking detail
- record a cash entry
- player chat inbox tab
- full-screen notification pages
- payment history on the done screen

**Web-only features:**
- waitlist join
- court hours panel
- QR print
- marketing pages

---

## B. Screen-by-screen UI review

Automated checks found **no horizontal overflow on any screen** and **no broken images** (apart from #5, which is local S3). **No automatic scroll jump was measured on web** (table at the end of this section).

| # | Platform | Role | Screen | Width | Problem | Severity | Screenshot |
|---|---|---|---|---|---|---|---|
| B1 | web | owner | every owner page | both | 401 race and forced session rotation on load (Top 12 #4) | high | web-owner-approvals-390.png |
| B2 | backend | owner | today | 390 | `/auth/me` 500 during that race (Top 12 #5) | med | web-owner-today-390.png |
| B3 | both | owner | sidebar / tab badge vs approvals | both | The badge says **18**, the page says 11 actionable + 7 cancelled/expired. The badge counts items the owner cannot act on. | med | web-owner-today-1440.png, app-owner-today-390.png |
| B4 | web | owner | approvals | both | Cancelled/expired items are listed first. At 390 the struck-through date wraps badly. | med | web-owner-approvals-390.png |
| B5 | web | owner | approvals, refunds | both | An empty proof thumbnail has no placeholder ("Screenshot nahi khul saka"). The missing images are local S3, an environment issue. | low | web-owner-refunds-390.png |
| B6 | web | owner | owner shell (all pages) | both | English in Roman Urdu mode: nav (Overview/Approvals/Bookings/Ledger/Growth/Reviews/Staff/Premium/Account), buttons (Check-in, Add booking, Bookings history), KPI labels, "Cancelled", "Overdue". The nav says "Booking add karein" but the button says "Add booking". | med | web-owner-today-1440.png |
| B7 | backend → web | owner | approvals | both | Payment-check reasons come from the backend in English ("Name not visible on the screenshot.", etc.) | med | web-owner-approvals-1440.png |
| B8 | web | owner | checkin | 390 | The header says "Dashboard". The copy says "Today" (the nav says Overview). "--" is used instead of a dash. The H1 is smaller than on other pages. | low | web-owner-checkin-390.png |
| B9 | web | owner | settings | 390 | The "Tafseel" field is single-line, so the description is cut off. The header says "Venue settings" and the H1 says "Settings". | low | web-owner-settings-390.png |
| B10 | web | owner | bookings history | 1440 | Sort icons sit to the left of the labels and float between columns. "TOTAL MILA" wraps. | low | web-owner-bookings-1440.png |
| B11 | web | owner | ledger | 390 | A KPI wraps. Table cells wrap onto 2-3 lines. | low | web-owner-ledger-390.png |
| B12 | web | owner | sidebar | 1440x900 | The sticky sidebar (978 px) is taller than the viewport, so the WhatsApp help box is cut off. | low | web-owner-today-1440.png |
| B13 | both | owner | all owner pages | 390 | The CNIC banner (~130 px) pushes content down on every page. | low | web-owner-*-390.png |
| B14 | web | player | booking chat (expired hold) | both | Completely blank: no greeting, no summary, no empty state. | med | web-player-booking-chat-390.png |
| B15 | web | player | pay (payment_submitted) | both | Never says which booking it is (no venue, date or court). | med | web-player-booking-pay-submitted-390.png |
| B16 | web | player | pay (expired) | 390 | Full-screen error with no header or back link. | low | web-player-booking-pay-390.png |
| B17 | web | player | account | 390 | The tab strip scrolls sideways and the Settings tab is cut off with no hint. | low | web-player-account-profile-390.png |
| B18 | web | player | bookings | 390 | The "Intezar mein" stat label wraps, so its number sits lower than the others. | low | web-player-bookings-390.png |
| B19 | web | player | done | both | Label casing is mixed (TAREEKH/WAQT vs Court/Venue). | low | web-player-booking-done-390.png |
| B20 | web | public | venue | both | A padel venue shows a futsal-pitch hero illustration. Sport pill casing is mixed ("Padel" vs "padel"). | med | web-player-venue-1440.png |
| B21 | web | public | venue | both | The Court 1 meta line wraps with a dangling "·", so the two court calendars are ~23 px out of line. | low | web-player-venue-scrolled-1440.png |
| B22 | web | public | venue | both | Owner-entered text and review text are not translated (data, expected). | low | web-public-venue-en-390.png |
| B23 | web | player | header | both | A signed-in user still sees "Shuru karo". At 390 its text is squeezed. | low | web-player-home-390.png |
| B24 | web | public | header | 1440 | Three CTAs crowd the header (Login karo, Sign up, Shuru karo). | low | web-public-for-owners-1440.png |
| B25 | web | public | terms, privacy | both | The body text is English in Roman Urdu mode (known: legal text was left untranslated on purpose). | med | web-public-terms-390.png |
| B26 | web | public | for-owners | 1440 | "baaki" vs "baqi" spelling. | low | web-public-for-owners-1440.png |
| B27 | web | public | search | 390 | The sticky filter bar covers ~190 px (23%) of the screen once scrolled. | med | web-public-search-scrolled-390.png |
| B28 | web | public | home | 390 | The stat tiles stack one per row, which is very tall. | low | web-public-home-scrolled-390.png |
| B29 | web | admin | all tabs | both | English only (intended). The tab bar is cut off at 390 ("Premium prici…") with no hint that it scrolls. The Approve button is green, off brand. | low | web-admin-overview-390.png, web-admin-venues-1440.png |
| B30 | app | player | home, bookings, venue | 390 | English weekdays/months in Roman Urdu mode ("FRI 30", "WED/OCT", "FRI SAT SUN" next to "AAJ KAL"). | med | app-player-home-390.png, app-player-venue-390.png |
| B31 | app | player | home | 390 | The "Badminton" label fills its tile edge to edge. "Koi bhi waqt" wraps. | low | app-player-home-390.png |
| B32 | both | player | bookings | 390 | The app's "Aane wali · 27" includes expired holds and own cancels. Web shows 13 for the same user. | med | app-player-bookings-390.png |
| B33 | app | player | search | 390 | "1 venues" (plural). | low | app-player-search-390.png |
| B34 | app | player | profile | 390 | "Saved venues" runs into the settings menu with no gap. | low | app-player-profile-390.png |
| B35 | app | player | booking done | 390 | "PM" wraps onto its own line. The "Pakki ✓" badge appears twice. | low | app-player-booking-done-390.png |
| B36 | app | owner | account | 390 | English strings in Roman Urdu mode ("Select your city", etc.) | med | app-owner-account-390.png |
| B37 | app | owner | venue-settings | 390 | English strings ("Sports offered at this venue", "BANK DETAILS…", cancellation questions, "No photos yet…") | med | app-owner-venue-settings-390.png |
| B38 | both | owner | today | 390 | "WED, 28 OCT" is in English. The app's "Aaj aaya PKR 0" vs web's "Collected PKR 2,500" is a different metric with a similar-looking label. The buttons wrap 2+1. | low | app-owner-today-390.png |
| B39 | app | all | tab screens | 390 | The floating tab bar covers the last card. Safe area at the top. **needs device** | med | app-player-home-390.png, app-player-bookings-390.png |
| B40 | app | player | venue | 390 | The sticky bottom bar covers ~120 px. Keyboard and gesture bar overlap. **needs device** | low | app-player-venue-390.png |

**Scroll-jump measurement:** scrolled to mid-page, then `scrollY` was read at 0, 2, 6 and 16 s.

| Screen | Width | scrollY 0/2/6/16 s | Page height |
|---|---|---|---|
| web /venues/demo-arena | 390 | 1733 ×4 | unchanged |
| web /venues/demo-arena | 1440 | 1095 ×4 | unchanged |
| web /search?city=Lahore | 390 | 851 ×4 | unchanged |
| web /search?city=Lahore | 1440 | 233 ×4 | unchanged |

On the app (Expo web) the page does not scroll; a ScrollView does. So the app jump is **needs device** (see C1).

**Not captured:**
- staff role (no seeded staff password)
- app booking chat
- app `/notifications` (ambiguous route in Expo web)
- owner settings Courts tab
- camera, image picker, `Alert.alert` and push, all **needs device**

---

## C. The six reported bugs (causes only, nothing fixed)

| # | Bug | Platform | Cause (file:line) | Confirmed how | Needs device |
|---|---|---|---|---|---|
| C1 | Venue / court screen jumps or scrolls up | both | Web: `W/components/booking/court-day-popup.tsx:185`, `duration-sheet.tsx:69`. App: `M/app/(player)/venue/[slug].tsx:93,120-127,137,410-431` + `M/components/ui/Screen.tsx:55` | code trace; no jump measured on desktop Chromium | yes (app; iOS Safari for web) |
| C2 | AI replies in Devanagari | backend | `BE/services/ai_chat_service.py:75`; `chat_validator.py:217-222`; `chat_language.py:13-14`; `ai_chat_service.py:271-281` | local run of the validator with a Devanagari draft | no |
| C3 | "sirf KHA Legends Arena hai" / named venue not found | backend | `BE/services/chat_state.py:889-894, 783, 279, 286-315`; `chat_facts.py:220-232, 247`; `BE/api/chat.py:41`; `ai_chat_service.py:1301-1311`; `venue_service.py:212` | local simulation of chat state + code trace | no |
| C4 | Profile photo not shown everywhere | both | `W/components/site/site-header.tsx:114`, `profile-menu.tsx:138`; `M/app/(player)/(tabs)/index.tsx:127` | code trace | no |
| C5 | Amenities "1 + +1"; Indoor + Outdoor both shown | both (old builds) | "+N": old web `cc762fa` `components/discovery/venue-card.tsx:62` and old app `db4db49` `(player)/_components.tsx:118`, both `max={2}`. Current code shows one "Amenities [n]" chip. Indoor + Outdoor: `W/app/venues/[slug]/page.tsx:73-79` | code + git history | no |
| C6 | Player booking cards not clickable | web (current); app only in an old build | `W/components/bookings/booking-card.tsx:328` (`onClick={() => v.canResumePay && v.goPay()}`); `NextBookingCard` `:421` has no card link | code trace (spot-checked) | no |

### C1. Screen jumps
Nothing on these screens scrolls on purpose: no `scrollTo`, `focus()`, URL replace or key change. `placeholderData` keeps old data during refetches. The jumps are side effects:

**Web:**
- `CourtDayPopup` and `DurationSheet` are `fixed inset-0` overlays with **no body scroll lock and no `overscroll-contain`**. The owner modals have both (`W/components/owner/modal-shell.tsx:10-11`). When the slot list inside the popup reaches its end, the scroll carries into the venue page underneath. When the popup closes, the page is somewhere else. This is worst on phone browsers.
- Inside the popup, a 30 s clock (`court-day-popup.tsx:91-95`) drops slots that have started (`:115`). The day query opts out of placeholder data (`:110-114`), so changing the day collapses the list to a "Loading" line (`:259-260`). The month calendar also changes height when it loads (`court-month-calendar.tsx:104-105`). Safari has no scroll anchoring, so the page visibly shifts.
- **Extra real bug:** `pickingIndex` is a list position (`court-day-popup.tsx:161,166`). If the 30 s tick removes a past slot while the duration sheet is open, Continue points at the *next* slot.

**App:**
- `useNow(30_000)` and a 30 s availability refetch with `placeholderData: undefined` drop past slots. Changing court or day swaps the grid for 9 skeletons, then the grid or a one-line "Closed" banner, so the height changes.
- The page is a plain ScrollView with no `maintainVisibleContentPosition`. When content above the viewport shrinks, the offset is clamped and the screen jumps up.
- The search list has no polling. Only the offline banner toggling in the header can change its height.

### C2. Devanagari
- `SYSTEM_PROMPT` says to reply in "English, **Urdu**, or Roman Urdu" and never says "Latin letters only". Models treat Hindi and Urdu as the same and sometimes write Devanagari.
- `score()` only tokenises `[a-z؀-ۿ']`, so Devanagari scores (0, 0) and `check_language` never flags it. A mixed draft ("शुक्रिया, Court 1 ka slot …") passes as Roman Urdu.
- `sanitize_reply` has no script filter.
- Greeting, thanks and "ok" replies are Latin templates, so Devanagari can only come from the model path. Both app chat and WhatsApp use that path.

### C3. One venue only
- **The in-app chat does not use the venue it was opened from.** `POST /chat/message` stores `venue_id` on the message rows only (`BE/api/chat.py:51,62`) and never passes it to the turn (`:41`).
- **State is kept per user and channel, not per venue.** The venue gets pinned by the seed question text ("What's available at {venue}?", `M/app/(player)/booking/[id]/chat.tsx:108-110`), or automatically when only one venue offers the chosen sport (`chat_state.py:889-894`).
- **Once pinned, the model only sees that venue.** `facts_block` lists only that venue (`chat_facts.py:220-232`) and tells the model "no need to call search_venues" (`:247`).
- **Asking for another venue does not unpin it.** "koi aur venue hai?" only sets `more_options` (`chat_state.py:783`).
- **Weak name matching.** `match_venue` drops "court" as a generic word (`:279`), so "Court Site" matches only on the exact word "site". Fuzzy matching needs 5+ letters (`:306`), so "courtsite" and "court sitee" fail.
- **Weak fallback search.** `search_venues` is a plain substring match with an exact city match (`venue_service.py:212`), and `total` is counted before the name filter.
- **WhatsApp is the same**, and it has no `venue_id` at all.

**Venues in production:**
- The public `GET /api/v1/venues` (run 2026-10-28) returns **2 player-visible venues**: KHA Legends Arena and Court Site.
- The **total in the production DB** (including pending, rejected and inactive) could not be read without SSM. Read-only query via the RUNBOOK section 4 SSM recipe: `SELECT status, is_active, count(*) FROM venues GROUP BY 1,2;`

### C4. Profile photo
The photo is `users.avatar_url`, uploaded with `POST /users/avatar` and returned by `/auth/me`. The header "M" is simply the first letter of the account name; the components never read `avatar_url`.

| Place | Platform | File | Photo shown |
|---|---|---|---|
| Header avatar / profile menu | web | W/components/site/site-header.tsx:114, profile-menu.tsx:138 | **no** (initial) |
| Phone-width header drawer | web | site-header.tsx:199 | no (text) |
| Account hub header + profile panel | web | W/components/account-hub/account-hub.tsx:101, profile-panel.tsx:123 | yes |
| Home header avatar | app | M/app/(player)/(tabs)/index.tsx:127 | **no** (initials) |
| Profile tab, edit profile, avatar picker | app | (tabs)/profile.tsx:60-63, edit-profile.tsx:96, components/account/forms.tsx:84 | yes |
| Owner booking rows / overview / approvals | web | owner/booking-table/booking-rows-table.tsx:95, overview/bookings-table.tsx:136, approvals/page.tsx:463 | no (the API sends no avatar) |
| Owner booking card / approval card | app | components/overview/booking-card.tsx:125, approval-card.tsx:104 | no |
| Venue reviews | web | W/components/venue-reviews.tsx:62,167 | no |
| Staff list, owner "More" | app | (owner)/staff.tsx:161, (tabs)/more.tsx:155 | no (`Avatar` takes no URL, `M/components/ui/Layout.tsx:99`) |

The owner, review and staff schemas carry no avatar at all (`BE/schemas/owner_dashboard.py`, `owner_overview.py`).

### C5. Amenities and indoor/outdoor
- **"+1":** comes from builds older than Floodlight. Current main shows one "Amenities [n]" chip on cards and the full list on the venue page. With `max={2}`, KHA (3 amenities) showed 2 + "+1" and hid "changing room". If a phone still shows "+1", it is running an old build. "One item + +1" with max=2 would need a screenshot to explain.
- **Indoor + Outdoor:** correct behaviour. KHA really has both an indoor and an outdoor active court (public API: `has_indoor=true, has_outdoor=true`). It would be wrong only if an owner set a court's indoor flag incorrectly. `W/lib/venue-tags.ts` `settingKinds` ("Indoor + Outdoor" as one chip) exists but is unused.

### C6. Booking cards
- **Web:** cards respond only for held or payment_submitted bookings. Booked, completed and cancelled cards do nothing; they have no role or href and no keyboard support.
- **Current app:** fixed. `BookingRow` opens pay or done (`M/app/(player)/(tabs)/bookings.tsx:131-160`).
- **Expected:** an unpaid booking opens `/booking/{id}/pay`; everything else opens `/booking/{id}/done`.

---

## D. CNIC and venue visibility

### D1. Review actions
| Item | Finding | Platform |
|---|---|---|
| Statuses | Derived only: `missing` → `submitted` → `verified` (`BE/services/owner_identity_service.py:88-91`). **There is no `rejected` status, no reason column, and no status column.** | backend |
| Model | `owner_identity`: `cnic_encrypted`, `cnic_last4`, `cnic_hash`, `front_key`/`back_key`, `verified_at`, `verified_by`, `flags` (JSONB list, only `duplicate_cnic`) (`BE/models/owner_identity.py`) | backend |
| Admin actions | list / view / **verify** only (`BE/api/stage2.py:139-157`). **No reject or un-verify.** | backend |
| Admin UI | web: verify button only (`W/app/dashboard/admin/identities/page.tsx:187-198, 249`). **App: nothing.** | web / app |
| Owner notified? | **No.** Verify writes an audit row only (`owner_identity_service.py:248-263`). | backend |
| Re-upload | Overwrites the photos and resets `verified_at` (`:162-164`). | backend |

### D2. Is the venue hidden if CNIC is pending or rejected?
**No. Outside its own module, the backend never reads `OwnerIdentity` or `verified_at`.** Visibility depends only on `venue.status` and `venue.is_active`.

| Surface | Today | CNIC checked |
|---|---|---|
| Search `GET /venues` and the web map | approved + active (`BE/services/venue_service.py:209-210`) | no |
| Areas list | approved + active (`venue_service.py:328-340`) | no |
| **Venue page by slug / id** | **no status or active check at all** (`BE/api/venues.py:146-177`). Pending, rejected and soft-deleted venues open for anyone with the link. | no |
| **Availability / quote / month summary** | **no venue status check** (`BE/api/availability.py:33-151`, `availability_service.py:92`) | no |
| Hold / booking | `_require_approved_venue_for_court` checks APPROVED but **not `is_active`** (`BE/services/booking_service.py:61-71, 265`). A soft-deleted venue's courts can still be held. | no |
| AI chat | `search_venues` is approved + active, but `get_venue_info`, `get_venue_courts` and `check_availability` have no status check (`ai_chat_service.py:1301-1348`); `chat_facts` is approved + active (`chat_facts.py:122`). The hold gate still refuses. | no |
| WhatsApp | same service as the AI chat | no |
| Saved venues | approved + active (`BE/services/favorite_service.py:31,49`) | no |
| Admin approve | no CNIC or completeness check; the admin venues page shows no CNIC state (`BE/api/admin.py:127-170`) | no |

The only "CNIC gate" is in the client: the wizard disables "Send for review" without a CNIC (`W/app/venue-setup/courts/page.tsx:88-92`, mobile equivalent). Calling the API directly skips it.

### D3. Is the image really a CNIC?
**No.** There is no OCR, no vision check and no aspect-ratio check. Checks today:
- 13 digits (`normalize_cnic`, `:45-56`), with no checksum or region check
- MIME is jpeg, png or webp
- 10 MB or smaller
- Pillow can decode it and it is not a pixel bomb (`BE/utils/image.py:24-39`)
- a duplicate number only adds a flag

A payment screenshot passes as a CNIC. A real check could reuse the existing vision provider (as payment OCR does) to read the number off the card and compare it with the typed number. That needs no migration.

---

## E. Venue settings defaults

Defaults copy: `court-booking-frontend/packages/types/src/settings-defaults.ts:91-107`, `W/messages/ru/set2.ts:4-6`, `W/components/settings/default-hint.tsx`, `M/components/default-hint.tsx`. Timer defaults: `BE/services/venue_timers.py:26-34` (a NULL column means "use the default").

| Setting | Field (file) | Default | UI (web / app) | Make required? |
|---|---|---|---|---|
| booking_horizon_days | venues (BE/models/venue.py:68) | 90 | web: **no control**; app: venue-settings.tsx:442 | no (add a web control) |
| cancellation_allowed | venues (venue.py:62) | true | W/components/setup/cancellation-policy-fields.tsx; M/components/court-setup-fields.tsx:339 | **yes, an explicit choice** (the default commits the owner to refunds) |
| cancellation_cutoff_hours | venues (venue.py:65) | null = no limit (the backend even allows cancelling after the start) | same | **yes, when cancelling is allowed** |
| hold_minutes | venues (venue.py:73) | 15 | W/components/setup/venue-timers-card.tsx:128; M/components/reminders-card.tsx:100 | no |
| reminders_enabled / first_reminder_after_min / repeat_every_min / max_reminders | venues | true / 10 / 30 / 5 | same | no |
| auto_cancel_enabled / auto_cancel_after_min | venues | true / 120 | same | no |
| slot_minutes (minimum booking) | courts (court.py:25) | 60 (the wizard prefills 90) | court-setup-fields (both) | explicit (prefilled is OK) |
| advance rule type/value/minimum | courts (court.py:61-68) | null → pricing rule `advance_percentage` | W/components/setup/advance-rule-fields.tsx; M/components/advance-settings.tsx | recommend explicit |
| advance_percentage | pricing_rules (pricing.py:31) | 100 | court-setup-fields | no |
| floodlight_surcharge | pricing_rules (pricing.py:28) | 0 | court-setup-fields | no |
| is_indoor / has_floodlights | courts (court.py:29-33) | false / false | court-setup-fields | is_indoor: explicit |
| auto_approve_enabled / min_bookings | venues (venue.py:49-53) | false / 5 | — | no |
| Schedule | schedule_templates | none (the wizard prefills 6 AM–11 PM) | court-setup-fields | **yes** |
| Pricing | pricing_rules | none | court-setup-fields | **yes** |
| Bank details | venues.bank_details (encrypted JSONB) | null | wizard sends it only if all 3 fields are set; settings | **yes**: players cannot pay without it |
| Photos | venues.photos / courts.photos | none | settings | recommend at least 1 |
| CNIC | owner_identity | none | wizard identity step | **yes, as a server-side approve gate** |

**Can a venue go live with empty settings today? Yes.**
- `POST /venues` needs only name, address, city, coordinates and one sport.
- `POST /admin/venues/{id}/approve` checks nothing (`BE/api/admin.py:166-170`).
- An approved venue with no courts, schedule, pricing or bank details still appears in search, AI facts and favourites. It is just not bookable, or slots are unpriced, or the pay screen has no account.
- The checks exist only in the wizard UI.

---

## F. Refunds

### F1. Where the policy lives and where players see it
- **Storage:** `venues.cancellation_allowed` and `venues.cancellation_cutoff_hours` (`BE/models/venue.py:62-65`). Enforced only in `_enforce_cancellation_policy` (`BE/services/booking_service.py:489-522`). The `courts.cancellation_*` columns are deprecated and unused, and `CourtOut` mirrors the venue's value.

| Screen | Web | App |
|---|---|---|
| Venue page | yes, inside the duration sheet (`W/components/booking/duration-sheet.tsx:122-125`) | yes, info banner (`M/app/(player)/venue/[slug].tsx:471, 518, 542`) |
| Pay screen | yes (`W/app/booking/[id]/pay/page.tsx:252-254`) | yes, short line (`pay.tsx:294`) |
| My bookings card | partly: the note shows only when the booking cannot be cancelled; the refund amount is in the confirm dialog (`W/components/bookings/booking-card.tsx:213-244`) | **no** (`(tabs)/bookings.tsx`) |
| Booking done / detail | **no** (`W/app/booking/[id]/done/page.tsx`) | yes, policy card + "Refund due" (`done.tsx:264-281, 312-317`) |

### F2. Can a player request a refund?
**There is no "request refund" action.** The only path is cancel: `POST /bookings/{id}/cancel` creates a `payment_disputes` row with `refund_status = owed`.

| Status | On player cancel |
|---|---|
| held | cancelled, nothing owed |
| **payment_submitted** | cancelled, **no policy check and no refund row**, although the player may have paid. The owner gets "player cancelled". |
| booked | policy enforced. If allowed, a refund row = full `amount_paid` (`_flag_refund_for_voluntary_cancel`, `:524-556`). **Only if an approved `Payment` row exists:** a cash or hand-recorded booking gets no refund row, yet the owner is still notified "refund owed" (`BE/api/bookings.py:191-208`). With no cutoff, the backend also allows cancelling **after the start time**. |
| completed / no_show | refused (400) |

**What the owner sees:**
- **Refunds to pay:** web `W/app/dashboard/owner/refunds/page.tsx`, app `M/app/(owner)/(tabs)/refunds.tsx`. Lists owed rows with amount > 0, oldest first, overdue flag after 3 days. Mark paid needs a reference.
- **Notification:** push + WhatsApp + bell "Refund owed", **only for player cancels**.
- **Player side:** marking the refund paid notifies the player.

---

## G. Payments plan (feasibility)

### G1. Second proof (balance) on a booked booking
**Blocked today; a code-only fix is possible.** Blockers in `BE/services/payment_service.py`:

| Blocker | Where |
|---|---|
| `submit_payment` only accepts HELD | `:456-460` |
| Expected amount is hard-wired to `advance_amount` | `:462, 472-481` |
| Time check uses `created_at` / `held_until`, so a balance proof is always "after_timer" | `:53-66` |
| `mark_payment_submitted` only allows HELD → PAYMENT_SUBMITTED | `booking_service.py:642-667` |
| approve / reject `require_awaiting` → 409 on BOOKED; approve calls `confirm_booking` | `:99-111, 776-781, 904-913` |
| **reject always cancels the booking** | `:960-962` |
| Duplicate check skips proofs on the same booking | `:409-428` |

- **Not a blocker:** the partial unique index `one_pending_payment_per_booking` allows a second row once the first proof is reviewed.
- **Already exists:** the append-only `payment_entries` ledger with `bank_transfer_proof`.
- **Plan:**
  - add a BOOKED branch whose expected amount is `balance_due`
  - add a balance approve that credits through `PaymentLedgerService.record_entry`
  - add a balance reject that does **not** cancel
  - include same-booking proofs in the duplicate check
- **Purpose of each proof:** can be inferred from the booking status, or stored in `ocr_flags`/`ocr_raw` JSONB. A clean `payments.purpose` column = migration (optional).
- **Risk:** high (money path).

### G2. Bank details and Raast QR
- **Storage:** `venues.bank_details` encrypted JSONB (Fernet), keys `bank`, `account_title`, `account_number`, `iban` (optional) (`BE/models/venue.py:40`, `BE/utils/encryption.py:45-55`).
- **Validation:** account number 8-24 digits; IBAN regex `^PK\d{2}[A-Z0-9]{20}$` only, **no mod-97 checksum** (`BE/schemas/venue.py:12-82`). IBAN is not a separate column.
- **Raast QR: nothing exists.** Possible server-side only when an IBAN is present. Missing:
  - a Raast alias / ID (mobile number)
  - the merchant name and city in Raast form (`account_title` and `venue.city` could be reused)
  - an EMVCo/Raast payload generator
  - proof that the IBAN belongs to the account title
- A new key inside the JSONB blob needs no migration.

### G3. What OCR checks
| Check | Today |
|---|---|
| Amount vs advance (± tolerance) | yes (`payment_service.py:472-481`) |
| Screenshot timestamp vs booking | yes: ≥ created_at − 2 min and ≤ held_until + 2 min (`:53-66`) |
| Receiver **name** vs account title | yes, fuzzy (`:69-82`) |
| Receiver **account / IBAN** | **no** (`ocr_bank` is stored, never compared) |
| Payer name vs player | yes, a warning only (`:44-50`) |
| Duplicates | reused reference or perceptual hash, other bookings only, within the lookback (`:391-439`) |
| `not_a_receipt` / cropped / edited / failed-transaction flags | informational only |

### G4. Walk-in phone and WhatsApp opt-in
- `player_phone` is **optional** (`BE/schemas/booking.py:73,81-86`); the name is required. It links to an existing account by phone.
- **No WhatsApp opt-in flag exists anywhere.**

### G5. Notification matrix
- **push** = FCM/APNs, plus web push wherever push is sent.
- **bell** = in-app feed built from `notification_log`.
- **SMS: never used** (`SMSService` is created but never called, `notification_service.py:67`).
- **WhatsApp templates are not approved in Meta.** Outside the 24 h window they fail with 132001, so treat WA as "only works if the user messaged in the last 24 h".

| Event | Player | Owner | Code |
|---|---|---|---|
| Hold created (advance due) | **none** (instructions are in the HTTP response only) | push + WA + bell | BE/api/bookings.py:82; notification_service.py:460 |
| Advance reminder | push + bell | – | BE/jobs/expiry_job.py:112; :506 |
| **Balance due** | **none** | **none** | – |
| Proof received | – | push + bell; then reminders push + WA + bell | BE/api/payments.py:82; expiry_job.py:219; :619, 636 |
| Payment approved | push + WA + bell | none | payments.py:94,137; :360 |
| Payment rejected | push + WA + bell | none | payments.py:174; :432 |
| Auto-cancel (owner did not review) | push + WA | push + WA + bell | expiry_job.py:65,71; :689 |
| **Short payment ("kam mila")** | **none** | **none** | owner_overview_service.py:~960-1030 |
| **No-show** | **none** | **none** | booking_service.py:739-784 |
| Refund owed | none | push + WA + bell, **player cancel only** | bookings.py:191-210; :524 |
| Refund paid | push + WA + bell | none | owners.py:411; :444 |
| **CNIC result** | – | **none** | owner_identity_service.py |
| Venue approved / rejected / changes | – | push + WA + bell | admin.py:155-161; :583-615 |
| Player cancels | push + WA | push + bell (only if it was awaiting approval) | bookings.py:170,183 |

### G6. WhatsApp webhook and templates
- **Button presses are handled.** `interactive.button_reply`, `list_reply` and `button.payload` are read (`BE/services/whatsapp_service.py:240-263`) and routed to `_handle_button_reply` (`BE/api/webhooks.py:513-514`).
- **Ids handled:** `decline` and `confirm:<court>:<starts_at>[|x<n>]` (`webhooks.py:173-178, 419-470`). A typed "yes" maps to the pending confirm. Any other id gets a reply and a warning log.
- **Templates in code** (`BE/services/whatsapp_templates.py:73-89`):

| Template | Params |
|---|---|
| whatsapp_otp | code |
| booking_confirmed | venue, court, date, time, amount |
| payment_rejected | court, reason |
| payment_submitted_owner | venue, court, time, player, amount |
| venue_approved | venue |
| venue_changes_requested | venue, changes |
| venue_rejected | venue, reason |
| booking_cancelled | court, date |
| tournament_announcement | 5 params |
| generic_notification | body |

None is confirmed approved in Meta (`docs/round2-findings.md`: all 40 failures in 30 days were 132001).

### G7. Owner personal WhatsApp vs venue number
- `venues.phone` and `venues.whatsapp` exist (`BE/models/venue.py:35-36`) and are shown as the venue contact, but **notifications never use them**.
- All owner notifications go to `users.phone` (the login number).
- There is **no field for the owner's personal WhatsApp** separate from the login number. Staff use their own `users.phone`.

---

## H. Points, dues, disputes: schema design (no code)

**Every item below is Migration-Go** (needs `Migration-Go: owner-approved` + a fresh RDS snapshot).

Conventions followed:
- append-only ledgers, never edits
- partial unique indexes for idempotency
- `walk-in` players may have no account, so they are keyed by `user_id` **or** normalized `player_phone`
- totals are computed on read (project rule "on-read over stored derived state")

### H1. Per-player-per-venue points ledger (Migration-Go)
Table `player_points_entries`:

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| venue_id | uuid FK venues ON DELETE CASCADE, not null | |
| user_id | uuid FK users, null | |
| player_phone | varchar(20), null | walk-in without an account (normalized +923…) |
| booking_id | uuid FK bookings, null | |
| points | integer, not null | signed (+5, −20, …) |
| reason | new enum `points_reason`: booking_completed, paid_on_time, short_payment_accepted, short_payment_no_reply, no_show, dispute_upheld, reversal, manual | |
| reverses_entry_id | uuid FK player_points_entries, null, **unique** | a reversal = an opposite row |
| created_by | uuid FK users, null | null = system job |
| note | text, null | |
| created_at | timestamptz default now() | |

- **Checks:** `CHECK (user_id IS NOT NULL OR player_phone IS NOT NULL)`, `CHECK (points <> 0)`.
- **Indexes:**
  - `(venue_id, user_id, created_at)`
  - partial `(venue_id, player_phone) WHERE user_id IS NULL`
  - **partial unique `(booking_id, reason) WHERE reverses_entry_id IS NULL AND booking_id IS NOT NULL`**, so a job rerun can never double-award
- **Balance:** `SUM(points)` per (venue, player).
- **Optional:** a later `player_venue_standing` cache table, only if it gets slow.

### H2. Dues (baqi) carried to the next booking (Migration-Go)
Table `player_dues`:

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| venue_id | uuid FK venues, not null | |
| user_id / player_phone | as in H1, with the same CHECK | |
| source_booking_id | uuid FK bookings, not null, **unique** | one due per short-paid booking |
| amount_pkr | integer, not null, CHECK > 0 | |
| status | new enum `due_status`: open, carried, settled, written_off | |
| carried_to_booking_id | uuid FK bookings, null | the booking where it was added |
| settled_entry_id | uuid FK payment_entries, null | the money that cleared it |
| created_by, resolved_by | uuid FK users, null | |
| created_at, resolved_at | timestamptz | |

- **Index:** partial `(venue_id, user_id) WHERE status IN ('open','carried')`, plus the phone variant.
- **Payment ledger:** add enum value `payment_method += 'due_settlement'`. **`ALTER TYPE … ADD VALUE` cannot be undone by downgrade**, so leaving it in place on rollback is harmless.
- **Bookings:** `bookings.carried_due_pkr integer NOT NULL DEFAULT 0` so the next booking's total = price + carried due without rewriting `price`.

### H3. Short-payment reply (+5 / −20 after 24 h, reversal) (Migration-Go)
Table `short_payment_claims`:

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid FK bookings, **unique** | one open claim per booking |
| venue_id | uuid FK venues | |
| user_id / player_phone | as in H1 | |
| short_pkr | integer CHECK > 0 | from the "kam mila" completion |
| claimed_by | uuid FK users | owner or staff |
| claimed_at | timestamptz | |
| reply_deadline | timestamptz | claimed_at + 24 h |
| reply | new enum `claim_reply`: pending, accepted, disputed, no_reply | |
| replied_at | timestamptz, null | |
| reply_channel | varchar(20), null | app / whatsapp (button id `short:<claim_id>:yes|no`) |
| points_entry_id | uuid FK player_points_entries, null | +5 on accept, −20 on no reply |
| dispute_id | uuid FK booking_disputes, null | set when disputed (H4) |
| reversed_at, reversed_by, reversal_reason | null | reversal writes the opposite points row |

- **Index:** partial `(reply_deadline) WHERE reply = 'pending'` for the 24 h job (new runner step, e.g. `python -m app.jobs.runner claims`).
- **Who gets the points:** +5 to the player who accepts and −20 when there is no reply. This is my reading of "+5 / −20"; confirm the direction before building.

### H4. Owner dispute review (Migration-Go)
Use a new table rather than `payment_disputes`, because `payment_disputes.payment_id` is **NOT NULL**: cash and walk-in bookings have no payment row, and its columns are refund-shaped.

Table `booking_disputes`:

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid FK bookings, not null | |
| venue_id | uuid FK venues, not null | for owner lists without joins |
| opened_by | uuid FK users | the player |
| kind | new enum `dispute_kind`: short_payment, no_show, amount, refund, other | |
| player_message | text, not null | |
| evidence_keys | jsonb default '[]' | private S3 keys |
| status | new enum `dispute_status`: open, owner_accepted, owner_rejected, escalated, admin_resolved | |
| owner_response | text, null | |
| owner_responded_by, owner_responded_at | null | records the real staff/owner actor |
| admin_resolution, resolved_by, resolved_at | null | |
| created_at | timestamptz | |

- **Indexes:**
  - **partial unique `(booking_id, kind) WHERE status IN ('open','escalated')`**: one live dispute per kind
  - `(venue_id, status, created_at)` for the owner queue
- An accepted dispute writes the money correction through `payment_entries` and points through H1. No new money columns.

### H5. GPS "pohanch gaya" proof (Migration-Go)
Table `arrival_proofs`:

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid FK bookings, not null | |
| user_id | uuid FK users, not null | |
| recorded_at | timestamptz default now() | server time (trusted) |
| client_reported_at | timestamptz, null | device time (untrusted) |
| location | geography(Point, 4326), not null | PostGIS is already installed |
| accuracy_m | numeric(7,1), null | |
| distance_to_venue_m | integer | computed server-side with `ST_Distance` against `venues.location` |
| within_radius | boolean | e.g. ≤ 150 m and accuracy ≤ 100 m |
| device_id | varchar(100), null | |

- **Indexes:** `(booking_id, recorded_at desc)`. No GIST index is needed (always looked up by booking).
- **Optional:** `bookings.arrived_at timestamptz null` for fast lists. Without it the latest proof row is read on demand.
- **Caveat:** GPS can be spoofed on Android, so this is evidence, not proof (**needs device** to tune radius and accuracy).

---

## I. Staff dashboard

### I1. Per-staff stats without a migration? **Yes**, read-only queries
`audit_log` has an indexed `actor_id` but **no `venue_id`**: venue scoping joins entity → booking → court → venue. Some rows hard-code `actor_type="owner"` even for staff, so join `actor_id` to `users.role` instead of trusting `actor_type`.

| Metric | Source | Gap |
|---|---|---|
| No-shows marked | audit `booking.no_show` (`actor_id`, `new_value.marked_by`) | none |
| Cash recorded | `payment_entries.recorded_by` + `method='cash_at_venue'` | completion adjustments write no `payment_entry.recorded` audit row, so read the ledger table |
| Transfers approved | audit `payment.approved` / `payments.reviewed_by` / entries `bank_transfer_proof` | auto-approvals have `recorded_by` NULL |
| Short payments | audit `booking.completion_marked` with `result='no'`, `received_pkr`, `received_now`, `reason` | none |
| Refunds paid, reversals | audit `refund.marked_paid`, `payment_entry.reversed`; entries `recorded_by` | none |
| Totals | `SUM(payment_entries.amount_pkr) GROUP BY recorded_by` | none |
| **Check-ins** | – | **staff id not stored** (see I2) |
| **Cancels by staff** | – | **staff id not stored** (see I2) |

### I2. Actions that do not record the real actor
| Action | Records actor? | Where | File |
|---|---|---|---|
| Owner/staff check-in | **no: logs `booking.player_id`**; `checked_in_by` = the string "owner" | `booking.checked_in` | BE/services/booking_service.py:708-716 |
| Owner/staff cancel | **no: logs `booking.player_id`** | `booking.cancelled` | booking_service.py:476-484; BE/api/bookings.py:159 |
| Cancel caused by a payment reject | **no: player id** | `booking.cancelled` | payment_service.py:962 → booking_service.py:476 |
| `booking.confirmed` (side effect of approve) | **no: player id, "system"** | | booking_service.py:630-637 |
| Staff permission change / activate / deactivate | **no audit row** | | BE/services/staff_service.py:242,252 |
| Staff create | column only (`invited_by_user_id`), no audit row | | staff_service.py:209 |
| **Venue edit, including bank details** | **no audit row** | | BE/api/venues.py:180,210,226 |
| Court edit / schedule / pricing / delete | no (except deactivation with live bookings) | | BE/api/courts.py:116-195 |
| Blackouts | column `created_by` only; no delete route | | courts.py:280-292 |
| No-show, completion, approve, reject, record/reverse entry, walk-in, refund paid, timers | **yes** | | (see the respective files) |

Fixing the check-in and cancel gaps is **code only**, because `audit_log.actor_id` already exists. Past rows cannot be repaired.

---

## J. Estimates and what can ship before 5 Nov

- **Days** = one developer, including tests.
- **Risk:** the chance of breaking something live.
- **"Device":** the change needs a new EAS build plus phone testing to reach and verify the app.

| Item | Migration? | Days | Risk | Notes |
|---|---|---|---|---|
| **A.** Admin screens in the app (8 screens) | no | 6–8 | low | device |
| **A.** App: waitlist join + court hours | no | 1 | low | device |
| **A.** Web: gate staff pages client-side (walk-in, ledger, check-in, growth, reviews, settings) | no | 1 | low | |
| **A.** Web: wire the existing record-payment sheet; owner cancel UI on both | no | 1.5 | med | money |
| **B.** Owner web 401 race / session rotation (gate `owner-venues` on auth) | no | 0.5–1 | med | fixes logouts |
| **B.** `/auth/me` 500 → 401 | no | 0.25 | low | |
| **B.** Approvals badge = actionable only; actionable first | no | 0.5 | low | |
| **B.** Roman Urdu leftovers (owner shell, app account/settings, weekday names, backend check reasons) | no | 2–3 | low | app part needs device |
| **B.** Chat/pay empty states, which-booking header, small layout fixes (B8–B38) | no | 2 | low | |
| **C1.** Web popup scroll lock + `overscroll-contain` + id-based picking | no | 0.5 | low | |
| **C1.** App venue page stable height / `maintainVisibleContentPosition` | no | 1 | med | device |
| **C2.** Devanagari: prompt "Latin letters only" + script check in validator/sanitizer | no | 0.5–1 | low | |
| **C3.** Chat venue scope: pass `venue_id`, unpin on "koi aur venue", list all venues in facts, better name match | no | 2–3 | med | AI behaviour must be re-checked live |
| **C4.** Avatar in headers (web + app) and owner rows | no | 1 | low | owner rows need a schema field (API only, no DB change) |
| **C5.** Amenities/indoor | no | 0 | – | already fixed / correct; ship the new app build |
| **C6.** Web booking card opens pay/done | no | 0.25 | low | |
| **D1.** CNIC reject + reason + owner notification | **no-migration possible** (state in `flags` JSONB + audit_log); clean = **migration** (status/reason columns) | 2 | med | app admin screen depends on A |
| **D2.** Hide venues: by-slug/id + availability status check; `create_hold` `is_active` | no | 0.5 | med | check that both live venues are approved+active first (they are) |
| **D2.** Require verified CNIC for public visibility | no | 1 | **high** | **check production first**: if a live owner is unverified, the venue disappears |
| **D3.** CNIC image check with the vision model | no | 2–3 | med | costs AI calls |
| **E.** Approve completeness gate (courts, schedule, pricing, bank details, CNIC) + explicit cancellation choice | no | 1.5 | med | |
| **E.** Web `booking_horizon_days` control | no | 0.25 | low | |
| **F.** Refund row for payment_submitted and cash bookings; block cancel after start; fix the "refund owed" notice | no | 1.5 | med | money |
| **F.** Policy on web done page and app My Bookings | no | 0.5 | low | |
| **G1.** Balance proof via payments/OCR (without the reject→cancel path) | no (optional migration for `payments.purpose`) | 3–4 | **high** | money |
| **G2.** IBAN mod-97 + Raast QR | no (new JSONB key) | 2–3 | med | needs a Raast spec check |
| **G3.** Compare receiver account/IBAN in OCR | no | 0.5 | low | |
| **G4.** Walk-in phone required | no | 0.25 | low | |
| **G4.** WhatsApp opt-in flag | **migration** | 1 | low | |
| **G5.** Notifications for no-show, short payment, balance due, CNIC result | no | 2 | low | WhatsApp only reliable after Meta templates (outside the code) |
| **G7.** Owner personal WhatsApp field | **migration** (or reuse `venues.whatsapp`, no migration) | 0.5–1 | low | |
| **H1–H5.** Points, dues, short-payment reply, disputes, GPS | **migration (all)** | 10–14 total | **high** | design above; build after 5 Nov |
| **I.** Staff dashboard from audit_log + payment_entries | no | 2–3 | low | |
| **I.** Fix actor gaps (check-in, cancel, confirmed) + audit staff/venue/bank edits | no | 0.5–1 | low | |

**Safe to ship before 5 Nov.** No migrations, web/backend only (deploys on push), and low risk. About 8–10 developer days in total:
1. `/auth/me` 500 → 401; owner web 401 race / session rotation.
2. Venue by-slug/id + availability status check; `create_hold` `is_active` check.
3. Devanagari guard (prompt + validator + sanitizer).
4. Web booking card click; web popup scroll lock.
5. Approvals badge / order; header avatar.
6. Actor gaps in the audit log; audit bank-detail and staff-permission edits.
7. Approve completeness gate (after checking the 2 live venues already pass it).
8. Refund-row fixes and blocking cancel after start.
9. Web staff page gating.
10. Roman Urdu leftovers on web.

**Do not rush before 5 Nov:**
- the balance proof (G1: money, and reject cancels bookings)
- hiding venues on CNIC status (could hide a live venue)
- chat venue scope (AI behaviour)
- everything in H (migrations)
- the app-side fixes, which need an EAS build and phone testing anyway
