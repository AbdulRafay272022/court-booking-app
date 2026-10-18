# Owner Round 2: read-only findings (agent R)

Date: 2026-10-18. Branch `feat/owner-round2`. Production was read with SELECTs only, each inside a transaction that started with `SET TRANSACTION READ ONLY`, plus the cron files and job log on the box. Nothing was written. Phone numbers and refund references are masked to their last 4 digits. Screenshot keys and URLs were not read.

Code line numbers refer to `court-booking-backend/` at commit 61fdd87.

---

## 1. A10: the refunds of Mujtaba Anwer (Padel 1) and Abbas Zafar

### 1.1 What production holds

All times are UTC (PKT = UTC+5). "adv" is the advance due. "paid" is `amount_paid`, which is the sum of `payment_entries`.

**Mujtaba Anwer** (8 bookings, all `source=app`)

| Booking | Court | Price | Adv | Paid | Balance | Status / why |
|---|---|---|---|---|---|---|
| e9b363fc | Padel 1 | 15,750 | 15,750 | 0 | 0 | cancelled, system, hold_expired |
| f6db65ba | Left Wing (KHA) | 10,500 | 10,500 | 5,000 | 5,500 | booked |
| eaf85c4c | Padel 1 | 10,500 | 10,500 | 5,000 | 5,500 | booked |
| fc772e2d | Padel 1 | 10,500 | 10,500 | 0 | 0 | cancelled, owner, "fake screenshot" |
| 4488880e | Padel 1 | 10,500 | 10,500 | 0 | 0 | cancelled, system, hold_expired |
| **1e495b1f** | **Padel 1** | **10,500** | **10,500** | **0** | **0** | **cancelled, player** (see 1.2) |
| 2ae1edcd | Padel 1 | 12,000 | 12,000 | 0 | 0 | cancelled, player (before any proof) |
| f60f4cc1 | Padel 1 | 8,000 | 8,000 | 0 | 0 | cancelled, owner, "name not matched" |

Mujtaba's payments (none auto-approved):

| Booking | amount_claimed | ocr_amount | ocr_verdict | review | reviewed after | is_duplicate |
|---|---|---|---|---|---|---|
| f6db65ba | 10,500 | 5,000 | mismatch | approved | 2.7 min | **true** |
| eaf85c4c | 10,500 | 5,000 | mismatch | approved | 19.6 min | **true** |
| fc772e2d | 10,500 | 5,000 | mismatch | rejected ("fake screenshot") | 7.6 min | true |
| **1e495b1f** | **10,500** | **10,000** | **match** | **rejected ("Screenshot unreadable")** | 5.9 min | false |
| f60f4cc1 | 8,000 | 8,000 | match | rejected ("name not matched") | 1.7 min | true |

Payment entries: one positive entry each on f6db65ba and eaf85c4c (5,000, `bank_transfer_proof`, note "Expected PKR 10,500. Screenshot showed PKR 5,000. Paid PKR 5,000. Credited PKR 5,000."). There are no reversals (`reverses_entry_id` is null everywhere).

Disputes: **1e495b1f has one `payment_disputes` row: reason `payment_rejected`, refund_amount **0.00**, refund_status **owed**, refunded_amount null, no reference, resolved false.** This is the only refund row Mujtaba has.

**Abbas Zafar** (13 bookings: 12 `app`, 1 `whatsapp`)

| Booking | Court | Price | Adv | Paid | Balance | Status / why |
|---|---|---|---|---|---|---|
| 021355b8 | Right wing (KHA) | 4,500 | 4,500 | 0 | 0 | cancelled, system, hold_expired |
| 32eac90b | Left Wing (KHA) | 4,500 | 1,500 | 0 | 4,500 | cancelled, player (refunded 450) |
| 4d333dd0 | Futsal 1 (Court Site) | 3,500 | 3,500 | 0 | 3,500 | cancelled, player (refunded 2,000), source whatsapp |
| 2e9f75f2 | Padel 1 | 10,500 | 10,500 | 0 | 0 | cancelled, system, hold_expired |
| **a642a4b4** | **Padel 1** | **7,000** | **7,000** | **0** | **0** | **cancelled, owner, "Screenshot unreadable"** |
| 850723a0 | Right wing | 22,000 | 22,000 | 15,000 | 7,000 | no_show |
| ad46a818 | Right wing | 8,250 | 8,250 | 450 | 7,800 | no_show |
| 4653209b | Right wing | 11,000 | 11,000 | 450 | 10,550 | no_show |
| **922d0960** | Right wing | 33,000 | 33,000 | 15,000 | 18,000 | cancelled, player |
| **d735afe1** | Right wing | 19,250 | 19,250 | 450 | 18,800 | cancelled, player |
| ec02a6f0 | Right wing | 5,500 | 5,500 | 0 | 0 | cancelled, player |
| 82d2c617 | Right wing | 8,250 | 8,250 | 450 | 7,800 | no_show |
| 8c00c6b7 | Right wing | 8,250 | 8,250 | 0 | 0 | cancelled, player |

