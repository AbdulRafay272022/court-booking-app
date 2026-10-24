# Claude Code prompt: implement the Khelo "Floodlight" redesign

Paste the block below into the Claude Code CLI from the repo root, AFTER the `mobile-p0-fixes` branch is merged to local main.

```
TASK: Implement the Khelo "Floodlight" redesign in the real app. Implement, do not just report. Report to me in Roman Urdu (technical words in English), short.

READ FIRST (all of it, before any code):
- design/khelo-mobile-floodlight/README.md            (rules + file-to-route map)
- design/khelo-mobile-floodlight/khelo-design-research-2026-10.md  (research, colour rationale, state model, hypotheses)
- design/khelo-mobile-floodlight/*.dc.html            (23 boards, every player + owner screen = design source of truth; inline styles ARE the design; renderVals() data is SAMPLE, never real; frames are drawn full length = nothing may be cropped)
- design/khelo-website/khelo-website-design/README.md + Main.dc.html (approved web brand: Bricolage Grotesque, Plus Jakarta Sans, #0C1F1D, #0E7C74, #FF6A2B)
- design/desgin/*.png (owner references)
- docs/mobile-audit-2026-10.md (all known UI bugs)

STANDING RULES (never break):
- New branch: floodlight-redesign. Merge only to LOCAL main after QA. Do NOT push.
- No production access. No secrets printed.
- No DB migration. If any screen needs a backend change, write it in the contract as "BACKEND DEPENDENCY", stop that part, and ask me. Do not invent behaviour.
- Keep every route, API contract, auth, permission and booking/payment logic exactly as it is.
- Real data only: never hardcode ratings, photos, prices, policies, discounts or availability. If data is missing, design the empty state.
- Never show "confirmed / Court aap ka hai" unless backend status === booked.

STEP 0 — CONTRACT (before code)
Write docs/floodlight-contract.md with:
1. Token file shape (colors, type, spacing, radius, shadow, motion) for packages/types or a new packages/ui-tokens shared by web + mobile.
2. Component list with props: Screen, Header, Button (primary/secondary/soft/danger, sizes, loading, haptic), IconButton (44pt, required accessibilityLabel), Card, Chip, StatusPill, SlotChip (states: open/selected/inRange/held/booked/noRoom), Sheet (@gorhom/bottom-sheet), Input (keyboard-aware, label always visible), Skeleton, EmptyState, ErrorState (retry + back, Roman Urdu/EN), Toast, Stepper, CountdownRing, Ticket (QR), GlassBar (expo-blur with solid fallback).
3. Screen map: each board -> route file -> which components -> which API calls (existing only).
4. Backend dependency list. Check specifically:
   a) Can the app create a HOLD directly (without the AI chat)? Find the existing service the AI hold_slot tool calls and whether an HTTP endpoint exposes it. If no endpoint exists: STOP that feature and tell me; chat path stays as today.
   b) Is there a "held by someone else" signal in availability responses? If not, show only open/booked.
   c) Where cancellation policy text and advance/balance come from for the confirm sheet.
5. Copy table: Roman Urdu (default) + English for every new string, using the same language switch as web (messages/en, messages/ru) if shareable.
Show me the contract summary and WAIT for my "go".

STEP 1 — NATIVE FOUNDATION (one build for a long time)
Install in apps/mobile (npx expo install): expo-dev-client, expo-updates, expo-blur, expo-haptics, expo-image, expo-linear-gradient, react-native-gesture-handler, @gorhom/bottom-sheet, @shopify/flash-list, lucide-react-native + react-native-svg (if missing), @expo-google-fonts/bricolage-grotesque, @expo-google-fonts/plus-jakarta-sans, expo-font, expo-clipboard.
- Wrap root in GestureHandlerRootView + BottomSheetModalProvider.
- app.json: runtimeVersion policy "appVersion", updates.url, channels in eas.json (development, preview, production) with env per profile (dev profile must NOT point at production API unless I say so).
- Keep slug/package/scheme (com.maidan.app / maidan://) unchanged; list it as an open naming decision.
- Give me the exact PowerShell commands for: eas update:configure, the dev-client build, the preview build, and later `eas update --channel preview`.

STEP 2 — DESIGN SYSTEM
- Tokens exactly from design/khelo-mobile-floodlight/System.dc.html.
- ROLE COLOURS (same as website): PLAYER side is ORANGE-led (primary button, active tab, selected chip = #FF6A2B / #FFE7DB with ink text). OWNER side is GREEN/TEAL-led (primary button, active tab, FAB, Approve = #0E7C74 with WHITE text; hero = linear-gradient(165deg,#0E7C74,#0A5F59 55%,#0C1F1D)). Put this in the theme as tokens `role.player.*` and `role.owner.*`, chosen by the route group (player) / (owner) — never hardcode per screen. On owner side orange is only the notification badge + "now" line.
- Hard colour rules: orange #FF6A2B buttons use ink #0C1F1D text (5.98:1). Teal #0E7C74 buttons use white (5.06:1); never #E3F4F1 text on teal (4.45). White on orange is banned (2.86:1). Small text never #8A9996 (2.97:1); use #5B6E6B or darker. Teal text on #E3F4F1 uses #0A5F59.
- One orange action per screen.
- Fonts: Bricolage Grotesque (display, big numbers), Plus Jakarta Sans (everything else). Numbers tabular. Remove monospace from prices/times/phones.
- Spacing 4/8/12/16/20/24/32; fix every px-4.5 / p-5.5 style class (audit G1).
- Remove hardcoded hex literals from screens you touch; use tokens.
- Motion 150–250 ms; respect reduce-motion (AccessibilityInfo.isReduceMotionEnabled); glass falls back to solid when reduce-transparency is on or on low-end Android.

STEP 3 — SCREENS (agents M1 = player, M2 = owner; W1–W3 only for Step 4)
Each screen against its board (README has the file → route map; "(map)" = find the existing route, do not create new ones).
PLAYER (M1, orange):
1. Tabs: 4 tabs (Home, Bookings, Chat, Profile), floating GlassBar, orange active pill. Single bottom safe-area inset (audit G8).
2. PAuth: Login, Sign up (Player/Owner toggle, city, terms checkbox in a 44pt label), OTP 6 boxes with error note. Existing auth API only.
3. Main (Home): dark hero, 3-field search pill (Khel/Kab/Kitni der) → existing search with params, sport tiles from real sports, Next game card only if a real upcoming booked booking exists, "Aaj raat khaali" from real availability, "Phir se khelo" from real past bookings. Pull-to-refresh, skeletons.
4. VenueCard (VenueCard.dc.html) FIRST, shared by Home/Search/Map/Saved and web: follow design/khelo-mobile-floodlight/venue-card-photos-amenities-prompt.md (auto-scrolling photos + "Amenities" chip with popover/sheet).
4b. PSearch: results list + List/Naqsha toggle, Filters bottom sheet (price, time, sport — existing filter params only), empty state.
5. Venue: real photos (expo-image), Raasta/WhatsApp/Tafseel, numbered steps 1 Court 2 Din 3 Kitni der 4 Kab shuru, SlotChip states never colour-only, floating bar total + chat + "Book karo", confirm sheet money from real data. If STEP 0 (a) found no direct hold endpoint, "Book karo" opens the chat with the slot prefilled.
6. Pay: countdown from real hold expiry, bank details + expo-clipboard copy + haptic, compressed screenshot upload, progress capped 100%.
7. Status: honest timeline Hold → Screenshot bheja → Venue check → Pakki ✓ (Pakki only when status === booked), Ticket with real check-in QR, rejected/expired reason + next step.
8. PChat: inbox (one row per venue/booking, unread dot), booking chat with slot context bar, hold-proposal card, hold timer pill, screenshot bubble, quick replies, keyboard-aware input. Same backend chat as WhatsApp flow — no new chat logic.
9. PBookings: list with status pills (Pakki / Venue check / Pay baqi), detail ticket (QR, Total/Mila/Baqi, cancel policy from real data), cancel confirm sheet (danger #B42318).
10. PAccount: Profile (stats only from real counts), Notifications (push-off banner + typed notifications), Edit profile + language toggle, Logout.
11. PStates: one Skeleton, ErrorState (retry + back), Offline banner, 404 — used by every screen.
OWNER (M2, teal):
12. Owner tabs: real Tabs navigator (Aaj, Approvals, teal +walk-in FAB, Paisa, Aur) — audit G2. Staff see only permitted tabs (existing my-permissions).
13. OwnerToday: hero = real collected today (same source as Ledger, audit G14), approvals card when count > 0, multi-court timeline, CNIC slim row.
14. Approvals: Chahiye vs Screenshot (OCR), duplicate warning, full-screen viewer, teal Approve; bulk approve only for OCR-matched + confirm sheet. FlashList.
15. OSheets: booking detail sheet (ID copy, Total/Mila/Baqi, waqt-nama, "Baqi mil gaye"), Reject sheet with reason radios, "Booking adhoora?" (kitna mila + wajah) — existing endpoints only.
16. OWalkin: walk-in form (court, day, slot grid, name/phone, payment method chips, sticky Save) + Check-in QR scan (expo-camera if already installed; else BACKEND/NATIVE DEPENDENCY) with manual code fallback.
17. OPaisa: Ledger (tiles, baqi/refund cards, range + court chips, rows with "Theek karein"), Refunds, History with search/filters. Numbers must equal OwnerToday.
18. OwnerMore: grouped menu, real badges, feature-flag gating, Zabaan, Help WhatsApp, Logout.
19. OGrowthTeam: Growth heatmap (empty slots pattern) + discount ideas, Reviews, Staff permission switches, Premium features/billing — only what the backend already supports; rest = BACKEND DEPENDENCY.
20. OSettings: hub, Courts & pricing (rules, advance %, hidden-rule warning), Timers (stepper + "Default par wapas") — must match wizard field parity.
21. OWizard: step 1 venue + map pin ("Meri location lo" / "Pin khud lagao") + sports, step 2 courts + CNIC (submit disabled with visible reason), Pending timeline, Rejected with admin note.
22. OStaffView: staff limited view (Check-in + Walk-in only, arrivals list, 2 tabs) and one shared "Ijazat nahi" screen.
23. Any other screen from the audit: same components (ErrorState, EmptyState, Skeleton, keyboard-aware inputs).

STEP 4 — WEB (only after mobile passes QA, separate commit)
- Web marketing pages already follow the approved website design: do not redesign them.
- Align web app screens (search, venue, booking/pay/status, owner dashboard) to the same tokens and state model: slot states, honest status labels, confirm-sheet money rules, contrast fixes (#8A9996 small text, white-on-orange). Keep layouts; change tokens/components.

STEP 5 — QA (agent QA, must fix what it finds)
- mobile unit + tsc + Expo-web e2e at 390x844; web unit + tsc + Playwright at 390, 768, 1280.
- Screenshot every redesigned screen and state into docs/floodlight-qa/ (before/after for the audit screens).
- Automated checks: contrast of every token pair used (fail < 4.5 text, < 3 UI), touch targets >= 44, no text truncation on money/time at 320px width, no white text on #FF6A2B, no orange primary button inside (owner) routes, every board frame compared against the screen at 390x844 AND 320 width with large font (nothing cropped / no ellipsis on money, time, names, phones), no hardcoded hex in touched files, reduce-motion path, screen-reader labels on icon buttons.
- Journey checks on local backend: search -> venue -> pick slot -> confirm -> hold -> pay screenshot -> owner approve -> player sees booked + QR; reject path; expiry path; staff without permission.
- Mark anything that needs a real phone (blur performance, keyboard, haptics, push) as "needs device".

REPORT (Roman Urdu): what changed per screen, files touched, test counts, contrast/tap results, backend dependencies found, native modules added, exact PowerShell commands for my dev-client build and first OTA update, and anything that needs a real phone.
```
