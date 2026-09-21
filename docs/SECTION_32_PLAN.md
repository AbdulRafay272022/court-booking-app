# Section 32 plan: the single source of truth (read this first in any new session)

Owner's spec for the Karachi padel/futsal pilot ("Maidan"). This file holds the working rules, the current order of work,
the progress table, the owner's later additions **verbatim**, and (at the bottom) the original spec **verbatim**. Read
`court-booking-backend/CLAUDE.md` (START HERE) and `court-booking-frontend/CLAUDE.md` too. Update this file and the
progress table after EVERY part.

## Working rules (from the owner)

- **One part at a time.** After each part: update this file and the progress table, commit, report in plain English with
  proof, then **STOP and wait for the owner to say "continue"**.
- 12-hour Pakistan time only (no 24-hour, UTC or ISO strings anywhere a person reads); human dates ("Wed, 23 Sep";
  Today/Tomorrow within a day); one shared formatter per platform (`app/utils/timezone.py`,
  `packages/types/src/datetime.ts`).
- Diagnose from production logs/DB first; reproduce every bug in a test and confirm it fails on the old code; verify live
  (real Postgres, Playwright on the web build and the Expo web target); never claim "fixed" without evidence.
- Ask before any production write, deploy, or migration. If a command is blocked, hand the owner the exact command.
- Small separate commits per part. Report in plain English, short, and list anything decided without asking.
- Money is integer PKR; AI replies show money as "PKR 3,500" (never "Rs. 3500.0"); the model never invents a reason.
- **Rules A, B, C for every migration:**
  - **A.** Once `venues.cancellation_*` exist the code never reads or writes the old `courts.cancellation_*` columns
    (deprecated, **drop next release**).
  - **B.** Keep `one_live_booking_per_slot` until the new overlap constraint is proven in production, then TELL the owner
    whether it is redundant; never drop it without asking.
  - **C.** Before ANY migration touches production: show the plan and the exact commands; remind the owner to take a
    manual RDS snapshot first (backups are 1 day, restore never rehearsed) and confirm it is visible; test upgrade AND
    downgrade on a copy of production-shaped data; run it from the NEW image before the new backend serves traffic; read
    the output back to the owner; **stop before production until the owner says "go"**.
- The deploy script (`infra/scripts/remote-deploy.sh`) now runs `alembic upgrade head`, `current` and `check` from the new
  image before `up -d` on EVERY deploy, so a push with a migration in it IS the migration: never push one without the go.

## Order of work (set by the owner 2026-09-22)

Part 4 (deploy) -> **Part 3** (overnight courts) -> **Part 4b** (player venue page redesign) -> **Part 5** (split payments +
ledger) -> **Part 9** (QR check-in) -> **Part 10** (refunds) -> **Part 7** (OCR, with the updated rules below) ->
**Part 8** (WhatsApp/Gemini prompts) -> **Part 6** (photos and reviews) -> **Part 11** (screen audit).

## Progress table

| Part | What | Status |
|---|---|---|
| 1-2 | 12-hour Pakistan time, date-shift bug, own-slot state | **Deployed** as `94ac837f372d` (2026-09-21). Mobile needs an EAS build to reach phones. |
| 4 | Per-court slot length and pricing, per-venue cancellation, duration picker, closed/booked labels | Built and tested locally (449 backend tests, live Playwright on web and Expo web). **Deploy + migration `dd23d75cf310` awaiting the RDS snapshot confirmation.** Cancellation stays "not allowed" (the live court already has it). |
| 3 | Overnight courts (`closes_next_day`) | Next |
| 4b | Player venue page redesign (below) | Not started. **A mockup screenshot must be approved before any wiring.** |
| 5 | Split payments + `payment_entries` ledger | Not started |
| 9 | QR check-in (below) | Not started |
| 10 | Refunds, manual (below) | Not started |
| 7 | OCR improvements (updated rules below) | Not started |
| 8 | WhatsApp/Gemini prompts. Findings queued: AI money "PKR 3,500"; never invent a reason for an unavailable slot ("fixed 90-minute blocks" when it was simply booked); only say what the tool returned | Not started |
| 6 | Photos and reviews | Not started |
| 11 | Screen audit, incl. the owner dashboard's fixed sidebar overflowing below ~600px (owners are on phones) | Not started |

## Owner's additions (verbatim, 2026-09-22)

### Part 4b: Player venue page redesign (web and mobile)

