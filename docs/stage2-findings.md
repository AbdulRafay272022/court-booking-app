# Round 2 Stage 2: read-only findings (agent R)

Date: 2026-10-20. Branch `feat/round2-stage2`. Production was read with SELECTs only. Every query ran in a transaction that began with `SET TRANSACTION READ ONLY`. Nothing was written. Screenshot hashes were compared **inside SQL**: only group numbers and counts were printed, never a hash, key or URL. Refund references are shown by their last 4 digits only. Item 3 comes from the code, plus one boolean read from prod (`feature_flags.split_payments`).

Times are PKT (UTC+5) unless marked otherwise. Booking ids are the first 8 characters.

Earlier context: `docs/round2-findings.md` section 1.

---

## 1. Abbas Zafar's two open refunds (Right wing, KHA Legends Arena)

### 1.1 The two disputes

| Dispute | Booking | Slot (PKT) | Price | Paid (ledger) | Status | Reason | refund_amount | refund_status |
|---|---|---|---|---|---|---|---|---|
| 40949e4c | **922d0960** | Sat 17 Oct 13:30 | 33,000 | 15,000 | cancelled by player at 17 Oct 04:11 | player_cancelled_paid_booking | **15,000** | owed |
| a7d092dd | **d735afe1** | Sat 17 Oct 19:30 | 19,250 | 450 | cancelled by player at 17 Oct 04:10 | player_cancelled_paid_booking | **450** | owed |

Both rows were written by `_flag_refund_for_voluntary_cancel` (`booking_service.py` 520-547). It sets refund owed = everything paid on that booking. It does not check whether the approved proof was a duplicate.

### 1.2 The screenshots behind them

Abbas uploaded 11 proofs and none were auto-approved. Grouped by identical `proof_hash` (the group number is assigned inside SQL):

| Hash group | OCR amount | Payments with this image | Approved and credited | Rejected |
|---|---|---|---|---|
| **G-450** | 450 | **6** | **5** | 1 |
| **G-15000** | 15,000 | **3** | **2** | 1 |
| G-5000 | 5,000 | 1 for Abbas, **+3 for Mujtaba Anwer** | 0 for Abbas, **2 for Mujtaba** | 1 for Abbas, 1 for Mujtaba |
| G-2000 | 2,000 | 1 | 1 | 0 |

Every payment below has `amount_claimed` = the booking's full advance (= price), `ocr_verdict = mismatch`, `auto_approved = false`. `duplicate_of` shows the first 8 characters of the original payment's id.

| Payment | Booking | Court | Uploaded (PKT) | OCR | is_duplicate | duplicate_of | Group | Review | Reviewed (PKT) | Ledger credit |
|---|---|---|---|---|---|---|---|---|---|---|
| 375f0072 | 32eac90b | Left Wing | 16 Oct 01:14 | 450 | false | - | G-450 | approved | 01:19 | +450, then **-450 refunded** (ref ***8610, 16 Oct 02:10) |
| c27d8ce0 | 4d333dd0 | Futsal 1 (Court Site) | 16 Oct 01:33 | 2,000 | false | - | G-2000 | approved | 01:34 | +2,000, then -2,000 refunded (ref ***4214) |
| bcadbe47 | a642a4b4 | Padel 1 (Court Site) | 16 Oct 04:15 | 5,000 | false | - | G-5000 | **rejected** "Screenshot unreadable" | 04:16 | 0 |
| ef06f025 | **850723a0** | Right wing | 17 Oct 03:34 | 15,000 | false | - | G-15000 | approved | 03:46 | **+15,000** |
| 4b841c4f | ad46a818 | Right wing | 17 Oct 03:35 | 450 | **true** | 375f0072 | G-450 | approved | 03:46 | +450 |
| 467cc90f | 4653209b | Right wing | 17 Oct 03:48 | 450 | **true** | 375f0072 | G-450 | approved | 03:53 | +450 |
| 595f70d6 | **922d0960** | Right wing | 17 Oct 03:53 | 15,000 | **true** | ef06f025 | G-15000 | approved | 03:57 | **+15,000** |
| f2e7c395 | **d735afe1** | Right wing | 17 Oct 03:54 | 450 | **true** | 375f0072 | G-450 | approved | 03:57 | **+450** |
| 7cd432f6 | ec02a6f0 | Right wing | 17 Oct 03:54 | 15,000 | **true** | ef06f025 | G-15000 | rejected "customer back off" | 04:01 | 0 |
| f68e59e8 | 82d2c617 | Right wing | 17 Oct 03:54 | 450 | **true** | 375f0072 | G-450 | approved | 04:05 | +450 |
| 902af304 | 8c00c6b7 | Right wing | 17 Oct 04:05 | 450 | **true** | 375f0072 | G-450 | rejected "1" | 04:08 | 0 |

