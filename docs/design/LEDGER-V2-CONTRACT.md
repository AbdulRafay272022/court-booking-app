# Khelo — Ledger v2 (Paisa) contract

12 Nov 2026 · step 0 report + founder faislon par bana · **v2: founder ki 7 corrections + section 10 ke jawab shamil · build GO mila (steps 1–3, sirf local DB tak)**.
Source: `docs/design/LEDGER-BUILD-PROMPT.md` (section A design files se upar), `ledger-design.html`, `paisa-mobile.html`.
Is file aur prompt mein takraav ho to **yeh file** chalegi (isme founder ke baad wale faisle hain).

---

## 0. Process

- Branch `feat/ledger-v2`, `fix/bank-details-key-loss` (5b5c748) ke upar se, kyunki bank details ki encryption-key fix ka code isi par hai. `main` par seedha kuch nahi.
- `docs/design/` ki files pehle commit mein jayengi.
- Flag `ledger_v2`, default **OFF** (`DEFAULT_OFF_FLAGS`; row na ho to OFF). Flag OFF ho to app bilkul aaj jaisi chale: purane screens, purane rules.
- Ek Alembic migration (schema), down_revision `c3e8a1f5b902`. **Migration-Go chahiye.**
- Data backfill alag script mein: `scripts/ledger_v2_backfill.py`. Idempotent hai, `--dry-run` deta hai aur report likhta hai. Check script: `scripts/ledger_v2_check.py`. Dono migration ke baad chalenge (section 3.3).
- Ab nahi: expenses, profit, charts, cash handover, bank API, auto reconciliation, month closing.
- **Prod gate 1 (founder, 13 Nov):** prod se pehle **prod ki copy** par `ledger_v2_backfill.py --dry-run` + `ledger_v2_check.py`. Local DB khali tha, is liye asli data par backfill abhi pakka nahi. Check report founder ko dikhani hai; prod sirf founder ke GO par.
- **Prod gate 2 (founder, 13 Nov):** prod par **migration + backfill + flag `ledger_v2` ON ek hi deploy window mein, ek saath**. Alag alag nahi: backfill ke baad flag OFF par bhi Final price dikhti hai (maslan no-show 5,000 → 1,000), jo purane screens par ajeeb lagega.

---

## 1. Hisaab (har booking) — ek hi function

Backend mein ek hi pure function `booking_money(booking, entries, adjustments) -> Money` hoga. Har screen, CSV, Overview aur badge isi se number lega. Frontend khud hisaab nahi lagata.

```
base_price      = bookings.base_price                          (booking ki asal raqam)
deductions      = Σ adjustments (active) jin ka kind ∈ {points, no_show, cancellation, price_reduced}
final           = base_price − deductions                      (= bookings.price, maaf ke baghair)
waived          = Σ adjustments (active) jin ka kind = waived  (deduction NAHI, alag)
net             = Σ payment_entries.amount_pkr
                = payments + jama se diya − refunds − jama mein gaya (+ corrections, apne nishan ke saath)
balance         = final − net − waived

balance > 0 aur booking khel chuki / no-show / cancel        → due          = balance
balance > 0 aur upcoming / attendance baqi                   → due_at_slot  = balance
balance < 0                                                  → refund_due   = −balance
```

- **Identity:** `final = net + due + due_at_slot + waived − refund_due`. Yeh definition se hi barabar aata hai, is liye har set (date range, court) par test hoga (8.1). Asal galti pakadne wale checks woh hain jo bahar ke sources se milate hain (3.3).
- `active` = jis adjustment ka reversal na hua ho.
- Pending ya rejected screenshot kisi total mein nahi: entry approve hone par hi banti hai.
- Sab raqam whole rupees (int).
- `bookings.amount_paid` = net. `bookings.balance_due` = max(balance, 0). Dono **sirf** `recompute_payment_totals` likhega. Formula mein waived shamil hoga (4.2).

### 1.1 Booking ka status (pill), ek hi jagah tay hota hai

| key | ru | en | kab |
|---|---|---|---|
| `unpaid` | Abhi kuch nahi mila | Not paid yet | cancel nahi, net = 0, balance > 0 (upcoming ya khel chuki) |
| `paid_full` | Poora mila | Fully paid | khel chuki / mukammal, balance = 0 |
| `part_paid` | Kuch baqi | Partly paid | due > 0 |
| `attendance_pending` | Hazri baqi | Attendance pending | slot khatam, status abhi `booked` |
| `advance_paid` | Advance mila | Advance received | upcoming, net > 0 |
| `noshow_kept` | Nahi aaye · advance rakha | No-show · advance kept | no_show, balance 0 |
| `cancel_kept` | Cancel · advance rakha | Cancelled · advance kept | cancelled, `cancellation` adjustment advance rakhta hai |
| `cancel_clear` | Cancel · hisaab saaf | Cancelled · settled | cancelled, net = 0, refund_due = 0 |
| `cancel_refund` | Cancel · wapas dena | Cancelled · refund due | cancelled, refund_due > 0 |
| `refund_due` | Wapas dena | Refund due | cancel nahi, balance < 0 (zyada paisa, maslan 6,500 on 6,000) |
| `disputed` | Jhagra | Disputed | short claim `disputed`, owner ka faisla baqi |

Tarteeb (pehla jo lage): `disputed` → cancel wale → `noshow_kept` → `refund_due` → `unpaid` → `attendance_pending` → `part_paid` → `advance_paid` → `paid_full`.

