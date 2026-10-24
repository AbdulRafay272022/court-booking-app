# Khelo design research and system ("Floodlight"), October 2026

Author: Claude (design research), for Abdul Rafay. Date: 24 Oct 2026.
Design canvas: "Khelo App Redesign" artifact (8 boards). Implementation is for Claude Code, through the normal contract + agents workflow.

## 1. What was actually inspected

| Source | How | Status |
|---|---|---|
| Live site `https://3.6.48.6.sslip.io/` home | Fetched page text | Inspected (structure and copy only, not visuals) |
| Approved website design `design/khelo-website/khelo-website-design/*.dc.html` (README says "build to match exactly") | Read tokens and fonts from source | Inspected |
| Owner design references `design/desgin/*.png` (Overview web + phone, Booking detail popup, "Booking adhoora?") | Viewed images | Inspected |
| Mobile app, 200 Expo-web screenshots + `docs/mobile-audit-2026-10.md` | Read report, viewed 12 key screens | Inspected |
| Other live web routes (search, venue, owner dashboards) | Not opened this round | **Not inspected visually** |
| Backend code | Not opened this round (only via earlier audit and project docs) | **Not inspected directly** |
| Competitor apps | Official sites, Google Play and App Store listings, help centres | Listings only; **no competitor app was installed or used** |

## 2. The existing Khelo brand (preserve and elevate)

From the approved website design source:
- Fonts: **Bricolage Grotesque** (display) + **Plus Jakarta Sans** (body).
- Colours: night/ink `#0C1F1D`, teal `#0E7C74`, orange accent `#FF6A2B`, ground `#F4F6F5`, muted `#4A5D5A` / `#5B6E6B`, lines `#CFD8D6` / `#DDE3E1`, mint `#3DDC97`, amber `#FFB020`, deep orange `#B83E00`.
- Owner designs use orange buttons with **dark text** ("Add booking", "Save karein") and teal status chips.
- Copy is **Roman Urdu first** with English terms ("Court dhoondo. Slot lo. Khelo."), with an EN toggle on web.

Finding: the mobile app does not use this brand today. It uses Figtree + warm orange `#EF5A2C` (player) and IBM Plex Sans + teal `#0E6274` (owner). Two apps look like two companies. **Decision: the mobile app adopts the approved website brand.**

## 3. Competitor research (verified facts only)

| Product | What was verified | Lesson for Khelo |
|---|---|---|
| On Spot (Karachi, padel/futsal/indoor cricket) | 3-step flow (find, check real-time availability + pay online, instant confirmation); tournament hub; vendor panel; venue discount badges up to 50–62%; 5K+ Android installs | Discounts and tournaments are the norm in Karachi; Khelo's growth engine (discount suggestions) is a real need |
| SportsNow (Karachi, Lahore, Islamabad) | Shows hourly rate, off-peak pricing and cancellation terms **before checkout**; venue-supplied slot calendar; owner dashboard with "which hours sell or sit empty" | Show money rules before pay. Owner "empty hours" view is table stakes |
| Janbaz (Karachi, cricket/futsal/padel) | "Next Available" widget; money-back guarantee; area SEO pages; venue cards use **initials instead of photos** and show no price | Next available time on cards = good. Initials instead of photos = weak (Khelo mobile has the same "D" problem) |
| Kheylo (Pakistan) | Owner analytics: revenue, bookings, occupancy, demand by half-hour; colour-coded monthly calendar; per-slot pricing; 4 ratings | Half-hour demand chart is a good owner pattern |
| Sporty (Karachi developer) | Directory-style: sort by distance/price/rating, maps directions, one-tap call; no in-app booking described | Sort + directions + call are expected basics |
| Poncho (poncho.pk) | Booking + matches + tournaments + loyalty points (new) | Loyalty is coming to the market |
| Groundify (Lahore, cricket first) | PayFast; **advance online, rest cash at ground**; 2.6% fee on online part; cancel up to 4 h before; refunds in 2 working days; free listing, payouts via JazzCash/Easypaisa/bank | Matches Khelo's advance model. State fee, cancellation window and refund time plainly |
| Turfy (goturfy.com) | 30-min grid; only shows times free for the **whole session length**; WhatsApp verification; marketing says "instant" but bookings are **requests the venue confirms** | Khelo already does full-length availability. Be honest where competitors overclaim |
| BookMySpot (bookmyspot.pk) | Directory, not booking: ~2,945 venues, ratings like "4.4 (84)", phone/WhatsApp contact; online booking "coming soon" | Breadth + reviews win discovery; booking is still unsolved in Pakistan |
| PlayPro (racket sports) | Booking, open matches, Americano/Mexicano tournaments; cash, PayFast, bank transfer; full or partial payment | Partial payment is normal for padel |
| Playtomic (global) | Flow: sport → location → date/time → court + duration → split or full payment with **club cancellation policy on the same screen** → review → pay | Gold-standard order of decisions; policy shown at the decision point |
| Playo (India) | 50+ sports, real-time slots, community/games, Karma points; reviews complain features are hard to find | Don't bury key actions behind social features |
| Hudle + Hudle Partner (India) | Split payment, reschedule, multi-day passes; owner app: occupancy dashboard by sport, payment links, staff, reports | Reschedule and occupancy views are worth planning |
| TurfBookPK | No product with this name found. "TurfBook" on Google Play is a Bangladeshi operator app (walk-in bookings, partial payments, verify/reject payments) | Unavailable as named |