`is_duplicate` and `duplicate_of` agree exactly with the hash groups. Every duplicate points at the first upload of that same image.

### 1.3 The bookings that got money from each image

**G-450 (one real transfer of PKR 450 at most)** was credited on **5 bookings**, 450 each, so **2,250 in the ledger**:

| Booking | Court | Price | amount_paid | Status now |
|---|---|---|---|---|
| 32eac90b | Left Wing | 4,500 | 0 (450 in, then 450 refunded) | cancelled by player. **The 450 has already been paid back** |
| ad46a818 | Right wing | 8,250 | 450 | no_show |
| 4653209b | Right wing | 11,000 | 450 | no_show |
| d735afe1 | Right wing | 19,250 | 450 | cancelled by player, **450 refund owed** |
| 82d2c617 | Right wing | 8,250 | 450 | no_show |

**G-15000 (one real transfer of PKR 15,000 at most)** was credited on **2 bookings**, so **30,000 in the ledger**:

| Booking | Court | Price | amount_paid | Status now |
|---|---|---|---|---|
| 850723a0 | Right wing | 22,000 | 15,000 | no_show (17 Oct 07:00) |
| 922d0960 | Right wing | 33,000 | 15,000 | cancelled by player, **15,000 refund owed** |

**G-5000 is shared across players.** Abbas's 5,000 image (rejected on his Padel 1 booking as "Screenshot unreadable") was uploaded again 3 times by **Mujtaba Anwer**. The owner approved 2 of those (f6db65ba Left Wing and eaf85c4c Padel 1, +5,000 each, both now no_show) and rejected the third (fc772e2d, "fake screenshot"). So 10,000 sits in Mujtaba's ledger from an image the same owner had rejected for Abbas. This is outside the two refunds but has the same root cause.

### 1.4 What the correct refund is

Rule: one real transfer can be refunded at most once. Matching images mean one transfer.

- **450 (d735afe1): the correct refund is PKR 0.** The only real 450 transfer was first credited on 32eac90b, and the owner **already paid it back** on 16 Oct 02:10 (ref ***8610). Paying 450 again would refund the same money twice. The other three 450 credits (ad46a818, 4653209b, 82d2c617, now no-shows) are also not real money. Their true amount_paid is 0, so each true due is 450 higher than shown.
- **15,000 (922d0960): the correct refund is PKR 0 for this booking.** At most one 15,000 was received. It was first credited on 850723a0, and that booking became a **no-show**. The second credit on 922d0960 (flagged duplicate of ef06f025) is the same money counted twice. So "15,000 owed" double-counts.
  - The owner still has one decision. If the venue does **not** keep money from no-shows, the single 15,000 can be refunded **once**, against 850723a0, and never also against 922d0960. Either way, the most that can ever be refunded across both bookings is **15,000**, not 30,000.
