# Ledger v2 backfill report

2026-11-12 22:56 · committed · local/dev DB only

## Kya bana

| cheez | ginti |
|---|---|
| adjustment_cancellation | 7 |
| adjustment_no_show | 1 |
| adjustment_points | 2 |
| adjustment_price_reduced | 1 |
| adjustment_waived | 3 |
| entry_added_payment | 3 |
| entry_added_refund | 1 |
| entry_kind_correction | 3 |
| entry_kind_payment | 23 |
| entry_kind_refund | 3 |

## Har booking: pehle → baad

| booking | naam | status | price pehle → Final | paid pehle → net | baqi pehle → due / slot par / wapas | waived | pill | kya bana |
|---|---|---|---|---|---|---|---|---|
| `de54ad92` | S01 Partly | completed | 5,000 → 5,000 | 3,000 → 3,000 | 2,000 → 2,000 / 0 / 0 | 0 | part_paid | — |
| `2d4b99c0` | S02 Two parts | completed | 6,000 → 6,000 | 6,000 → 6,000 | 0 → 0 / 0 / 0 | 0 | paid_full | — |
| `2e621d21` | S03 Points | booked | 4,500 → 4,500 | 1,000 → 1,000 | 3,500 → 0 / 3,500 / 0 | 0 | advance_paid | + points 500 (backfill: points (audit booking.points_redeemed)); base_price 5,000 |
| `2830b3c4` | S04 Waived | completed | 3,000 → 5,000 | 3,000 → 3,000 | 0 → 0 / 0 / 0 | 2,000 | paid_full | + waived 2,000 (backfill: owner waived the due (audit booking.due_waived)); base_price 5,000 |
| `6930b4c8` | S05 Khelo waive | completed | 2,500 → 4,000 | 2,500 → 2,500 | 0 → 0 / 0 / 0 | 1,500 | paid_full | + waived 1,500 (backfill: Khelo decided for the player (audit escalation.decided)); base_price 4,000 |
| `b19095bb` | S06 Noshow reversed | completed | 4,000 → 4,000 | 4,000 → 4,000 | 0 → 0 / 0 / 0 | 0 | paid_full | + price_reduced 1,000 (backfill: final price set when the no-show was taken back); base_price 5,000 |
| `09e38a8d` | S07 Noshow | no_show | 5,000 → 1,000 | 1,000 → 1,000 | 4,000 → 0 / 0 / 0 | 0 | noshow_kept | + no_show 4,000 (backfill: old no-show, advance kept, rest not charged) |
| `45e3e93e` | S08 Noshow chased | no_show | 5,000 → 5,000 | 1,000 → 1,000 | 4,000 → 4,000 / 0 / 0 | 0 | part_paid | — |
| `2023a81b` | S09 Cancel owed | cancelled | 5,000 → 0 | 500 → 500 | 4,500 → 0 / 0 / 500 | 0 | cancel_refund | + cancellation 5,000 (backfill: cancelled, refund owed) |
| `98aebba6` | S10 Cancel refunded | cancelled | 5,000 → 0 | 0 → 0 | 5,000 → 0 / 0 / 0 | 0 | cancel_clear | + cancellation 5,000 (backfill: cancelled) |
| `236ec205` | S11 Cancel partial | cancelled | 5,000 → 0 | 400 → 400 | 4,600 → 0 / 0 / 400 | 0 | cancel_refund | + cancellation 5,000 (backfill: cancelled, refund owed) |
| `2d56d3d4` | S12 Excess refunded | completed | 5,000 → 5,000 | 5,000 → 5,000 | 0 → 0 / 0 / 0 | 0 | paid_full | + payment 500 (overpayment_excess, was never in the ledger); + refund -500 (overpayment_excess) |
| `b7ec716f` | S13 Excess owed | completed | 5,000 → 5,000 | 5,000 → 5,300 | 0 → 0 / 0 / 300 | 0 | refund_due | + payment 300 (overpayment_excess, was never in the ledger) |
| `f4e62c43` | S14 Expired paid | cancelled | 5,000 → 0 | 0 → 2,000 | 5,000 → 0 / 0 / 2,000 | 0 | cancel_refund | + payment 2,000 (cancelled_payment_received, was never in the ledger); + cancellation 5,000 (backfill: cancelled, refund owed) |
| `b658a8fe` | S15 Refund reopened | cancelled | 5,000 → 0 | 1,000 → 1,000 | 4,000 → 0 / 0 / 1,000 | 0 | cancel_refund | + cancellation 5,000 (backfill: cancelled, refund owed) |
| `a55902ca` | S16 Walkin 4000 | completed | 2,000 → 2,000 | 4,000 → 4,000 | 0 → 0 / 0 / 2,000 | 0 | refund_due | — |
| `8b1c99f4` | S17 Completion fix | completed | 5,000 → 5,000 | 1,000 → 1,000 | 4,000 → 4,000 / 0 / 0 | 0 | part_paid | — |
| `fbbb9409` | S18 Reversed | booked | 3,000 → 3,000 | 1,000 → 1,000 | 2,000 → 0 / 2,000 / 0 | 0 | advance_paid | — |
| `61c66ea9` | S19 Held | held | 4,000 → 4,000 | 0 → 0 | 4,000 → 0 / 4,000 / 0 | 0 | unpaid | — |
| `7397b6a5` | S20 Advance | booked | 5,000 → 5,000 | 1,000 → 1,000 | 4,000 → 0 / 4,000 / 0 | 0 | advance_paid | — |
| `a3dfca07` | S21 Points+waive | completed | 4,000 → 5,500 | 4,000 → 4,000 | 0 → 0 / 0 / 0 | 1,500 | paid_full | + points 500 (backfill: points (audit booking.points_redeemed)); + waived 1,500 (backfill: owner waived the due (audit booking.due_waived)); base_price 6,000 |
| `cfddadfa` | S22 Venue cancel cash | cancelled | 3,000 → 0 | 3,000 → 3,000 | 0 → 0 / 0 / 3,000 | 0 | cancel_refund | + cancellation 3,000 (backfill: cancelled, refund owed) |
| `16c2fbb3` | S23 Cancel unpaid | cancelled | 4,000 → 0 | 0 → 0 | 4,000 → 0 / 0 / 0 | 0 | cancel_clear | + cancellation 4,000 (backfill: cancelled) |