Jahan zaroorat ho, `due` / `refund_due` waghera pill ke saath alag dikhayi denge (maslan "Kuch baqi · PKR 2,000").

---

## 2. Money rules

### 2.1 Business day
`business_date(venue, instant)`:
1. `local` = instant ka PKT waqt, `d = local.date()`.
2. Venue ke sab active courts mein se, `d − 1` ke din (day_of_week) ke `closes_next_day = true` schedules ka **sab se der wala** `close_time` nikalo.
3. Agar `local.time() <` us close_time → business day `d − 1`, warna `d`.

Maslan Mon 6 PM – Tue 4 AM wale venue par Tue 1:00 AM ka paisa Monday ka hai. Yahi function slots ke din ke liye bhi chalega (booking ka business day = `business_date(starts_at)`).

- Har entry par `money_business_date` aur asal `created_at` dono save honge.
- `money_business_date ≤ business_date(venue, now)`: aage ki tareekh `VALIDATION_ERROR`.
- **Purani tareekh:** business_date < aaj ho to note zaroori, `created_at` = abhi.
- Statement booking ke slot ke business day par filter hoga. "Paisa kaise aaya" aur Len-den `money_business_date` par.
- **Statement mein kaun si bookings (founder, 13 Nov):** booked / completed / no_show / cancelled hamesha. `held` aur `payment_submitted` **sirf tab** jab un par koi approved paisa ho (net ≠ 0), maslan advance approve ho chuka aur sirf baqi ka screenshot review mein hai; warna asal mila hua paisa gaib ho jata.

### 2.2 No-show (`venues.no_show_charge`)
- `advance` (default): no-show mark karte hi `no_show` adjustment = max(final − net, 0). Final = net, settled.
- `full`: koi adjustment nahi. Due = baqi raqam, aur "kam mila" flow khud shuru hota hai (`open_short_claim`, player ko 24 ghante jawab ke liye).
- **No-show ulta** (owner-only): `no_show` adjustment ko reverse karo, status completed. Price kabhi seedha nahi likha jayega. Owner jo nayi final raqam bataye, us mein farq ho to woh alag `price_reduced` adjustment banega (wajah ke saath).
- Player was here → baqi raqam Due (test 8.2).

### 2.3 Cancel
- **Player, cutoff se pehle** (aur `cancellation_allowed`): `cancellation` adjustment = poora final. Jo diya sab refund_due (`cancel_refund`). Refund jis payment entry ka hai, us se link hoga.
- **Player, cutoff ke baad**, sirf jahan `cancellation_allowed = true` (sirf `ledger_v2` ON par; OFF par aaj jaisa block). **`cancellation_allowed = false` wale venue par player ka cancel band hi rahega** (owner ki setting nahi tootegi):
  - Cancel ki ijazat hai.
  - Cancel se pehle player ko saaf dikhe: **"Advance PKR X wapas nahi hoga"** / "Advance PKR X will not be refunded". Confirm zaroori.
  - `cancellation` adjustment = final − net. Final = net, `cancel_kept`.
  - Slot foran khulta hai, aur maujooda `notify_waitlist_slot_available` chalta hai.
  - Net = 0 ho to `cancel_clear`.
- **Owner / staff ki cancel sheet** mein zaroori choice **"Kis ne cancel ki: Player / Venue"** (`cancelled_for: "player"|"venue"`). Ijazat maujooda `cancel_booking` par rahegi (Part 12 nahi badla).
  - **Player** (player ne phone par cancel karwaya): player wala rule. Cutoff se pehle poora refund, baad mein advance rakha. Sheet par "Advance PKR X wapas nahi hoga" dikhe.
  - **Venue**: hamesha poora refund (`cancellation` = final, refund_due = net).
- **Goodwill:** "Raqam kam karein" (`price_reduced`, wajah zaroori), phir refund.

### 2.4 Zyada paisa (har raste par ek hi rule)
Raste: record payment, walk-in, advance approve, balance screenshot approve, owner ka transfer, no-show ulta, due done.
- Jo aaya **sab** `payment` entry banta hai (cash ya transfer).
- Advance se zyada lekin final se kam: bara advance hai, koi refund nahi. Approve par `accept_mode = "advance_only"` ledger_v2 mein **hat jata hai**.
- Final se upar wala hissa `excess`: request mein `excess_choice` zaroori hai:
  - `refund`: refund_due ban jata hai, aur us payment entry se linked `payment_disputes` row (reason `overpayment_excess`).
  - `credit`: usi transaction mein `credit_out` entry (−excess) + `player_credits` (+excess).
  - `excess_choice` na ho → `409 EXCESS_CHOICE_REQUIRED`, `details: {excess_pkr, can_credit}`. UI choice dikhati hai. **Chupke se kuch accept nahi hota.**
  - **Staff:** jama owner-only hai, is liye staff ke liye sirf `refund` (staff ko `can_credit = false`; `credit` bheje to `403 OWNER_ONLY`). Owner baad mein Kaam → Wapas dena se **"Jama rakhein"** kar sakta hai: refund_due `credit_out` + `player_credits` ban jata hai, dispute utni raqam se kam ya band.
  - **Approve:** manual approve dialog mein extra ho to choice **hamesha** dikhe, "Player ko wapas" pehle se chuna hua. Auto-approve (Khud) par default `refund`. API par choice na ho to wahi 409.
