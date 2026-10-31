# Design vs app, Android emulator, 2026-10-31

**Source of truth:** `design/khelo-mobile-floodlight/` (README + System.dc.html hard rules).
**Branch:** `fix/android-ui` (local, not pushed).
**Phone:** AVD Khelo-Budget, 720x1600 @ 320 dpi (360x800 dp), Android 14.
**App:** EAS dev build 1ed6378b + Metro from this branch, local backend on the scratch DB `cb_ui_audit` (seed test accounts only).

## How the images were made (all local, gitignored)

| Folder | What it holds |
|---|---|
| `design/<board>-<nn>-<frame>.png` | Every 390 pt phone frame of every board, rendered in headless Chromium. Values come from each board's `renderVals()` sample data. |
| `compare/<screen>.png` | Design (left) vs the app before any fix (right). |
| `after/<screen>.png` | Design vs the app after the fixes in this branch. Several app shots sit under each other when the screen scrolls. |

Not every app shot can show the same data as the design, because the app only shows real data (README rule 9). The sample data has things the scratch DB does not:
- two courts on Demo Arena
- screenshots attached to payments
- ratings and reviews
- growth history

Where data is missing, the app's empty state is compared with the design's empty state.

**Capture note:** Metro's file watcher stopped noticing edits partway through the session, so some first after-shots showed old code. Metro was restarted with `--clear` and every after-image was taken again from commit d8ab487. Root cause found on 2026-11-01: Metro was started with `CI=1`, which turns file watching off. Start it without `CI` (stdin from `/dev/null`). The second round (2026-11-01, commits e42b6b6..e1accbc) re-took OPaisa-history, OPaisa-refunds, OSettings-hub, OStaffView-staff and PBookings-tab; the third round (adee39f, 248e3f2) re-took PBookings-detail, OSettings-hub and OSettings-courts.

**Severity:**

| Level | Meaning |
|---|---|
| P0 | A main action is missing or unusable |
| P1 | The layout is clearly wrong |
| P2 | A visible difference in colour, copy or style |
| P3 | Polish |

## Shared causes (fixed once, affect many screens)

| # | Difference | Cause (before) | Fix (commit) | Sev |
|---|---|---|---|---|
| S1 | Approve, teal "+" FAB, quick actions, back/close buttons, list rows, slot chips rendered as bare text or 20 dp icons | NativeWind wraps RN `Pressable`. On Android it drops a **function** `style={({pressed}) => …}`. 17 files used one. See `components/ui/Button.tsx:74` (and IconButton.tsx:69, Chip.tsx:46, TabBar.tsx:55, Card.tsx:33, Layout.tsx:92, SlotChip.tsx:48, VenueCard.tsx:309, plus 9 screens) | New `components/ui/Pressable.tsx` resolves the function itself. All 17 files use it. `npm run check:pressable` guards against a regression (6c28ffb) | P0 |
| S2 | Android Back with a sheet open left the screen or closed the app | `components/ui/Sheet.tsx`: BottomSheetModal had no BackHandler | BackHandler while open; the top sheet closes first (0b88a47) | P0 |
| S3 | Keyboard covered the chat composer and form inputs | `KeyboardAvoidingView behavior` was `undefined` on Android. See `app/(player)/booking/[id]/chat.tsx:198` and `components/ui/Screen.tsx:77` | `behavior="padding"` on both platforms (0b88a47) | P0 |
| S4 | Black status-bar icons on the teal or night heroes | Root `<StatusBar style="dark"/>` re-applied on every render (`app/_layout.tsx:202`). The owner hero never asked for light icons | Imperative default, plus `useLightStatusBar` on every hero: owner HeroLayout, Aur, login hero, player heroes (0b88a47) | P2 |
| S5 | Courts dropdown grew into a 630 px one-letter-per-line column, behind the tab bar | `components/overview/ui.tsx:73`: `flex: 1` on the SelectButton text in a wrapping row | `flexShrink` (214af39) | P1 |
| S6 | Idle tiles (court, day, duration) were white with a border | `components/ui/Chip.tsx`: one idle look for every shape | Tile = ground fill + transparent 2 px border (board). Pill unchanged. New `solid` chips: owner = teal, player = night (214af39) | P2 |
| S7 | Radio rows were grey-filled; the board shows white with a 1 px line | `components/ui/Controls.tsx:157` | White + line; chosen = tint + 2 px border (214af39) | P2 |
| S8 | Sub-page title sat under the back button (two rows) | `components/ui/Header.tsx:46` | Back + title + actions in one row (214af39) | P2 |
| S9 | Quiet grey buttons ("Wapas", "Kam mila", "Theek karein") had no variant | `packages/ui-tokens/src/roles.ts:140` | New `quiet` button variant (ground fill, ink text) (214af39) | P3 |