Today the page shows one row of day tabs, then every court side by side. Change it like this:

1. Sport selector at the top. Show only the sports this venue offers.
   - If the player arrived from a sport (search filter or a link like ?sport=futsal), that sport is selected by default
     (came from padel, then padel). If no sport was given, use the venue's first sport.
   - If the venue offers only one sport, hide the selector.
   - Under it, show ALL courts of the selected sport at this venue, and only those courts.

2. Each court gets its own section, one below the other (not side by side): a centered heading with the court name, its
   slot length and its starting price, and under it that day's slots inline (see 3).
   - Each court has a "View calendar" button. The month calendar is HIDDEN until the player taps it. It opens as a popup
     (a bottom sheet on mobile, a centered dialog on web) showing the whole month, like a Teams calendar, with the
     CURRENT WEEK highlighted. Each day shows a small dot: has open slots / almost full / fully booked / closed. Past
     days are greyed and not tappable.
   - Tapping a day in the calendar shows that day's slots for that court in the same popup (with a back arrow to return
     to the month). Slot states are the ones already built: open with price, "Payment pending", "Booked" with Notify me,
     "Unavailable", "Your booking". Slots after midnight show under the opening day with a clear "Fri 1:00 AM" label
     (Part 3).
   - Selecting an open slot asks "How long do you want to play?" and shows the server-priced total, exactly as it works
     now. Do not change that flow.

3. A sticky week strip stays at the top of the page (Today, Tomorrow, then the next days) so a player can quickly switch
   the day for all courts at once. Each court section shows the selected day's slots inline under its heading. The
   calendar popup is for jumping to any other date.

