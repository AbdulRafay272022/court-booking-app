# Khelo mobile audit — October 2026

**Date:** 2026-10-24
**Base:** `main` @ `fc0a9c1`
**Scope:** `court-booking-frontend/apps/mobile` (Expo SDK 57, Expo Router, NativeWind v4)
**Method:** read-only. Four code audits ran (parity, UI/UX, native/config, docs), plus 200 screenshots from Expo web.

> **How the screenshots were taken.** The app ran on Expo web at 390x844 (scale 2, touch on). It talked to a LOCAL backend on `localhost:8000`, using the docker-compose Postgres on 5433 and localstack, with `make seed` data plus extra local fixtures.
> - Production was never contacted. One link to `https://3.6.48.6.sslip.io/terms` (the signup Terms link) was blocked in Playwright.
> - No AI key exists locally, so exactly one `/chat/message` reply was faked to reach the Yes/No hold buttons (shots 34–35).
> - The 500, slow-network and offline states were forced by intercepting requests in Playwright.
>
> **Limits of Expo web.** It cannot show native-only behaviour: `Alert.alert` dialogs, the camera, push, the native keyboard, haptics or the status bar. Those items are marked "needs device".
>
> Screenshots are in `docs/mobile-audit/screens/`. Local test accounts (local DB only; seed password `demo-password-123`):

| Phone | Role / state |
|---|---|
| +923000000001 | admin |
| +923000000002 | owner, Demo Arena, 2 courts |
| +923000000003 | player with bookings in every state |
| +923000000010 | fresh player (empty states) |
| +923000000011 | new owner (setup wizard) |
| +923000000012 | owner, venue pending review |
| +923000000013 | owner, venue rejected |
| +923000000014 | second player |
| +923000000020 | staff (`record_payments` only) |

---

## 1. Parity matrix (web ↔ mobile)

Categories:
- **a** = in the app, complete
- **b** = in the app, partial
- **c** = not in the app, should be
- **d** = website-only, not needed

Paths: `W/` = `apps/web/app`, `M/` = `apps/mobile/app`, and `components/…` are relative to each app.

**Headline:** mobile is much closer to web than expected. The player and owner flows call almost the same api-client methods. The real gaps are:
- discovery: no map and no sort
- venue info: description, address/map/directions, venue WhatsApp
- feature-flag gating
- CSV export from history
- language switch
- admin

### 1.1 Player

| Feature | Web | Mobile | Cat | Note |
|---|---|---|---|---|
| Area / city / near-me filter | `components/discovery/filter-bar.tsx` | `M/(player)/search.tsx`, `components/filter-sheet.tsx` | a | Same API params; radius 15 km |
| Price / indoor / amenities / date+time+duration / sport filters | same | same | a | Mobile uses free PKR inputs; web uses presets |
| Sort (best / price / rating / nearest) | `filter-bar.tsx:416-420` | — | **b** | Mobile only sorts by distance when near-me is on |
| Map view of results | `components/discovery/results-view.tsx`, `venue-map.tsx` | — | **c** | No react-native-maps. A list/map toggle is a native-feel must-have (Playtomic, Airbnb) |
| Venue photos (venue + court) | `photo-gallery.tsx` | `photo-gallery.tsx` | a | |
| Amenities | `amenity-badges.tsx` | `amenity-badges.tsx` | a | |
| Court Indoor/Outdoor label | `venue-schedule-client.tsx:90` | `M/(player)/venue/[slug].tsx:132` | **b** | Mobile shows only "Indoor", never "Outdoor"; no venue-level summary |
| Court surface / floodlights | — | — | **c (both)** | `surface_type` / `has_floodlights` exist in types and backend; no UI anywhere |
| Venue description, address, pin map, directions | `venues/[slug]/page.tsx:181-205` | — | **c** | Mobile shows only name, rating, area and distance. A "Directions" button should open Google Maps via `Linking` |
| Venue WhatsApp button | `venues/[slug]/page.tsx:239-246` | — | **c** | Mobile has only the support WhatsApp link |
| "From PKR" price on venue | aside + per court | per court | b | Minor |
| Reviews on venue | `venue-reviews.tsx` (flag-gated) | `venue-reviews.tsx` | **b** | Mobile ignores the `reviews` feature flag |
| Month calendar, day popup, booked/available, hours, horizon | `components/booking/*` | `components/court-*.tsx`, `duration-sheet.tsx` | a | Ported one to one |
| Slot tap → AI chat → hold | `W/booking/[id]/chat` | `M/(player)/booking/[id]/chat.tsx` | a | Booking only works through chat; without an AI reply there is no Hold button (shot 33) |
| Pay + screenshot upload | `W/booking/[id]/pay` | `pay.tsx` (camera + gallery) | a | Screenshot is not resized before upload (see P0-4) |
| Waiting for approval → done | `pay`, `done` | `pay.tsx`, `done.tsx` | a | Wrong "Court is yours" copy for a pending booking (P0-2) |
| Bookings list + filters | `W/bookings/page.tsx` | `(tabs)/bookings.tsx` | a | Tapping a card opens no detail view (shots 49–50) |
| Cancel + refund disclosure | `booking-card.tsx` | `components/booking-card.tsx` | a | Uses `Alert`, so it does nothing on web (186); needs a device check |
| Check-in | `W/booking/[id]/checkin` (manual code) | `checkin.tsx` (camera + manual) | a | Mobile is better here; "today" copy bug (P1) |
| Favorites / saved venues | `favorite-button.tsx`, `saved-venues.tsx` | same names | a | |
| Notify-me (slot available again) | `court-day-popup.tsx:114` | `court-day-popup.tsx:102`, `profile.tsx:19-24` | a | "Leave" is a tiny text tap with no confirm |
| Notification inbox + bell | `site/notification-bell.tsx` | `M/(player)/notifications.tsx`, `bell-badge.tsx` | a | Read/unread is tracked client-side on both (no backend endpoint). Opening the deep link `/notifications` as a player lands on Home (27) |
| Profile / avatar / phone / password | `account-hub/*`, `W/account/phone` | `edit-profile.tsx`, `change-phone.tsx`, `account/forms.tsx` | a | The `/change-phone` deep link lands on Home (67) |
| Language switch EN / Roman Urdu | `components/i18n/language-switch.tsx`, `messages/en`, `messages/ru` | — | **c** | Mobile text is hardcoded and mixed per screen |
| Push opt-in | Web Push | FCM device token | a | Different mechanism, same purpose |
| Support WhatsApp | `lib/support.ts` | `lib/support.ts` | a | |
| Terms / Privacy | `W/terms`, `W/privacy` | link to web | d | Legal pages; a link is enough |
| Landing, about, blog, features, for-owners, contact, sitemap, OG image, SEO venue pages | `W/page.tsx`, `about/` … | minimal home | **d** | Marketing/SEO. The app home should instead be a booking-first "near me / tonight / favorites" feed |

