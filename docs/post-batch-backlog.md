# Post-batch backlog (queued work)

> **Status: QUEUED. Do not start any of this until the current Section 32 batch
> (Parts 5, 9, 10, 7, 8, 6, 11) is built, integration-tested, AND deployed.**
> Owner authored these; this file is the source of truth for their scope and
> wording. Sequence once the batch is live: **Part 12 first** (core
> infrastructure), **then the 8-item UI/UX backlog** (UI fixes). The owner
> invited a flag if the order should flip. Standing rules apply to everything
> here: its own branch, isolated scratch Postgres for any migration/live
> testing (never the shared dev DB), full suite passes for real, any migration
> tested upgrade→downgrade→upgrade with an `alembic check`, both frontends
> typecheck clean, live-verified, report with proof, and **nothing merges or
> pushes to `main` without the owner's explicit go** (a push to `main` deploys
> and runs migrations against production).

---

## 1. Part 12 — Admin control panel: global feature flags + owner staff/permissions

> **QUEUE ONLY — DO NOT START YET: New part after the current batch ships.**
> A new part, built and verified on its own branch (`section-32-part-12`, or
> renumber it if tracking it under a new section) — only after Parts 5, 9, 10,
> 7, 8, 6, 11 are all built, integration tested, and deployed. Do not start
> this early and do not mix it into any branch already in flight. Once the
> current batch is live, build this **before** the 8-item post-batch UI/UX
> backlog (this is core infrastructure; those are UI fixes) — flag it to the
> owner if the order should flip.

**GOAL:** An admin control panel with two layers — global feature switches, and
a per-owner staff/access system — so behavior can change app-wide or per-court
with no code deploy.

### LAYER 1 — Admin: global feature flags

Build the panel generically (a table/config keyed by feature name + boolean,
read at the point of use everywhere that feature triggers — not hardcoded
if-branches sprinkled through the codebase) so adding a new toggle later is
cheap. Then wire up every one of these as a real, working flag from day one —
each a true kill switch with an explicit, sane fallback behavior, no dead ends,
no broken screens when OFF:

1. **AI OCR payment verification (Part 7).** OFF → owner manually reviews every
   payment screenshot and approves/rejects by eye, no auto-extraction, no
   auto-approve, no computed verdicts — same as before Part 7 existed.
2. **QR check-in (Part 9).** OFF → the whole QR scan/generate flow disappears;
   check-in falls back to the owner manually marking a booking as checked in /
   no-show from their dashboard.
3. **Split payments / `payment_entries` ledger (Part 5).** OFF → bookings go
   back to the single full-payment flow this app had before Part 5 — no partial
   payments, no ledger entries, no split-payment UI shown to players.
4. **Manual refunds (Part 10).** OFF → the refund/cancellation UI is hidden;
   cancellations revert to whatever this app's original policy did before Part
   10, and any refund-marking screens for owners disappear.
5. **WhatsApp / AI chat booking assistant (Part 8's AI messaging flow — the
   "message the court, AI asks if you want to book" flow).** OFF → players can
   only book through the app's normal screens; the AI-driven chat booking flow
   is disabled app-wide (WhatsApp business messaging itself can stay up for
   support, but the AI "do you want to book" automation turns off).
6. **In-app booking chat (direct player ↔ owner chat tied to a slot/booking,
   separate from the AI assistant).** OFF → chat is hidden; players and owners
   fall back to whatever contact method existed before in-app chat (e.g. a
   phone number / WhatsApp link shown instead).
7. **Photos and reviews (Part 6).** OFF → court listing pages stop showing the
   photo gallery and review/rating sections; venues display with just their
   core info as they did before Part 6.
8. **Slot-pattern / discount-suggestion engine (the system that detects
   under-booked slots and prompts an owner to add a discount there).** OFF →
   the pattern analysis stops surfacing suggestions to owners; no behavior
   change for players.
9. **Push notifications (booking confirmed, payment approved, slot became
   available again, etc.).** OFF → in-app/WhatsApp notifications for that event
   stop sending; the underlying booking/payment logic is unaffected, only the
   notification side effect is suppressed.