- Booking row `FOR UPDATE` lock rahega (maujooda pattern).
- **Bug 1 (walk-in 4,000 / 2,000)** aur **bug 2 (balance screenshot zyada)** isi rule se band ho jate hain. Screenshot approve dialog mein owner choice deta hai. Default hamesha `refund` (player ka paisa chupke se jama mein nahi jata).

### 2.5 Player credit (jama)
- Key: `venue_id` + (`player_id`, ya account na ho to `phone`). Jab us phone se account bane, purana jama us account ka shumar hoga (query `player_id = X OR phone = user.phone`).
- Jahan na player_id ho na phone, wahan credit ka option hi nahi (`can_credit = false`). Sirf "Player ko wapas".
- **Use:** agli booking par `credit_in` entry (+) aur `player_credits` (−).
  - Had: use ≤ jama, aur use ≤ booking ka baqi.
  - Credit Cash/Transfer totals mein nahi aata. Len-den mein "Jama se" / "Jama mein" alag dikhega.

### 2.6 Refunds
- Har refund (`overpayment_excess` aur `cancelled_payment_received` samet) dene par `refund` entry (−) banegi, jo dispute aur refund_transfer se linked hogi, aur `refund_of_entry_id` = jis payment se paisa wapas gaya.
- Method:
  - Owner chunta hai: **Transfer** (Reference zaroori, screenshot optional, aaj jaisa) ya **Cash** (note zaroori; founder ne manzoor kiya).
  - Default Transfer. Cash refund ka form mein option naya hai.
- Had: refund ≤ refund_due (aaj bhi hai).
- **Refund wapas khulna** (Khelo escalation ka "nahi mila"): us refund entry ka **reversal** (`kind = correction`, `reverses_entry_id`). "Other payment" nahi.
- `payment_disputes` workflow ki rows hain (payout account, transfers, Mil gaya / Nahi mila), raqam ka source nahi. Check: har booking par open disputes ka remaining = refund_due (3.3).

### 2.7 Galti theek karna
Kuch edit ya delete nahi hota.
- Payment galat → reversal (owner-only). Reversal ke baad refund_due kam ho to khule refund disputes (sab se naya pehle) utne chhote / band ho jate hain (`sync_refund_disputes`), taake Kaam mein jhoota "Wapas dena" na bache.
- Adjustment galat → us adjustment ka reversal (owner-only).
- Dono par wajah zaroori, aur reversal original se link.

### 2.8 Duplicate
Same booking + same raqam + same method, pichle 10 min mein → `409 POSSIBLE_DUPLICATE` (`details: {entry_id, recorded_at, by}`). UI poochti hai; dobara bhejne par `confirm_duplicate: true`.

---

## 3. Schema

### 3.1 Migration `xxxx_ledger_v2` (down_revision `c3e8a1f5b902`)

**`bookings`**
- `+ base_price NUMERIC(10,2) NULL`. Backfill ke baad app ise `price` ke saath likhegi. Agle release mein NOT NULL (column khali chhodne se purane rows nahi tootenge).

**`booking_adjustments` (naya)**
| column | type | |
|---|---|---|
| id | uuid pk | |
| booking_id | uuid fk bookings, index | |
| kind | varchar(16) | `points` / `no_show` / `cancellation` / `price_reduced` / `waived` |
| amount_pkr | int | hamesha > 0 (nishan kind se) |
| reason | text null | price_reduced / waived par zaroori |
| created_by | uuid fk users null | null = system |
| reverses_adjustment_id | uuid fk self null, unique | reversal |
| short_claim_id | uuid fk short_payment_claims null | waive ka source |
| backfilled | bool default false | |
| created_at | timestamptz | |

Check constraint: `amount_pkr > 0`.

**`payment_entries`**
- `+ kind varchar(12) NOT NULL default 'payment'`: `payment` / `refund` / `correction` / `credit_in` / `credit_out`.
- `+ money_business_date date NULL`. Backfill ke baad NOT NULL (agla release).
- `+ refund_of_entry_id uuid fk payment_entries null`
- `+ dispute_id uuid fk payment_disputes null, index`
- `+ refund_transfer_id uuid fk refund_transfers null, unique`
- `+ backfilled bool default false`
- `payment_method` enum ko **haath nahi lagana**. Credit rows `method = other` aur `kind` se pehchani jayengi, taake Postgres `ALTER TYPE … ADD VALUE` ka transaction wala jhanjhat na ho. Purani `other` payments "Doosra" naam se dikhengi.

**`player_credits` (naya)**
| column | type | |
|---|---|---|
| id | uuid pk | |
| venue_id | uuid fk venues, index | |
| player_id | uuid fk users null, index | |
| phone | varchar(20) null, index | +923XXXXXXXXX |
| delta_pkr | int, ≠ 0 | + jama hua, − use hua |
| booking_id | uuid fk bookings | |
| entry_id | uuid fk payment_entries, unique | credit_out / credit_in entry |
| created_by | uuid fk users null | |
| note | text null | |
| created_at | timestamptz | |

Check: `player_id IS NOT NULL OR phone IS NOT NULL`.

**`venues`**
- `+ no_show_charge varchar(10) NOT NULL default 'advance'`, check `IN ('advance','full')`.

**Feature flag:** `FeatureFlagKey.LEDGER_V2 = "ledger_v2"`, `DEFAULT_OFF_FLAGS` mein shamil, label + description. Row ki zaroorat nahi.

