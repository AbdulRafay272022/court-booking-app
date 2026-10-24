# Floodlight QA (Phase E)

Everything here was produced on the LOCAL stack only: backend `http://localhost:8000` (seed users, data created through
the local API), Expo web `:8095` with `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`, Expo web `:8096` on a dead API for
the mocked suites, web `next start` on `:3001`. Every Playwright context aborts any request that is not localhost
(the web script serves the S3-format photo URLs from LocalStack, so the browser never contacts AWS).

## Where things are

| What | Path |
|---|---|
| Every board next to the app, per board | `boards/<Board>-side.png` (board render left, app screens right), `boards/index.html` (all boards, scrollable) |
| Board renders / app screenshots | `boards/<Board>-board*.png`, `boards/<Board>-app-<screen>.png` (390 full length), `-320-fs13.png` (320 wide, font x1.3) |
| Check results per screen (JSON) | `qa-results-390.json`, `qa-results-320-fs13.json` |
| Journey screenshots | `journeys/J1..J6-*.png` |
| Web re-run screenshots (390 / 768 / 1280) | `web/`, VenueCard web: `../venue-card-qa/web-qa/` |
| Scripts | `scripts/board-render.cjs` (renders a `.dc.html` board without the design tool), `scripts/qa-audit.cjs` (in-page checks), `scripts/qa-screens.cjs` (tour + boards + composites), `scripts/web-qa.cjs` (W1 web script re-pointed at merged main); mobile e2e: `court-booking-frontend/apps/mobile/e2e/qa-journey-live.cjs`, `qa-sheets-check.cjs`, `qa-motion-check.cjs` |

Run: `PLAYWRIGHT_PATH=<pw>/node_modules/playwright BASE=http://localhost:8095 node docs/floodlight-qa/scripts/qa-screens.cjs all`.
Large font on Expo web = the in-app `?fs=1.3` font scale (sessionStorage `fl.fs`), same switch as the DS dev page.

## Automated checks (final run)

| Check | 390 (52 screens) | 320 + font x1.3 (19 main screens) |
|---|---|---|
| Rendered text contrast (>= 4.5, large >= 3) | 2748 pairs, 0 fail | 1036 pairs, 0 fail |
| Icon (UI) contrast >= 3 | 239 pairs, 0 fail | 143 pairs, 0 fail |
| Tap targets >= 44 | 0 under 44 | 0 under 44 |
| White text / icon on orange | 0 | 0 |
| Orange primary surface in owner routes | 0 | 0 |
| Icon-only controls without a label | 0 | 0 |
| "…" or clipped text | 0 | 1 (chat inbox message preview, one line by design; not money/time/name/phone) |
| Horizontal page overflow | 0 | 0 |

First run (before the fixes below): 19 text fails (owner hero glass 4.21:1 x10, owner notifications 2.72:1 x9) and 4 icon
fails (decorative court drawing on the VenueCard placeholder exposed as a control icon).
Contrast is measured on the rendered DOM: text colour (with every ancestor opacity) over the composited backgrounds;
for gradients every stop is checked (worst one counts); disabled controls are exempt (WCAG).

Other scripted checks:
- No hex / rgba literal: `lib/fl-contrast.test.ts` now also scans ALL of mobile `app/` and `components/` and the web
  screen dirs the Floodlight pass touched (comments may name a colour, code may not).
- Reduce-motion (`e2e/qa-motion-check.cjs`, Playwright `reducedMotion: "reduce"`): VenueCard autoplay off, Sheet appears
  without sliding, Skeleton does not pulse; each with a motion-on control run. 6/6.
- VenueCard mobile (STEP 3): card inside the screen, Amenities chip inside its card and not cut, AmenitiesSheet fully on
  screen, at 390 and at 320 + x1.3: no problems. Web 390/768/1280 (`scripts/web-qa.cjs`): autoplay advances, hover pauses +
  44 px arrows, popover not clipped on the last card of a row / last card, Esc closes, keyboard opens + pauses: 278/278.

## Journeys (local backend, both apps driven through the UI): `e2e/qa-journey-live.cjs`

| Journey | Result |
|---|---|
| search -> venue -> slot -> confirm sheet -> Book karo (POST /bookings/hold) -> pay screenshot -> owner approves in the Approvals UI (+ duplicate-screenshot confirm) -> the player's open screen turns into "Court aap ka hai!" + QR | pass |
| Reject: player books + pays in the UI, owner rejects in the UI with a reason -> player sees "Venue ne booking nahi li" + the venue's own reason, no QR | pass |
| Expiry: owner hold timer set to the 5 min minimum for ONE hold and restored at once; the open Pay screen flips to "Hold ka waqt khatam", status "Waqt khatam ho gaya" | pass (real 5 min wait) |
| Walk-in in the owner UI (teal save) -> booking on the server | pass |
| Check-in: owner types the full booking ID of the approved booking -> checked in | pass |
| Staff `record_payments`: only the Aur tab, no FAB; deep links /approvals, /ledger, /walkin -> one "Ijazat nahi" screen | pass |
| Staff `view_ledger + check_in`: Aaj / Approvals / Paisa / Aur, no FAB, /walkin -> Ijazat nahi, venue settings read-only (no input, no Save) | pass |