- **Total correct refund to Abbas: PKR 0** (keeping the no-show money), or **PKR 15,000 at most** (returning the no-show money). It must never be 15,450.
- What the ledger would really show: 850723a0 paid 15,000 (true). 922d0960, d735afe1, ad46a818, 4653209b and 82d2c617 paid **0** (each now shows 15,000 or 450). The ledger overstates Abbas's money received by **16,800**. That is 15,000 (the second G-15000 credit) plus 4 x 450 still sitting on ad46a818, 4653209b, d735afe1 and 82d2c617, which should be 0 because the one real 450 was already refunded. Mujtaba's ledger is overstated by **10,000** (G-5000).
- Context: Abbas made 9 Right wing bookings in about 30 minutes after 03:30 PKT, reusing 2 images, and Mujtaba reused Abbas's image. This looks like test traffic, but the money columns are real.

Recommended numbers (no change was made):

| Dispute | Booking | Now | Recommended |
|---|---|---|---|
| a7d092dd | d735afe1 | 450 owed | **0** (close with a note: "duplicate of payment 375f0072, already refunded ***8610") |
| 40949e4c | 922d0960 | 15,000 owed | **0** (close: "duplicate of payment ef06f025, credited on 850723a0"). If the owner wants to return no-show money, at most 15,000 once, against 850723a0 |
| 80e118d4 | a642a4b4 | 0 owed (payment_rejected) | 0. The confusing zero row from round2-findings 1.2 |

**Roman Urdu khulasa:** Abbas ke dono "owed" refund duplicate screenshot par bane hain. 450 wala screenshot 5 bookings par credit hua, lekin asal mein 450 sirf ek dafa aaye, aur woh 450 owner 16 Oct ko pehle hi wapas kar chuka hai (***8610). Is liye d735afe1 ka sahi refund **0** hai. 15,000 wala screenshot 2 bookings par credit hua. Asal 15,000 sirf ek dafa aaye, aur woh 850723a0 par lage jo no-show ho gayi. Is liye 922d0960 ka sahi refund bhi **0** hai. Agar owner no-show ka paisa wapas karna chahe to zyada se zyada 15,000 sirf ek dafa. Kisi haal mein 15,450 nahi banta. Mujtaba ne Abbas ka rejected 5,000 wala screenshot dobara lagaya, aur owner ne usay 2 dafa approve kar diya (10,000 ledger mein, asal mein 0).

---

## 2. All no_show bookings (all are on live venues)

There are 13 `no_show` bookings in production. All 13 are on venues with `status=approved, is_active=true`. None has a check-in. Each one has exactly one `booking.no_show` audit row, written by `system` (the expiry cron), 60 minutes after the slot start (`NO_SHOW_GRACE_MINUTES`).