### 1.2 Owner / staff

| Feature | Web | Mobile | Cat | Note |
|---|---|---|---|---|
| Overview dashboard (KPIs, slots, venue switcher, completion, no-show) | `dashboard/owner/today` | `M/(owner)/today.tsx` | a | Its numbers disagree with Ledger and the badge (shots 84, 89) |
| Bookings history | `dashboard/bookings` | `history.tsx` | **b** | No CSV export on mobile (`owners.bookingsHistoryCsv` is used on web only) |
| Approvals (approve, reject, duplicate, overpay, ack-cancelled) | `dashboard/owner/approvals` | `approvals.tsx`, `approval-card.tsx` | a | "Bara karke dekhein" (enlarge) opened nothing on web (127) |
| Record / correct payment | `record-payment-sheet`, `correct-payment-sheet` | same | a | |
| Walk-in | `dashboard/owner/walkin` | `walkin.tsx` | a | Stale cache key (P0-6) |
| No-show | `completion-dialog.tsx:335` | `booking-detail-sheet.tsx:321`, `completion-sheet.tsx` | a | |
| Refunds to pay | `dashboard/owner/refunds` | `refunds.tsx`, `refund-sheet.tsx` | **b** | Mobile always shows the Refunds tab, even when the `refunds` flag is off. "Paisa aa gaya – Refund banayein" creates a refund in one tap with no confirmation (129) |
| Ledger + CSV | `dashboard/owner/ledger` | `ledger.tsx`, `lib/export-csv.ts` | a | |
| Growth suggestions | `dashboard/owner/growth` | `growth.tsx` | **b** | Ignores the `growth_suggestions` flag; shows 24-hour times |
| Reviews + reply | `dashboard/owner/reviews` | `reviews.tsx` | **b** | Ignores the `reviews` flag |
| Announcements | — | — | **c (both)** | `POST /venues/{id}/announcements` and `api.venues.announce` exist; no UI anywhere |
| Staff + permissions | `dashboard/owner/staff` | `staff.tsx` | a | Defaults differ: web pre-ticks `view_ledger`, mobile starts empty. "Deactivate" uses `Alert`, which does nothing on web (146) |
| Staff permission gating | `lib/use-my-permissions.ts` | `lib/use-my-permissions.ts`, `PERM` | **b** | Same logic, but staff still see every tab and action button. Denials look three different ways (168–175). Staff get 403s from `/owners/badges` on every screen |
| Venue settings (basics, amenities, cancellation, photos, courts, pricing, hours, blackouts, deactivate) | `dashboard/owner/settings` | `venue-settings.tsx` | a | One 701-line page with many separate Save buttons |
| Booking horizon | display only | `venue-settings.tsx:367` | mobile-only | Web settings cannot edit it |
| auto_approve (enabled / min bookings) | — | — | **c (both)** | Backend `schemas/venue.py:118-119`; no UI |
| Timers with "Default: X" / "Default par wapas" | `venue-timers-card.tsx` | `reminders-card.tsx`, `default-hint.tsx` | a | |
| CNIC / owner identity | `components/identity/*` | `cnic-form.tsx`, `cnic-banner.tsx`, `identity-card.tsx` | a | The banner's "CNIC dein" opens the whole Venue settings page instead of the CNIC form (124) |
| Onboarding wizard + status | `venue-setup/*` | `venue-setup/register`, `courts`, `pending`, `rejected` | a | Step 2 opens by URL with step 1 incomplete; the stepper is clipped (156, 164) |
| Check-in: venue QR / scan player QR | `checkin/qr`, `checkin/manual` | `checkin-qr.tsx`, `checkin-scan.tsx` (camera) | a | Mobile is better (camera) |
| Premium | `dashboard/owner/premium` | `premium.tsx` | a | |
| Owner inbox | bell in `owner-shell.tsx` | `M/(owner)/notifications.tsx` | a | |
| Feature-flag nav gating | `owner-shell.tsx:50-74` | only `advance-settings.tsx:37` | **b** | `owner-tab-bar.tsx` and `more.tsx` never check flags |

### 1.3 Admin