### 3.2 Backfill (`scripts/ledger_v2_backfill.py`)
Ek booking par ek transaction. Dobara chalana safe (`backfilled` flags). `--dry-run` sirf report deta hai.

1. **Entries ka kind:**
   - `reverses_entry_id` ho → `correction`.
   - Note `Booking completed…` aur raqam < 0 → `correction`.
   - Note `Refund paid (…)` → `refund` (dispute ko booking + raqam + waqt se match karke link).
   - Note `Refund taken back by Khelo…` → `correction`, us refund entry ka reversal (`reverses_entry_id`).
   - Baaqi negative → `refund`. Baaqi sab → `payment`.
2. **`money_business_date`** = `business_date(venue, created_at)`, **aaj ke** closing schedule se. Jahan schedule baad mein badla ho, wahan din mein farq ho sakta hai: report mein raat 00:00–08:00 PKT wali entries ki list alag (jin ka din calendar din se mukhtalif aaya).
3. **Adjustments (audit log se, waqt ke hisaab se):**
   - `booking.points_redeemed` → `points` (discount_pkr).
   - `booking.due_waived` aur Khelo escalation ka waive (refund_flow_service, `price → paid`) → `waived` (old − new). Price wapas `old` ho jati hai, kyunki maaf ab price mein nahi.
   - `booking.noshow_reversed` jahan price kam hui → `price_reduced` (old − new), reason "purana no-show faisla".
   - `base_price` = maujooda price + points + price_reduced + waived (jo price se ghataya gaya tha).
4. **Purane no-show** (aaj ka matlab: advance rakha, baqi ignore): `no_show` adjustment = max(final − net, 0). Agar us booking par khula short claim ho → adjustment nahi; woh check list mein jayega.
5. **Uncredited refunds** (`overpayment_excess`, `cancelled_payment_received`), jinka paisa kabhi ledger mein nahi aaya:
   - Paisa aane ki `payment` entry: +refund_amount, method transfer, `created_at` = proof ke `reviewed_at` (warna dispute `created_at`), note "backfill: zyada aaya paisa".
   - Jo diya ja chuka us ki `refund` entry: −refunded_amount, `created_at` = `refunded_at`, dispute + transfer se link.
   - Asar: in dino ka purana "Mila" barh jayega aur "Wapas diye" bhi. Net wohi rahega. Report mein din-wise farq dikhega.
   (Yeh step purane cancel se **pehle** chalta hai, taake cancel adjustment sahi net par bane.)
6. **Purane cancel:** open refund remaining `R` (disputes se) le kar `cancellation` = final − (net − R). Yeh negative aaye → adjustment nahi, check list mein.
6a. **Zyada paisa jis ka dispute nahi (S16 walk-in jaisa, founder 13 Nov):** cancel ke baghair booking par refund_due > khule disputes ka remaining ho to farq ka `overpayment_excess` dispute banta hai (us payment entry se linked, jo zyada aayi), taake Kaam → Wapas dena mein aaye. Aisa paisa aksar typing ki ghalti hota hai, is liye owner ke paas us entry par "Ghalti theek karein" (reverse) rehta hai; reverse se refund_due ghatta hai aur dispute **khud** utna chhota / band ho jata hai (2.7 ka sync).
7. Har touched booking par `recompute_payment_totals`.
8. Report `docs/design/ledger-v2-backfill-report.md` mein (booking id, kya bana, purana aur naya price / paid / due) + din-wise "Mila" / "Wapas diye" ka farq.
9. **Backfill abhi sirf local/dev DB par. Prod par sirf founder ke kehne par.**

### 3.3 Check (`scripts/ledger_v2_check.py`), har booking par
Identity khud definition se barabar hai, is liye asal check bahar ke sources se milata hai:
- C1 `bookings.price == base_price − deductions`
- C2 `bookings.amount_paid == Σ entries`
- C3 `bookings.balance_due == max(final − net − waived, 0)`
- C4 refund_due == open disputes ka Σ remaining (`refund_amount − refunded_amount`)
- C5 due (khel chuki bookings par) == open short claim ka `due_pkr` (agar claim ho)
- C6 `final ≥ 0`, `waived ≤ final`, koi adjustment negative nahi
- C7 identity `final == net + due + due_at_slot + waived − refund_due`, bookings ke set par bhi
- C8 har `refund` entry ka dispute link ho; har `credit_out` / `credit_in` ki `player_credits` row ho

Output: jo bookings fail hon unki list (id, short code, kaun sa check, numbers) `docs/design/ledger-v2-check-report.md` mein, aur aap ko di jayegi. Fail wali bookings khud theek **nahi** hongi; aap faisla karenge.

---

## 4. Backend changes

### 4.1 Permissions (backend mein enforce, UI mein chhupayein)
| kaam | kaun |
|---|---|
| Paisa darj karna, hazri | staff: `record_payments` / `check_in` (aaj jaisa) |
| Refund ho gaya mark karna | `mark_refunds` (aaj jaisa) |
| Booking cancel | `cancel_booking` (aaj jaisa) |
| Paisa entry ka reversal | **owner-only** (aaj: record_payments) |
| Maaf karna, raqam kam karna | **owner-only** |
| Jama (credit) dena / use karna | **owner-only** |
| No-show ulta | **owner-only** (aaj: record_payments) |
| Jhagre ka faisla (Raqam lein / Maaf karein) | **owner-only** (aaj: record_payments) |
| "Bank mein nahi mila" + staff/player faisla | **owner-only** (aaj jaisa) |
| Dekhna | `view_ledger`; Kaam ka "Wapas dena" group `mark_refunds` |