## Din-wise farq (Mila / Wapas diye)

Pehle = purana ledger (calendar din, purani pehchaan). Baad = business day + nayi `kind`.

| din | Mila pehle | Mila baad | Wapas diye pehle | Wapas diye baad | theek ki pehle | theek ki baad |
|---|---|---|---|---|---|---|
| 2026-10-17 | 4,000 | 4,000 | 0 | 0 | 0 | 0 |
| 2026-10-22 | 3,000 | 3,000 | 0 | 0 | 0 | 0 |
| 2026-10-24 **farq** | 5,000 | 5,500 | 0 | 0 | 0 | 0 |
| 2026-10-26 **farq** | 0 | 5,300 | 0 | 500 | 0 | 0 |
| 2026-10-27 **farq** | 5,000 | 0 | 0 | 0 | 0 | 0 |
| 2026-10-28 **farq** | 0 | 3,000 | 0 | 0 | 3,000 | 0 |
| 2026-10-30 | 2,500 | 2,500 | 0 | 0 | 0 | 0 |
| 2026-11-01 | 2,000 | 2,000 | 0 | 0 | 0 | 0 |
| 2026-11-02 **farq** | 0 | 6,000 | 0 | 0 | 0 | 0 |
| 2026-11-03 **farq** | 5,000 | 1,000 | 0 | 0 | 0 | 0 |
| 2026-11-04 | 1,000 | 1,000 | 0 | 0 | 0 | 0 |
| 2026-11-05 | 4,000 | 4,000 | 0 | 0 | 0 | 0 |
| 2026-11-06 | 1,000 | 1,000 | 1,000 | 1,000 | 0 | 0 |
| 2026-11-07 | 1,000 | 1,000 | 0 | 0 | 0 | 0 |
| 2026-11-08 **farq** | 2,000 | 1,000 | 0 | 0 | 0 | 1,000 |
| 2026-11-09 | 4,500 | 4,500 | 0 | 0 | 0 | 0 |
| 2026-11-10 | 7,000 | 7,000 | 1,000 | 1,000 | -2,000 | -2,000 |
| 2026-11-11 **farq** | 2,000 | 2,000 | 600 | 600 | 0 | -2,000 |
| 2026-11-12 **farq** | 2,000 | 2,000 | 0 | 0 | -2,000 | 0 |

## Entries jin ka business day calendar din se alag aaya

Aaj ke closing schedule se. Jahan schedule baad mein badla ho, wahan yeh din ghalat ho sakta hai.

| entry | booking | raqam | waqt (PKT) | calendar din | business day |
|---|---|---|---|---|---|
| `6a13827e` | `2d4b99c0` | 4,000 | 2026-11-03 01:00 | 2026-11-03 | 2026-11-02 |
| `55d1d6eb` | `b7ec716f` | 5,000 | 2026-10-27 02:00 | 2026-10-27 | 2026-10-26 |
| `135e5cee` | `fbbb9409` | -2,000 | 2026-11-12 00:30 | 2026-11-12 | 2026-11-11 |

## Jo chhoda gaya / dhyan do

- `45e3e93e` S08 Noshow chased: no-show with an OPEN due of 4,000: no no_show adjustment added (your decision)