| Feature | Web | Mobile | Cat | Note |
|---|---|---|---|---|
| Overview, venue approval, feature flags, premium pricing/payments, owner billing, CNIC verification | `W/dashboard/admin/*` | `(admin)/index.tsx` handoff only | **d** (venue approval → **c candidate**) | Admin is desk work. Venue approval plus a mini overview would be useful on the go. The handoff screen has no link to the web console and its text touches the screen edges (176) |

### 1.4 Backend endpoints with no mobile UI

| Endpoint | api-client | Web | Mobile |
|---|---|---|---|
| `GET /owners/bookings-history/export.csv` | `owners.bookingsHistoryCsv` | yes | **no** |
| `GET /feature-flags` (public) | `featureFlags.publicFlags` | yes (nav, reviews, split payments) | only in `advance-settings` |
| `POST /venues/{id}/announcements` | `venues.announce` | no | no |
| `PATCH /venues/{id}` `auto_approve_enabled`, `auto_approve_min_bookings` | `venues.update` | no | no |
| `PATCH /courts/{id}` `surface_type`, `has_floodlights` | `courts.update` | no | no |
| `DELETE /venues/{id}` | `venues.deactivate` | no | no |
| `/admin/overview`, `/admin/venues/pending` + approve / request-changes / reject | `admin.*` | yes | no |
| `/admin/feature-flags` GET/PATCH | `featureFlags.list`, `setEnabled` | yes | no |
| `/admin/premium-*`, `owner-billing*`, `owner-identities*` | `admin.*` | yes | no |
| `/admin/stats`, `dashboard`, `venues`, `bookings`, `users`, `disputes`, suspend/unsuspend | `admin.*` | no | no |
| `/admin/disputes/refund-queue`, `passive-venues`, `flagged-checkins`, `/admin/users/{id}/role` | not in api-client | no | no |
| `/users/me/web-push*` | `users.webPush*` | yes | n/a (mobile uses `/users/me/fcm-token`) |
| Notifications mark-read | no endpoint | client-side | client-side |

The settings named in the brief do have mobile UI: amenities, booking_horizon (mobile only), CNIC, default timers, record payment, refunds, ledger, growth, staff permissions and the notification bell. The real gaps are auto_approve, court surface/floodlights, announcements, CSV history export, flag gating and admin.

### 1.5 Mobile-only (not on web)

- Camera QR scanning (owner scans the player; player scans the venue).
- Booking-horizon editor.
- FCM push.
- A separate rejected-venue screen.

---

## 2. Screen-by-screen UI issues

The numbers in brackets are screenshot files `docs/mobile-audit/screens/NN-*.png`.

### 2.0 Issues that hit many screens

| # | Issue | Evidence | Sev |
|---|---|---|---|
| G1 | **Non-standard spacing classes render with no padding.** `px-4.5`, `p-4.5`, `p-5.5` and similar are not in Tailwind's default scale, and `tailwind.config.js` has no `spacing` extend. Confirmed by grep: 42 uses in 18 files. Card text sits on the card edge and screens touch the screen edge. This affects pay, done, ledger, refunds, walk-in, check-in, reviews, staff, premium, venue settings and admin. | 36, 40, 52, 53, 55, 56, 93, 94, 100, 102, 106, 107, 109, 176 | **P0** |
| G2 | **Owner "tabs" are fake.** `components/owner-tab-bar.tsx:60` calls `router.navigate` inside a plain Stack (`(owner)/_layout.tsx`). Tab switches slide in like pushes, and back walks through tab history. Every visited tab stays mounted and keeps polling. Approvals, Refunds and Ledger show a back chevron as well as tabs. | code | **P0** |
| G3 | **Polling ignores screen focus.** There is no `useFocusEffect` or `useIsFocused` anywhere. Overview, approvals, badges, bell and feed each poll every 15 s, and `/health` polls every 8 s for every role. On a cheap Android phone that costs battery and data. | `lib/query-client.ts`, `lib/network-status.ts` | **P0** |
| G4 | **Keyboard avoidance is missing on almost every form.** That includes the auth kit, AccountScreen, walk-in, venue settings, the wizard, staff, check-in code inputs and the filter price inputs. Chat uses `behavior={undefined}` on edge-to-edge Android. | `components/auth/kit.tsx:330`, `chat.tsx:239` | **P0** (needs device) |
| G5 | **No FlatList and no pull-to-refresh anywhere** (0 `RefreshControl`, 0 FlatList/FlashList). Bookings can render 200 cards, each running 2 queries (`booking-card.tsx:67-68`). Approvals load full-size screenshots in a ScrollView. | code | P1 |
| G6 | **No shared design-system components.** Four parallel kits exist, with 2 TextFields, 2 EmptyStates and 3 sheet styles. About 25 hand-rolled headers vary in padding and title size (16.5–20 px). The code has 612 hex literals (104 distinct colours against 40 tokens), about 590 inline styles and 29 ad-hoc font sizes. `lib/overview.ts` `OV.orange #FF6A2B` leaks orange into the teal owner system. | code | P1 |
| G7 | **Status bar is always `dark`** (`_layout.tsx:159`), so the clock is invisible on the dark owner Overview header and the dark done screen. | 83, 56 | P1 (needs device) |
| G8 | **The bottom safe area is applied twice** on player tab screens. `edges` includes `"bottom"` inside Tabs, so tab labels look cut off. Several headers have no top inset. | 17, 18, 156 | P1 |
| G9 | **Language is mixed per screen.** Owner Overview, History and Approvals are in Roman Urdu. Ledger, Walk-in, Staff, Growth and Settings are in English. `ErrorState` is English everywhere. Back buttons say "Back" 6 times and "Wapas" 6 times. Copy contains `--` and `->`. | 83, 96, 102, 132, 153 | P1 |
| G10 | **Error and empty states are weak.** Raw "Internal server error" text is shown. A 404 shows "Something went wrong" with a Try again button that can't help and no back button. Counters show 0 or "PKR —" while loading or on error. The unmatched route shows the default dark Expo screen. A cold start with the backend down is a blank white screen. | 68–70, 73, 76–78, 80, 192–198 | P1 |
| G11 | **Monospace font is used for prices, times and phone placeholders**, which makes slot rows wrap. | 02, 29, 31, 34, 58, 106 | P2 |
| G12 | **No press feedback, haptics or motion.** Only 24 of 242 Pressables give feedback, there is no `android_ripple` and no expo-haptics. Reanimated is installed but not used. Sheets are RN `Modal`s that slide the whole backdrop, with no drag handle and no swipe to dismiss. Text glyphs (✕ → ‹ › ★ ✓) stand in for icons. | code | P2 |
| G13 | **Images and accessibility.** RN `Image` is used with no caching and no placeholder, and the list shows the full-size `photo_urls[0]`. 16 icon-only back buttons have no `accessibilityLabel`. The auth background icons animate forever with no reduce-motion check. | 18 ("D" letter instead of photo) | P2 |
| G14 | **Totals disagree.** The approvals badge says 4 but the header says "3 approvals baqi". Overview says Collected PKR 7,000 but Ledger Today says PKR 14,000. Cancelled and no-show bookings still show "AT THE VENUE PKR 1,250". | 47, 84, 89, 94 | P1 |