Owner-only ab `ledger_v2` ON par hi lagega (OFF par aaj jaisa). Staff ko `403 OWNER_ONLY`.

Caps:
- refund ≤ refund_due
- waive ≤ due
- credit use ≤ jama aur ≤ baqi
- Players tab ki payment ≤ player ka kul due

### 4.2 Purana code jo badlega
**Read path flag se azaad, hamesha lagega:** backfill waived bookings ka price wapas purana karta hai, is liye `booking_money()`, `recompute_payment_totals` aur har `price − paid` wala hisaab waived ko **hamesha** ghatata hai (flag OFF par bhi), warna flag OFF par maaf ki hui bookings dobara baqi dikhengi. Flag sirf naye write paths, screens aur rules ke liye hai.
- `recompute_payment_totals`: `balance_due = max(price − net − waived, 0)`.
- `bookings.price` likhne wali 4 jagahein adjustment par jayengi, price sirf recompute likhega:
  - `phase3_service.redeem_points` (281)
  - `decide_short` waive (494)
  - `reverse_noshow` (613)
  - `refund_flow_service` escalation waive (704)
- `price − amount_paid` se baqi nikalne wala har code `booking_money()` par jayega, warna maaf ki hui bookings dobara baqi dikhengi. Files:
  - `api/availability.py`, `api/bookings.py`, `api/payments.py`
  - `services/booking_service.py`, `owner_dashboard_service.py`, `owner_overview_service.py`
  - `payment_service.py`, `phase3_service.py`, `payment_ledger_service.py`
  - Build se pehle grep list contract ke saath dobara di jayegi.
- `owner_dashboard_service.ledger`: `kind` column se type, sign ya note se andaza nahi.
- `UNCREDITED_REFUND_REASONS`: nayi rows ke liye khatam. Purane data ke liye backfill ke baad hata diya jayega.
- `create_walkin`, `record_entry`, balance-proof approve, `confirm_booking`: 2.4 ka rule.
- `mark_no_show`: 2.2. `cancel`: 2.3. `mark_refund_paid`: 2.6.

---

## 5. API (sab `/api/v1`, naye endpoints `ledger_v2` OFF par 404)

Paisa `int` PKR. Dates `YYYY-MM-DD` (business day). Muddat ki keys:
`today | this_week | yesterday | last_7 | last_30 | this_month | last_3m | last_6m | last_1y | all | custom`.
`yesterday` sirf Bookings tab ke "Kal" ke liye. **Default `this_month`.**

### 5.1 `GET /owners/paisa/summary?venue_id&court_ids&period&from&to`
```jsonc
{
  "right_now": {               // date filter se azaad, court filter lagta hai
    "due": 0, "due_count": 0,
    "refund_due": 0, "refund_count": 0,
    "advance_received": 0,     // upcoming bookings par mila net
    "player_credit": 0,        // venue ka kul jama
    "pending_approval": 0, "pending_count": 0
  },
  "range": { "from": "2026-11-01", "to": "2026-11-12" },
  "counts": { "bookings": 36, "played": 27, "no_show": 3, "cancelled": 5 },
  "statement": {               // slot ke business day par
    "booking_amount": 0,
    "deductions": { "total": 0, "points": 0, "no_show": 0, "cancellation": 0, "price_reduced": 0 },
    "final": 0,
    "received": 0,             // = net
    "due": 0, "due_at_slot": 0, "waived": 0, "refund_due": 0
  },
  "money_in": {                // money_business_date par
    "cash": 0, "transfer": 0, "other": 0,           // other sirf purani rows
    "refunds_paid": { "cash": 0, "transfer": 0, "total": 0 },
    "credit_in": 0, "credit_out": 0,
    "net": 0
  },
  "by_month": [ { "month": "2026-10", "final": 0, "received": 0, "due": 0, "refund_due": 0, "net_in": 0 } ]  // >= 40 din par
}
```

### 5.2 `GET /owners/bookings-history`: maujooda endpoint, **barhaya jayega** (naya nahi)
- Naye query params: `period`, `money_status` (1.1 ki keys), `booking` (focus).
- Purane params wahi rahenge: `q`, `court_ids`, `statuses`, `staff`, `act`, `page`, `page_size`, `date_from`, `date_to`.
- Har row mein naye fields: `final`, `received`, `balance`, `due`, `due_at_slot`, `refund_due`, `waived`, `money_status`, `short_code`.
- Totals: statement jaise numbers.
- `export.csv` mein bhi yahi columns.
- Screen par jo number hai, CSV mein bhi wahi (test 8.10).

### 5.3 `GET /owners/bookings/{id}/money`
```jsonc
{
  "booking": { "id": "…", "short_code": "KH-…", "player": "…", "phone": "…", "court": "…", "starts_at": "…", "ends_at": "…", "status": "…", "money_status": "part_paid" },
  "calc": { "booking_amount": 0, "deductions": [ { "id": "…", "kind": "points", "amount": 0, "reason": null, "by": "…", "at": "…", "reversible": true } ],
            "final": 0, "received": 0, "waived": 0, "balance": 0, "due": 0, "due_at_slot": 0, "refund_due": 0 },
  "dispute": { "player_message": "…" } ,          // jab ho
  "history": [ { "at": "…", "business_date": "…", "kind": "payment", "method": "cash", "amount": 0, "by": "…", "note": null, "entry_id": "…", "reversible": true } ],
  "actions": ["record_payment","collect","waive","reduce_price","refund","credit","use_credit","reverse_entry","reverse_noshow","cancel"],   // role ke mutabiq
  "credit_available": 0, "can_credit": true
}
```