4. Rules: 12-hour PKT times and human dates only (the shared formatter), closed hours never shown as bookable, per-court
   slot length and price, no 24-hour or ISO strings, works at 390px phone width, tap targets at least 44px, fast (fetch a
   court's month availability summary in one request, not one request per day; propose the endpoint shape if none exists).

5. Before wiring it up, show me ONE screenshot mockup of the new page (web at 1200px and mobile at 390px) with two courts,
   the calendar popup open on one of them, and wait for my approval. Then build it and show me before and after
   screenshots.

### Part 9: QR check-in (booking start)

Verify what backend exists (per-venue QR token, owner-scan and player self-check-in) and build the missing screens on web
and mobile:
- Owner: show and print the venue QR, a "Check in" action on each booked slot in Today, and a scan or enter-code screen.
  Record who and when.
- Player: "Scan to check in" on a booked, current-day booking, only inside the window (about 15 minutes before to 15
  minutes after start), with clear messages outside it.
- No-show: owner marks it after the window (balance-due and reliability effects as already designed). All times in
  12-hour PKT.

### Part 10: Refunds (manual, no payment gateway)

- On cancel, compute the refundable amount from the venue cancellation policy and the payments recorded (the advance may
  be non-refundable inside the cutoff). Show it to the player BEFORE they confirm, in plain words.
- Create a refund item. Owner screen "Refunds to pay": the owner sends the money outside the app (JazzCash or bank), then
  marks it Refunded with a reference and an optional screenshot. The player is notified. The ledger shows the refund as a
  negative entry linked to the booking.
- Admin screen: refund queue and disputes, an alert when a refund is overdue after N days, audit log on every step.
- Tests: partial refund, non-refundable advance, refund larger than the amount paid rejected, double-click on "Refunded".

### Part 7 update: OCR rules (replace earlier OCR bullets where they differ)

Extract from every payment screenshot: amount, reference, payment date and time, payer name, bank or wallet name
(JazzCash, Easypaisa, HBL, Meezan...) and receiver name or account tail. Use null for anything not clearly visible, never
guess. JSON only, fixed schema, confidence per field, and flags for non-receipts, crops, edits, screenshots of screenshots,
and failed or pending transactions.

The owner's approval card shows these checks in plain words, each with a clear Matched / Not matched result:
1. NAME: "Name on screenshot: Ali Raza. App account: Ali R. Matched" or "Not matched". Tolerant matching (case, word order,
   initials, Roman Urdu spellings). Not matched is a strong warning and blocks auto-approve, but does not auto-reject
   (people pay from a relative's account). The owner decides.
2. AMOUNT, with the difference and what is left: "Screenshot shows PKR 400. Expected now: PKR 400. Matched." or "PKR 100
   less than expected" or "PKR 50 more than expected". Then always show: "Total PKR 3,500. Paid so far PKR 400. Balance due
   at the venue: PKR 3,100." A payment less than the required advance cannot be auto-approved. A payment more than the
   advance is recorded as received, with the balance reduced.
3. TIME: the payment time on the screenshot must be AFTER the booking hold was created and WITHIN the 15-minute timer
   (before held_until). Allow a 2-minute clock tolerance and say so. Show it in 12-hour PKT: "Paid 7:12 PM. Booking
   started 7:05 PM. Timer ended 7:20 PM. Within the timer." or "Paid before the booking started" or "Paid after the timer
   ended". A failed time check blocks auto-approve and shows in red. The owner can still approve manually. Never
   auto-reject on time alone. If no time is readable, show "Time not visible" as a warning.
4. BANK: show which bank or wallet the payment came from, and whether the receiver matches the venue's saved bank details
   (if entered).
5. Duplicate image or reused reference checks keep working.
Auto-approve stays gated: name matched, amount matched, time within the timer, receiver matched, no duplicate.
Add fixture images (clean and messy JazzCash and Easypaisa screenshots) and tests for: name matched and not matched,
amount less, equal and more, time before booking, inside the timer, after the timer, and time missing. Tell me honestly
what accuracy you see on messy screenshots.

## Decisions already accepted (2026-09-21/22)

1. Overnight = explicit `schedule_templates.closes_next_day` column (close <= open means next day; open == close + flag = 24
   hours; midnight close is `00:00` + the flag).
2. Multi-slot bookings via a `btree_gist` EXCLUDE constraint on `tstzrange(starts_at, ends_at, '[)')` for held,
   payment_submitted, booked (built and tested in Part 4).
3. Advance rule lives on the COURT (fixed or percent + minimum); `pricing_rules.advance_percentage` stays as fallback.
4. Slot lengths 30/60/90/120. 5. Old per-court cancellation columns kept one release, unused.
6. New append-only `payment_entries` ledger table for Part 5 (separate from `payments` proofs), integer PKR, atomic guards.

## Findings made along the way (already fixed unless marked)

- Owner screens numbered weekdays Sunday-first against a Monday = 0 API (fixed in Part 4; production hours are uniform so no
  live effect).
- The app's query client keeps the previous query's data (`placeholderData`), so a form seeded from `useQuery` data must
  check the data belongs to the selected id (fixed in Venue Settings).
- The unhandled-500-has-no-CORS-headers problem (looks like "Can't reach the server") is still open: add an inner catch-all
  in `RequestContextMiddleware` (Part 8 territory).
- Local `.env` has `AI_PROVIDER=gemini` with a real key: always run tests as
  `AI_PROVIDER=claude AI_VISION_PROVIDER=claude pytest` (documented).

---

# ORIGINAL SPEC (verbatim, as given 2026-09-21)



<pasted_content id="0052">
# Section 32: Time and Date Display, Overnight Courts, Per-Court Slots and Pricing, Split Payments, Ledger, OCR, WhatsApp, Photos and Reviews

Read `court-booking-backend/CLAUDE.md` (START HERE) and `court-booking-frontend/CLAUDE.md` first. Follow the working rules in them: diagnose from production logs and the DB before theorising, reproduce every bug in a test first and confirm it fails on the old code, verify live (real Postgres, Playwright on the web build), and never claim "fixed" without evidence. Ask before any production write, deploy side effect, or migration on production. If a command is blocked, hand me the exact command instead of working around it.

## Who this is for (drives every decision below)

Players in Karachi range from highly educated to barely tech-literate, and some will send a guard or helper to book. The product must be simple, clear and professional for all of them. Rules that apply everywhere a player or owner sees a time or date:

- **12-hour clock only, in Pakistan time (PKT, UTC+5).** Format: `7:30 PM`, `6:00 AM`. No 24-hour times, no "UTC", no seconds, no ISO strings, anywhere in the UI, WhatsApp messages, AI chat replies, notifications, emails or error messages.
- **Human dates only.** Format: `Wed, 23 Sep` (add the year only if it is not the current year). Also use `Today` and `Tomorrow` where the date is within one day. Never raw `2026-09-23` or `23/09/2026` in user-facing text.
- **One shared formatter per platform** (backend `app/utils/timezone.py` or a sibling `app/utils/formatting.py`; web and mobile share one helper in `packages`). No screen or message builds its own time string. Grep the whole repo for `toLocaleTimeString`, `hour12`, `strftime`, `isoformat`, `HH:mm`, `.slice(11` and every place a time is interpolated into a string, and route all of them through the formatter.

## Part 1: Time format bugs (do this first, it is the most visible)

1. Find every place a 24-hour time reaches a player or owner: schedule grid, slot chips, booking cards, pay screen, done screen, My Bookings, owner Today, Approvals, Ledger, walk-in, venue settings, wizard hours pickers, notifications, WhatsApp templates and texts, AI tool results.
2. **The AI chat is inconsistent (sometimes 12h, sometimes 24h).** Root cause is almost certainly that tool results hand the model raw times and the model formats them itself. Fix at the source: every tool result (`check_availability`, `propose_booking_confirmation`, booking summaries) must return ready-made display strings (`label: "7:00 PM to 8:00 PM, Wed 23 Sep"`), and the system prompt must say: "Never convert or reformat times or dates. Copy the `label` exactly. Never use 24-hour time. Never mention UTC." Pull the last 50 AI messages from the `messages` table (RUNBOOK section 4) and list every 24-hour or ISO occurrence you find, so we can see the pattern before fixing it. Add a regression test that scans AI replies for `\b([01]?\d|2[0-3]):[0-5]\d\b` not followed by AM/PM.
3. **Schedule hours are set to 6 AM to 11 PM but the player side shows "21" (and probably other odd values).** Trace it: what does the availability API return for that court, what does the client render, and is it a UTC/PKT conversion or a grid-alignment bug? Show me the exact cause with the real values before fixing.
4. Owner pickers (wizard and Venue Settings) must let the owner enter times as 12-hour with AM/PM, stored as before.

## Part 2: Date shift bug (booked 23rd, shows 24th) and "Notify me" on a booked slot

1. I booked a slot for the 23rd and the message/UI showed the 24th. Reproduce with the exact booking (look it up in production read-only, or hand me the query). This is almost certainly a UTC vs PKT day-boundary error (a late-evening PKT slot is a different UTC date, or the reverse near midnight). Fix at the single conversion point in `app/utils/timezone.py`, add tests for slots at 11:30 PM, 12:00 AM, 12:30 AM and 6:00 AM PKT, and make sure the date shown in every message is derived from the PKT start time of the booking, not from `created_at` or a UTC date.
2. **"Notify me" (waitlist) button shows on slots that are already booked by ME or that are in "booking in progress" by me.** Rule: Notify me is only for a slot that someone ELSE holds or has booked. Never show it on my own booking or my own held slot; show my status instead ("Your booking" or "Payment pending"). Explain in your report what the button was tied to and why it showed.
3. **"Venue 0"**: I saw the text "Venue 0" somewhere after my booking. Find it, explain what it is (likely a missing name, a count rendered as text, or a falsy `0` rendered by React), and fix it. Sweep for the same pattern (`{value && <X/>}` rendering a literal 0) in owner Today and player screens.
4. Owner "Today" screen: check it after my booking and confirm it shows the booking with correct 12-hour time, court, amount paid, balance due and status.

## Part 3: Overnight courts (e.g. 3 PM to 3 AM, or 6 PM to 6 AM)

Today `CHECK (open_time < close_time)` blocks this and the UI suggests 23:59 which loses the last slot. Build real overnight support. This needs a written plan first (short, in your reply) before code, covering:

1. **Model**: a schedule day belongs to the day it OPENS. A Thursday 3 PM to 3 AM schedule covers Thursday 3 PM through Friday 3 AM. Drop or replace the CHECK constraint with one that allows `close_time <= open_time` meaning "closes next day" (and decide how 24-hour operation, open == close, is represented, and say what you chose).
2. **Availability engine** (`AvailabilityService.get_day_slots`): generate the grid across midnight, in PKT, converted to UTC only at the storage boundary. Slots after midnight display under the correct calendar date/label and belong to the opening day's schedule, blackouts and pricing.
3. **Pricing windows** that cross midnight (e.g. peak 10 PM to 2 AM) must work.
4. **Blackouts, holds, expiry, reminders and growth-job bucketing** must all use the same PKT logic. Check the growth job's (day_of_week, hour) buckets for a slot at 1 AM Friday (it belongs to Thursday's schedule).
5. **UI**: the schedule grid shows a day tab (e.g. "Thu 24 Sep") with slots running past midnight and a small "after midnight" divider, with a `Fri 1:00 AM` style label on those slots. Wizard and Venue Settings hours pickers show "Closes next day" when close is earlier than open.
6. Tests: a 3 PM to 3 AM court, a 6 PM to 6 AM court, DST is not a concern (Pakistan has none), a booking at 1:00 AM, two bookings on either side of midnight, and the 50-concurrent-request test still passing.
7. The migration must be reversible and safe on the current production data (one venue, hours 6 AM to 11:59 PM). Tell me the migration plan and wait for my go-ahead before it touches production.

## Part 4: Slot length and pricing are per COURT, cancellation is per VENUE

1. **Slot interval (30 min or 60 min, also allow 90 min for padel) is chosen by the owner, per court, in the wizard and in Venue Settings.** `courts.slot_minutes` already exists; verify it is really used by the availability engine and by the UI for every court, and that changing it later cannot break existing bookings (existing bookings keep their own start/end). Show the resulting number of slots as a live preview in the settings screen.
2. **Pricing is per court.** I am seeing it set once for the venue. Trace where the wizard and settings screens apply one price to all courts and change it so each court has its own rate, peak rules and weekend rules. Backend `pricing_rules` should already be keyed by court, confirm and fix any place that fans out one setting to all courts.
3. **Cancellation policy is per VENUE, not per court. This deliberately reverses Section 31** (I asked for per-court then, and now I want one policy per venue). Plan: add `venues.cancellation_allowed` and `venues.cancellation_cutoff_hours`, backfill each venue from its courts (if a venue's courts disagree, use the most player-friendly values and list those venues to me), point `_enforce_cancellation_policy` at the venue, remove the controls from the per-court UI, and put one control in the wizard (venue step) and Venue Settings. Keep the pre-payment disclosure to the player. Keep the migration reversible, and update the two Section 31 tests that pinned per-court behaviour to pin per-venue instead. Flag this clearly in your report.
4. **Closed hours must not appear as bookable.** Times outside the court's opening hours are simply not shown (or greyed out "Closed" if a full day grid reads better), never as available. **Booked and held slots are clearly marked** ("Booked", "Payment pending") and are not tappable for booking. Blackouts show as "Unavailable".
5. **Booking duration**: when the player books, ask for duration (for example 1 hour, 1.5 hours, 2 hours, in multiples of the court's slot length), show the total price for that duration before they confirm, and make sure the price uses the per-court pricing rules across the whole duration (including when it crosses a peak boundary or midnight). Do this in the web UI, the mobile UI and the WhatsApp/AI flow (the assistant must ask "How long do you want to play?" if the player didn't say). Check `create_hold` supports multi-slot ranges with the unique index still protecting every slot in the range; if it doesn't, tell me the design before building.

## Part 5: Split payments (advance now, balance later) and the ledger

Reality: players usually pay a small advance (for example PKR 200 or 400 on a PKR 3,500 court) to hold the slot, and pay the balance at the venue, often in cash. This must be handled securely and professionally.

1. Check what exists (`bookings.advance_amount`, `amount_paid`, `balance_due`, `payments`). Then design and implement:
   - **Court/venue advance rule set by the owner**: a fixed amount or a percentage, with a minimum. The pay screen and the WhatsApp payment instructions show: "Total PKR 3,500. Pay PKR 400 now to confirm. PKR 3,100 due at the venue."
   - **Multiple payments per booking.** Each payment is its own row with amount, method (bank transfer proof, cash at venue, other), who recorded it, when, and a note. The booking shows total, paid so far, and balance remaining, always computed from the payment rows (never a hand-edited number).
   - **Owner records the balance.** On the owner's booking detail (and Today), a "Record payment" action: amount, method, note. It refuses to record more than the balance due, and shows the remaining balance after. Booking is marked "Fully paid" when the balance is zero.
   - **Admin can view and correct** payments on any booking with an audit-log entry for every change (who, what, before/after). No silent edits, no deletes: corrections are reversing entries.
   - **Player view**: My Bookings shows "Paid PKR 400 of PKR 3,500, PKR 3,100 due at the venue".
   - **Refunds/cancellation** interact with the advance: keep the existing manual-refund dispute queue, and show the advance amount in the cancel confirmation copy.
   - No-show with unpaid balance is recorded on the booking (feeds the reliability score) but never blocks the slot from being released.
2. All money math in integer PKR (or Decimal), never floats. Add tests: partial payments summing to the total, an over-payment being rejected, two owners recording at the same moment (use the same atomic-guard pattern as payment approval), and a cancelled booking's payments still appearing in the ledger.
3. **The Ledger screen is empty.** Find out why before changing anything (wrong venue scoping after Section 27? date filter? status filter excluding "booked"? loading state?). Then make the ledger the owner's real financial view:
   - One row per payment (not just per booking): date and time (12h), court, booking slot, player, method, amount, and running total.
   - Summary at the top: collected today, this week, this month, outstanding balances (money owed for booked slots not yet collected), and cancelled/refund-pending amounts.
   - Filters: date range, court, method, status. Breakdown by court and by day. CSV export includes the same columns.
   - Empty state only when there truly is no data, with a clear message.
   - Scoped to the selected venue (the multi-venue fix from Section 27 must still hold).
   - Owners must be able to make decisions from it (which court earns most, which days are weak, how much is still owed), so include a simple revenue-by-court and revenue-by-day view.

## Part 6: Photos and reviews

1. **Venue and court photo upload is missing in the owner UI.** Backend upload exists (`upload_public_photo`, `photo_urls`). Build upload in the wizard (venue photos, court photos) and in Venue Settings: pick from camera or gallery, compress client-side (max about 1600px), show progress, allow delete and reorder, set a cover photo, limit to a sensible count (for example 8 per venue and 5 per court). Web and mobile. Photos render on the venue page and court cards (Section 29 Tier 2 already renders `photo_urls`, so verify against the real bucket and CloudFront URLs).
2. **Reviews are missing for players.** Backend has a reviews table but the flow is dead end to end. Build: after a booking is completed (or its time has passed), the player sees "Rate your game" (1 to 5 stars, optional comment, one review per booking, editable within 7 days). Show average rating and review count on venue and court cards and list reviews on the venue page (newest first, player first name only). Owner sees their reviews and can post one public reply. Admin can hide a review. Keep it simple and abuse-resistant: only players with a real completed booking can review.

## Part 7: OCR (payment screenshot) improvements

1. Extract and return, in addition to amount, reference and time: **payer name**, **bank or wallet name** (JazzCash, Easypaisa, HBL, Meezan, etc.), and receiver name/account tail if visible. Store them in the payment row.
2. **Compare and show the result to the owner** on the approval card, as plain-language checks with a tick, warning or cross:
   - Amount matches the amount due now (or the advance)?
   - Payer name vs the name on the player's account: "Name on screenshot: Ali Raza. App account: Ali R. Looks like a match / Does not match." Use tolerant matching (case, order, initials, common spelling variants, Roman Urdu spellings) and never auto-reject on name alone, since people pay from a family member's account. Name mismatch is a warning, not a failure.
   - Time on screenshot vs booking time: is the payment time within a sensible window of when the hold was created (not before the hold, not hours stale)? Show the screenshot time in 12h PKT and where it came from.
   - Receiver matches the venue's bank details (if the owner entered them).
   - Duplicate image or reused reference (existing perceptual-hash checks keep working).
3. **Make the vision prompt strict.** Rewrite it: return JSON only in a fixed schema, use `null` for anything not clearly visible (never guess), separate "visible in image" from "inferred", report confidence per field, and flag images that are not a payment receipt, are cropped, are edited/screenshots of screenshots, or show a failed/pending transaction. Add a few fixture images (synthetic receipts plus messy ones) and tests. I asked earlier that OCR quality be checked on messy JazzCash/Easypaisa screenshots, so tell me honestly what accuracy you see.
4. Auto-approve stays gated as it is today. The name and time checks only add information for the owner.

## Part 8: WhatsApp chat and Gemini prompts

1. **The WhatsApp bot literally says the word "button" (for example "please tap the button below" or "click the Yes button")** and sometimes the user sees no button. Buttons must only be SENT as real interactive buttons, and the text must never mention buttons, tapping or clicking. Write the copy so it works with or without buttons ("Shall I book it? Reply Yes or No" is fine as the fallback text only when the interactive send fails). Strip those phrases in code as a safety net and add a test.
2. **Read the Gemini logs and the `messages` table from the beginning** (RUNBOOK section 4; hand me the exact SSM commands if reads are blocked). Produce a short findings list: recurring failure patterns, 24h/UTC times, wrong dates, loops, tool errors, `MAX_TOOL_ITERATIONS` hits, replies that ignore the venue's real hours, markdown `**bold**` leaking into WhatsApp (WhatsApp uses `*bold*`), and any place the model asked something it should already know.
3. **Rewrite the system prompt properly** (`build_system_prompt(now)`), in a senior, professional way:
   - Persona: polite, brief, warm, professional. Works for a guard, a student and a CEO. Short sentences, simple words. Replies in the player's language: English, Urdu, or Roman Urdu, matching how they write.
   - Always: 12-hour PKT times and human dates, copied from tool `label`s, never computed by the model.
   - Booking flow order: sport/area, court, date, start time, **duration**, then confirm with a summary (venue, court, date, time, duration, total, advance due now, balance due at venue), then payment instructions, then screenshot request.
   - Never invents availability, prices or venues. Only states what tools return. Never says a slot is booked for someone unless the tool says so.
   - Never mentions buttons, UTC, internal IDs, tool names or "Venue 0" style placeholders. No markdown that WhatsApp can't render.
   - Handles: "nearest court", "cheapest after 8 PM", "tomorrow evening", "aaj raat", "kal subah", and asks one question at a time when something is missing.
   - After a failure it tells the player plainly what happened and what to do next, never "I'm having trouble completing that" without a next step.
4. Add a small conversation test suite (English, Urdu, Roman Urdu, including "yes", "haan", "nahi", "1 ghanta", "2 hours") that runs against the real Gemini model locally and checks: no 24h times, correct dates, duration asked, no mention of buttons, no UTC.
5. Fix while there: retrying deterministic Meta 4xx errors three times in `WhatsAppService._send` (do not retry 4xx except 429), and the inner catch-all for unhandled 500s so they return the JSON error envelope with CORS headers (open items 2 and 8 in the handoff). These two are small and they have misled us before.

## Order of work and how to report

1. First, before writing code: reply with (a) the findings from the production logs and DB for Parts 1, 2 and 8, (b) your written plan for Parts 3 and 5, and (c) any place where my request conflicts with something already built (for example the Section 31 reversal). Wait for my go-ahead on migrations.
2. Then implement in this order: Part 1 and 2 (display and date bugs), Part 4, Part 3, Part 5, Part 7 and 8, Part 6. Commit in small, separate commits per part.
3. Use real Postgres, run the full test suite (`AI_PROVIDER=claude AI_VISION_PROVIDER=claude`) and `alembic check`, and live-test on the web build with Playwright and the mobile web target. Show me before/after screenshots for the time format, the schedule grid (including an overnight court), the ledger, and the split-payment flow.
4. Update README.md, both `CLAUDE.md` files (new Section 32 entries, including the venue-level cancellation reversal), and RUNBOOK.md if log-reading steps change.
5. Deploy only after I approve, and read the migration output. Report in plain English, short, and list anything you decided without asking.

## Acceptance checklist (every item must be demonstrated, not assumed)

- [ ] No 24-hour time or ISO date anywhere a player or owner can see, including AI and WhatsApp replies.
- [ ] Court set to 6 AM to 11 PM shows exactly those slots (no "21", no closed hours as available).
- [ ] A booking for the 23rd shows the 23rd everywhere.
- [ ] "Notify me" never appears on my own booking or hold; "Venue 0" is gone and explained.
- [ ] A 3 PM to 3 AM court and a 6 PM to 6 AM court can be created, priced, viewed and booked across midnight.
- [ ] Slot length and pricing are set per court; cancellation policy is set per venue.
- [ ] Booked slots are marked booked; closed times are not shown as available.
- [ ] Player picks a duration and sees the correct total before confirming (web, mobile, WhatsApp).
- [ ] PKR 400 advance on a PKR 3,500 booking, then PKR 3,100 recorded by the owner, ends "Fully paid" with a full audit trail; over-payment rejected.
- [ ] Ledger shows payments, totals, outstanding balances and revenue by court and by day, and it is not empty when data exists.
- [ ] Owners can upload venue and court photos; players can leave one review per completed booking.
- [ ] OCR returns payer name, bank, time and shows name/time/receiver checks to the owner with a strict, tested prompt.
- [ ] WhatsApp never says the word "button"; real interactive buttons are sent.
- [ ] Gemini log findings delivered; prompt rewritten; conversation tests pass.
</pasted_content id="0052">