### 2.1 Auth

| Screen | Issues | Shots | Sev |
|---|---|---|---|
| Boot | Blank white while booting, no splash on web | 01, 80 | P2 |
| Login | Floating icons overlap the text; phone placeholder in mono; old server error stays visible after editing; web focus ring drawn inside the input; offline banner overlaps the logo | 02–05, 200 | P2 |
| Signup | No keyboard avoidance on the longest form; Submit disabled with no reason given; small terms checkbox; "Islamabad (Punjab)" in the city list; inline web-style dropdown | 06–12 | P1 |
| Forgot / reset / verify | Raw "try again in 3359s"; double frame around the code box; one input instead of 6 OTP boxes | 13–16, 184–185 | P2 |

### 2.2 Player

| Screen | Issues | Shots | Sev |
|---|---|---|---|
| Home `(tabs)/index` | Mostly empty page (no booking-first feed); bell is 38pt; "→" glyph; no pull-to-refresh; double bottom inset | 17 | P1 |
| Search | No top safe area; filter chips h-8 (32pt); letter "D" placeholder instead of a photo; chip row clipped; no map, no sort | 18–22, 74, 77 | P1 |
| Filter sheet | Good. Date chips clipped at the edge; price inputs have no keyboard avoidance | 19–20 | P2 |
| Venue detail | Plain gradient hero; no description or address; hours in mono; every court's month calendar rendered at once (very long page); no sticky CTA; bare spinner while loading; 500 error has no header or back | 23–25, 75, 78 | P1 |
| Day popup / duration sheet | Weekday chips clipped; "8:00 to 8:30" shown next to a 1-hour price; the page behind scrolls instead of the popup; a second Modal stacks on the first (iOS risk) | 29–32 | P1 |
| Chat | Booking only through AI; empty thread has no booking context; send button 40pt; quick replies about 34pt; keyboard behaviour undefined on Android | 33–35, 61 | **P0** (needs device) |
| Pay | Cards have no padding (G1); "4,000" shown without PKR; no bank name; the revisit hides bank details ("shown when this hold was created"); screenshot not resized; "Need help?" and "Remove" are tiny taps | 36–39, 51–55 | **P0** |
| Done | **"Court is yours / Confirmed by the venue" for a pending booking** (`done.tsx:62-64`); dark screen with dark status bar | 40, 56, 57 | **P0** |
| Bookings tab | Cancelled bookings listed under Upcoming; no refund status on paid-then-cancelled; card tap opens nothing; Cancel does nothing on web; 200 cards in a ScrollView; chips 40pt; counters show 0 while loading or on error | 41–50, 73, 76, 186–189 | P1 |
| Check-in | **"7:00 PM today" for a future booking** (`checkin.tsx:131`); "--" in copy; error state has no retry or back; camera has no in-screen exit | 58–60 | P1 |
| Notifications | Deep link lands on Home as a player; "WhatsApp par bheja gaya" shown even when WhatsApp is off; row tap uses `router.replace`, so the list is lost | 27, 62–63, 79 | P2 |
| Profile / edit / change phone | Mostly blank; "← Back" text link differs from other screens; duplicate label; "Leave waitlist" is a tiny tap with no confirm | 28, 64–67, 71–72 | P2 |

### 2.3 Owner