| Booking | Player | Court | Venue | Slot start (PKT) | Price | amount_paid | Due | Due > 0 | Source | Became no_show (PKT) |
|---|---|---|---|---|---|---|---|---|---|---|
| 963119b6 | Abdul Rafay | Padel 1 | Court Site | Thu 15 Oct 18:00 | 3,000 | 3,000 | 0 | no | walkin | 15 Oct 19:00 |
| 8b18c820 | Fasih | Right wing | KHA Legends Arena | Fri 16 Oct 02:30 | 6,750 | 250 | 6,500 | **yes** | walkin | 16 Oct 03:30 |
| 3cd15619 | af | Right wing | KHA Legends Arena | Fri 16 Oct 12:00 | 5,500 | 100 | 5,400 | **yes** | walkin | 16 Oct 13:00 |
| 5c9beb16 | Noman | Futsal 1 | Court Site | Fri 16 Oct 17:00 | 3,500 | 3,500 | 0 | no | walkin | 16 Oct 18:00 (row last updated 17 Oct 05:34) |
| 6b30d806 | da | Right wing | KHA Legends Arena | Fri 16 Oct 23:30 | 5,500 | 50 | 5,450 | **yes** | walkin | 17 Oct 00:30 |
| 6a850de5 | afasf | Right wing | KHA Legends Arena | Sat 17 Oct 00:30 | 13,750 | 120 | 13,630 | **yes** | walkin | 17 Oct 01:30 |
| 850723a0 | Abbas Zafar | Right wing | KHA Legends Arena | Sat 17 Oct 06:00 | 22,000 | 15,000 | 7,000 | **yes** | app | 17 Oct 07:00 |
| ad46a818 | Abbas Zafar | Right wing | KHA Legends Arena | Sat 17 Oct 10:00 | 8,250 | 450* | 7,800 | **yes** | app | 17 Oct 11:00 |
| 4653209b | Abbas Zafar | Right wing | KHA Legends Arena | Sat 17 Oct 11:30 | 11,000 | 450* | 10,550 | **yes** | app | 17 Oct 12:30 |
| 82d2c617 | Abbas Zafar | Right wing | KHA Legends Arena | Sun 18 Oct 00:30 | 8,250 | 450* | 7,800 | **yes** | app | 18 Oct 01:30 |
| f6db65ba | Mujtaba Anwer | Left Wing | KHA Legends Arena | Sun 18 Oct 06:00 | 10,500 | 5,000* | 5,500 | **yes** | app | 18 Oct 07:00 |
| eaf85c4c | Mujtaba Anwer | Padel 1 | Court Site | Sun 18 Oct 11:00 | 10,500 | 5,000* | 5,500 | **yes** | app | 18 Oct 12:00 |
| d5371118 | Hamza Khan | Padel 2 | Court Site | Mon 19 Oct 11:00 | 4,500 | 4,500 | 0 | no | whatsapp | 19 Oct 12:00 |

\* Credit comes from a duplicate screenshot (see 1.3). The real amount received on that booking is 0, so the true due equals the price.

Totals: 13 no-shows. **10 have due > 0**, totalling **PKR 75,130** by the ledger. 3 are fully paid (2 walk-ins and 1 WhatsApp). By source: walkin 6, app 6, whatsapp 1. In every case `balance_due` equals price - amount_paid. Four of the 6 walk-ins on Right wing have tiny paid amounts (50-250), which look like test entries.

**Roman Urdu khulasa:** Prod par 13 no-show bookings hain, sab live venues par. 10 par paisa baqi hai (ledger ke hisaab se kul 75,130). Sab ko cron ne slot shuru hone ke 1 ghante baad no-show kiya. Abbas ki 3 aur Mujtaba ki 2 no-shows ka "paid" asal mein duplicate screenshot se aaya hai, is liye unka asal baqi poori qeemat hai.

---

## 3. Settings audit (from the code)

Paths: BE = `court-booking-backend/app/`, FE = `court-booking-frontend/`. Line numbers are as of 8db27fb.

### 3.1 Where each setting is set

- **API**
  - Venue: `POST /venues` (`VenueCreateIn`, BE/schemas/venue.py 85-102), `PATCH /venues/{id}` (`VenueUpdateIn` 105-122)
  - Court: `POST /venues/{id}/courts` (`CourtCreateIn`, BE/schemas/court.py 92-114), `PATCH /courts/{id}` (117-141)
  - Schedule: `POST /courts/{id}/schedule` (upsert per day)
  - Pricing: `POST /courts/{id}/pricing` (replaces every rule)
  - Blackouts: `POST /courts/{id}/blackouts`
  - Staff: `POST /staff`, `PATCH /staff/{id}/permissions`, `PATCH /staff/{id}/active`
  - Walk-in: `POST /bookings/walkin`
- **Web**
  - Wizard step 1: `apps/web/app/venue-setup/register`
  - Wizard step 2 (courts, hours, prices): `apps/web/app/venue-setup/courts`
  - Settings: `dashboard/owner/settings`
  - Staff: `dashboard/owner/staff`
  - Walk-in: `dashboard/owner/walkin`
- **Mobile**
  - Wizard: `(owner)/venue-setup/register`, `courts`
  - Screens: `(owner)/venue-settings`, `(owner)/staff`, `(owner)/walkin`
- **Shared court setup defaults:** `packages/types/src/court-setup.ts`