Abbas's payments (none auto-approved). OCR amounts: 450 (verdict mismatch, approved), 2,000 (mismatch, approved), 5,000 (Padel 1 a642a4b4, mismatch, **rejected** "Screenshot unreadable"), 15,000 x2 (approved), 450 x4 more (approved), 15,000 on a 5,500 booking (rejected "customer back off"), 450 (rejected "1"). **Every payment after the first 15,000 and the first 450 was flagged `is_duplicate=true`, meaning the same screenshot was re-used. The owner still approved the duplicates:** the 450 screenshot was credited on 5 bookings and the 15,000 screenshot on 2.

Abbas's disputes:

| Booking | reason | refund_amount | status | refunded | reference? |
|---|---|---|---|---|---|
| 4d333dd0 | player_cancelled_paid_booking | 2,000 | refunded | 2,000 | yes (entry -2,000 "Refund paid (***4214)") |
| 32eac90b | player_cancelled_paid_booking | 450 | refunded | 450 | yes (entry -450 "Refund paid (***8610)") |
| a642a4b4 (Padel 1) | payment_rejected | **0** | **owed** | - | no |
| d735afe1 | player_cancelled_paid_booking | 450 | owed | - | no |
| 922d0960 | player_cancelled_paid_booking | 15,000 | owed | - | no |

### 1.2 Why the owner saw "That's more than what's owed" with "remaining PKR 0 of PKR 0"

This is the Mujtaba Padel 1 booking **1e495b1f** (Sun 18 Oct, 2:30 PM PKT, price 10,500, and the advance was the full 10,500):

1. 00:09 UTC: Mujtaba held the slot. 00:11: he sent a screenshot. OCR read **PKR 10,000**. That is within 5% of 10,500, so the verdict was `match`, and it was not a duplicate.
2. 00:16:38: **Mujtaba cancelled the booking himself while the payment was still waiting for approval.** `_flag_refund_for_voluntary_cancel` only writes a refund when an *approved* payment exists (`booking_service.py` 429-436). This payment was not approved yet, so **no refund was recorded** and nothing says that 10,000 may need to go back.
3. 00:17:09, 31 seconds later: the owner pressed **Reject** ("Screenshot unreadable") on the card that was still showing. The reject went through (the A5 bug). `reject_payment` then always adds a `payment_disputes` row with reason `payment_rejected` and **`refund_amount=0`** (`payment_service.py` 694-703). Its `refund_status` takes the column default **`owed`** (`models/dispute.py` 47-49).
4. The Refunds screen lists every dispute whose `refund_status == "owed"`, including zero-amount ones (`owner_dashboard_service.py` 338-350, filter at 346). `remaining_amount = max(refund_amount - refunded_amount, 0)` = 0 (line 371). The dialog prints "remaining PKR {remaining} of PKR {total}" with total = `refund_amount` = 0 (`apps/web/app/dashboard/owner/refunds/page.tsx` 179).
5. The owner typed 10,000. `POST /owners/refunds/{id}/mark-refunded` (`api/owners.py` 328-373) calls `AdminService.mark_refund_paid`. That computes `remaining = 0` (`admin_service.py` 335-337) and refuses any amount above `remaining + 0.01` with `REFUND_EXCEEDS_OWED_AMOUNT` (347-353). The web shows that code as "That's more than what's owed on this booking."

**What the player really sent:** the screenshot showed **PKR 10,000** against an expected advance of **PKR 10,500**. Mujtaba sent slightly *less* than the advance, not more. Because he cancelled before approval and the owner then rejected the proof, the app recorded **PKR 0 paid and PKR 0 owed**. If the 10,000 was real, nothing in the app tracks that it must be returned. The owner remembered "10,000" correctly, but the system had stored 0.

