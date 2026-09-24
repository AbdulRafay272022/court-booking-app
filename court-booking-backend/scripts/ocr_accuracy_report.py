"""Run the REAL vision model against the synthetic OCR fixtures and report honest,
field-by-field accuracy (Section 32 Part 7).

This is a SCRIPT, not a pytest test, on purpose: it makes real, billed vision-API
calls, which must never happen during a normal `pytest` run (this project already
learned that lesson -- see the tests/test_gemini.py gotcha in CLAUDE.md).

Run (uses whatever AI_VISION_PROVIDER/API key .env has -- production is Gemini):
  .venv/Scripts/python.exe scripts/ocr_accuracy_report.py

CAVEAT printed at the end: these are rendered/synthetic images. Real photos of a
phone screen (glare, skew, moire, a thumb over a corner, a cheap camera) are
harder, so real-world accuracy will be LOWER than whatever this prints.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config import get_settings
from app.services.ai.factory import get_vision_provider
from app.services.payment_service import PaymentService
from app.utils.text import fuzzy_name_match
from tests.fixtures.payments import manifest


def _norm_ref(s):
    return (s or "").strip().upper().replace(" ", "").replace("-", "")


def score(gt, ext):
    """Return dict field -> (ok: bool|None, detail). None = not applicable."""
    out = {}
    # amount
    if gt["amount"] is None:
        out["amount"] = (ext.amount is None, f"got {ext.amount!r}")
    else:
        out["amount"] = (ext.amount is not None and abs(float(ext.amount) - gt["amount"]) < 0.5,
                         f"got {ext.amount!r}, want {gt['amount']}")
    # reference
    if gt["reference"] is None:
        out["reference"] = (None, f"got {ext.reference!r}")
    else:
        out["reference"] = (_norm_ref(ext.reference) == _norm_ref(gt["reference"]),
                            f"got {ext.reference!r}, want {gt['reference']}")
    # payer
    if gt["payer_name"] is None:
        out["payer"] = (None, f"got {ext.payer_name!r}")
    else:
        out["payer"] = (fuzzy_name_match(ext.payer_name, gt["payer_name"]),
                        f"got {ext.payer_name!r}, want {gt['payer_name']}")
    # bank
    if gt["bank_name"] is None:
        out["bank"] = (None, f"got {ext.bank_name!r}")
    else:
        out["bank"] = ((ext.bank_name or "").lower().find(gt["bank_name"].lower()) >= 0,
                       f"got {ext.bank_name!r}, want {gt['bank_name']}")
    # receiver tail
    if gt["receiver_tail"] is None:
        out["receiver"] = (None, f"got {ext.receiver_name!r}")
    else:
        # A receiver is correctly extracted as EITHER the account tail or the
        # receiver's name (the app compares the name to the venue's saved title).
        digits = "".join(ch for ch in (ext.receiver_name or "") if ch.isdigit())
        by_tail = gt["receiver_tail"] in digits or gt["receiver_tail"] in (ext.receiver_name or "")
        by_name = gt.get("receiver_name") and fuzzy_name_match(ext.receiver_name, gt["receiver_name"])
        out["receiver"] = (bool(by_tail or by_name),
                           f"got {ext.receiver_name!r}, want tail {gt['receiver_tail']} or name {gt.get('receiver_name')}")
    # date -- the honest metric is "can the app PARSE and use it" (the model
    # returns the human string as printed; our parser handles that), not "is it
    # literally ISO". Score it through the real parser.
    if gt["date_iso_prefix"] is None:
        out["date"] = (None, f"got {ext.timestamp!r}")
    else:
        parsed = PaymentService._parse_ocr_timestamp(ext.timestamp)
        ok = parsed is not None and parsed.strftime("%Y-%m-%d") == gt["date_iso_prefix"]
        out["date"] = (ok, f"got {ext.timestamp!r} -> parsed {parsed}")
    # flag
    if gt["expected_flag"] is None:
        out["flag"] = (None, f"flags={ext.flags}")
    else:
        out["flag"] = (gt["expected_flag"] in (ext.flags or []),
                       f"flags={ext.flags}, want {gt['expected_flag']}")
    return out


async def main():
    settings = get_settings()
    provider = get_vision_provider(settings)
    print(f"vision provider: {type(provider).__name__}  model: {getattr(settings, 'GEMINI_PRO_MODEL', '?')}\n")

    agg = {}  # field -> [correct, total]
    for fx in manifest.FIXTURES:
        data = manifest.read_bytes(fx["file"])
        expected_amount = float(fx["amount"] or 0)
        print(f"=== {fx['file']}  ({fx['kind']}) ===")
        try:
            ext = await provider.extract_payment_proof(data, fx["mime"], expected_amount)
        except Exception as e:  # noqa: BLE001 -- a real report must survive a vendor error per fixture
            print(f"  ERROR calling vision model: {type(e).__name__}: {e}\n")
            continue
        res = score(fx, ext)
        for field, (ok, detail) in res.items():
            mark = "n/a " if ok is None else ("PASS" if ok else "FAIL")
            print(f"  {field:9} {mark}  {detail}")
            if ok is not None:
                c, t = agg.get(field, (0, 0))
                agg[field] = (c + (1 if ok else 0), t + 1)
        print(f"  confidence: {ext.confidence}")
        print()

    print("=== FIELD ACCURACY (across applicable fixtures) ===")
    tot_c = tot_t = 0
    for field, (c, t) in agg.items():
        print(f"  {field:9} {c}/{t}")
        tot_c += c
        tot_t += t
    print(f"  {'OVERALL':9} {tot_c}/{tot_t}" + (f"  ({100*tot_c/tot_t:.0f}%)" if tot_t else ""))
    print("\nCAVEAT: synthetic rendered receipts. Real phone-screen photos are harder;")
    print("treat these numbers as an optimistic upper bound, not real-world accuracy.")


if __name__ == "__main__":
    asyncio.run(main())