| Screen | Issues | Shots | Sev |
|---|---|---|---|
| Gate `(owner)/index` | On error: bare red text, no retry, no logout, so the owner is trapped | 198 | **P0** |
| Overview `today` | Fake tabs (G2); large CNIC banner plus 3 CTAs push the bookings far below the fold; mixed language; "Booked 6" counts half-hour slots; amounts without PKR; pending bookings missing from today's list; "Your venue / Sab courts (0)" while loading | 82–88, 120–123, 193–194 | P1 |
| Approvals | Badge/header mismatch; a cancelled item appears in the queue; enlarge does nothing; "Keyboard ke mic se bolein" hint shown on web; full-size screenshots in a ScrollView | 89–92, 125–128, 191, 195 | P1 |
| Refunds | Edge to edge (G1); one-tap refund creation; toast clipped | 93, 129–131, 196 | P1 |
| Ledger | Edge to edge; "Correct" cut off on the right and only about 30pt tall; "-PKR" wording; filtering by court also changes the top totals | 94–95, 132–134, 192, 197 | P1 |
| More ("Aur") | Web-style menu list; no icons; mixed language | 96–97 | P2 |
| History | "Chunein" shown before the slot ends; no CSV export | 98–99, 135–139 | P2 |
| Walk-in | No side padding; uneven slot grid; placeholders look like filled values; no keyboard avoidance with a sticky footer; stale cache key | 100–101, 140–142 | P1 |
| Check-in hub / QR / scan | No padding; "--"; QR screen blank while loading; manual UUID entry is unrealistic; success reachable only through the `Alert` callback | 102–104, 148–149 | P1 |
| Growth | Empty state; 24-hour times; English only | 105 | P2 |
| Reviews | No padding; date in mono; reply button 36pt | 106, 147 | P2 |
| Staff | No padding; labels only as placeholders; "03xx" format vs +92 elsewhere; Deactivate does nothing on web; permission defaults differ from web | 107, 143–146 | P1 |
| Premium | "Save my choices" looks enabled with nothing to save | 108 | P2 |
| Venue settings | CNIC section first; cards edge to edge; short description box; no IBAN field; many separate Save buttons, one sitting outside its card; lowercase "padel"; blackout date chips clipped; blackout default start 6:00 AM is outside opening hours | 109–115, 150–155 | P1 |
| Wizard / pending / rejected | Stepper clipped ("We revie") and missing on step 2; step 2 reachable by URL; Next disabled with no reason; default 90 min in the wizard vs 60 in settings; "Gallery (select several)" text clips; pending/rejected errors have no retry | 156–167, 177–183 | P1 |

### 2.4 Staff and admin

| Screen | Issues | Shots | Sev |
|---|---|---|---|
| Staff Today | No-permission banner, but every action button and tab is still shown | 168 | P1 |
| Staff Approvals / Ledger / Staff | "Something went wrong" + Try again for a permission denial | 170–171, 173 | P1 |
| Staff Walk-in / Venue settings | Full editable form shown without permission | 172, 174 | P1 |
| Staff History | Inline red text (a third denial style) | 175 | P2 |
| Admin | Handoff text touches the edges; no link that opens the web console | 176 | P2 |

**Not captured, and why:**
- Player booking detail: tapping a card does nothing.
- Native `Alert` confirms: they don't appear on web.
- Screenshot viewer: did not open.
- Real camera / QR scanning.
- Push notifications.
- Real AI replies: no local key.
- Wizard final submit: needs CNIC photo uploads.
- Mark-refund-paid form, change-phone code step, reset-password success: not driven.

Console output (602 lines, no uncaught errors):
- 128 × "missing the required default export" for `_components.tsx`, `_dashboard-components.tsx` and `venue-setup/_components.tsx`.
- 16 × `useNativeDriver` not supported on web.
- 17 × staff 403s from `/owners/badges` and other endpoints.

---

## 3. Native / config findings

### 3.1 Design system

- **Tokens:** `tailwind.config.js` defines `player.*` (orange `#EF5A2C`, Figtree) and `owner.*` (teal `#0E6274`, IBM Plex Sans), with IBM Plex Mono for numbers. `lib/colors.ts` repeats the hex values for use in `style`, but only 5 files import it.
  - There is no `spacing` scale extension, which is the cause of G1.
  - `darkMode: "class"` is set but has 0 `dark:` uses.
- **Shared kits** (fragmented, see G6):

| Kit | Path | What it contains | Importers |
|---|---|---|---|
| Auth kit | `components/auth/kit.tsx` | `AuthScreen`, `TextField`, `PasswordField`, `SelectField`, `SubmitButton`, OTP controls | 12 |
| Overview UI | `components/overview/ui.tsx` | `BottomSheet` (RN Modal), `Pill`, `OutlineButton`, `OrangeButton`, `Checkbox` | 6–9 |
| Wizard kit | `app/(owner)/venue-setup/_components.tsx` | second `TextField`, `PrimaryButton` | 6 |
| Icons | `components/icons.tsx`, `overview/icons.tsx` | hand-written SVG icons | 44 |
| Error state | `components/error-state.tsx` | `ErrorState` | 16 |
| Player components | `app/(player)/_components.tsx` | `VenueCard`, `VenueCardSkeleton` (the only skeleton), `EmptyState` | 15 |

- There is no generic `Screen`, `Header`, `Button`, `Card`, `Input`, `Sheet`, `Toast` or `Skeleton`.

### 3.2 Packages

| Package | Status |
|---|---|
| expo-dev-client | **NOT installed**, even though `eas.json` `development` has `developmentClient: true` |
| expo-updates | **NOT installed**; no `runtimeVersion`, no `updates` block, no channels |
| expo-notifications | installed + used (`lib/push-notifications.ts`) |
| expo-image-picker | installed, used in 6 files |
| expo-image-manipulator | installed, used in only 2 (`photo-manager`, `cnic-form`) |
| expo-location | installed, used in 3 |
| expo-camera | installed, used in 2 (QR) |
| expo-haptics | **NOT installed** |
| react-native-reanimated 4.5.1 / worklets | installed, **0 direct imports** (babel-preset-expo auto-adds the plugin) |
| react-native-gesture-handler | **not a direct dependency** (hoisted transitive only); no `GestureHandlerRootView` |
| Bottom sheet library (@gorhom etc.) | **NOT installed**; 7 hand-made RN `Modal` sheets |
| expo-image | **NOT installed** (RN `Image` in 11 files) |
| @shopify/flash-list | **NOT installed** |
| Icon library | none (custom SVG + text glyphs) |
| expo-linear-gradient, expo-blur | NOT installed |
| Sentry / crash reporting | **NOT installed** |
| Unused | expo-application, expo-linking (Linking comes from RN instead), @react-native-picker/picker |