Abbas's Padel 1 booking a642a4b4 has the same zero row: OCR 5,000 against an advance of 7,000, rejected as "Screenshot unreadable", which created a `payment_rejected` dispute with 0 owed. Opening that row gives the same error for any amount. His two real open refunds are on Right wing: 450 (d735afe1) and 15,000 (922d0960). **Both rest on payments flagged as duplicates.** The 15,000 on 922d0960 is the same screenshot already credited on 850723a0. So the "15,000 owed" probably counts money that was sent only once.

### 1.3 How overpayment is handled today (A10.3)

- On approve, the credit is the amount the owner typed. If the owner typed nothing, it is the **OCR amount when OCR read one**, otherwise the advance (`payment_service.py` 84-90 `default_credit_amount`, used at 652).
- `confirm_booking` credits `min(paid, price)`. Anything **above the booking price** becomes a `payment_disputes` row `overpayment_excess` (refund owed) (`booking_service.py` 485-521).
- Anything above the **advance** but at or below the **price** is credited as extra advance. There is no refund and the owner gets no choice. The A10.3 choice "approve only 2,000, refund 8,000" would need the approve endpoint to accept a "credit X, owe Y back" split. `PaymentDispute` with reason `overpayment_excess` can already hold Y, so this probably needs **no schema change**: the service would just write the dispute when the credit is below the paid amount.

**Roman Urdu khulasa:** Mujtaba ne 10,500 ke advance ke liye screenshot bheja jis mein 10,000 likha tha. Phir usne approval se pehle khud booking cancel kar di, is liye koi refund record nahi bana. 31 second baad owner ne "Reject" dabaya. Reject hamesha 0 rupay wala "refund" record banata hai jis ka status "owed" hota hai, is liye wo Refunds list mein "PKR 0 mein se PKR 0 baqi" dikhata hai. Owner ne 10,000 likha to system ne kaha "zyada hai", kyunke system ke hisaab se 0 wapas dena tha. Asal mein player ne 10,000 bheje (advance se 500 kam). Abbas ke Padel 1 wale record mein bhi yehi 0 wala masla hai. Uske 15,000 aur 450 wale refunds duplicate screenshot par bane hain.

---

## 2. A4: Channel (`bookings.source`)

**Code.** The enum has 4 values (`models/booking.py` 22-26): `app`, `whatsapp`, `walkin`, `phone`.

- `app`: the default for every player hold (`booking_service.py` 32 `booking_source_ctx` default APP, applied at 190). It covers the **website, the mobile app and the in-app chat assistant**. They are not told apart (`api/bookings.py` 61, `ai_chat_service.py` 1534).
- `whatsapp`: the WhatsApp webhook sets the context to WHATSAPP while it handles an incoming message (`api/webhooks.py` 543-549). Every hold made there (Yes button, typed "yes", AI hold) gets `whatsapp`.
- `walkin`: `create_walkin` (`booking_service.py` 260), `POST /bookings/walkin`. The source is the same whether the **owner or a staff member** added it. Who added it is in `audit_log` (`action='booking.walkin'`, `actor_user_id`). Comparing that actor with the venue owner tells owner from staff without a migration.
- `phone`: **no code ever sets it.** It is dead.

**Production counts (all time):** app 22, walkin 7, whatsapp 2, phone 0. (Last 30 days: app 22 = 2 booked, 16 cancelled, 4 no-show; walkin 7 = 1 booked, 6 no-show; whatsapp 2 = 1 booked, 1 cancelled.)

**Gap for the requested labels:** "App chat" vs "Website" (vs mobile app) cannot be told apart from stored data. That would need a new source value or column (Stage 2). "Staff ne add ki" can be derived from `audit_log` now.

**Roman Urdu rule:** Player ne website, app ya app ki chat se booking ki to "app". WhatsApp par chat ya button se ki to "whatsapp". Owner ya staff ne khud dashboard se add ki to "walkin" (staff ya owner ka farq audit_log se pata chalta hai). "phone" kabhi set nahi hota.

---

## 3. A6: Escalation ladder and why WhatsApp vs SMS

