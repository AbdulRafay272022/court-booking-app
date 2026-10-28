# Decisions made without asking (audit build, 2026-10-28)

The brief said: when something is unclear, pick the safest option, write it here, continue. Each line: what, why, how to change it.

| # | Item | Decision | Why |
|---|---|---|---|
| 1 | P1.2 venue visibility | A pending/rejected/deleted venue's PUBLIC page (web server render has no login) is now a 404 even for its owner; the owner still sees it in the dashboard, status screen and walk-ins (those calls carry the token). | Never leak a hidden venue; the owner has every other surface. |
| 2 | P1.4 booking detail | The detail view is the existing `/booking/{id}/done` page (web) and status screen (app), extended, not a new route. Every card opens it for every status; held bookings still have the "pay" button there. | One detail page per platform, no duplicate screens. |
| 3 | P1.4 timeline | The player's timeline never shows staff names (who at the venue approved / marked what). | Venue-internal information. |
| 4 | P1.6 photos | Public venue REVIEWS keep showing only the first name and an initial, no photo; chat bubbles stay without avatars (Floodlight design). The photo is shown in the web header + profile menu, account hub, app home header + profile tab + owner "More", owner/staff booking rows, overview table, booking detail (web + app) and approvals (web + app). | Reviews are public: a face next to a first name is a privacy step the founder did not ask for. |