### 3.3 `eas.json` and `app.json`

- **`eas.json`:**
  - `development`: `developmentClient: true`, internal APK. It won't work until expo-dev-client is installed.
  - `preview`: internal APK.
  - `production`: `autoIncrement`, AAB by default.
  - `appVersionSource: remote`.
  - **No `channel` and no `env` on any profile**, so every build, including development, points at the production API.
- **`app.json`:**
  - name "Khelo" but slug, scheme, package and bundle id use "maidan" (`com.maidan.app`, `maidan://`). Decide before the first store submission; changing these later breaks the EAS link and store identity.
  - `extra.apiBaseUrl` and `webBaseUrl` point at production. The local override is `EXPO_PUBLIC_API_BASE_URL` (`lib/config.ts:8-19`).
  - `userInterfaceStyle: light`.
  - `supportsTablet: true` conflicts with portrait-only orientation.
  - No iOS `infoPlist` (photo library text is generic), and `expo-image-picker` is not listed in `plugins`.
  - Android lists only the location permissions; CAMERA and POST_NOTIFICATIONS come from merged manifests. Verify with `npx expo config --type introspect`.
  - `predictiveBackGestureEnabled: false`.
- **`google-services.json`** is committed (Firebase project `maidan-31556`, package `com.maidan.app`). That is normal for a client config, because EAS only uploads tracked files. Keep the Firebase API key restricted in the GCP console.
- **CI:** only the backend deploy workflow. There is no mobile or EAS job.

### 3.4 Push

**Token:**
- `lib/push-notifications.ts:37` calls `getDevicePushTokenAsync()`, which returns the raw FCM or APNs token. Expo Push is not used.
- The Android channel `default` (HIGH importance) is created before asking for permission.
- The token is registered through `POST /users/me/fcm-token` (`_layout.tsx:143-145`) and removed on logout. Errors are swallowed silently.

**Backend:**
- Sends to FCM HTTP v1 directly (`services/fcm.py`) and to APNs directly (`services/apns.py`).
- SSM secret names: `FCM_SERVICE_ACCOUNT_KEY`, `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`. Values were not checked.
- **You do not need to upload FCM credentials to EAS**, because the backend talks to Google directly.

**Risks:**
1. **Cold-start taps can be lost.** There is no `getLastNotificationResponseAsync` or `useLastNotificationResponse`, and `router.push` can fire before the Stack has mounted.
2. **iOS dev-client builds get sandbox APNs tokens**, but the backend uses production APNs (`APNS_USE_SANDBOX=false`). iOS dev-client push will therefore fail; Android is unaffected.
3. A tap can route to a guarded route the current role cannot open.

**Why push doesn't work in Expo Go:**
- SDK 53+ removed remote push from Expo Go on Android.
- Expo Go is Expo's own app with its own Firebase config, not `com.maidan.app` / `maidan-31556`. The token call fails, the error is swallowed, and nothing is registered.
- On Expo web there is no service worker and no VAPID key, so the call throws. Browser push is the separate Web Push feature.

### 3.5 Where each feature can be tested

| Feature | Expo web | Expo Go | Dev client / real build |
|---|---|---|---|
| Layout, copy, flows, API logic | ✅ (fastest) | ✅ | ✅ |
| `Alert.alert` confirms (cancel, deactivate, scan success) | ❌ no-op | ✅ | ✅ |
| Keyboard, safe area, status bar, back gesture | ❌ | ✅ | ✅ |
| Camera QR scan, image picker (camera), location, secure-store, share/CSV, WhatsApp `Linking` | partial / fake | ✅ | ✅ |
| **Remote push (FCM/APNs)**, tap deep links | ❌ | ❌ | ✅ only |
| App icon, splash, notification icon, `maidan://` scheme, permission strings, `google-services.json` | ❌ | ❌ (`exp://`) | ✅ only |
| Any new native package (haptics, bottom-sheet, flash-list, expo-image, maps) | some | only if in Expo Go's bundled set | ✅. A new native package means a **new build** |

**Current state:** every module the app imports today ships with Expo Go SDK 57, so everything except push and branding can be checked in Expo Go right now.

---

## 4. Prioritized list

### P0: broken or blocking

1. **G1: missing padding.** 42 non-standard spacing classes (`*-4.5`, `*-5.5`) in 18 files produce no padding. Pay, done, ledger, refunds, walk-in, staff, settings and admin all touch their edges.
   - Fix: add a `spacing` extend in `tailwind.config.js` (`4.5: 18px`, `5.5: 22px`, …). One file fixes all 18.