64 checks (58 + 6 expiry); first full run 63/64 (a wrong expectation in the script: view_ledger staff DO get Approvals by the
existing owner-access rule, kept).

## Board vs app: visible mismatches

| Board | Mismatch | Decision |
|---|---|---|
| Status | Rejected / expired timeline showed a red cross next to "Venue check kar raha hai" | FIXED: a failed step now says "Venue ne booking nahi li" / "Screenshot waqt par nahi aaya" (`ui-tokens rules/status.ts`, tested) |
| Status | Board: confetti, Calendar action | Not built (no calendar module; listed for the founder) |
| OwnerToday | Hero chips / venue switch: white on a white-glass over the light teal stop (4.21:1) | FIXED: night-tinted glass `alpha.glassOnTeal` (>= 5.9:1) on owner hero chips, venue switch, Paisa tiles + CSV, owner `IconButton onDark` |
| OwnerToday | Board timeline 5 PM-11 PM full; app shows "Koi booking nahi" after midnight | Data / clock (run at ~00:30 PKT); timeline itself verified by M2 |
| OwnerToday | App has extra sections under the board (bookings list, day summary) | Kept (existing features, real data) |
| OwnerMore | Owner Notifications was the old Plex/hex list, timestamps 2.72:1 | FIXED: `components/notification-row.tsx` on the DS (tokens, Text, Skeleton, EmptyState, ErrorState, Button) |
| OwnerMore | Board splits Venue details / Courts / Timers rows; app has one "Venue settings" row; no Announcements | Kept (existing route); Announcements has no backend |
| OSettings | Board Timers as its own frame | Timers live inside Venue settings (existing route) |
| Venue | Board day strip shows 7 days in a grid; app strip scrolls and the 7th day is cut at the right edge at 390 | Kept (horizontal scroller, scroll affordance); listed |
| Venue | Board confirm "15 min hold karo"; app "Hold karo, phir pay" | Hold minutes are not public before the hold (backend B6) |
| Venue / VenueCard / PSearch | No photos (local seed photo URLs use the S3 domain and are blocked); "Agla khaali" chip absent | Honest placeholder; `nextFree` has no API (B-dependency) |
| Main | "Aaj raat khaali" empty | Data (after midnight); empty state shown |
| PSearch | Naqsha (map) | Not built (react-native-maps needs a native build) |
| PChat | Unread counts in the inbox | Backend B1 |
| OWalkin | Board short check-in code "KH-1234" | Backend B2 (full booking ID only; said in the UI) |
| OGrowthTeam | Heatmap, discounts, reviews list, premium features empty | Real data only: local DB has no signals / 1 review / no premium features (empty states) |
| OWizard | Map pin | Not built (needs react-native-maps) |
| VenueCard | Decorative court drawing on the placeholder was in the accessibility tree | FIXED: `aria-hidden` / hidden from screen readers |

## Other bugs found and fixed in this phase

- DS Sheet: role / language / font scale / toast context lost in the @gorhom portal (owner sheets fell back to player
  orange), stacked sheets dismissed both on web, unmount-while-open lingered, onDismiss stale closure; RadioGroup /
  Checkbox / Switch without aria-checked. `e2e/qa-sheets-check.cjs` 27/38 before, 38/38 after.
- White on orange: web `components/error-state.tsx` retry button (3.40:1, seen on the web Pay screen when its data failed)
  and web + mobile "Can't reach Khelo" screen; legacy auth kit / account form buttons made ink-on-orange safe for the player tone.
- Owner offline banner (root) and the session-unreachable screen moved to the DS; unused `bell-badge.tsx` and
  `overview/icons.tsx` removed; `components/icons.tsx` default colours are tokens.

## Needs a real phone

Blur / glass performance and the solid fallback on low-end Android; haptics; swipe vs vertical scroll on VenueCard lists;
bottom-sheet keyboard behaviour (Pay notes, reject reason, walk-in form) and Android back closing sheets; OS large-font
(the `?fs` preview only scales Text); expo-image caching with real photos; camera QR scan (owner check-in, player
venue QR); push notifications + deep links; share / WhatsApp / Raasta intents; AppState polling pause; real stacked-sheet
gestures (verified on Expo web only); low-end Android smoothness of the carousel.
