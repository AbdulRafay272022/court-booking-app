# Khelo mobile app, "Floodlight" redesign: design source of truth (v5, all screens)

Approved direction (24 Oct 2026): the Floodlight layout, in the website colours.
- Brand: the approved website brand in `design/khelo-website/khelo-website-design/`. Fonts are Bricolage Grotesque and Plus Jakarta Sans. Colours are night `#0C1F1D`, teal `#0E7C74`, orange `#FF6A2B` and ground `#F4F6F5`.
- Read first: `khelo-design-research-2026-10.md` (research, colour rationale, state model, hypotheses).

## Role colours (same split as the website)

| | PLAYER side = ORANGE-led | OWNER side = GREEN (teal)-led |
|---|---|---|
| Primary button | `#FF6A2B` bg + ink `#0C1F1D` text | `#0E7C74` bg + white text |
| Active tab | orange pill, ink icon/text | teal pill, white icon/text |
| Selected chip/court/day | `#FFE7DB` bg, 2px `#FF6A2B` border, ink text | `#E3F4F1` bg, 2px `#0E7C74` border, `#0A5F59` text |
| Hero | night `#0C1F1D` (photo/glass on top) | gradient `linear-gradient(165deg,#0E7C74 0%,#0A5F59 55%,#0C1F1D 100%)`, white text |
| FAB | (none) | teal `#0E7C74`, white +, shadow `rgba(14,124,116,.4)` |

On the owner side orange appears only as a tiny accent: the notification count badge and the "now" line in the timeline, always with ink text. On the player side teal appears only for info and links (`#0A5F59` on `#E3F4F1`).

## How to read a `.dc.html` file
These use the same format as the website design.
- The markup with inline `style="..."` IS the design: layout, spacing, colours, radii and copy.
- `{{name}}` holes are filled by the `renderVals()` script at the bottom. The values there are SAMPLE DATA, never real data.
- `<sc-for>` is a loop and `<sc-if>` is a conditional. Ignore `support.js` and `<x-dc>`; they belong to the design tool.
- Each board holds 1 to 4 phone frames, each 390 pt wide.
- Frames are drawn FULL LENGTH, so nothing is cropped. On a real phone the content scrolls and the floating bars stick to the bottom.

## File → screen map
Route paths marked "(map)" must be matched to the existing route by the CLI. Do not invent new routes.

### Player (orange)
| File | Frames | Screen / route |
|---|---|---|
| PAuth.dc.html | Login · Sign up (Player/Owner toggle) · OTP | `app/(auth)/*` (map) |
| Main.dc.html | Home | `app/(player)/(tabs)/index.tsx` |
| PSearch.dc.html | Results (List/Naqsha) · Filters sheet · No results | search route (map) |
| Venue.dc.html | Venue + slot picker + confirm sheet (interactive) | `app/(player)/venue/[slug].tsx` |
| Pay.dc.html | Pay (countdown, bank copy, screenshot) | `app/(player)/booking/[id]/pay.tsx` |
| Status.dc.html | Waiting → Booked + QR ticket (interactive) | `done.tsx` / booking status |
| PChat.dc.html | Chat inbox tab · Booking chat (hold card, screenshot bubble, quick replies) | chat tab + thread (map) |
| PBookings.dc.html | Bookings tab · Booking detail ticket · Cancel sheet | bookings tab + `booking/[id]` (map) |
| PAccount.dc.html | Profile tab · Notifications · Edit profile | profile tab (map) |
| PStates.dc.html | Skeleton · Error (retry + back) · Offline banner · 404 | shared components |
| VenueCard.dc.html | Shared VenueCard: photos auto-scroll (all venue photos), "Amenities" chip → hover popover (web) / tap sheet (phone), web card grid, rules | every venue list card, app + web (see venue-card-photos-amenities-prompt.md) |

### Owner (green/teal)
| File | Frames | Screen / route |
|---|---|---|
| OwnerToday.dc.html | Aaj (hero, chips, timeline) | `app/(owner)/today.tsx` |
| Approvals.dc.html | Approvals (Chahiye vs Screenshot, duplicate warning) | `app/(owner)/approvals.tsx` |
| OSheets.dc.html | Booking detail sheet · Reject sheet · "Booking adhoora?" | owner sheets (map) |
| OWalkin.dc.html | Walk-in form · Check-in QR scan + manual code | walk-in / check-in (map) |
| OPaisa.dc.html | Ledger · Refunds · History | ledger routes (map) |
| OwnerMore.dc.html | "Aur" menu | `app/(owner)/more.tsx` |
| OGrowthTeam.dc.html | Growth heatmap + ideas · Reviews · Staff permissions · Premium | growth/reviews/staff/premium (map) |
| OSettings.dc.html | Settings hub · Courts & pricing · Timers | settings routes (map) |
| OWizard.dc.html | Setup step 1 (venue + map pin) · Step 2 (courts + CNIC) · Pending · Rejected | owner onboarding wizard (map) |
| OStaffView.dc.html | Staff limited view (Check-in + Walk-in only) · "Ijazat nahi" | staff mode (map) |

### System
| File | Use |
|---|---|
| System.dc.html | Tokens, slot states, contrast table, rules |
| ColorLab.dc.html | Palette comparison (A = the chosen one) |

## Hard rules
1. Orange `#FF6A2B` buttons always use ink text `#0C1F1D` (5.98:1). White on orange fails (2.86:1) and is banned. Use one orange action per player screen.
2. Teal `#0E7C74` buttons use white text (5.06:1). `#E3F4F1` text on teal fails (4.45), so use white. Teal text on a teal tint uses `#0A5F59`.
3. Small text is never `#8A9996` (2.97). Use `#4A5D5A` or `#5B6E6B`.
4. Never show "confirmed" or "Court aap ka hai" unless the backend status is `booked`. The honest journey is Hold → Screenshot bheja → Venue check → Pakki ✓.
5. Slot states are never colour-only: use a tick + outline, strikethrough, or a dashed border (see the System board).
6. Glass (expo-blur) only on floating bars and on buttons over photos or dark heroes. Fall back to solid on low-end Android or when reduce-transparency is on.
7. Nothing cropped:
   - Use grids and wrapping. Never put "…" on money, time, names or phone numbers.
   - Test at 320 pt width and with large font.
   - Tap targets must be ≥ 44 pt.
8. Copy is Roman Urdu first (English terms allowed), matching the live website. Keep an EN toggle.
9. Real data only. Do not invent ratings, photos, discounts, policies or availability. If data is missing, show the empty state.

10. Venue cards everywhere: photos auto-scroll (3.5 s, only visible card, pause on touch/hover, off with reduce-motion), amenities as ONE "Amenities [n]" chip with the full list on hover (web) or tap (phone).

Checked before delivery (scripted):
- All inline text colour pairs are ≥ 4.5:1.
- No tap target is under 44.
- There is zero white-on-orange.
- No orange primary action appears on the owner side.