| Setting | Set where | Default (layer) |
|---|---|---|
| Venue name | wizard 1; settings (web + mobile) | none (required). Wizard starts `""` |
| Venue address | wizard 1; settings | none (required) |
| Venue city | wizard 1 | none in backend. **"Karachi"** in both wizards |
| Venue area | wizard 1; settings | none (nullable) |
| Venue location (lat/lng) | wizard 1 pin; mobile re-pin | none (required) |
| Venue phone | API only, **no UI** | none (nullable) |
| Venue whatsapp | wizard 1; settings | none (nullable) |
| Venue description | settings | none (nullable) |
| Venue sports | wizard 1; settings; auto-added when a court is added | none (required, min 1) |
| Venue amenities | wizard 1; settings | none (nullable); wizard `[]` |
| Venue photos | settings (flag `photos`, staff `manage_photos`) | none |
| Bank details (bank, account_title, account_number) | wizard 1; settings | none (nullable object; all 3 required if sent) |
| Bank IBAN | API only, **no UI** | none |
| JazzCash / Easypaisa | not separate fields, only values of `bank` | n/a |
| cancellation_allowed | wizard; settings | **true** (model, server, schema, both wizards) |
| cancellation_cutoff_hours | wizard; settings | **none** (NULL = player may cancel any time before start) |
| Refund % / free-cancel window | **does not exist** (an allowed cancel = full refund of amount_paid) | n/a |
| booking_horizon_days | API only, **no UI** | **90** (model, server, schema; 1-365) |
| auto_approve_enabled | API `PATCH` only, **no UI** | **false** (model, server) |
| auto_approve_min_bookings | API `PATCH` only, **no UI** | **5** (model, server) |
| Venue status | admin | pending |
| Venue is_active | delete venue | true |
| Court name | wizard 2; settings / add court | none in backend. UI "Court N" |
| Court sport | wizard 2; settings | none in backend. UI "Padel" or the venue's first sport |
| Court slot_minutes (minimum booking) | wizard 2; settings | **60** (model, server, schema), but **90 in both wizards** (court-setup.ts 66). **The layers disagree.** |
| Court is_indoor | wizard 2; settings | false |
| Court has_floodlights | API only, **no UI** | false |
| Court surface_type, capacity | API only, **no UI** | none |
| Court advance_type | settings (advance section) | **none** (NULL = use the pricing rule %) |
| Court advance_value | settings | **none**; required when type is set. If the type is set but the value blank, web sends 0 and mobile sends `Number("")` = 0 |
| Court advance_minimum | settings | **none** |
| Court sort_order | API only | 0 |
| Court is_active | delete court = deactivate | true |
| Schedule (per court, per day open/close) | wizard 2; settings | **No backend default. A new court has no rows, so it is closed.** UI default: same hours every day, **06:00-23:00**. There are **no venue-level hours.** |
| Schedule closes_next_day | derived from times | false |
| Pricing rule name | wizard 2; settings | UI "All day" |
| Pricing price_per_slot | wizard 2; settings | **none** (required > 0). A court with no priced rule cannot be booked. |
| Pricing day_of_week / start_time / end_time | settings | none (NULL = every day / all day) |
| Pricing priority | list order | 0 |
| Pricing floodlight_surcharge | **no UI** (UI omits it for new rules) | **0** (model, server, schema) |
| Pricing advance_percentage | **no UI field**; UI sends `?? 100` | **100** (model, server, schema, UI) |
| Blackout title | settings | none |
| Blackout starts_at / ends_at | settings | none in backend (required). UI times 06:00 / 23:00 |
| Blackout reason | **no UI** | none |
| Staff name / phone / password | staff page (web, mobile) | none (required) |
| Staff permissions (11 keys) | staff page | schema `[]`. **Web form pre-ticks `view_ledger`** (staff/page.tsx 25). **Mobile form starts empty** (staff.tsx 128). **Web and mobile disagree.** |
| Staff is_active | staff page | true |
| Feature flags (owner-visible effect) | admin panel only | `enabled` **true** (model, server; a missing row = ON). `owner_billing_enforced` seeded **false** |
| Owner notification preferences / digest opt-in / reminder settings | **do not exist** | n/a (only the global `digest_reminders` flag) |
| Walk-in slot_count | walk-in page | court minimum (schema None) |
| Walk-in player_name | walk-in page | none (required) |
| Walk-in player_phone | walk-in page | none |
| Walk-in amount_paid | walk-in page | **none in schema (required)**. UI prefills the quoted price |
| Walk-in method | **UI never sends it** | `cash_at_venue` (schema) |
| Walk-in source | not settable | `walkin` (service) |