### 5.4 `GET /owners/paisa/daybook?venue_id&court_ids&period&from&to&show=money|with_deductions|deductions&method&person`
- `days[]`: `{ date, label_key, total, rows[] }`.
- Row: `{ entry_id | adjustment_id, at, kind, method, amount, player, by, booking_id, short_code, slot_business_date, note, paid_before, paid_after }`.
- Footer: `{ in, out, net, cash_by: [{ name, amount }] }`.
- Filter "Sirf refunds" = `show=money&kind=refund`.

### 5.5 Players
- `GET /owners/paisa/players?venue_id&q`:
  - Har row `{ key: {player_id|phone}, name, phone, due_total, credit, open_bookings: [{ booking_id, short_code, slot_date, due }] }`.
  - Open balance wale pehle, bookings sab se purani pehle.
  - Header: `{ points_awarded, points_used }`.
- `POST /owners/paisa/players/payment`, body `{ key, amount_pkr, method: "cash"|"transfer", proof?, business_date?, note? }`:
  - Raqam sab se purani booking par pehle lagti hai.
  - Transfer → screenshot Approvals mein.
  - Kul due se zyada → `excess_choice`.
- Response: `{ allocations: [{ booking_id, amount }] }`.
- WhatsApp share text client par banega, pehle se maujood helper se.

### 5.6 `GET /owners/paisa/tasks?venue_id`, Kaam
```jsonc
{ "total": 0,                       // badge; mark_refunds-only staff ke liye sirf refunds
  "groups": [
    { "key": "short_decide",   "count": 0, "items": [ … ] },   // Hisaab par faisla (sirf disputed, faisla baqi)
    { "key": "noshow_reply",   "count": 0, "items": [ … ] },   // No-show par player ka jawab (+GPS)
    { "key": "refund_due",     "count": 0, "total": 0, "oldest_days": 0, "items": [ … ] },  // Wapas dena (OwnerRefund + player phone)
    { "key": "refund_not_got", "count": 0, "items": [ … ] },   // Refund "Nahi mila"
    { "key": "bank_check",     "count": 0, "items": [ … ] },   // Bank se mila lein: nahi-mila ke faisle baqi + aaj ke transfers
    { "key": "screenshots",    "count": 0 },                   // Approvals ka count + link
    { "key": "attendance",     "count": 0, "items": [ … ] },   // Hazri lagayein
    { "key": "due_collect",    "count": 0, "items": [ … ] }    // Baqi wasooli (jawab nahi diya / player ne sahi kaha / aap ne kaha raqam leni hai)
  ] }
```
- Group ke items mein wohi shapes jo aaj `/owners/refunds`, `/owners/dues`, `/owners/staff-activity` (no-show, bank_missing) aur `/owners/bank-check` dete hain.
- Wapas dena / Refund "Nahi mila": `?date&court_ids` filter (Overview banner).
- "Jawab nahi diya" jhagra **nahi** hai: woh `due_collect` mein jata hai, `short_decide` mein nahi.
- `GET /owners/badges` ka `refunds` ledger_v2 ON par `tasks.total` ho jayega. Purana field rahega.

### 5.7 Likhne wale (naye / badle)
| endpoint | body | |
|---|---|---|
| `POST /bookings/{id}/payment-entries` (badla) | `{ amount_pkr, method: "cash"\|"transfer", proof? (multipart), business_date?, note?, excess_choice?, confirm_duplicate? }` | transfer → Approvals (owner foran approve kar sakta hai), 2.4, 2.8 |
| `POST /owners/payments/{payment_id}/approve` (badla) | `+ excess_choice?` | `advance_only` hata |
| `POST /bookings/walkin` (badla) | `+ excess_choice?` | |
| `POST /bookings/{id}/adjustments` | `{ kind: "price_reduced"\|"waived", amount_pkr, reason }` | owner-only |
| `POST /booking-adjustments/{id}/reverse` | `{ reason }` | owner-only |
| `POST /payment-entries/{id}/reverse` (badla) | `{ reason }` | owner-only |
| `POST /bookings/{id}/credit/use` | `{ amount_pkr }` | owner-only |
| `POST /owners/refunds/{dispute_id}/mark-paid` (badla) | `+ method: "cash"\|"transfer"`, `refund_of_entry_id?` | cash par note zaroori |
| `POST /owners/refunds/{dispute_id}/keep-as-credit` | `{ amount_pkr }` | owner-only, "Jama rakhein" (2.4) |
| `POST /bookings/{id}/cancel` (badla) | `+ accept_keep_advance?: true`; owner/staff ke liye `+ cancelled_for: "player"\|"venue"` (ledger_v2 ON par zaroori) | advance rakhne wale cancel par `accept_keep_advance` zaroori; na ho to `409 CANCEL_KEEPS_ADVANCE {advance_pkr}` |
| `GET /bookings/{id}/cancel-preview` | → `{ refund_pkr, keep_pkr, late }` | player ka confirm text |
| `PATCH /venues/{id}` (badla) | `+ no_show_charge` | settings + wizard |
| `POST /owners/short-payments/{id}/decide`, `/owners/noshow-replies/{id}/decide`, `/owners/bookings/{id}/noshow-reverse` | waise hi | owner-only (4.1), adjustments ke zariye |
| `GET /owners/ledger/export` (badla) | `+ kind, business_date` columns | |

