# MASTER PROMPT: Khelo full app upgrade, multi-agent, one run

How to use it: from the repo root in the Claude Code CLI, send one line:
`design/khelo-mobile-floodlight/MASTER-PROMPT.md poori parho aur us ke mutabiq kaam shuru karo.`

---

You are the LEAD (orchestrator). The goal is to build the whole Floodlight redesign, the shared venue card and the leftover bugs in a single run, using parallel sub-agents.

This prompt is my "GO" for everything below. Do NOT stop to wait for my go. Stop and ask me ONLY for the STOP conditions listed at the end.

Report to me in Roman Urdu (technical words in English), short, only at the end of each phase.

## 0. Read first (all of it)
- All .md files in the project root and in docs/ (for context: PRD, plan, handoff, backlog, audit).
- docs/mobile-audit-2026-10.md and the P0 result (main = db4db49).
- design/khelo-mobile-floodlight/README.md: file → route map, player = ORANGE, owner = GREEN/teal, hard rules.
- design/khelo-mobile-floodlight/floodlight-implementation-prompt.md: the screen-by-screen spec. Ignore its "WAIT for my go" line; this file is the go.
- design/khelo-mobile-floodlight/venue-card-photos-amenities-prompt.md: the shared VenueCard spec.
- design/khelo-mobile-floodlight/*.dc.html: 23 boards, the design source of truth.
  - Inline styles ARE the design.
  - renderVals() data is SAMPLE only.
  - Frames are drawn full length, so nothing may be cropped.
- design/khelo-website/khelo-website-design/: web brand.

## 1. Standing rules (never break)
- **Git:**
  - Never push. Merge only into LOCAL main, after QA passes.
  - Merge order is always: Backend → Web → Mobile → QA fixes.
- **Production:** no production access and no production login, ever.
- **Secrets:**
  - Never print secret values. Check secret NAMES only.
  - Any CLI `--value` must be a variable like `$KEY`, never a pasted value.
- **Database:**
  - No DB migration. No new table or column.
  - Read-only API changes are allowed. Example: adding existing fields such as photos[] or amenities to a list response.
- **Behaviour:**
  - Keep every route, auth, permission, booking/payment/ledger rule and API contract as it is.
  - Real data only. Never invent ratings, photos, prices, policies or availability.
  - Never show "Court is yours" / "Pakki" unless status === booked.
- **Progress file:** keep docs/floodlight-progress.md updated after every step: phase, branch, done, next, blockers.
  - If you are restarted or compacted, read it first and continue from there.

## 2. Phase A: housekeeping (Lead, alone, ~10 min)
1. Run `git status` and confirm main = db4db49 or later with a clean tree.
2. Commit docs/mobile-audit-2026-10.md and docs/mobile-audit/p0-after/*.
   - Add docs/mobile-audit/screens/ (the 200+ raw audit screenshots) to .gitignore. Keep them locally.
3. Commit the design/khelo-mobile-floodlight/ folder if it is untracked.
4. Make sure local Docker (db + localstack) and the local backend are running; QA needs them.

## 3. Phase B: native foundation (one agent: NF, branch native-foundation)
Follow STEP 1 of floodlight-implementation-prompt.md.

1. Install with `npx expo install` (exact SDK-compatible versions):
   - expo-dev-client, expo-updates
   - expo-blur, expo-haptics, expo-image, expo-linear-gradient
   - react-native-gesture-handler, @gorhom/bottom-sheet, @shopify/flash-list
   - expo-clipboard
   - expo-camera, only for the owner Check-in QR scan
   - @expo-google-fonts/bricolage-grotesque, @expo-google-fonts/plus-jakarta-sans
   - @sentry/react-native
2. Sentry reads env name EXPO_PUBLIC_SENTRY_DSN. If that is unset, Sentry stays disabled. Never print it.
3. Root: wrap the app in GestureHandlerRootView + BottomSheetModalProvider, and load the fonts.
4. app.json:
   - runtimeVersion policy "appVersion" and updates.url.
   - Keep slug/package/scheme (com.maidan.app / maidan://).
5. eas.json: channels development / preview / production.
   - The dev profile must NOT point at the production API.
6. Gate: tsc clean, unit tests pass, Expo-web e2e passes.
7. Merge into local main.

## 4. Phase C: design system (one agent: DS, branch floodlight-ds, after B)
Follow STEP 2 of floodlight-implementation-prompt.md.

1. Tokens go in a shared package used by web + mobile.
   - The role theme is `role.player.*` (orange) and `role.owner.*` (teal), picked by route group. Never hardcode it per screen.
2. Build every shared component:
   - Button, IconButton (44 pt), Card, Chip, StatusPill, SlotChip (all states, never colour-only)
   - Sheet, Input, Skeleton, EmptyState, ErrorState (retry + back), Toast, Stepper
   - CountdownRing, Ticket (QR), GlassBar (with solid fallback)
   - VenueCard (auto-photos + Amenities chip, per venue-card-photos-amenities-prompt.md)
3. Build the same components for web (Next.js) with the same tokens.
4. Add a component test page (dev only) showing every component in every state.
5. Gate: tests pass, contrast check passes, then merge into local main.

## 5. Phase D: screens IN PARALLEL (sub-agents, after C)
Use the Task tool to run these sub-agents at the same time.

Each agent works in its OWN git worktree, so they never touch the same files:
`git worktree add ../kb-<agent> -b <branch> main`

| Agent | Branch | Scope (boards) |
|---|---|---|
| BE | floodlight-be | Read-only API only. (a) Is there an HTTP hold endpoint for direct "Book karo"? (b) Is there a "held by someone else" availability signal? (c) Where does the cancel policy come from? (d) Add the existing venue photos[] + amenities to list endpoints if they are missing. Write findings in docs/floodlight-contract.md. No migration. |
| M1 | floodlight-player | Mobile PLAYER, orange: PAuth, Main, PSearch, Venue, Pay, Status, PChat, PBookings, PAccount, PStates + player tabs |
| M2 | floodlight-owner | Mobile OWNER, teal: OwnerToday, Approvals, OSheets, OWalkin, OPaisa, OwnerMore, OGrowthTeam, OSettings, OWizard, OStaffView + owner tabs |
| W1 | floodlight-web | Web app screens (search, venue, booking/pay/status, owner dashboard): same tokens, VenueCard, state model, contrast fixes. Do NOT redesign the marketing pages. |
| FX | leftover-fixes | Leftover bugs from P0: view_ledger staff sees Venue settings read-only (no Save) · Pay screen Back from a deep link goes to Home/Bookings · Done screen spinner visible (contrast ≥ 3:1) · Duplicate chip hides "0 bookings" |

Rules for the agents:
- M1 and M2 import components from Phase C only. If one needs a new shared component, it tells the Lead, and the Lead adds it on main and the agents rebase.
- If BE finds no hold endpoint, M1 makes "Book karo" open the chat with the slot prefilled, as today.
- If BE finds no "held by other" signal, show open/booked only.
- Every agent's gate: tsc clean, its own unit tests, Expo-web e2e for its screens at 390x844 and 320 width with large font. Nothing cropped, no "…" on money/time/names/phones, tap targets ≥ 44.
- The Lead merges in this order: BE → W1 → FX → M1 → M2. Resolve conflicts, then run the full test suite after each merge.

## 6. Phase E: QA (agent QA, after D, must FIX what it finds)
Follow STEP 5 of floodlight-implementation-prompt.md, plus the VenueCard QA.

1. Run the full journeys on the local backend:
   - search → venue → slot → confirm → hold → pay screenshot → owner approve → player sees booked + QR
   - reject path
   - expiry path
   - staff without permission
   - walk-in
   - check-in
2. Take screenshots of every board's screens and save them in docs/floodlight-qa/, side by side with the board.
3. Run the automated checks:
   - contrast
   - 44 pt targets
   - no white on orange
   - no orange primary on owner screens
   - no hardcoded hex in touched files
   - reduce-motion
   - icon-button labels
4. Fix, retest, then merge into local main.
5. Remove the worktrees: `git worktree remove`.

## 7. Final report (Roman Urdu)
- Per phase: what changed, branches merged, and the test counts (before → after).
- The BE findings (hold endpoint, held signal, photos/amenities) and anything waiting for my decision.
- A "needs real phone" list.
- The exact PowerShell commands for me, in order:
  1. git push origin main
  2. eas login check
  3. dev-client build: `eas build --profile development --platform android`
  4. installing it on my phone
  5. starting `npx expo start --dev-client`
  6. later OTA: `eas update --channel preview --message "..."`

## STOP conditions (only these: stop that part, keep the rest going, and tell me)
1. Any change needs a DB migration, a new table or a new column. For example, the venue has only ONE photo field, or there is no amenities field. STOP that part and wait for my "Migration-Go".
2. Anything that would touch production or need a secret value.
3. A native module that cannot be installed for this Expo SDK.
4. Tests that still fail after 3 honest fix attempts.