Staff permission keys (BE/models/staff.py 22-32): approve_payments, record_payments [needs flag split_payments], check_in, walkin, cancel_booking, edit_court_settings, manage_photos [photos], respond_reviews [reviews], mark_refunds [refunds], view_ledger, view_growth [growth_suggestions]. A permission tied to a flag cannot be granted while that flag is off (staff_service.py 33-39).

### 3.2 Has a default (value)

- venue.cancellation_allowed = **true**
- venue.booking_horizon_days = **90**
- venue.auto_approve_enabled = **false**
- venue.auto_approve_min_bookings = **5**
- venue.status = **pending**
- venue.is_active = **true**
- venue.city = **"Karachi"** (wizards only)
- court.slot_minutes = **60** in the backend, **90** in the wizards
- court.is_indoor = **false**
- court.has_floodlights = **false**
- court.sort_order = **0**
- court.is_active = **true**
- court.name = **"Court N"** (UI)
- court.sport = **"Padel"** or the venue's first sport (UI)
- schedule hours = **06:00-23:00 every day** (UI only)
- schedule.closes_next_day = **false**
- pricing.advance_percentage = **100**
- pricing.floodlight_surcharge = **0**
- pricing.priority = **0**
- pricing.name = **"All day"** (UI)
- blackout times = **06:00 / 23:00** (UI only)
- staff.is_active = **true**
- staff permissions = **[]** (API/mobile) or **["view_ledger"]** (web)
- feature_flags.enabled = **true**; owner_billing_enforced = **false**
- walk-in method = **cash_at_venue**
- walk-in slot_count = **court minimum**
- walk-in amount_paid = **quoted price** (UI prefill)
- Global constants: hold **15 min**, payment review **2 h**, no-show grace **60 min**, trial **15 days**, billing grace **7 days**, reminder window **2 h**

### 3.3 Has NO default

**Required, with no fallback:**
- venue: name, address, location, sports (plus city in the backend)
- bank sub-fields, when bank details are sent
- court: name, sport (backend)
- pricing price_per_slot
- schedule open/close per day
- blackout starts_at/ends_at
- staff: name, phone, password
- walk-in: player_name, amount_paid (backend)

**Nullable, with no value until set:**
- **cancellation_cutoff_hours** (NULL = cancel any time)
- **court advance_type / advance_value / advance_minimum** (NULL = use the rule %)
- venue: phone, whatsapp, description, area, amenities, bank_details, iban
- court: surface_type, capacity
- pricing day/time window
- blackout title/reason
- walk-in player_phone

**Not created at all for a new court via the API:**
- schedule rows: the court stays **closed** until hours are sent
- pricing rules: the court is **unbookable** until a priced rule exists
- Only the wizards fill these in.

**Do not exist:** venue-level opening hours, refund % or free-cancel window, owner notification preferences or digest opt-in, separate JazzCash/Easypaisa fields.

**Exist in the backend but have no web/mobile UI:** booking_horizon_days, auto_approve_enabled/min_bookings, has_floodlights, surface_type, capacity, floodlight_surcharge, per-rule advance_percentage, iban, venue phone, sort_order, blackout reason, walk-in method.

### 3.4 split_payments and the advance

**Production value (read-only): `split_payments.enabled = true`.**