**Name risk (verify before launch):** an App Store app named **"Khelo: Book, Play, Repeat!"** (CODEX LABS TECHNOLOGIES LLP) already targets Pakistan for venue booking, and **"Kheylo"** is a live Pakistani sports booking app. The mobile package is still `com.maidan.app` / `maidan://`. Get a trademark and store-name check before the first store submission.

Sources:
- [On Spot](https://onspotapp.com/) · [On Spot on Google Play](https://play.google.com/store/apps/details?id=com.onspot.user.app&hl=en_US)
- [SportsNow](https://sportsnow.pk/) · [Janbaz](https://janbaz.pk/) · [Janbaz futsal](https://janbaz.pk/futsal)
- [Kheylo listing](https://mwm.ai/apps/kheylo/6754123169) · [Kheylo site](https://kheylo.pk/)
- [Sporty on Google Play](https://play.google.com/store/apps/details?id=com.sporty.kicksetgoo&hl=en_US) · [Poncho on Google Play](https://play.google.com/store/apps/details?id=app.poncho.android)
- [Groundify](https://igroundify.com/cricket-ground-booking) · [Turfy](https://www.goturfy.com/) · [BookMySpot](https://bookmyspot.pk/)
- [PlayPro listing](https://appshunter.io/ios/app/playpro-booking-and-tournaments/id6612028849)
- [Playtomic: how to make a reservation](https://playerhelp.playtomic.com/hc/en-gb/articles/19831881490449-How-to-make-a-reservation-in-Playtomic-app)
- [Playo on App Store](https://apps.apple.com/us/app/playo-sports-community-app/id1018786950) · [Hudle](https://apps.apple.com/app/id1380053168) · [Hudle Partner](https://apps.apple.com/app/id1569130632)
- [TurfBook (Bangladesh)](https://play.google.com/store/apps/details?id=com.qitbd.turfbook&hl=en) · ["Khelo" App Store listing](https://apps.apple.com/cd/app/khelo/id6749449861)

## 4. Where Khelo can win (hypotheses, to be tested)

1. **Honest status.** Several competitors say "instant" while bookings are requests. Khelo shows Hold → Screenshot bheja → Venue check → Pakki and never says "confirmed" before the backend does.
2. **Money rules before money moves.** Advance, venue-par baqi and cancellation in the confirm sheet (SportsNow, Groundify, Playtomic do this).
3. **Roman Urdu-first + WhatsApp + AI chat** as an optional path, not a gate.
4. **Owner command centre.** Timeline of courts + "what needs me now" (approvals) + walk-in in one tap. Most local competitors list analytics; few show the day as a timeline.
5. **Real photos.** Several local products show initials or no photos. Photos are a cheap trust win (needs owner upload nudges).

## 5. Colour system and rationale

Principles used (established): WCAG 2.2 AA contrast (4.5:1 text, 3:1 large text and UI parts); status never by colour alone (colour vision deficiency affects roughly 1 in 12 men); one dominant accent for the primary action makes it stand out (isolation effect). Not claimed: that any colour "increases conversions" by itself.

| Token | HEX | Role | From existing brand? | Tested contrast |
|---|---|---|---|---|
| Action | `#FF6A2B` | The one next step per screen (Book, Pay, Approve, + walk-in) | Yes (website accent) | Ink text 5.98 ✓. **White text 2.86 ✗ → never white on orange** |
| Night / Ink | `#0C1F1D` | Hero stage, text, active tab | Yes | White 15.8+ ✓ |
| Teal | `#0E7C74` | Brand secondary, booked blocks, data highlights | Yes | White 5.06 ✓; teal text on `#E3F4F1` 4.45 ✗ → use `#0A5F59` (6.61) |
| Ground | `#F4F6F5` | 60% calm surface | Yes | Ink 15.74 ✓ |
| Muted | `#4A5D5A` | Secondary text | Yes | 6.44 on ground ✓ |
| Open | `#0B6B43` on `#DFF5EA` | Available, paid, confirmed | Yes (website) | 5.75 ✓ |
| Waiting | `#8A5A00` on `#FFF1D6` | Held, venue checking | Yes (website) | 5.31 ✓ |
| Danger | `#B42318` on `#FDE8E5` | Reject, cancel, duplicate | New | 5.59 ✓ |
| Deep orange | `#B83E00` | Orange-family text and links on light | Yes | 5.63 on white ✓ |
| Old meta grey | `#8A9996` | Was used for small text on the website | Yes | 2.97 ✗ → replace with `#5B6E6B` (5.40) |

Why dark heroes: they separate "where am I / what's next" from content, and match evening play (the live site itself sells "prime evening slots"). This is a design hypothesis, not a proven effect.

Glass: only on floating chrome (tab bar, book bar, buttons over photos and dark heroes). Never behind money or body text. Solid fallback on low-end Android and with reduce-transparency.

## 6. State model (never by colour alone)

| State | Visual | Non-colour cue |
|---|---|---|
| Khaali (available) | Ground fill | Tappable, plain time |
| Aap ka chuna (selected start) | Orange fill | ✓ prefix + 2 px ink outline |
| Booking ke andar (in range) | Peach tint | Peach outline |
| Kisi ne hold kiya | Amber tint | Dashed border, disabled |
| Booked | Grey | Strikethrough, disabled |
| No room for this length | Transparent | Dashed grey, disabled, screen-reader label says why |

Booking journey labels: 1 Hold → 2 Screenshot bheja → 3 Venue check → 4 Pakki ✓, plus ✕ Reject/expire with reason and next step.

## 7. Journey decisions

- Home: 3-field search (Khel · Kab · Kitni der), sport tiles, next game, "Aaj raat khaali" cards with real open times, "Phir se khelo".
- Venue: booking first in 4 numbered steps (Court, Din, Kitni der, Kab shuru); info after.
- Floating Book bar with live total; chat is an optional icon, not a gate.
- Confirm sheet: Venue, Court, Kab, Abhi bhejna (advance), Venue par baqi, Cancel policy.
- Pay: countdown ring, numbered steps, Copy for account number and IBAN, compressed screenshot.
- Status: honest waiting timeline; celebration + QR ticket only after `booked`.
- Owner Aaj: hero number, approvals card first, 2-court timeline, walk-in "+" in the tab bar.
- Approvals: "Chahiye" vs "Screenshot mein" side by side; duplicate warning; bulk approve only with confirm.

## 8. Measurable hypotheses (no claims without data)

| Hypothesis | Metric | How to measure |
|---|---|---|
| Direct Book + 4 steps cuts time to choose a slot | Median seconds from venue open to Hold | Event log `venue_view` → `hold_created` |
| Showing money rules early reduces drop-off at pay | Hold → screenshot submitted rate | `hold_created` → `payment_submitted` |
| Honest status reduces "kya hua?" support | WhatsApp support messages per booking | Support log tags |
| Owner approvals card speeds approval | Median minutes `payment_submitted` → `approved` | Booking timestamps |
| Photos raise venue page conversion | Venue view → Hold by venues with/without photos | Segment by `photo_urls` count |

Run a 5-player + 3-owner hallway test on a real Android phone before calling any of this "done".

## 9. Known limits

- Live web routes beyond home and the backend code were not inspected in this round.
- No competitor app was used hands-on; findings come from listings and sites.
- Venue photos, ratings and prices on the canvas are sample data.
- The canvas boards are design targets; they are not code.
