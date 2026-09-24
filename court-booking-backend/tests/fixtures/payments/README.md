# Payment-screenshot OCR fixtures (Section 32 Part 7)

Synthetic JazzCash / Easypaisa payment confirmations used to sanity-check the
OCR extraction the owner's approval card relies on. Regenerate with
`python scripts/generate_ocr_fixtures.py`; ground truth is in `manifest.py`.

| file | kind | what it exercises |
|---|---|---|
| `jazzcash_clean.png` | clean | full field extraction (amount, ref, payer, bank, receiver name, time) |
| `jazzcash_messy.jpg` | messy | rotation + low contrast + noise + blur + heavy JPEG + a cropped edge |
| `easypaisa_clean.png` | clean | receiver as an account number (not a name) |
| `easypaisa_messy.jpg` | messy | same degradations, green-brand layout |
| `jazzcash_failed.png` | failed | `failed_or_pending_transaction` flag |
| `not_a_receipt.png` | not a receipt | `not_a_receipt` flag, all fields null |

## Honest accuracy (run 2026-09-24, real Gemini vision model)

`python scripts/ocr_accuracy_report.py` (a script, NOT part of `pytest` — it
makes billed API calls) against the real vision provider `.env` selects
(production uses Gemini):

```
amount    6/6      reference 5/5     payer 5/5     bank 5/5
receiver  4/4      date      5/5     flag  2/2     OVERALL 32/32 (100%)
```

**This 100% is on synthetic, digitally-rendered receipts and is an optimistic
upper bound, NOT a real-world number.** A real photo of a phone screen (glare,
moire, skew, a thumb over a corner, a low-end camera, a screenshot-of-a-
screenshot) is materially harder. Before trusting auto-approve at pilot scale,
run this same script against a handful of REAL (anonymized) JazzCash/Easypaisa
screenshots from the pilot and report the real hit rate.

## What this run caught (a real bug, now fixed)

The vision model returns the transaction time **exactly as printed** on the
receipt — a human, Pakistan-local string like `24 Sep 2026, 07:12 PM`, not
ISO 8601. The old `_parse_ocr_timestamp` parsed ISO only, so on real output it
returned `None`, silently making the TIME check always "not visible" and
blocking auto-approve on every real screenshot. Fixed: the parser now accepts
the human formats the model emits, and — because the printed time is Pakistan
local with no offset — reads it as PKT (treating it as UTC was 5 hours off).
See `test_parse_ocr_timestamp_*` and
`test_time_check_works_when_model_returns_a_human_pkt_timestamp`.

## Note on the check LOGIC tests

The name/amount/time/receiver check-verdict cases (name matched vs not, amount
less/equal/more, time before/within/after/missing, receiver match/not
configured, duplicate) are covered deterministically in `tests/test_ocr.py`
with a mocked provider — they do not depend on these images. These fixtures
back the extraction-accuracy question specifically.