## Screens

**Match:** yes = same layout, colours and copy (data differs only where the app has no such data); partial = main parts match, listed differences remain; no = still clearly different.

### Owner (teal)

**OwnerToday:** `app/(owner)/(tabs)/today.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| "+" FAB, bell and day arrows invisible or 20 dp | S1 | fixed |
| Hero chip read "40 slots khaali aage"; board: "5 ghante khaali" | today.tsx:215 | fixed (`freeHoursLabel`) |
| Extra row "Check-in / Add booking / History" that is not on the board; it also looked like plain text | today.tsx:289-293 | removed (Aur has these; staff get the board's two big tiles) |
| No "5 PM – 11 PM" range next to "Courts ka din" | today.tsx:298 | fixed (`dayRangeLabel`) |
| Gap text "4 ghante koi booking nahi" / legend "Koi booking nahi"; board: "1 hr khaali" / "Khaali" | `_timeline.tsx:200,172` | fixed |
| Empty day: the "+ Add" text sat in the middle of an 11-hour gap (1000 px down) | `_timeline.tsx:191` | fixed (long gaps put the text at the top) |
| Payments card wrapped "Dekhein" under the text | today.tsx:238 | fixed |
| Extra blocks under the board (Din ka hisaab KPIs, filter pills, status-pending line) | product features added after the board | **kept** (real features; not in the design) |
| Single court in the scratch DB (board shows 2) | data | n/a |

**Approvals:** `app/(owner)/(tabs)/approvals.tsx`, `components/approval-card.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Approve button invisible (white on white) | S1 | fixed |
| Hero "1 approvals baqi" + a second line; board: one line "3 payments check karni hain · sab se purani 12 min" | approvals.tsx:229-233 | fixed |
| No "Baqi · N / Cancel/expire · N" tabs (shown only when both exist, with a third "Sab") | approvals.tsx:240-253 | fixed (two tabs, default Baqi) |
| Card meta on two lines (court, then a bold time); board: one muted line | approval-card.tsx:112-117 | fixed |
| No screenshot thumb in the card | the scratch payment has no image | n/a (thumb renders when `proof_url` exists) |
| Extra "No-show 0 / kul bookings", "Purana baqi … Done", "History mein dekhein" | real player context (later feature) | kept |

**OSheets, booking detail:** `components/booking-detail-sheet.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| "Booking ID" under the code; board: small caps eyebrow above it | :139 | fixed (Sheet `eyebrow`) |
| Money tiles "PKR 2,000" wrapped to 2 lines; board: "3,000" one line | :66-76 | fixed |
| "ID copy" outlined with an icon; board: grey pill | :279 | fixed |
| Slot / booked-at in English ("Today, 9:00 AM to …") | :298-300 | fixed (Roman Urdu formatter) |
| Footer "Baqi mil gaye / Kam mila / Nahi aaye"; app shows "Mukammal mark karein" + "History mein dekhein / Band karein" | different backend states (the board shows a due booking) | partial |
| No screenshot thumb next to Waqt-nama | data | n/a |

**OSheets, reject:** `components/approval-card.tsx:360-372`. Match: **yes**.

| Difference (before) | Cause | Status |
|---|---|---|
| Footer "Wapas / Reject karein" side by side as text | S1 + layout | fixed (red full-width, then grey "Wapas") |
| Radio rows grey | S7 | fixed |
| Reason list wording differs ("Amount match nahi karta" vs "Amount kam hai") | server-side reason keys | kept (the backend's real reasons) |

**OSheets, booking adhoora:** `components/completion-sheet.tsx`. Match: **partial**. It opens from Dues "Done". The scratch data has no due that is partly paid. Styles come from the shared fixes (S1, S6, S7, S9).

**OWalkin, walk-in:** `app/(owner)/walkin.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Day tiles wrapped "Tareekh" to its own row | walkin.tsx:251-265 | fixed (one row) |
| Idle tiles white + border | S6 | fixed |
| "Mon 2" English day | — | same as board (the board also writes "Mon 26") |
| Board: phone optional + "Kaise mila?" payment chips; app: phone required + "WhatsApp rasid" tick | product decision in a later round | kept |