2. **Done screen copy is wrong.** It says "Court is yours / Confirmed by the venue" while the booking is only `payment_submitted` (`done.tsx:62-64`, shot 57).
3. **Owner gate error dead end.** No retry and no logout (`(owner)/index.tsx:54`, shot 198). The same gap exists in `pending.tsx:96`, `rejected.tsx:39` and player `checkin.tsx:36`.
4. **Payment screenshot not resized** (`pay.tsx:80-81`, `quality:0.8` only). A 3–8 MB photo goes up over 3G against a 45 s timeout in the core money flow. The same gap exists in `refund-sheet`, `premium` and the avatar upload.
   - Fix: reuse `photo-manager`'s 1600 px `manipulateAsync`.
5. **Owner tabs are fake** (G2), so the stack grows without limit and every visited tab keeps polling.
   - Fix: a real `Tabs` navigator in `(owner)/`, mirroring the player `(tabs)` pattern.
6. **Stale cache key.** `walkin.tsx:162` and `ledger.tsx:207` invalidate `["owner-today"]`, but Overview uses `["owner-overview"]`, so a new walk-in doesn't show until the next poll.
7. **Polling ignores focus** (G3). 5+ polls every 15 s plus `/health` every 8 s waste battery and data on cheap Android phones.
8. **Keyboard avoidance missing** on forms and chat (G4). Needs a device check, but it is very likely broken on iOS.
9. **Repeat pay visit hides bank details** (shots 40, 51). A player who leaves the pay screen and comes back can't see where to send the money.
10. **One-tap refund with no confirmation** ("Paisa aa gaya – Refund banayein", shot 129). Money actions need a confirm sheet.
11. **No EAS build since September.** Nothing on mobile has been verified on a real phone, and `expo-updates` / `expo-dev-client` are not installed (see §5).

### P1: missing important feature or serious UX gap

1. Venue detail: description, address, pin map, **Directions**, venue WhatsApp, Outdoor label (all present on web).
2. Search: **map view** and **sort** (price / rating / nearest).
3. **Feature-flag gating** on mobile for the tab bar, More menu, venue reviews, growth and refunds.
4. **Staff UX:** hide tabs and actions the staff member lacks permission for; one consistent "no access" state; stop the `/owners/badges` 403s.
5. **Booking detail** from a Bookings card (today tapping does nothing); cancelled bookings moved out of Upcoming; refund status shown on cancelled-paid bookings.
6. **Check-in "today" copy** for future bookings (`checkin.tsx:131`).
7. **FlatList + pull-to-refresh** on bookings, approvals, ledger, history and notifications. Fix the N+1 queries in `booking-card.tsx`. Show approval thumbnails instead of full images.
8. **Numbers must agree** (G14): badge vs header, Overview Collected vs Ledger, "at venue" money on cancelled/no-show bookings.
9. **Status bar per screen** (G7) and **remove the double bottom inset** on the player tabs (G8).
10. **One language.** Pick Roman Urdu or English per role, or add the web's EN/RU dictionary to mobile. Fix "--", "->", 24-hour times and lowercase sport names.
11. **Error states:** friendly copy instead of raw server messages; 404 → "not found + back"; counters show skeletons, not 0; branded unmatched-route screen; branded boot screen.
12. **Wizard guards:** step 2 blocked until step 1 is done; stepper not clipped; consistent default duration; reason shown when Next is disabled.
13. **Venue settings:** split into sections or sub-screens with one sticky Save; add the IBAN field; CNIC banner opens the CNIC form directly.
14. **Push hardening:** cold-start tap handling (`getLastNotificationResponseAsync`); route only after the Stack has mounted; role guard on tap routes; set `APNS_USE_SANDBOX` for iOS dev builds.
15. Owner history **CSV export**; **auto_approve**, **court surface/floodlights** and **announcements** UI (these are missing on web too, so decide product-wise first).
16. Optional: admin **venue approval** on mobile.

### P2: polish and wow factor (Playtomic / Careem level)

1. **One design system kit**, separate for player and owner as the rules require, but with the same primitives:
   - `Screen` (safe area + status bar + header)
   - `Header`, `Button` (sizes ≥ 44pt, pressed state, haptic)
   - `Card`, `Input` (keyboard-aware), `Sheet` (@gorhom/bottom-sheet with drag handle and backdrop fade)
   - `Skeleton`, `EmptyState`, `ErrorState` (bilingual), `Toast`
   - Then remove the 612 hex literals and the ad-hoc font sizes (type scale: 12/14/16/20/24/32).
2. **Native feel:** expo-haptics on primary actions (slot select, approve, pay submit); Reanimated for sheet and press animations and shared transitions from venue card to venue; `android_ripple`; swipe actions on approval cards (approve/reject).
3. **Images:** expo-image with blurhash placeholders, caching and list thumbnails; a real venue hero gallery with a parallax header.
4. **Player home** becomes a booking-first feed: "Near me", "Tonight available", favorites, recent venues, sport chips. Sticky "Book" CTA on venue detail. 6-box OTP input.
5. A real icon set (for example lucide-react-native) instead of text glyphs; `accessibilityLabel` on every icon button; reduce-motion check on the auth background.
6. Optional dark mode (owner night use). Sentry for crash reporting. Remove the unused deps (`@react-native-picker/picker`, `expo-application`, `expo-linking`).
7. Clean up the console noise: move `_components.tsx` files out of `app/` so they aren't treated as routes.

---

## 5. Plan: dev client + EAS Update (stop rebuilding for every JS change)

### 5.1 Target workflow

| Change type | How to test | Rebuild? |
|---|---|---|
| UI, copy, logic (most changes) | `npx expo start --web` (seconds), then Expo Go or the dev client on the phone with hot reload over LAN | ❌ |
| Ship JS to testers or owners | `eas update --channel preview` → testers' installed **preview** build downloads it on next launch | ❌ |
| Ship JS to production users | `eas update --channel production` (treat like a deploy) | ❌ |
| Add or upgrade a **native** package, change `app.json` plugins, permissions, icons, SDK upgrade | new `eas build` (the fingerprint `runtimeVersion` changes automatically) | ✅ only then |

