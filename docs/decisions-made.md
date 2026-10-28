# Decisions made without asking (audit build, 2026-10-28)

The brief said: when something is unclear, pick the safest option, write it here, continue. Each line: what, why, how to change it.

| # | Item | Decision | Why |
|---|---|---|---|
| 1 | P1.2 venue visibility | A pending/rejected/deleted venue's PUBLIC page (web server render has no login) is now a 404 even for its owner; the owner still sees it in the dashboard, status screen and walk-ins (those calls carry the token). | Never leak a hidden venue; the owner has every other surface. |
| 2 | P1.4 booking detail | The detail view is the existing `/booking/{id}/done` page (web) and status screen (app), extended, not a new route. Every card opens it for every status; held bookings still have the "pay" button there. | One detail page per platform, no duplicate screens. |
| 3 | P1.4 timeline | The player's timeline never shows staff names (who at the venue approved / marked what). | Venue-internal information. |
| 4 | P1.6 photos | Public venue REVIEWS keep showing only the first name and an initial, no photo; chat bubbles stay without avatars (Floodlight design). The photo is shown in the web header + profile menu, account hub, app home header + profile tab + owner "More", owner/staff booking rows, overview table, booking detail (web + app) and approvals (web + app). | Reviews are public: a face next to a first name is a privacy step the founder did not ask for. |
| 5 | P1.10 refund for a cancelled payment_submitted booking | NOT created automatically. The existing owner step stays the correct entry: the greyed card on Approvals has "Paisa aa gaya - Refund banayein", which creates the refund row for the screenshot amount once the owner sees the money in the bank. | An automatic row would put money that may never have arrived on the Refunds list. |
| 6 | P1.10 cash-paid booking cancelled | Needs `payment_disputes.payment_id` nullable (a cash booking has no payment row). Done in Phase 2 item 3 (migration). Phase 1 only stops the false "refund owed" notice. | Brief: schema changes go to Phase 2. |
| 7 | P1.12 Roman Urdu | Translated the owner dashboard words the audit flagged (nav, KPI labels, statuses, buttons, check-in copy, payment-check sentences via a new `text_ru` from the backend). Kept as is on purpose: loanwords Pakistanis use as they are (Booking, Court, Player, Slot, Total, Advance, Refund, Check-in, Staff, Premium, Reviews), the admin console (English-only by design), and the Terms/Privacy bodies (legal text, needs a lawyer before translating). | Audit B6/B7/B8/B25/B29. |
