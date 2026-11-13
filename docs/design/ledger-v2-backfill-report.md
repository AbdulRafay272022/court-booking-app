# Ledger v2 backfill report

2026-11-12 23:41 · committed · local/dev DB only

## Kya bana

| cheez | ginti |
|---|---|
| dispute_added_overpayment_excess | 1 |

## Har booking: pehle → baad

| booking | naam | status | price pehle → Final | paid pehle → net | baqi pehle → due / slot par / wapas | waived | pill | kya bana |
|---|---|---|---|---|---|---|---|---|
| `de54ad92` | S01 Partly | completed | 5,000 → 5,000 | 3,000 → 3,000 | 2,000 → 2,000 / 0 / 0 | 0 | part_paid | — |
| `b658a8fe` | S15 Refund reopened | cancelled | 0 → 0 | 1,000 → 1,000 | 0 → 0 / 0 / 1,000 | 0 | cancel_refund | — |
| `a55902ca` | S16 Walkin 4000 | completed | 2,000 → 2,000 | 4,000 → 4,000 | 0 → 0 / 0 / 2,000 | 0 | refund_due | + refund dispute 2,000 (zyada paisa, dispute nahi tha) |
| `8b1c99f4` | S17 Completion fix | completed | 5,000 → 5,000 | 1,000 → 1,000 | 4,000 → 4,000 / 0 / 0 | 0 | part_paid | — |
| `fbbb9409` | S18 Reversed | booked | 3,000 → 3,000 | 1,000 → 1,000 | 2,000 → 0 / 2,000 / 0 | 0 | advance_paid | — |
| `61c66ea9` | S19 Held | held | 4,000 → 4,000 | 0 → 0 | 4,000 → 0 / 4,000 / 0 | 0 | unpaid | — |
| `7397b6a5` | S20 Advance | booked | 5,000 → 5,000 | 1,000 → 1,000 | 4,000 → 0 / 4,000 / 0 | 0 | advance_paid | — |
| `a3dfca07` | S21 Points+waive | completed | 5,500 → 5,500 | 4,000 → 4,000 | 0 → 0 / 0 / 0 | 1,500 | paid_full | — |
| `cfddadfa` | S22 Venue cancel cash | cancelled | 0 → 0 | 3,000 → 3,000 | 0 → 0 / 0 / 3,000 | 0 | cancel_refund | — |
| `16c2fbb3` | S23 Cancel unpaid | cancelled | 0 → 0 | 0 → 0 | 0 → 0 / 0 / 0 | 0 | cancel_clear | — |
| `2d4b99c0` | S02 Two parts | completed | 6,000 → 6,000 | 6,000 → 6,000 | 0 → 0 / 0 / 0 | 0 | paid_full | — |
| `2e621d21` | S03 Points | booked | 4,500 → 4,500 | 1,000 → 1,000 | 3,500 → 0 / 3,500 / 0 | 0 | advance_paid | — |
| `2830b3c4` | S04 Waived | completed | 5,000 → 5,000 | 3,000 → 3,000 | 0 → 0 / 0 / 0 | 2,000 | paid_full | — |
| `6930b4c8` | S05 Khelo waive | completed | 4,000 → 4,000 | 2,500 → 2,500 | 0 → 0 / 0 / 0 | 1,500 | paid_full | — |
| `b19095bb` | S06 Noshow reversed | completed | 4,000 → 4,000 | 4,000 → 4,000 | 0 → 0 / 0 / 0 | 0 | paid_full | — |
| `09e38a8d` | S07 Noshow | no_show | 1,000 → 1,000 | 1,000 → 1,000 | 0 → 0 / 0 / 0 | 0 | noshow_kept | — |
| `45e3e93e` | S08 Noshow chased | no_show | 5,000 → 5,000 | 1,000 → 1,000 | 4,000 → 4,000 / 0 / 0 | 0 | part_paid | — |
| `2023a81b` | S09 Cancel owed | cancelled | 0 → 0 | 500 → 500 | 0 → 0 / 0 / 500 | 0 | cancel_refund | — |
| `98aebba6` | S10 Cancel refunded | cancelled | 0 → 0 | 0 → 0 | 0 → 0 / 0 / 0 | 0 | cancel_clear | — |
| `236ec205` | S11 Cancel partial | cancelled | 0 → 0 | 400 → 400 | 0 → 0 / 0 / 400 | 0 | cancel_refund | — |
| `2d56d3d4` | S12 Excess refunded | completed | 5,000 → 5,000 | 5,000 → 5,000 | 0 → 0 / 0 / 0 | 0 | paid_full | — |
| `b7ec716f` | S13 Excess owed | completed | 5,000 → 5,000 | 5,300 → 5,300 | 0 → 0 / 0 / 300 | 0 | refund_due | — |
| `f4e62c43` | S14 Expired paid | cancelled | 0 → 0 | 2,000 → 2,000 | 0 → 0 / 0 / 2,000 | 0 | cancel_refund | — |

## Din-wise farq (Mila / Wapas diye)

Pehle = purana ledger (calendar din, purani pehchaan). Baad = business day + nayi `kind`.

| din | Mila pehle | Mila baad | Wapas diye pehle | Wapas diye baad | theek ki pehle | theek ki baad |
|---|---|---|---|---|---|---|
| 2026-10-17 **farq** | 0 | 4,000 | 0 | 0 | 0 | 0 |
| 2026-10-22 **farq** | 0 | 3,000 | 0 | 0 | 0 | 0 |
| 2026-10-24 **farq** | 0 | 5,500 | 0 | 0 | 0 | 0 |
| 2026-10-26 **farq** | 0 | 5,300 | 0 | 500 | 0 | 0 |
| 2026-10-28 **farq** | 0 | 3,000 | 0 | 0 | 0 | 0 |
| 2026-10-30 **farq** | 0 | 2,500 | 0 | 0 | 0 | 0 |
| 2026-11-01 **farq** | 0 | 2,000 | 0 | 0 | 0 | 0 |
| 2026-11-02 **farq** | 0 | 6,000 | 0 | 0 | 0 | 0 |
| 2026-11-03 **farq** | 0 | 1,000 | 0 | 0 | 0 | 0 |
| 2026-11-04 **farq** | 0 | 1,000 | 0 | 0 | 0 | 0 |
| 2026-11-05 **farq** | 0 | 4,000 | 0 | 0 | 0 | 0 |
| 2026-11-06 **farq** | 0 | 1,000 | 0 | 1,000 | 0 | 0 |
| 2026-11-07 **farq** | 0 | 1,000 | 0 | 0 | 0 | 0 |
| 2026-11-08 **farq** | 0 | 1,000 | 0 | 0 | 0 | 1,000 |
| 2026-11-09 **farq** | 0 | 4,500 | 0 | 0 | 0 | 0 |
| 2026-11-10 **farq** | 0 | 7,000 | 0 | 1,000 | 0 | -2,000 |
| 2026-11-11 **farq** | 0 | 2,000 | 0 | 600 | 0 | -2,000 |
| 2026-11-12 **farq** | 0 | 2,000 | 0 | 0 | 0 | 0 |

## Entries jin ka business day calendar din se alag aaya

Aaj ke closing schedule se. Jahan schedule baad mein badla ho, wahan yeh din ghalat ho sakta hai.

Koi nahi.

## Jo chhoda gaya / dhyan do

- `45e3e93e` S08 Noshow chased: no-show with an OPEN due of 4,000: no no_show adjustment added (your decision)
