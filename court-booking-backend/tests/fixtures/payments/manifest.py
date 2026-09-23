"""Ground truth for the synthetic OCR fixtures (Section 32 Part 7).

Shared by tests/test_ocr_fixtures.py (pipeline tests, mocked provider) and
scripts/ocr_accuracy_report.py (a real-vision-model accuracy run, NOT part of
the pytest suite -- it makes billed API calls, so it is a script, per this
project's "no real API calls during test collection/run" rule).
"""
import os

FIXTURES_DIR = os.path.dirname(os.path.abspath(__file__))

# Each entry: the file, its mime, the fields a human reads off the image, and
# any flag a strict reader should raise. `None` fields = genuinely absent.
FIXTURES = [
    {
        "file": "jazzcash_clean.png", "mime": "image/png", "kind": "clean",
        "amount": 400, "reference": "TXN987654321", "payer_name": "Ali Raza",
        "bank_name": "JazzCash", "receiver_tail": "1234567", "receiver_name": "Maidan Padel Club",
        "date_iso_prefix": "2026-09-24", "expected_flag": None,
    },
    {
        "file": "jazzcash_messy.jpg", "mime": "image/jpeg", "kind": "messy",
        "amount": 400, "reference": "TXN987654321", "payer_name": "Ali Raza",
        "bank_name": "JazzCash", "receiver_tail": "1234567", "receiver_name": "Maidan Padel Club",
        "date_iso_prefix": "2026-09-24", "expected_flag": None,
    },
    {
        "file": "easypaisa_clean.png", "mime": "image/png", "kind": "clean",
        "amount": 1000, "reference": "EP123456789", "payer_name": "Bilal Ahmed",
        "bank_name": "Easypaisa", "receiver_tail": "7654321",
        "date_iso_prefix": "2026-09-24", "expected_flag": None,
    },
    {
        "file": "easypaisa_messy.jpg", "mime": "image/jpeg", "kind": "messy",
        "amount": 1000, "reference": "EP123456789", "payer_name": "Bilal Ahmed",
        "bank_name": "Easypaisa", "receiver_tail": "7654321",
        "date_iso_prefix": "2026-09-24", "expected_flag": None,
    },
    {
        "file": "jazzcash_failed.png", "mime": "image/png", "kind": "failed",
        "amount": 400, "reference": "TXN000111222", "payer_name": "Ali Raza",
        "bank_name": "JazzCash", "receiver_tail": None,
        "date_iso_prefix": "2026-09-24", "expected_flag": "failed_or_pending_transaction",
    },
    {
        "file": "not_a_receipt.png", "mime": "image/png", "kind": "not_a_receipt",
        "amount": None, "reference": None, "payer_name": None,
        "bank_name": None, "receiver_tail": None,
        "date_iso_prefix": None, "expected_flag": "not_a_receipt",
    },
]


def path(name: str) -> str:
    return os.path.join(FIXTURES_DIR, name)


def read_bytes(name: str) -> bytes:
    with open(path(name), "rb") as f:
        return f.read()
