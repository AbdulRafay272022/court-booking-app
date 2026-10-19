# Round 2 Stage 2 + small fixes + no-show fix: the owner's instructions (Migration-Go given)

Branch: from main, `feat/round2-stage2`. Do not push. Report in Roman Urdu. Do NOT run the migration on production (the owner says when, after the deploy check).

A. STAGE 2 DECISIONS
1. Defaults when the owner sets nothing (these ARE today's real values, nothing changes):
   - Hold: 15 minutes.
   - Payment screenshot not approved -> auto-cancel: ON, 120 minutes.
   - Reminders: first after 10 minutes, then every 30 minutes, at most 5 (+ a final warning 5 minutes before the cancel). The push that goes out the moment a screenshot arrives keeps going as today.
   - Auto-cancel default is ON 120 (not OFF). When the owner switches it OFF in Settings show: "Band karne par approve na hone wali booking ka slot band rahega."
   - Null (nothing set) always means these defaults.
2. EVERY setting shows its Default (web + mobile, Settings + onboarding wizard):
   - Small text under each field: "Default: 15 minute".
   - If the owner's value differs from the default: a "Default par wapas" link.
   - If nothing is set: a marker near the field "Abhi default chal raha hai".
   - Not only the new fields: audit ALL existing owner/venue/court settings (advance payment, hold, reminders, auto-cancel, pricing-related, notifications, walk-in, staff permissions, whatever exists). Show the default for those that have one. List those without a default in the report.
   - Advance payment: show the default that REALLY applies (if the split_payments flag is off, add the note "abhi poori raqam").
3. Drop bookings.channel (app vs website); not in the migration.
4. CNIC_HASH_KEY: give the exact command to generate it (openssl) and store it on the server (SSM parameter name). Never print the key value. The owner runs the command.
5. First take the RDS snapshot (khelo-pre-round2-YYYYMMDD-HHMM, instance court-booking-app-db), wait for "available", only then create the migration. If AWS permission is missing or the snapshot fails, stop and tell the owner.
6. Everything else per Stage 2 (docs/web-push-plan.md and the combined migration plan: web_push_subscriptions, owner_identity/CNIC encrypted, venue timer columns, notification_log.payload): Web Push, CNIC (wizard + Settings + admin view + masked display + banner + duplicate flag), venue timer enforcement and UI, notification payload, mobile parity, QA agent. Parallel worktree agents, contract file first, merge order Backend -> Web -> Mobile -> QA.

B. SMALL FIXES (no migration)
a) Approving a duplicate-flagged screenshot asks a separate clear confirm ("Ye screenshot pehle bhi X bookings par use hua hai. Phir bhi approve karein?"), and the backend enforces the same check.
b) A "my permissions" endpoint for staff so buttons are hidden up front for staff without permission (web and mobile).
c) Roman Urdu at 1280: "PKR 31,500" must not break onto two lines.
d) READ-ONLY report on Abbas's 2 open refunds (PKR 15,000 and PKR 450): which bookings, which screenshot was credited on how many bookings, and what the correct refund is. Change nothing.

C. NO-SHOW FIX (no migration)
Problem: the expiry job marks a booking no_show NO_SHOW_GRACE_MINUTES (60) after its start when nobody checked in. Owners do not check in, so every played match becomes no_show, public stats "bookings" falls (4 -> 2), and completed never happens.
1. Public stats: "bookings" counts booked, completed and no_show. Cancelled, rejected, expired, held, payment_submitted excluded. Update tests.
2. Stop auto no-show: the expiry job must not do booked -> no_show. The rest of expiry/hold keeps working. Update tests of this rule.
3. Owner by hand: after the slot ends, Overview/History show a "Status baqi" marker on the booking and two ways: Haan/Nahi (completion dropdown) sets the booking status to completed (not only the Mukammal/Adhoora chip), and a separate button "Nahi aaye (No-show)" with confirm. Both record who/when in audit_log (owner, or staff with "Record & correct payments" / check-in permission). Haan/Nahi must also work on bookings already no_show (no_show -> completed allowed), so the owner can fix old mistakes. Check allowed transitions; if booked->completed or no_show->completed is impossible without schema, stop that part and report.
4. Overview small line ("N bookings ka status baqi", clickable -> History filter) and that filter in History. The evening daily summary/notification gets the line "N bookings ka status baqi hai".
5. Do NOT bulk-change the old no_show bookings (~13). READ-ONLY list only: booking, player, court, slot, due or not.
6. Web and mobile both.

D. TESTS AND REPORT
Full backend suite, web unit, types, mobile unit, tsc, web e2e, Expo-web e2e, QA agent. Merge to local main, no push. Report: each item web and mobile status (Done/Partly/Gated), snapshot name, migration revision id, CNIC_HASH_KEY commands, the settings audit list (those without a default), Abbas refunds read-only report, the old no_show list, and what to check after deploy.