Naye error codes: `EXCESS_CHOICE_REQUIRED`, `POSSIBLE_DUPLICATE`, `OWNER_ONLY`, `CANCEL_KEEPS_ADVANCE`, `BUSINESS_DATE_IN_FUTURE`, `BACKDATE_NOTE_REQUIRED`, `CREDIT_NOT_AVAILABLE`. Teeno jagah add honge: `errors.py`, web aur mobile friendly-message files (ru + en).

Types `packages/types` mein, client `packages/api-client` mein.

---

## 6. Screens

Labels LEDGER-BUILD-PROMPT A3 ke mutabiq. Sab language files se aayenge: web `messages/ru|en/odash-paisa.ts` (naya), mobile ka i18n. Hardcoded string koi nahi. Default ru.
- **Rule:** koi explanation box, banner ya help paragraph nahi. Sirf confirm messages, errors, empty states aur data (maslan "Player ne abhi account nahi bataya", dispute message).
- Light theme. Tabular numbers. Paisa "PKR 1,234".

### 6.1 Web `/dashboard/owner/paisa` (owner-shell, Floodlight)
- Header: "Paisa", venue naam, CSV.
- Tabs `?tab=bookings|lenden|players|kaam`, saath mein `&group=`.
- Staff ko sirf woh tabs dikhenge jo `view_ledger` / `mark_refunds` kholti hain; sirf `mark_refunds` wale ko sirf Kaam → Wapas dena.
- **Bookings tab:**
  - Abhi tak ke 5 cards → Kaam / Players.
  - Muddat ▾, Court ▾, chhoti tareekh, "Apni tareekhen" par From/To.
  - Statement: + aur − nishan ke saath; har box tap → booking list usi filter ke saath.
  - Paisa kaise aaya: Cash/Transfer bar, Wapas diye, Net (Doosra sirf jab ho).
  - 40+ din par Mahina-wise (band, khul sakta hai).
  - Search + Status ▾ + Staff filter banner + "sirf ye booking" focus + "Aur dikhao".
  - Row khulti hai: hisaab, history, actions; "Record payment" + "More ⋯" (role ke mutabiq).
- **Len-den tab:** din-wise list, din ka Kul, filters (5.4). Row ⋯ → "Ghalti theek karein" (owner). Footer In − Out = Net, Cash kis ne liya.
- **Players tab:** points line, search, open balance pehle. Player → raqam lein sheet (purani pehle), Save, WhatsApp.
- **Kaam tab:** 5.6 ke groups.
  - Wapas dena: aaj ki refunds list ki har cheez + player number + group header "Kul wapas dena + sab se purana X din".
  - Bank se mila lein: 7 din chunna, list, Kul, "Bank mein nahi mila" + staff/player faisla.
- `record-payment-sheet.tsx` (2.4, 2.8): Amount, Kaise mila (Cash / Transfer + screenshot), Business day, note, extra par choice.
- < 860px par mobile jaisa layout.
- **Redirects (`paisa-redirect.ts`):**
  - `?tab=hisaab` → bookings
  - `bank` → kaam&group=bank_check
  - `baqi` → players
  - `wapas` → kaam&group=refund_due
  - `/owner/ledger`, `/dues`, `/refunds`, `/bank-check` usi tarah
  - Notification `?tab=wapas&booking=X&open=1` → Kaam (Wapas dena) + booking sheet khuli
- **Staff ka kaam page:** no-show aur bank faislon ke buttons hat jayenge; sirf status line + "Kaam mein kholein". MoneyHealthCard waisa hi.
- Venue settings + wizard: No-show setting.

### 6.2 Mobile Paisa (HeroLayout, PaisaSwitch, maujooda components)
- Tab route `/(owner)/(tabs)/paisa` (naya), PaisaSwitch: Bookings · Len-den · Players · Kaam (badge).
- `(owner)/(tabs)/refunds.tsx` aur `ledger.tsx` hat jayenge. Is se **Expo web `/refunds` ka takraav** khatam (bug 5).
- **Bookings:**
  - Hero mein Abhi tak ke 2×2 glass tiles (Pending approval yahan nahi).
  - Muddat (Aaj, **Kal**, …) aur Court ke SelectButtons, chhoti ginti wali line.
  - Statement card, Money in card.
  - Search + Status, staff banner, focus banner, "Aur dikhao", CSV.
  - Cards → booking Sheet: KeyValueBlock, MoneyRows, actions, History, Record payment, More ⋯.
- **Len-den:** hero mein Net in + cash/transfer/refunds, din-wise groups. Row par "Theek karein" **nahi**; galti theek karna booking sheet ke More ⋯ mein. Cash kis ne liya.
- **Players:** web jaisa (sheet + WhatsApp).
- **Kaam:** GroupLabel + GroupCard; groups 5.6. Wapas dena mein player number box, Sab dikhao (filter hatana).
- Lambi lists FlashList.
- **Redirects:**
  - `/(owner)/history` → Paisa Bookings, saare params ke saath (from, to, courts, status, q, booking, open, staff, act, who).
  - `(owner)/dues` → Players.
  - `(owner)/bank-check` → Kaam (bank_check).
  - Notification helpers: refund → Kaam (Wapas dena) + sheet khuli; history → Bookings + sheet khuli.
  - Overview tiles, Staff ka kaam numbers aur "History mein dekhein" naye Bookings par sahi filter ke saath.