**Code** (`notification_service.py` 436-509, `jobs/expiry_job.py` 64-100):
- When a payment proof arrives: a **push** to the owner right away (`notify_payment_submitted`, event `payment_submitted`).
- The expiry job runs every minute. For each booking still in `payment_submitted`, it works out minutes since submission as `payment_deadline - PAYMENT_REVIEW_HOURS`:
  - After **ESCALATION_WHATSAPP_MINUTES (5)**, once: a WhatsApp to the owner (`payment_submitted_whatsapp`). If the owner messaged the business number in the last 24h, it goes as free text. Otherwise it needs the template `payment_submitted_owner` (`whatsapp_service.py` 306-329).
  - After **ESCALATION_SMS_MINUTES (15)**, once: an SMS (`payment_submitted_sms`).
  - After **PAYMENT_REVIEW_HOURS (2h)**, the booking auto-cancels as `payment_review_expired`.
- Every other owner/player event (booking confirmed/cancelled, payment approved/rejected, new booking, refund owed/paid, venue events) goes **WhatsApp + push**. Only this one ladder ever uses SMS.
- **Templates are not approved in Meta.** Outside the 24h window every template send fails with Meta error **132001** (template does not exist). It is logged `status='failed'` and the action itself still succeeds (`_whatsapp_smart_best_effort`, 162-195).
- **SMS is not configured in production.** The box's job log shows `sms.send.skipped_no_token` (5 times, most recently 2026-10-16 23:02 UTC). But `escalate_payment_submitted` logs every SMS as **`sent`** whatever happened (499-506). So the `sms | sent` rows are false: no SMS has ever left.

**Production `notification_log`, last 30 days (event_type x channel x status):**

| event_type | channel | status | n |
|---|---|---|---|
| booking_cancelled | push | sent | 3 |
| booking_cancelled | whatsapp | sent / failed | 12 / 1 |
| booking_confirmed | push | sent | 2 |
| booking_confirmed | whatsapp | sent / failed | 4 / 7 |
| booking_reminder | push | sent | 1 |
| owner_daily_digest | whatsapp | sent | 2 |
| owner_new_booking | whatsapp | sent / failed | 2 / **20** |
| payment_rejected | push | sent | 3 |
| payment_rejected | whatsapp | sent | 7 |
| payment_submitted_whatsapp | whatsapp | failed | **5** |
| payment_submitted_sms | sms | "sent" (actually skipped) | 1 |
| refund_owed | whatsapp | failed | 2 |
| refund_paid | whatsapp | sent | 2 |
| venue_approved | whatsapp | sent | 2 |
| venue_pending_review | whatsapp | failed | 5 |

All 40 WhatsApp failures have the same cause: `send_failed; meta_error_code=132001`. All 31 WhatsApp successes were free text sent inside the 24h window. (A failed send stores `template_name` null, so the log cannot show which template was tried.) The `payment_submitted` push itself has no log row in the window. Push rows exist only for the users with an active token.

**Roman Urdu:** Payment aate hi owner ko push jata hai. 5 minute tak approve na ho to WhatsApp, 15 minute tak na ho to SMS. Baqi sab notifications (booking, cancel, refund, venue) sirf WhatsApp + push par jati hain, SMS sirf is payment-reminder ki aakhri seerhi hai. WhatsApp tab hi pohanchta hai jab us bande ne pichle 24 ghante mein humein message kiya ho. Warna template chahiye, aur templates abhi Meta mein approve nahi hain, is liye wo fail hote hain (132001). SMS ka provider abhi laga hi nahi hai, is liye SMS kabhi nahi gaya, chahe log mein "sent" likha ho.

---

## 4. B1: Current timers

**Constants** (`app/config.py`): `BOOKING_HOLD_MINUTES = 15` (74), `PAYMENT_REVIEW_HOURS = 2` (84), `ESCALATION_WHATSAPP_MINUTES = 5` (93), `ESCALATION_SMS_MINUTES = 15` (94), `NO_SHOW_GRACE_MINUTES = 60` (85).

**Production values: NOT READ directly.** The script that read them with `get_settings()` inside the container was blocked by the permission classifier, so I stopped that part. Indirect evidence fits the defaults: on prod, expired holds were cancelled a median **15.4 min** after creation (max 15.8), which means the hold is 15 min plus up to 1 min of cron delay.

**Cron on the box** (`/etc/cron.d/court-booking`, schedule lines only):
```
* * * * *     runner expiry      (expiry + no-show + escalation + waitlist + unverified purge)
*/10 * * * *  runner reminders
0 3 * * *     runner digest      (08:00 PKT)
0 21 * * *    runner growth      (02:00 PKT)
```
The `billing` line in the repo's `infra/scripts/court-booking.cron` (`0 22 * * *`) is **not on the box** (that file is a hand-copied first-boot copy). Root's crontab is empty. The job log shows the expiry job finishing every minute.