For each flag, before building it: **confirm what the actual "OFF" fallback
behavior should be by checking what existed immediately before that feature was
built** (git history / the plan doc's earlier state), don't guess or invent a
new fallback behavior. If a clean fallback doesn't obviously exist for one of
these (e.g. going back to "before Part 5" might be messy if bookings already
have split-payment data), **stop and report that to the owner rather than
building a half-working toggle.** If there are other major features in the
codebase not listed above that this panel should obviously also cover, **list
them for the owner** rather than silently adding or silently skipping them.

Flags apply immediately (or on next relevant request) — **no app restart, no
redeploy needed to flip one.**

### LAYER 2 — Owner: staff/manager accounts with per-feature access

- Owners can add additional users ("staff" or "manager" — pick the clearer term
  for this codebase's existing role model) scoped to their own court(s) only. A
  staff account can log in and act, but never sees or touches another owner's
  courts.
- For each staff account, the owner gets a permissions screen listing every
  action currently exposed by the ON flags above (a staff account can never be
  granted something the admin has globally switched off) plus existing
  owner-only actions (approve payments, check in players, edit court settings,
  respond to reviews, etc.), each with an individual on/off toggle per staff
  member. Example: owner lets one staff member do check-ins but not approve
  payments, and vice versa for another.
- **Enforce this on the backend (API-level) for every gated action, not just
  hidden UI — a hidden button is not access control.**
- Data model: figure out whether this extends the existing User/role system or
  needs a new table (something like `staff_permissions` linking a staff user →
  owner's court → a set of allowed actions). **Propose the schema before writing
  the migration and get the owner's sign-off on the shape**, since this touches
  auth and will be awkward to change later.

### QUESTIONS TO RESOLVE BEFORE BUILDING (ask the owner, don't assume)

1. Can a staff account be shared by multiple owners (e.g. a manager working
   across two different courts under different owners), or is a staff account
   always tied to exactly one owner?
2. Does a staff member log in through the same owner-side app/login as the
   owner, just with a reduced view, or is there a separate staff login entry
   point?
3. Should removing/deactivating a staff member immediately kill any of their
   active sessions, or is it fine if they stay logged in until the token
   naturally expires?
4. For flags 3 and 4 (split payments, refunds) — if a booking already has
   split-payment or refund data when the flag gets switched OFF, should that
   existing data stay visible/intact (view-only), or does OFF only affect new
   bookings going forward? Don't assume; this affects the data model.

### STANDING RULES (same as every other part)

- Its own branch, real local backend testing, isolated scratch Postgres for any
  migration/live testing — never the shared dev DB.
- Full test suite must pass for real. Any migration tested upgrade → downgrade →
  upgrade with an `alembic check` for drift.
- Both frontend apps typecheck clean. Live Playwright (web) + Expo web
  verification of the admin flag panel AND the owner staff-permissions screen,
  plus a spot-check that flipping each flag OFF actually produces the stated
  fallback behavior in a real running app — before calling it done.
- Report back with proof before the owner decides anything about merging.
- Nothing merges or pushes to `main` without the owner's explicit go — pushing
  to `main` deploys and runs migrations against the production DB.

---

## 2. Post-batch UI/UX backlog (8 items)

> **QUEUE ONLY — DO NOT START.** Do not touch any of these 8 items until the
> full current batch (Parts 5, 9, 10, 7, 8, 6, 11) is built, integration
> tested, and deployed. When that batch is done and the owner gives the
> explicit go for this backlog, work through the 8 items exactly as scoped
> here. Comes **after Part 12** above.

1. **Venue Settings — add/delete court actions** (reuse the venue-setup
   wizard's court fields; delete needs confirmation; verify current
   `DELETE /courts/:id` deactivate behavior before wiring UI to it).
2. **Bug — Venue Settings court filter shows zero courts** for a specific court
   while "all courts" works. Root-cause the actual scoping/ID bug, don't paper
   over it.
3. **Remove or condition the stale "no courts currently" placeholder** copy
   still shown to real players despite Maidan Court being live — find its exact
   source.
4. **Fix image upload progress exceeding 100%** — find the real percent
   calculation bug, not a clamp/hack.
5. **Calendar-first venue page redesign.** FIRST determine whether the missing
   day-state dots are a rendering bug (backend returns real data, frontend
   doesn't draw it) or genuinely empty schedule data for that court — report
   which before touching anything. Then do a real design pass (color, type,
   spacing, day-state dots, week-strip pills, slot-list rows/scrollbar) without
   changing the calendar-first interaction model itself. Before/after
   screenshots required for the owner's approval before shipping, same as the
   original Part 4b mockup step.
6. **My Bookings — add date to every booking card** (both tabs, both
   platforms), e.g. "Thu, 24 Sep · 6:00 PM to 7:30 PM".
7. **My Bookings — colored status icons** matching each status's existing text
   color (CONFIRMED green check, WAITING FOR APPROVAL amber clock, CANCELLED
   red/negative-color X, NO SHOW its own distinct icon proposed for the owner's
   approval, any other state in the machine gets the same treatment — none left
   icon-less).
8. **Investigation only** — reproduce Court 101's calendar and the "How long do
   you want to play?" duration picker, fresh screenshots, plain-terms
   description of what's actually rendering in each. Do not guess at or scope a
   fix until the owner confirms what they meant by "why showing only 2."

**Same standing rules apply to all 8:** one branch per item, real local backend
testing, no shortcuts, report back per item with a before/after summary, and
nothing merges or pushes to `main` without the owner's explicit go.