The advance per slot comes from `compute_advance` (availability_service.py 159-172):
1. If the court's advance type is fixed, the advance is `advance_value`.
2. If it is percent, the advance is `price x value / 100`.
3. Otherwise, it is `price x rule.advance_percentage / 100`, which defaults to 100.
4. The result is then raised to `advance_minimum` if one is set, and capped at the price.

`quote_range` adds up the per-slot advances (line 707). Then at **718-719**: `if not flag_on("split_payments"): advance_amount = price`. With the flag **OFF**, every new booking must be paid in full and every court and rule advance setting is ignored. The owner's advance explainer copies this (advance_explain.py 62, 82-84). Walk-ins are not affected (they store `advance_amount = amount_paid`). The flag also gates the payment-ledger endpoints (api/payments.py 230, 272) and the `record_payments` staff permission.

Because the flag is **ON** in prod, court and rule settings apply. But every prod pricing rule is still at the default **100%** (round2-findings section 5), so in practice the advance is the full price on 7 of 8 courts anyway.

**Roman Urdu khulasa:**
- Kai settings ka default backend mein hai lekin UI mein unhe badalne ki jagah nahi: booking_horizon_days 90, auto-approve off/5, floodlight_surcharge 0, advance_percentage 100.
- slot_minutes ka backend default 60 hai magar wizard 90 rakhta hai.
- Staff permissions mein web "view_ledger" pehle se tick karta hai, mobile kuch nahi.
- cancellation_cutoff_hours aur court ke advance (type/value/minimum) ka koi default nahi. Khali ho to pricing rule ka % (100) chalta hai.
- API se naya court banayein to schedule aur pricing nahi banti, court band rehta hai. Sirf wizard 06:00-23:00 aur "All day" rule bharta hai.
- Venue ke opening hours, refund %, owner notification settings aur alag JazzCash/Easypaisa field mojood hi nahi.
- Prod par split_payments ON hai, is liye advance settings chalti hain. OFF hota to har booking poori qeemat par hoti. Lekin har rule 100% par hai, is liye abhi bhi poori qeemat hi advance hai.

---

```
AGENT: R (read-only, Round 2 Stage 2)
DONE: 1) Abbas's 2 open refunds traced to payments, hash groups (compared in SQL), ledger entries,
      disputes, audit; correct refund computed. 2) Table of all 13 no_show bookings with dues and
      no_show times. 3) Settings audit from code with where-set, defaults per layer, has/has-no
      default lists; split_payments read from prod (enabled=true) and its effect traced in code.
COULD NOT DO: nothing blocked. No prod writes; settings values inside the container not read (as instructed).
KEY FINDINGS:
- Both of Abbas's open refunds rest on duplicate screenshots. The one real 450 was already refunded
  (32eac90b, ***8610), so d735afe1 should be 0, not 450. The one real 15,000 is credited on no-show
  850723a0, so 922d0960 should be 0, not 15,000 (at most 15,000 once if no-show money is returned).
  Never 15,450. Abbas's ledger is overstated by 16,800.
- Abbas's rejected 5,000 image was re-uploaded 3x by Mujtaba Anwer; owner approved 2 (10,000 credited
  from 0 real money). The duplicate flag works, but approve/refund ignore it.
- 13 no_shows, all on live venues; 10 with due > 0 (ledger total 75,130); 5 of those carry
  duplicate-image credits, so their real due is the full price.
- Defaults disagree across layers: slot_minutes 60 (backend) vs 90 (wizards); staff permissions
  [] (API/mobile) vs ["view_ledger"] (web). No default for cancellation_cutoff_hours or court advance
  fields. A court created via the API has no schedule or pricing (closed/unbookable).
- Several settings have no UI: booking_horizon_days (90), auto_approve (false/5), floodlight_surcharge (0),
  advance_percentage (100), has_floodlights, iban, venue phone.
- split_payments is ON in prod; OFF would force advance = price.
```