**What the expiry job does per status** (`booking_service.py` 700-793, `expiry_job.py` 20-50):
- `held` with `held_until < now`: becomes `cancelled`, `cancelled_by=system`, `hold_expired`. The player gets "booking cancelled" (WhatsApp + push) and waitlisters for that time are notified.
- `payment_submitted` with `payment_deadline < now` (submission + 2h): becomes `cancelled`, `payment_review_expired`. Player **and** owner get "booking cancelled". If the proof was not a duplicate and the OCR verdict was not `mismatch`, a `payment_review_expired` dispute is written with refund_amount 0.
- `booked` that started 60 min ago or more without a check-in: becomes `no_show`.
- **Not immediate:** availability does not treat `held_until <= now` as free (`availability_service.py` has no such check), so an expired hold blocks the slot until the next cron run (up to about 1 min). A proof uploaded after cron has cancelled the hold gets a plain 400 "Booking is not awaiting a payment proof" (`payment_service.py` 399-403). Before that cron run it is still accepted.
- **No reminder to the player** before the hold expires (nothing in the jobs does it).

**What the player sees:**
- Web/mobile pay screen: a live countdown "Held · {m:ss} left" / "Hold · {m:ss} baqi". It turns red under 2 min (`apps/web/app/booking/[id]/pay/page.tsx` 52, 172-177).
- On expiry: "This hold expired. You didn't complete payment in time, so the slot was released." / "Yeh hold khatam ho gaya...".
- While under review: "The venue is reviewing your screenshot..." There is no countdown for the 2h review window.
- Chat/WhatsApp: "Please pay {advance} within {hold_minutes} minutes to confirm" / "...{hold_minutes} minute ke andar bhej dein" (`reply_text.py` 99-107, with `BOOKING_HOLD_MINUTES` passed in from `webhooks.py` 251).

**Production numbers (last 30 days):**
- Player holds (app + whatsapp): **24**. Expired holds (`hold_expired`): **5**. `payment_review_expired`: **0**. Player cancels: 8. Owner cancels (= rejects): 4.
- Hold to first proof (18 bookings with a proof): **median 0.25 min (15 s), p90 1.8 min, max 11.3 min**. 17 of 18 arrived in under 2 min, 1 in 10-15 min.
- Proofs stored after the 15-min hold: **0**. Proofs refused *after* cancellation are not stored, so how many players tried late is **not derivable**.
- Owner review time (18 manual reviews, none auto): **median 4.3 min, p90 11.3 min, max 19.6 min**. 7 took over 5 min (so the WhatsApp escalation fired and failed), 1 took over 15 min (the SMS "sent" that was really skipped).
- Review verdicts: approved 11 (all OCR `mismatch`), rejected 7 (2 match, 4 mismatch, 1 unreadable). Auto-approve: 0.
- Pending right now: none in `held` or `payment_submitted`.

**Roman Urdu:** Slot 15 minute hold hota hai. Har minute cron chalta hai jo waqt guzarne par hold cancel karta hai (asal mein 15 se 16 minute). Screenshot aane ke baad owner ke paas 2 ghante hain, phir booking khud cancel ho jati hai. Player ko pay screen par countdown dikhta hai, lekin expiry se pehle koi reminder nahi jata. Prod par players aam tor par 15 second mein screenshot bhej dete hain, aur owner aam tor par 4 minute (10 mein se 9 baar 11 minute ke andar) mein review karta hai. 30 din mein 5 hold expire hue.

---

## 5. A10/A11: Overpayment and advance settings in production

**Overpayment (all time, 18 payments):**
- OCR amount **above the advance**: **2** payments (2 bookings). Both were also above the **price**, because the advance equals the price on these courts:
  - Right wing: price/adv 5,500, OCR 15,000, duplicate, **rejected**.
  - Padel 2: price/adv 4,500, OCR 6,000, **approved**. 4,500 was credited and the 1,500 excess was queued as `overpayment_excess`, owed 1,500, not yet refunded.
- OCR **below** the advance: 14. OCR unreadable: 1. So the common prod case is **underpayment** (a partial advance), not overpayment.
- Disputes overall: overpayment_excess owed 1 (1,500); payment_rejected owed 3 (all **0**, the confusing rows); player_cancelled_paid_booking owed 2 (15,450) and refunded 2 (2,450 paid out).

**Advance settings per court:**

