# Khelo: Owner Round 2 FINAL (the owner's spec, Stage 1 + Stage 2)

Start from local `main` (3b45851 or later). Branch `feat/owner-round2`. Merge to local `main` at the end of each stage. DO NOT push. Report in Roman Urdu.

ALREADY DONE (do not redo): push-token diagnosis + FCM "sent" logging fix, mobile Details/History links + bell badge, Roman Urdu "Arena 1 ka" parser fix, frozen-clock chat tests, docs/web-push-plan.md. Baseline tests: backend 1399, web unit 52, types 60, Expo-web e2e 16.

## 0. Hard rules
1. STAGE 1 = no migration at all (no change in `alembic/versions`). STAGE 2 starts ONLY after the owner writes "Migration-Go".
2. Production is read-only (SELECTs, logs). Never print secrets, tokens, CNIC numbers, full phone numbers.
3. All text in the web dictionaries (`apps/web/messages/{ru,en}/<namespace>.ts`; ru = Roman Urdu, never Urdu script); owner side polite ("karein"); key-parity test stays green.
4. Colour never the only signal; 44px targets; existing design tokens (ink #0C1F1D, orange #FF6A2B with ink text, teal #0E7C74).
5. Every web change that exists in the Expo owner app gets the mobile version too (card list, bottom sheet, pinch zoom). Do not run EAS. MOBILE PARITY IS MANDATORY for every item (A1-A12, B1, CNIC). Where the Expo app has no such screen yet (owner Settings for advance payment / reminders / hold timers, onboarding steps incl. CNIC, the notifications list behind the bell), BUILD it in the same design language using the same API and the same shared logic (schedule preview function, advance-example calculator, refund breakdown) so web and mobile cannot disagree. Exception: Web Push (browser only; mobile uses FCM): make sure FCM push covers the same events as the bell. Final report needs a table item -> web Done/Partly/Gated | mobile Done/Partly/Gated for EVERY item.
6. Tests for every item; full backend suite, web unit, types, tsc, e2e (web + Expo-web) before each merge.
7. If a requirement needs a column/table that does not exist, do not build that piece in Stage 1: exact schema in the report, continue.

## 2. STAGE 1 (no migration)

### A1. Approvals page: ALL pending approvals as a list, newest first
Today one card at a time. Wanted: vertical list of every payment waiting for approval, latest submitted on top; header "N approvals baqi". Approve/Reject acts on that card; the card leaves; the others stay in place (no reload, no jump). 15s polling keeps working; URL date/court filters and "Sab dikhao" stay; "Aur dikhao" if > 50 (server pagination). Each card: player, sport + court, the booking DATE and time ("Aaj"/"Kal"/"Sat, 24 Oct", 9:00 - 10:00 PM; date is missing today), expected vs OCR-read amount (chip), screenshot thumbnail (A3), Details, "History mein dekhein", Approve, Reject. Mobile same.

### A2. Popups close when they navigate
"History mein dekhein", "View original booking" and every link inside BookingDetail close the popup first, then navigate. History page scrolls to and highlights the target row (does not re-open a popup) and shows "Sirf ye booking dikhayi ja rahi hai - Filter hatayen". Applies to Approvals, Refunds, Overview, bell.

### A3. Screenshots: thumbnail + proper lightbox
Problems: opens huge/full width, "-" cannot zoom back, Approvals screenshot not clickable. Wanted: thumbnail inline (max ~160px high, contain, rounded, caption "Bara karke dekhein") in Approvals card, BookingDetail, Refunds, History detail. Lightbox opens FIT-TO-SCREEN, buttons "-", "+", "Fit", wheel + pinch zoom, drag-to-pan when zoomed, min zoom = fit, max 4x, Esc/Close/outside click, focus trap, page behind does not scroll; refetch signed URL once on expiry. One shared component web, one mobile (full-screen sheet).

### A4. "Channel" (Zariya)
Find how channel is decided in code and list all values. Every value gets a human label (en + Roman Urdu): WhatsApp chat, App chat, Website, Owner ne khud add ki (walk-in), Staff ne add ki. UI label "Zariya (booking kahan se shuru hui)". Report the rule in simple Roman Urdu. Change logic only if wrong.

### A5. Player cancels while payment awaits approval
Today: card stays, Approve says "no longer awaiting payment review", Reject asks a reason and sends it to the player (wrong). Wanted: card turns grey with chip "Player ne cancel kar di" (icon + text); Approve/Reject replaced by one "Theek hai" button; owner or staff click -> card disappears and badge drops; who/when saved in audit_log. If the player had sent a screenshot: two buttons "Paisa nahi aaya - Theek hai" / "Paisa aa gaya - Refund banayein" (use the existing refund-owed path; if impossible without schema change, only "Theek hai" and report). Backend: approve/reject on cancelled/expired booking returns a clear state, never asks a reason, never messages the player. Visible card updates in place on polling. Tests: cancel after screenshot, approve-after-cancel, reject-after-cancel.

### A6. Bell: readable notifications
Replace "New notification" with a sentence + context + link ("Naya payment approval ke liye - Abbas Zafar - Futsal 1 - Aaj 9 PM - PKR 2,000" -> opens Approvals/booking). Event types: payment waiting approval, approved/rejected, player cancelled, refund owed, refund sent, new booking, slot freed, daily summary, venue approved/rejected. Build text from related booking/payment ids; fallback map template-name -> readable title (en/ru); never show "New notification". Delivery as small muted text ("WhatsApp par bheja gaya" / "SMS par bheja gaya" / failures muted); same event via WhatsApp then SMS = ONE row. Group by day; unread dot, "Sab parh liye", "Browser popups" section with a one-line explanation. Report in simple Roman Urdu why some go WhatsApp and some SMS. If rendering needs a missing column (payload), do not migrate: render what is derivable and list the gap for Stage 2.

### A7. Overview cards (overrides the earlier design for these cards)
Remove "Free slots" and "Booked slots" cards. "Total slots" card carries: total, stacked bar, legend Booked / Pending / Blocked / Free (each a 44px button), sub-line "Khali: X aane wale - Y guzre hue", court breakdown (top 2 + "+N aur"). Legend: Booked -> History (that date, booked); Free -> slots popup filtered to free; Pending -> Approvals. Move "Pending bookings" next to Total (top row, orange tint). Second row: Bookings, Cancelled, Refunds, Collected, Due.
Pending bookings = ALL bookings currently pending (held + payment submitted) for ANY date, subtitle "Sab dino ki", split "Approval (N) - Payment ke intezar (M)"; card -> Approvals without date filter; M -> History status held, no date filter. The Pending inside the Total bar stays date-based (that day's slots) with tooltip "Is din ke slots"; invariant Total = Booked + Pending + Blocked + Free stays tested via one shared function. The two pending numbers must be clearly labelled so they cannot be confused. Mobile same.

### A8. "Nahi / short paid" semantics
Bug: the entered amount replaces total paid (negative correction). Wanted: field "Baqi mein se kitna mila? (PKR)", default 0, range 0..Due. Save adds a POSITIVE payment entry: due = due - entered, total paid = paid + entered; never lowers total paid. Live line "Save karne par Due PKR X rahega." If entered = Due -> treated as Haan (Mukammal). Reason required only if Due remains > 0. Tests: total 4,500, advance 2,000: 1,000 -> paid 3,000, due 1,500, Adhoora; 2,500 -> paid 4,500, due 0, Mukammal; 0 + reason -> unchanged. Mistakes via existing correction flow. BookingDetail history: "Baqi se PKR X mila" with who/when. Mobile same.

### A9. Voice to text (FREE ONLY, Roman Urdu, listens until stopped)
Tap mic -> listens continuously (no auto-stop on pauses) -> tap again to stop. Pulsing red dot + timer + "Sun raha hoon... dobara dabayein to ruk jayega". Text stays editable. Output Roman Urdu (Latin letters) only.
FREE ONLY: no paid API, no Gemini, no server-side transcription, no audio upload.
1. Web Speech API (ur-PK; fallback en-IN), continuous=true, auto-restart on onend while the toggle is on, interim text live, then convert Urdu script -> Roman Urdu with a rule-based transliteration (client or backend, no paid API).
2. NO "AI se behtar likhein" button and NO /voice/transcribe endpoint. Roman Urdu correction layer: word list of common booking words (baqi, paisa, kal, aaj, hazaar, sau, advance, court, mila, dega, wapas ...) and Urdu number words -> digits ("do hazaar paanch sau" -> 2500). Text always editable.
3. Measure on >= 15 phrases ("customer ne kaha baqi paisa kal dega", "do hazaar mile baqi paanch sau rehte hain", mixed English): report accuracy and which kinds fail.
4. No Web Speech (Firefox) -> hide the mic and show "Voice ke liye Chrome ya Edge istemal karein, ya keyboard ka mic". Mic permission denied -> clear message.
Mobile: phone keyboard mic only (free). No expo-av, no new permission. Hint under the field: "Keyboard ke mic se bolein". Used in (web): completion reason, reject reason, cancel reason.

### A10. Refund flow
Screenshot case: "Mark refund as sent", amount 10000 typed, error "That's more than what's owed on this booking", header "remaining PKR 0 of PKR ...".
1. Read-only prod investigation of "Mujtaba Anwer" (Padel 1) and "Abbas Zafar" refund: payment entries, approvals, OCR amounts, refund records. Explain in simple Roman Urdu why the error appeared and what the player really sent (screenshot looked ~10,000 vs lower advance).
2. Redesign the dialog: breakdown card (Player ne bheje - Refund banta hai (policy) - Pehle wapas kiye - Ab baqi wapas dena); amount prefilled with the remaining, max = remaining, chip "Poora PKR X"; if remaining 0 -> no form, "Koi refund baqi nahi" + why; clear error "Aap ne 10,000 likha, lekin sirf PKR X wapas banta hai."; reference required (loose format check); screenshot optional; no double submit; partial refunds supported (status "Hissa wapas"); success summary.
3. Overpayment at approval: if OCR amount > advance required, Approve dialog shows banner + two choices: "Sirf 2,000 manzoor - baqi 8,000 wapas karna hoga" (default) / "Poora 10,000 manzoor (extra advance)". OCR is only a hint; owner decides. First report how backend handles overpayment today; if choice 1 needs schema change, report and skip.
4. Mobile same.

### A11. Advance payment settings (UI only; calculation unchanged)
Court setting: "Advance payment - [Default (from pricing) | Fixed amount | Percentage] - Percentage of total - Minimum advance (optional)". Report exactly (Roman Urdu): meaning of each option; precedence of percentage vs minimum; rounding; which amount a multi-slot booking uses; what "Default (from pricing)" resolves to; what happens if the owner sets NOTHING (exact value + source); other places advance can be set and which wins. Improve Settings AND onboarding wizard (parity test): plain labels, one-line help per option, live example from the court's real hourly price ("Court ka 1 ghante ka rate PKR 4,000 - 50% -> player abhi PKR 2,000 dega"), and visible "Agar aap kuch set na karein: ..." with the real default.

### A12. Remaining flaky tests
Other test files using `_future_day(5)` or weekday-dependent logic: freeze the clock (same 3 fixed times). Production code untouched.

### B1. Venue hold + auto-cancel timers (investigate in Stage 1; build in Stage 1 only if no schema is needed)
Every venue sets its own timers in Settings (and in onboarding wizard under "Advanced", pre-filled, wizard/settings parity). Time ENFORCED IMMEDIATELY, not "when a job runs":
- Report current behaviour: how long a slot is held before payment, what auto-cancels and when, which statuses, which job/cron/constants/env, what is shown to players.
- Settings (defaults = today's values): `hold_minutes` (5-180) and approval_wait: owner reminders (default on): `first_reminder_after_min` (default 10), `repeat_every_min` (default 30, min 5), `max_reminders` (default 5, 1-10); Settings card "Payment reminders" with three number boxes, an auto-cancel checkbox + minutes box (+ warning text), and a LIVE PREVIEW line ("Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel."); validate with clear Roman Urdu errors; same card in the onboarding wizard under "Advanced" (parity test); reminders through the existing owner notification channels, sent only during the venue's operating hours (a night reminder is sent when the venue opens); stop reminding the moment the owner acts or the player cancels. If auto-cancel is ON with Y minutes: send only reminders BEFORE Y, drop any at or after Y, add one final warning 5 minutes before Y ("5 minute mein ye booking cancel ho jayegi"; if Y <= 10 send it at half of Y). Example Y=30: reminder at 10, final warning at 25, cancel at 30 = 2 owner messages. Example Y=120 with defaults: reminders at 10, 40, 70, 100, final warning at 115 (final warning does not count toward max_reminders). Unit tests for the schedule function (defaults, custom values, Y smaller than first reminder, Y=0/off, night-time shifting); same function for the preview and the real scheduler. On auto-cancel: slot freed immediately, player and owner both messaged, bell row, and if a payment screenshot existed it appears in Refunds as "paisa wapas dena hai" for the owner to confirm. For plain holds (no screenshot yet) the owner gets no reminders; report whether the player is currently reminded before the hold expires, and if not, add one reminder to the player at 2/3 of the hold time. OPTIONAL auto-cancel after Y minutes (default OFF; warning that a real payment might exist).
- Immediate enforcement: (1) availability/slot queries treat any hold whose held_until <= now as FREE at read time; (2) a frequent expiry job (every minute or per booking) moves it to cancelled/expired, frees the slot, sends slot-freed + player message; (3) a payment screenshot arriving after expiry is handled clearly (owner sees it, player told); (4) UI countdown on held bookings. Chat messages use the venue's own number.
- If an existing venue settings JSON/column can hold these, build now. If not, exact schema in the report, leave to Stage 2.

### B2/B3. Stage-2 designs (write now, build later)
- CNIC (required): number (13 digits, mask 12345-1234567-1) + front and back photo; required in onboarding wizard and in Settings (parity); encrypted at rest (app-level encryption, key from secrets/KMS), photos in a private path with short-lived signed URLs, never in logs or list APIs; owner sees masked (*****-*******-1); only admin sees full, each admin view written to audit_log; one CNIC cannot be used by two owners (flag for admin). Existing owners: soft banner "CNIC dein" + admin list of owners without CNIC, no lock-out. Deliver exact schema, encryption approach, storage path, validation rules, admin screens.
- Web Push: docs/web-push-plan.md as is (check it still matches the code).
- ONE combined ordered migration plan (web_push_subscriptions, CNIC storage, venue timers if needed, notification payload if needed, anything from A5/A10 that needed schema) with risks and rollback, plus the exact RDS snapshot name.

## 3. Acceptance (QA verifies each)
Approvals shows N cards newest first with date; approve removes only that card - thumbnail opens a fit-to-screen lightbox that can zoom out to Fit - popup closes on every navigation - cancelled-by-player card is grey with "Theek hai" and no error text and no message to player - bell never says "New notification" - Overview has no Free/Booked cards, Pending beside Total, Pending counts any date - Nahi popup: 1,000 on due 2,500 -> due 1,500 and paid increases - mic keeps listening until tapped again and writes Roman Urdu - refund dialog never shows a confusing "more than owed" without the breakdown - advance setting shows live example and real default - hold expiry frees the slot immediately in availability queries.

## 4. Stage 1 final report (Roman Urdu), then STOP for "Migration-Go"

## STAGE 2 (only after "Migration-Go")
a) RDS manual snapshot of `court-booking-app-db`, name `khelo-pre-round2-YYYYMMDD-HHMM`, wait for "available"; on failure STOP. b) One additive Alembic migration from B3 with downgrade, proven up/down on scratch DB. c) Web Push, CNIC, venue timers if gated, gated A5/A6/A10 pieces. d) Tests, QA, merge to local main, no push. e) Report: snapshot name, revision id, post-deploy checks, push command; migration runs on production only when the owner says so.
