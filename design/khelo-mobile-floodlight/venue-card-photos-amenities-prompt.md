# Claude Code prompt: venue card with auto-scrolling photos + "Amenities" (mobile + web)

Paste the block below into the Claude Code CLI from the repo root. It can run on its own, or as part of the Floodlight work (Step 3, item "VenueCard").

```
TASK: One shared VenueCard everywhere a venue is shown in a list. Implement it in BOTH the mobile app (Expo) and the web app (Next.js). Implement, do not just report. Report to me in Roman Urdu (technical words in English), short.

DESIGN (source of truth, read first):
- design/khelo-mobile-floodlight/VenueCard.dc.html
  - Frame A = phone list
  - Frame B = phone amenities sheet
  - Frame C = web cards with hover
  - Frame D = rules
- design/khelo-mobile-floodlight/Main.dc.html ("Aaj raat khaali" cards) and PSearch.dc.html (search list) already use this card.
- README.md in the same folder (role colours: player = orange, ink text on orange).

STANDING RULES:
- New branch: venue-card-gallery. Merge only to LOCAL main after QA. Do NOT push.
- No production access. No secrets printed.
- No DB migration without my explicit "Migration-Go".
- Real data only. Never use fake photos or fake amenities.

STEP 0 — CHECK DATA FIRST (tell me before coding):
a) Does a venue have MULTIPLE photos in the DB/API? Find the field. Also find what the list endpoints return: search, home "tonight", saved, map.
   - If list endpoints return only one cover photo but the venue has more, add the photo URLs (ordered, max 8, thumbnail size if available) to the existing list response. This is a read-only API change, no migration.
   - If the DB has only ONE photo per venue, STOP this part and tell me. That needs a migration plus an owner upload UI (wizard + settings), so it is a "BACKEND DEPENDENCY".
b) Does a venue have AMENITIES? Find the field (it may be inside venue settings / the wizard), and check whether the list endpoints return it.
   - Same rule: exposing an existing field in the list response is OK.
   - A new column/table = STOP and ask me.
c) Write the contract in docs/venue-card-contract.md: fields, endpoints, the component props, and every file it replaces.

STEP 1 — SHARED COMPONENT
Mobile: apps/mobile/components/VenueCard.tsx
Web: the web components folder, VenueCard.tsx
Props: venue { id, slug, name, sport, area, distance?, rating?, priceFrom, nextFree?, photos: string[], amenities: string[] }, plus optional actions (times row on Home, "Slots dekho" on web).

Photo carousel behaviour (both platforms):
- photos.length === 0 → plain placeholder (court-line art on teal/night). No fake photo.
- photos.length === 1 → static image. No dots, no animation.
- photos.length >= 2 → auto-advance every 3.5 s with a ~400 ms slide. After the last photo it goes back to the first smoothly (clone the first slide, or scroll without animation at the end). Dots at bottom-right show the current photo.
- Only the card that is VISIBLE plays:
  - Mobile: FlashList/FlatList onViewableItemsChanged (≥ 60% visible).
  - Web: IntersectionObserver.
  - Off-screen cards are paused (battery + data).
- User control wins:
  - Mobile: a swipe (horizontal FlatList pagingEnabled, or react-native-pager-view if already installed) pauses auto-play. It restarts 6 s after the last touch. A vertical scroll of the list must still work, so check the gesture conflict.
  - Web: mouse hover pauses and shows prev/next arrows (44 px, aria-label "Pichhli photo" / "Agli photo"). Keyboard focus inside the card pauses it.
- Reduce motion ON (mobile AccessibilityInfo.isReduceMotionEnabled, web prefers-reduced-motion) → no auto-play; swipe/arrows only.
- Performance:
  - Mobile: expo-image with cachePolicy "memory-disk", and prefetch the NEXT photo only.
  - Web: next/image with sizes for the card width; lazy-load for all cards except the first 2.
  - Use thumbnail size on cards (~720 px wide), full size only on the venue page.
- Pause all timers when the app goes to background (AppState) or the tab is hidden (document.visibilitychange).
- Accessibility: the carousel has accessibilityLabel / aria-label "<Venue> ki N photos, photo X". The dots are decorative.
- Tapping the photo opens the venue page (same as tapping the card). The save heart stays at 44 pt.

Amenities behaviour:
- On the card front show ONE chip only: list icon + the word "Amenities" + a count badge (#E3F4F1 bg, #0A5F59 text). Height 44, no wrapping, no "…".
- 0 amenities → hide the chip.
- Web: hover OR keyboard focus on the chip → popover with the full list (✓ + name), opening upward. It must not be clipped by the card (overflow hidden only on the photo area, z-index above the next card). Esc closes it. role="dialog" + aria-haspopup.
- Mobile (no hover): tap the chip → bottom sheet (@gorhom/bottom-sheet) titled "Amenities", with "<Venue> · N cheezein", a 2-column grid of icon + name, a close button (44 pt) and the note "Ye list venue owner ne khud dali hai".
- Icons: map the known amenity keys (parking, washroom, changing room, floodlights, drinking water, cafe, indoor, seating, wifi, equipment rent, prayer area) to lucide icons. Unknown key → check icon + the text as given.
- Rename the search filter group "Sahooliat" to "Amenities" in both app and web (Roman Urdu + EN copy).

STEP 2 — USE IT EVERYWHERE
Replace every venue list card with VenueCard:
- mobile: Home "Aaj raat khaali", Search results, Map bottom card, Saved venues
- web: search/listing page, home sections, saved

Do NOT auto-play on the venue DETAIL page hero: swipe + "1/6" counter + tap = full-screen gallery (reading the page, the photo should not move by itself).

STEP 3 — QA (must fix what it finds)
- Unit tests for the carousel logic: 0/1/2/8 photos, pause on touch/hover, resume after 6 s, reduce-motion, visibility pause.
- Expo-web e2e at 390x844 and 320 width + large font: card not cropped, chip not cut, sheet fully visible.
- Playwright web at 390, 768, 1280: autoplay advances, hover pauses + arrows, popover not clipped on the last card of a row or the last row, Esc closes, keyboard works.
- Screenshots into docs/venue-card-qa/.
- "needs device": real-phone swipe vs vertical scroll, Android low-end smoothness.

REPORT (Roman Urdu): what the data check found (photos? amenities?), files touched, test counts, and anything needing my decision (migration / owner upload UI).
```