| Venue | Court | court advance_type / value / minimum | pricing_rules.advance_percentage |
|---|---|---|---|
| Court Site | Cricket | none / - / - | 100 (5 rules) |
| Court Site | Futsal 1 | **percent / 20 / -** | 100 (5 rules) |
| Court Site | Futsal 2 | none | 100 (5) |
| Court Site | Padel 1 | none | 100 (4) |
| Court Site | Padel 2 | none | 100 (4) |
| KHA Legends Arena | Center Mid | none | 100 (2) |
| KHA Legends Arena | Left Wing | none / - / **500** | 100 (2) |
| KHA Legends Arena | Right wing | none | 100 (2) |

The rule (`availability_service.py` 163-171) is: court fixed or percent if set, otherwise the pricing rule's `advance_percentage`. Then it is raised to `advance_minimum` if one is set, then capped at the price. **Every pricing rule on prod is 100%**, so on 7 of 8 courts the player must pay the **full price as the "advance"** (23 of 24 player bookings had advance = price). Left Wing's minimum 500 has no effect at 100%. Futsal 1's 20% should give a 20% advance. Abbas's Futsal 1 booking of 15 Oct still had advance = price (3,500), and his Left Wing booking had a 1,500 advance on 4,500. That suggests these settings were changed after those bookings, but the history is not stored, so this is **not verifiable**.

**Roman Urdu:** Prod par sirf 2 baar screenshot advance se zyada tha (ek reject hua, ek mein 1,500 extra refund ke liye "owed" hai). Zyada tar log advance se **kam** bhejte hain. Lagbhag har court par pricing ka advance 100% hai, yani player ko poori qeemat "advance" ke tor par deni parti hai. Sirf Futsal 1 par 20% set hai, aur Left Wing par 500 minimum, jo 100% ki wajah se koi farq nahi dalta.

---

## Could not read / not derivable
- Live production values of `BOOKING_HOLD_MINUTES`, `PAYMENT_REVIEW_HOURS`, `ESCALATION_*`, and whether SMS credentials are set. The `get_settings()` read was **denied by the permission classifier** and not retried. The SMS state was instead shown by the job log (`sms.send.skipped_no_token`).
- How many players tried to upload a proof after their hold was cancelled (refused uploads are not stored).
- The history of court advance settings (only current values exist).
- Which template a failed WhatsApp send tried (`template_name` is null on failure).

---

```
AGENT: R (read-only investigations, Owner Round 2)
DONE: A10 player trace (bookings, payments, entries, disputes, audit) + root cause with code lines;
      A4 source rule + prod counts; A6 ladder + 30-day notification_log matrix; B1 constants, box cron,
      expiry behaviour, player texts, prod hold/review timings; A10/A11 overpayment counts + per-court advance settings.
COULD NOT DO: read live settings values via get_settings() in the container (permission classifier denied;
      stopped, not retried). Late-proof attempts and settings history are not derivable from stored data.
KEY FINDINGS:
- "More than owed / remaining PKR 0 of PKR 0": the player (Mujtaba, Padel 1, 1e495b1f) cancelled while the proof (OCR 10,000 vs 10,500 advance) was pending, then the owner rejected 31 s later. reject_payment writes a 0-amount dispute that defaults to refund_status 'owed', so it shows in Refunds with 0 and any amount is refused. The real 10,000 is tracked nowhere.
- Abbas's open refunds (15,000 and 450) rest on duplicate screenshots the owner approved anyway (the 450 image credited on 5 bookings, the 15,000 on 2), so the refund owed is probably overstated. His Padel 1 row is another 0-amount 'owed' row.
- SMS is not configured on prod (job log: sms.send.skipped_no_token) but notification_log records SMS as 'sent'. All 40 WhatsApp failures in 30 days are Meta 132001 (templates not approved), so out-of-window owner alerts (new booking 20, payment escalation 5, venue review 5) never arrive.
- Timers are enforced by a 1-minute cron, not at read time: holds die after about 15.4 min, and availability still shows an expired hold as taken until then. Players pay fast (median 15 s) and owners review in a median of 4.3 min (p90 11.3). There is no player reminder before expiry. The billing cron line is missing on the box.
- Every pricing rule on prod is advance 100%, so the "advance" is the full price on 7 of 8 courts. Overpayment is rare (2 payments); underpayment is common (14 of 18). Overpayment above the price is already queued as an overpayment_excess refund, but extra above the advance (at or below the price) is silently credited. The A10.3 choice looks buildable without a schema change.
```