**OWalkin, check-in scan:** `app/(owner)/checkin-scan.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| White card with a "Check in" button below | :138-155 | fixed (code row on dark, mint "Check") |
| Camera frame needs the camera permission | emulator | n/a |
| The board's "4821" short code is not accepted by the backend (full ID only) | backend | open (backend change, out of scope) |

**OPaisa, ledger:** `app/(owner)/(tabs)/ledger.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Hero tiles "PKR 12,000" squeezed; board: "7,000" | :257 | fixed |
| Range chips tint; board: solid teal | :176-183 | fixed (`solid`) |
| "Theek karein" outlined; board: grey | :227 | fixed (`quiet`) |
| Board has no Ledger/Refunds/History switch in the hero | PaisaSwitch (later feature) | kept |

**OPaisa, refunds:** `app/(owner)/(tabs)/refunds.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| "Bhej diya · record karein" invisible | S1 | fixed |
| Board: plain header + red total card; app: teal hero + switch | Refunds is a Paisa tab with the Ledger/Refunds/History switch (kept, like Ledger) | kept |
| Meta line had no booking code; reason was plain text | refunds.tsx:137,147 | fixed (5b562a1: "Court 1 · … · KH-…", reason in a grey box) |
| No "Kahan bhejein" (player's JazzCash) line | the API has no refund destination | n/a |

**OPaisa, history:** `app/(owner)/history.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Header two rows | S8 | fixed |
| Extra Courts + Status dropdowns; board: search + chips only | :232-237 | fixed (status dropdown removed; courts only with more than one court) |
| Long status chip squeezed the player name to one letter per line | `components/overview/booking-card.tsx:129-138` | fixed |
| Board cards are compact (date tile + one line); app cards show money stats | shared BookingCard | fixed (e42b6b6: `HistoryCard`, date tile, "Court 1 · 9–10 PM · KH-…", one status pill; money and Haan/Nahi are in the detail sheet) |
| Search field had a "Search" label and the glass on the right | history.tsx | fixed (glass on the left, label only for screen readers) |