### 5.2 One-time setup

These are the code changes. Do them on a branch; no backend or migration is involved.

```powershell
cd "C:\Users\Noman Traders\Desktop\Court Booking App\court-booking-frontend\apps\mobile"
npx expo install expo-dev-client expo-updates
npx expo install react-native-gesture-handler expo-haptics expo-image   # optional now: native deps for the P2 polish, so the FIRST build already contains them
eas login                       # account that owns project "maidan-app"
eas update:configure            # writes updates.url (https://u.expo.dev/4853b946-...) into app.json
```

`app.json` additions:

```json
"runtimeVersion": { "policy": "fingerprint" },
"updates": { "url": "https://u.expo.dev/4853b946-757a-45df-8e9a-70e48e0a6d94", "checkAutomatically": "ON_LOAD", "fallbackToCacheTimeout": 0 }
```

`eas.json`: add a channel and an API URL to each profile. `EXPO_PUBLIC_*` values are inlined into the JS bundle, so they must be set for both builds and updates.

```json
"build": {
  "development": { "developmentClient": true, "distribution": "internal", "channel": "development",
                   "android": { "buildType": "apk" },
                   "env": { "EXPO_PUBLIC_API_BASE_URL": "https://api.3.6.48.6.sslip.io" } },
  "preview":     { "distribution": "internal", "channel": "preview", "android": { "buildType": "apk" },
                   "env": { "EXPO_PUBLIC_API_BASE_URL": "https://api.3.6.48.6.sslip.io" } },
  "production":  { "autoIncrement": true, "channel": "production",
                   "env": { "EXPO_PUBLIC_API_BASE_URL": "https://api.3.6.48.6.sslip.io" } }
}
```

Notes on the API URL:
- There is no staging backend today, so every profile points at production. The dev client can still be pointed at the local backend from your PC (see 5.3).
- `eas update` does **not** read `build.*.env`. Set the same variable in **EAS Environment Variables** (`eas env:create --environment preview --name EXPO_PUBLIC_API_BASE_URL --value https://api.3.6.48.6.sslip.io`, and the same for `production` and `development`). Then publish with `--environment`.
- Alternatively, rely on the `app.json` `extra.apiBaseUrl` fallback, which already points at production.

Optional: a small "Update available — restart" banner using `useUpdates()` from expo-updates, so testers don't need two cold starts.

### 5.3 Builds, two in total

Run these yourself (EAS needs your account).

```powershell
eas build --profile development --platform android   # once: your personal dev client APK
eas build --profile preview --platform android       # once: APK for owners/testers
```

**Daily use on the phone with the dev client:**
- Install the development APK once.
- Start the dev server against the local backend over LAN:

  ```powershell
  $env:EXPO_PUBLIC_API_BASE_URL="http://<PC-LAN-IP>:8000"; npx expo start --dev-client
  ```

  Run uvicorn with `--host 0.0.0.0`.
- Scan the QR from the dev client. Every save hot-reloads on the phone.
- Push, camera, keyboard and haptics all work because it is a real native build.

### 5.4 Shipping JS without a rebuild

```powershell
eas update --channel preview --environment preview --message "Fix pay card padding + done copy"
# after testers confirm:
eas update --channel production --environment production --message "..."
# roll back if needed:
eas update:republish --group <previous-update-group-id>    # or: eas update:rollback
```

- Only builds whose `runtimeVersion` (fingerprint) matches receive the update.
- If a change adds a native package, `eas update` publishes for a new fingerprint that no installed build has. Nothing breaks, but nobody gets it until a new build exists. Check before publishing with `npx expo-updates fingerprint:generate` or the `eas update` output.

### 5.5 Rules that keep this safe

1. The FIRST preview/production build with expo-updates is still a full build. The old September APKs on phones can't receive OTA updates, so everyone must install the new build once.
2. Production OTA counts as a deploy. Use the same review as web: preview channel first, test, then production. Never ship to production straight from a feature branch.
3. Backend first. All API changes stay additive (old builds stay installed), as the round2 and stage2 contracts already require.
4. iOS dev client push needs `APNS_USE_SANDBOX=true` on a separate backend or config (production stays false). Android/FCM has no such split.
5. Sentry (P2) plus `expo-updates` update IDs show which OTA version a crashing phone is on.
6. Optional later: a GitHub Action that runs `eas update --channel preview` on pushes to a `mobile-preview` branch. Keep it off `main`, so it never ships to production without you.

### 5.6 What to check on the first device build (things Expo web can't show)

- [ ] `Alert` confirms: cancel booking, staff deactivate, check-in scan success.
- [ ] Keyboard on signup, walk-in, venue settings, chat (Android edge-to-edge) and the filter price inputs.
- [ ] Status bar on the owner Overview and the done screen.
- [ ] Safe area and tab bar on a notched phone and a cheap Android with gesture navigation.
- [ ] Camera QR (owner scan + player scan); image picker camera and gallery; payment upload on slow 3G.
- [ ] FCM push: receive in the foreground and background, and tap from a killed app (cold-start bug).
- [ ] WhatsApp deep link, Google Maps link, CSV share sheet.
- [ ] App icon, splash, notification icon, `maidan://` scheme.
- [ ] Nested modals: day popup → duration sheet on iOS.