- **Aur menu:** Ledger / Refunds / Bank se mila lein / Baqi raqam / Bookings history → sahi tab ya group.
- **Tab badge** = `tasks.total` (mark_refunds-only staff ke liye sirf refunds).
- Mobile hero ke Aaj / Is hafte / Is mahine tiles hat jayenge.
- RecordPaymentSheet: sirf Cash / Transfer; Transfer = screenshot → Approvals; extra par choice; Business day; Kuch aur nahi.
- Staff ka kaam: buttons hat jayenge, status line + "Kaam mein kholein".
- Venue settings: No-show setting.

### 6.3 Player side
- Cancel sheet: `cancel-preview` se. Der se cancel par "Advance PKR X wapas nahi hoga" aur confirm. Web aur mobile dono.
- Booking detail mein "Cancel · advance rakha" ka text, ru + en.

### 6.4 Flag OFF par
Purane screens, routes aur rules bilkul waise. Naye routes purane par wapas bhejte hain.

---

## 7. Jo hatega (aap ki manzoori mil chuki)
- Web tabs: Hisaab / Bank check / Lena baqi / Wapas dena.
- Mobile: Ledger / Refunds tab + History screen (sab redirect).
- Mobile row par "Theek karein".
- Mobile hero ke collected tiles.
- Saare help texts.
- "Kuch aur" method (naye paise ke liye).
- Staff ka kaam ke faisla buttons.
- Approve ka `advance_only` mode.
- **Data kuch nahi hatega.**

---

## 8. Tests (merge se pehle; backend pytest + web vitest/e2e + mobile jest)

1. Identity har booking aur set par: date range × court × flag ON. Web, mobile aur Overview same numbers. CSV = screen.
2. 5,000 booking, 1,000 advance, no-show (`advance`) → Final 1,000, settled. "Player was here" → 4,000 Due. `full` setting → 4,000 Due + short claim khula.
3. 5,000 booking: 3,000 aaj, 2,000 mahine baad → Partly paid → Fully paid. Dono entries apne business day par.
4. 500 diya, cutoff se pehle cancel → refund_due 500, refund entry 500 wali entry se linked. Der se cancel → `cancel_kept`, slot khula, waitlist notification gayi. Flag OFF par der se cancel blocked. `cancellation_allowed = false` par player cancel flag ON par bhi blocked. Owner cancel "Player" → player rule; "Venue" → poora refund.
5. 2,000 advance maanga, 3,000 diye (5,000 booking) → Due at slot 2,000, koi refund nahi.
6. 6,500 diya 6,000 par → `EXCESS_CHOICE_REQUIRED`. `refund` → 500 refund_due. `credit` → 500 jama, net 6,000. Status `refund_due`. Staff `credit` → 403; owner baad mein "Jama rakhein". Manual approve dialog mein choice (refund pehle se chuna); auto-approve par refund.
7. Walk-in 2,000 par 4,000 → choice zaroori. Bina phone walk-in par `can_credit=false`.
8. Balance screenshot due se zyada → extra choice. Gum nahi hota.
9. Raat 1 baje (overnight venue) ka paisa pichle business day mein. Aage ki business_date → error. Purani date bina note → error.
10. Date range badalne se "Right now" nahi badalta.
11. Staff (record_payments) reverse / waive / reduce / credit / no-show ulta / jhagre ka faisla → 403 OWNER_ONLY (API), aur UI mein button nahi.
12. Caps: refund ≤ refund_due, waive ≤ due, credit use ≤ jama aur ≤ baqi, players payment ≤ kul due.
13. Duplicate 10 min → 409. `confirm_duplicate` ke saath chal jata hai.
14. Refund ho gaya → linked refund entry (overpayment_excess samet). Khelo refund wapas khole → reversal, "Doosra payment" nahi.
15. Backfill: fixtures (points, waive, Khelo waive, no-show ulta, purane no-show / cancel, uncredited refunds) → check script ke saare checks pass. Dobara chalane par kuch nahi badalta.
16. Pending / rejected screenshot kisi total mein nahi. Flag OFF par maaf ki hui booking baqi nahi dikhti (read path).
17. Redirects: web purane URLs + `?tab=`. Mobile history / dues / bank-check / notification links sahi tab, group aur sheet par.
18. Labels ru + en: Paisa ki koi string hardcoded nahi (lint/test jo `paisa` folders mein raw string pakde).
19. Mobile 390px aur chhote phone: kuch nahi katta. FlashList.
20. Screenshots: web + mobile, design files ke saath compare.

---

## 9. Build ka order (GO ke baad)
1. Branch + docs commit.
2. Migration + model + `booking_money()` + business_date + tests.
3. Backfill + check script. Local DB par chala kar report.
4. Write paths (2.2–2.8) + permissions + API.
5. Web Paisa.
6. Mobile Paisa.
7. Player cancel.
8. Redirects / notifications.
9. Poore tests + screenshots.
10. Report.
- Prod par migration / backfill / flag sirf aap ke kehne par.

## 10. Founder ke jawab (12 Nov)
1. Cash refund: haan, note zaroori.
2. `cancellation_allowed = false`: cancel **band** hi rahe; der se cancel sirf allowed venues par.
3. Backfill ka asar: theek; report mein din-wise farq.
4. Default refund: haan.