**OwnerMore (Aur):** `app/(owner)/(tabs)/more.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Rows broken (icon over text) | S1 | fixed |
| White profile card; board: glass card + white "Profile" button | :159-170 | fixed |
| Zabaan as a separate segmented control; board: a card row with a globe | :222-236 | fixed |
| Extra rows (Bank se mila lein, Baqi raqam, Staff ka kaam, Account, Madad, Log out) | later features | kept |

**OSettings, hub:** `app/(owner)/venue-settings.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Header + 2 banners + switch were fixed and only ~20% scrolled | :103-150 | fixed (everything scrolls) |
| White venue card; board: teal card | :106-112 | fixed |
| Red "Venue live hone se pehle…" on a live venue | :116 | fixed (live venues read "Ye cheezein abhi baqi hain") |
| Board is a list hub (Venue ki tafseel ›, Courts aur qeemat ›, …); app is one long form with a Venue/Courts switch | screen structure | fixed (fa803b8: hub list with summaries and "Baqi" badges; each row opens its section; header arrow and Android Back return to the hub; `?section=cnic` opens CNIC) |
| Board row "Khulne ke ghante" | hours are per court, inside each court's setup | merged into "Courts aur qeemat" (sub line says "ghante") |
| Extra row "Points ki chhoot" | points feature | kept |
| No court-line art on the teal card | :146 | fixed (248e3f2: the board's court outline in `alpha.courtLines`) |

**OSettings, courts / timers:** `components/court-setup-fields.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| All labels English (Minimum booking time, Opening hours, Prices for this court, Cancellations…) | court-setup-fields.tsx | fixed (Roman Urdu) |
| Layout is the form, not the board's card list | per-court form | kept (opened from the hub row) |
| Court details, advance chips, blackout form, photos, time picker and toasts still English ("Court name", "Fixed amount", "Starts on", "Add blackout", "Couldn't save"…) | venue-settings.tsx, court-identity-fields, advance-settings, time-fields, photo-manager | fixed (248e3f2: Roman Urdu, owner tone; the wizard uses the same fields so it changed too) |
| Board: compact 2×2 "Court 1 ki tafseel", rule cards with "+ Rule" and a "chhup raha hai" warning, three advance chips, sticky "Sab save karein" footer | the editable per-court form | still different (labels match; layout is the long form) |

**OWizard step 1 / 2:** `app/(owner)/venue-setup/register.tsx`, `courts.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Whole wizard English ("Tell us about your venue", "Next: courts & pricing"…) | register.tsx:105-273, courts.tsx | fixed (Roman Urdu, owner tone) |
| No way out for a new owner (no Log out) | wizard | fixed (quiet Log out under the steps) |
| Board has a map pin card | no map SDK in the build | n/a (GPS button kept) |
| Bank + amenities on step 1 (board: step 2 has CNIC) | product order | kept |

**OWizard, pending / rejected:** `pending.tsx`, `rejected.tsx`. Match: **partial**. Buttons render after S1. Copy is already Roman Urdu.

**OStaffView:** `today.tsx` + `more.tsx` "limited". Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Staff Aaj had no big "Check-in scan / Walk-in" tiles | today.tsx | fixed (2aaa774) |
| A check-in / walk-in staff member landed on Aur; the Aaj tab was hidden and Aaj itself said "No access" | `lib/owner-access.ts`, `lib/owner-floodlight.ts`, today.tsx | fixed (87db0e4: own Aaj with "Demo Arena · Staff: Bilal", "Aaj · Sun, 1 Nov", the two big actions and the owner-only line; they land there) |
| Board: "Aane wale players" list | every booking list endpoint needs `view_ledger` (`/owners/overview`, `/today`, history) | **open, needs a backend decision**: a check-in-scoped arrivals endpoint (player names + times for today) |
| Board second tab "Profile"; app "Aur" | tab naming | kept (Aur holds Profile) |
| Staff WITH view_ledger (the seed staff) | gets the owner Aaj board + the two tiles | as before |

**OStaffView, no access:** `components/no-access.tsx`. Match: **yes** (one style, Roman Urdu).

**OGrowthTeam, staff:** `app/(owner)/staff.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| "+ Add" invisible | S1 | fixed |
| English permission chips from the server catalog | :181 | fixed (✓ Approve / ✓ Check-in / ✓ Walk-in; Roman Urdu switches + hints) |
| Header two rows | S8 | fixed |

**OGrowthTeam, growth / reviews / premium:** `growth.tsx`, `reviews.tsx`, `premium.tsx`. Match: **partial**. The scratch venue has no 6-week history or reviews, so each shows its empty state. The headers come from S8.

### Player (orange)

**Main:** `app/(player)/(tabs)/index.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Venue card time chips peach/orange; board: green `openTint` chips | `components/ui/VenueCard.tsx:342` | fixed |
| "Aur" sport tile wrapped to its own row | index.tsx:164, 301 | fixed (one row) |
| Status bar dark on the night hero | S4 | fixed |
| No "Phir se khelo" block | no data | n/a |
| "Sab dekho" instead of "Naqsha ›" | no map view in the app | n/a |

**PSearch, results / filters / no results:** `app/(player)/search.tsx`. Match: **partial**. Cards share VenueCard (fixed chips).

| Difference (before) | Cause | Status |
|---|---|---|
| No "List / Naqsha" switch | no map in the app | n/a |
| No "Agla khaali 8 PM" pill on the photo | the API has no next-free time per venue | n/a |

**Venue:** `app/(player)/venue/[slug].tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Slot chips were text only | S1 | fixed |
| Day labels "MON / TUE" English (board uses the same English short days) | — | same as board |
| Bottom bar "Book karo" grey until a time is picked | the board shows a picked slot | matches the state |

**VenueCard:** `components/ui/VenueCard.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Amenities chip broken into three lines | S1 (`VenueCard.tsx:309`) | fixed |
| Time chips | as Main | fixed |
| No photos in the scratch DB (court-line art shows) | data | n/a |

**Pay:** `app/(player)/booking/[id]/pay.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Ring and amount side by side; board: ring centred over a big amount | :247-266 | fixed |
| "5:30:42" spilled out of the ring (6 h hold in the scratch data) | `components/ui/CountdownRing.tsx:71` | fixed (smaller font for H:MM:SS) |
| "Bank details is phone par nahi" | the held booking was not made on this device | data |

**Status (waiting):** `done.tsx` / `pay.tsx` submitted state. Match: **yes**. Same timeline, copy and buttons. The board's "Prototype" pill is a design-tool control.

**PBookings tab:** `app/(player)/(tabs)/bookings.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Selected filter peach + border; board: solid night "Sab · 3" | :83 | fixed |
| Card actions: one "Ticket / QR"; board: "QR dikhao / Raasta / Tafseel" | bookings.tsx | fixed (b18244e: Pakki = QR dikhao / Raasta / Tafseel, check ho rahi = Chat / Tafseel, pay baqi = Abhi pay karein / Tafseel) |
| Board "Cancel" on a pay-baqi card | cancel lives on the details screen | kept |

**PBookings detail / cancel:** `done.tsx`. Match: **yes** (adee39f).
- A booking that is already pakki when it opens shows the board's ticket screen: "Booking KH-…" header, night ticket header (pill, venue, "Court 1 · Padel · Indoor"), Din / Waqt ("6:00 – 8:00 PM"), QR, Raasta / Calendar / Chat tiles, Paisa (Total / Aap ne diye / Venue par baqi), Cancel policy right under it. A booking that turns pakki on screen still gets the Status celebration.
- Kept on top of the board: a share button in the header, "Venue ka QR khud scan karein" under the QR, WhatsApp / Call tiles when the venue has them, and the payments, history and extras cards below the policy.
- Board's "Ya code batayein: 4821": not shown, because the owner's manual check-in takes the booking ID, not a short code.
- The cancel sheet styles come from the shared fixes.

**PChat inbox / thread:** `app/(player)/(tabs)/chat.tsx`, `booking/[id]/chat.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Inbox rows inside one card with dividers; board: one card each | chat.tsx:67,91 | fixed |
| Booking context grey; board: peach | [id]/chat.tsx:217 | fixed |
| Composer grey rounded box; board: white pill | :318 | fixed |
| Keyboard covered the composer | S3 | fixed |
| No quick-reply chips or image button | both existed (chips after an assistant reply, paperclip while held); the scratch chat never reached that state | after a booking is sent/confirmed the chips are now the board's "Parking hai? / Raasta bhejein / Cancel policy" (3e1dac3) |

**PAccount profile / notifications / edit:** `(tabs)/profile.tsx`, `notifications.tsx`, `edit-profile.tsx`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Stat tiles light grey on the night card; board: glass | profile.tsx:78 | fixed |
| Extra Points card and long rules text | points feature | kept |
| Rows had broken layout | S1 | fixed |

**PAuth login / sign-up / OTP:** `app/(auth)/*`. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| "Login karein" not orange | disabled until both fields are valid (smart button, by design) | same as board when filled |
| Status bar dark on the night hero | S4 | fixed |
| Error "No account found…" English | `lib/error-messages.ts` | fixed (e1accbc: every code in Roman Urdu by default, English with the toggle; "Is number ka koi account nahi. Pehle sign up karein.") |
| OTP "6 hindson" | — | not a typo: "hindson" = digits (ہندسوں) |

**PStates skeleton / error / offline / 404:** shared. Match: **partial**.

| Difference (before) | Cause | Status |
|---|---|---|
| Error "Dobara koshish" invisible | S1 | fixed |
| "Something went wrong" English body | `lib/error-messages.ts` | fixed (e1accbc: "Kuch gadbad ho gayi. Dobara koshish karein.") |
| 404 | — | matches |

## Still different (to do)

Second round (2026-11-01) closed items 1-6 of the first list; see the screen tables above. What is left:

1. **OStaffView "Aane wale players"** needs a backend endpoint a check-in-only account may read (today's arrivals). Every booking list needs `view_ledger` now. Owner decision.
2. ~~PBookings separate ticket screen~~ done (adee39f).
3. ~~OSettings court-line art and English forms~~ done (248e3f2). Left: the court form's layout (board: 2×2 details grid, rule cards, sticky save).
4. **Session-unreachable** screen ("Can't reach Khelo right now") is English; it sits outside the language provider.
5. **Data-only gaps** (screenshot thumbs, two courts, reviews, growth) show the empty state. They are not code differences.
