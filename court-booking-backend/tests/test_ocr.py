"""OCR/vision extraction behavior. This used to live in a standalone
OCRService; Section 21 moved it (unchanged) into ClaudeProvider.extract_payment_proof
as part of making the AI vendor a config choice -- see tests/test_ai_providers.py
for the provider-selection/factory contract these now sit behind.

Section 21 Part B.2 switched Claude's extraction from prompt-only JSON to a
forced record_payment_extraction tool call (see app/services/ai/schemas.py)
-- the response shape these tests mock changed accordingly."""

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.payment import Payment
from app.models.venue import Venue
from app.services.ai.claude_provider import ClaudeProvider
from app.services.ai.schemas import PaymentExtractionValidationError
from app.services.payment_service import (
    PaymentService,
    build_payment_checks,
    compute_name_match,
    compute_receiver_match,
    compute_time_check,
)
from app.utils.encryption import encrypt_json
from app.utils.text import fuzzy_name_match


@pytest.fixture
def provider():
    return ClaudeProvider("test-key", "claude-haiku-4-20250514", "claude-sonnet-4-20250514")


def _tool_use_vision_response(input_data: dict) -> dict:
    return {
        "content": [
            {"type": "tool_use", "id": "toolu_1", "name": "record_payment_extraction", "input": input_data}
        ],
        "model": "claude-sonnet-4-20250514",
        "usage": {"input_tokens": 800, "output_tokens": 40},
    }


async def test_extract_payment_proof_parses_claude_response(provider, monkeypatch):
    expected = {
        "amount": 3000,
        "reference": "TXN123",
        "timestamp": "2026-01-01T10:00:00",
        "confidence": 0.95,
    }

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json=_tool_use_vision_response(expected))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await provider.extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=3000)
    assert result.amount == 3000
    assert result.reference == "TXN123"
    assert result.timestamp == "2026-01-01T10:00:00"
    assert result.confidence == 0.95
    assert result.model_used == "claude-sonnet-4-20250514"
    assert result.raw_usage == {"input_tokens": 800, "output_tokens": 40}


async def test_extract_payment_proof_all_null_is_a_valid_unreadable_verdict(provider, monkeypatch):
    """All-null fields is what Claude legitimately returns when it can't
    read the screenshot -- that's schema-valid and must NOT raise, since
    it's indistinguishable in shape from any other successful extraction."""
    unreadable = {"amount": None, "reference": None, "timestamp": None, "confidence": 0.1}

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json=_tool_use_vision_response(unreadable))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await provider.extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=3000)
    assert result.amount is None
    assert result.reference is None
    assert result.confidence == 0.1


async def test_extract_payment_proof_no_tool_call_raises_validation_error(provider, monkeypatch):
    """If Claude ignores the forced tool_choice and replies with plain text
    instead, that's a genuinely malformed response -- distinct from a valid
    all-null "unreadable" answer -- and must fail loudly, not silently
    become a fake "unreadable" verdict."""
    async def fake_post(self, url, headers=None, json=None, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(
            200, request=request, json={"content": [{"type": "text", "text": "not json"}]}
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    with pytest.raises(PaymentExtractionValidationError):
        await provider.extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=3000)


async def test_extract_payment_proof_wrong_shaped_tool_input_raises_validation_error(provider, monkeypatch):
    """A tool call whose `input` doesn't match the schema at all (e.g. the
    amount field comes back as a non-numeric string) is also a validation
    failure, not a silently-accepted None."""
    async def fake_post(self, url, headers=None, json=None, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(
            200, request=request, json=_tool_use_vision_response({"amount": "not-a-number"})
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    with pytest.raises(PaymentExtractionValidationError):
        await provider.extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=3000)


async def test_payment_service_falls_back_gracefully_without_api_key(
    db_session, make_user, make_venue, make_court, monkeypatch
):
    """The graceful "no key configured" behavior now lives one layer up,
    in PaymentService (via get_vision_provider raising UnconfiguredProviderError),
    since the provider itself always assumes it was constructed with a key."""
    from app.models.user import UserRole
    from app.services.payment_service import PaymentService

    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "AI_VISION_PROVIDER", "")

    service = PaymentService(db_session, settings)
    extraction = await service._extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=3000)
    assert extraction.amount is None
    assert extraction.reference is None
    assert extraction.confidence is None


async def test_payment_service_falls_back_gracefully_on_validation_error(
    db_session, make_user, make_venue, make_court, monkeypatch
):
    """A malformed/schema-violating provider response must not break the
    payment submission flow -- PaymentService downgrades it to the same
    graceful "unreadable" extraction as no-API-key, just logged loudly
    (payment_service.ocr_validation_failed) so it's distinguishable from a
    real "couldn't read this screenshot" verdict in the logs."""
    from app.services.ai.claude_provider import ClaudeProvider
    from app.services.ai.schemas import PaymentExtractionValidationError
    from app.services.payment_service import PaymentService

    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_VISION_PROVIDER", "")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        raise PaymentExtractionValidationError("simulated malformed vendor response")

    monkeypatch.setattr(ClaudeProvider, "extract_payment_proof", fake_extract)

    service = PaymentService(db_session, settings)
    extraction = await service._extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=3000)
    assert extraction.amount is None
    assert extraction.reference is None
    assert extraction.confidence is None


# --- Section 32 Part 7: payer name, bank/wallet, receiver, flags ---------


async def test_extract_payment_proof_parses_the_new_part_7_fields(provider, monkeypatch):
    """The strict vision prompt asks for payer name, bank/wallet name,
    receiver name/tail, and non-receipt/crop/edit/pending-transaction flags
    alongside the original amount/reference/timestamp -- confirm they round
    -trip through validate_extraction into PaymentExtraction unchanged."""
    expected = {
        "amount": 400,
        "reference": "TXN999",
        "timestamp": "2026-01-01T19:12:00",
        "confidence": 0.9,
        "payer_name": "Ali Raza",
        "bank_name": "JazzCash",
        "receiver_name": "Maidan Court",
        "flags": ["cropped"],
    }

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json=_tool_use_vision_response(expected))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await provider.extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=400)
    assert result.payer_name == "Ali Raza"
    assert result.bank_name == "JazzCash"
    assert result.receiver_name == "Maidan Court"
    assert result.flags == ["cropped"]


async def test_extract_payment_proof_all_null_part_7_fields_is_still_a_valid_unreadable_verdict(provider, monkeypatch):
    """A screenshot that's genuinely unreadable for these fields too must
    stay a valid (not-raised) all-null response, same as the original
    amount/reference/timestamp fields."""
    unreadable = {
        "amount": None, "reference": None, "timestamp": None, "confidence": 0.1,
        "payer_name": None, "bank_name": None, "receiver_name": None, "flags": [],
    }

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(200, request=request, json=_tool_use_vision_response(unreadable))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    result = await provider.extract_payment_proof(b"fake-bytes", "image/jpeg", expected_amount=3000)
    assert result.payer_name is None
    assert result.bank_name is None
    assert result.receiver_name is None
    assert result.flags == []


# --- fuzzy_name_match -----------------------------------------------------


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("Ali Raza", "Ali Raza", True),
        ("ali raza", "ALI RAZA", True),
        ("Raza Ali", "Ali Raza", True),  # word-order-insensitive
        ("Ali Raza", "Ali R.", True),  # initials tolerance
        ("Ali Raza", "A. Raza", True),
        ("Fahad Khan", "Fahid Khan", True),  # Roman Urdu spelling drift, close enough
        ("Ali Raza", "Bilal Ahmed", False),  # genuinely different people
        ("Ali", "Ali Raza Khan Sons", False),  # too different in length/content to call a match
        (None, "Ali Raza", False),
        ("Ali Raza", "", False),
    ],
)
def test_fuzzy_name_match(a, b, expected):
    assert fuzzy_name_match(a, b) is expected


# --- compute_name_match ----------------------------------------------------


def test_compute_name_match_match():
    assert compute_name_match("Ali Raza", "Ali R.") == "match"


def test_compute_name_match_mismatch():
    assert compute_name_match("Ali Raza", "Bilal Ahmed") == "mismatch"


def test_compute_name_match_unavailable_when_either_side_missing():
    assert compute_name_match(None, "Ali Raza") == "unavailable"
    assert compute_name_match("Ali Raza", None) == "unavailable"


# --- compute_time_check -----------------------------------------------------


def _make_booking(**overrides) -> Booking:
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=uuid.uuid4(),
        court_id=uuid.uuid4(),
        starts_at=now + timedelta(hours=1),
        ends_at=now + timedelta(hours=2),
        price=3000,
        advance_amount=400,
        amount_paid=0,
        balance_due=3000,
        created_at=now,
        held_until=now + timedelta(minutes=15),
        status=BookingStatus.HELD,
    )
    defaults.update(overrides)
    return Booking(**defaults)


def test_compute_time_check_within_timer():
    booking = _make_booking()
    paid_at = booking.created_at + timedelta(minutes=5)
    assert compute_time_check(paid_at, booking) == "within_timer"


def test_compute_time_check_before_hold():
    booking = _make_booking()
    paid_at = booking.created_at - timedelta(minutes=10)
    assert compute_time_check(paid_at, booking) == "before_hold"


def test_compute_time_check_after_timer():
    booking = _make_booking()
    paid_at = booking.held_until + timedelta(minutes=10)
    assert compute_time_check(paid_at, booking) == "after_timer"


def test_compute_time_check_within_2_minute_clock_tolerance_either_side():
    """The spec explicitly allows a 2-minute clock tolerance either side of
    the hold window -- a payment timestamped 1 minute before created_at or 1
    minute after held_until must still read as within_timer, not a false
    before_hold/after_timer."""
    booking = _make_booking()
    just_before = booking.created_at - timedelta(minutes=1)
    just_after = booking.held_until + timedelta(minutes=1)
    assert compute_time_check(just_before, booking) == "within_timer"
    assert compute_time_check(just_after, booking) == "within_timer"


def test_compute_time_check_not_visible_when_timestamp_missing():
    booking = _make_booking()
    assert compute_time_check(None, booking) == "not_visible"


# --- compute_receiver_match -------------------------------------------------


def _venue_with_bank_details(settings, **bank_kwargs) -> Venue:
    bank = {"bank": "HBL", "account_title": "Maidan Court", "account_number": "1234567890"}
    bank.update(bank_kwargs)
    return Venue(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        name="Maidan Court",
        address="X",
        city="Karachi",
        location="SRID=4326;POINT(67.0 24.8)",
        sports=["padel"],
        bank_details=encrypt_json(bank, settings),
    )


def test_compute_receiver_match_match():
    settings = get_settings()
    venue = _venue_with_bank_details(settings)
    assert compute_receiver_match("Maidan Court", venue, settings) == "match"


def test_compute_receiver_match_mismatch():
    settings = get_settings()
    venue = _venue_with_bank_details(settings)
    assert compute_receiver_match("Some Other Business", venue, settings) == "mismatch"


def test_compute_receiver_match_not_configured_when_venue_has_no_bank_details():
    settings = get_settings()
    venue = Venue(
        id=uuid.uuid4(), owner_id=uuid.uuid4(), name="No Bank Venue", address="X", city="Karachi",
        location="SRID=4326;POINT(67.0 24.8)", sports=["padel"], bank_details=None,
    )
    assert compute_receiver_match("Anyone", venue, settings) == "not_configured"
    assert compute_receiver_match("Anyone", None, settings) == "not_configured"


def test_compute_receiver_match_unavailable_when_receiver_not_extracted():
    settings = get_settings()
    venue = _venue_with_bank_details(settings)
    assert compute_receiver_match(None, venue, settings) == "unavailable"


# --- build_payment_checks: the plain-language approval-card sentences -----


def _make_payment(**overrides) -> Payment:
    defaults = dict(
        id=uuid.uuid4(),
        booking_id=uuid.uuid4(),
        amount_claimed=400,
        ocr_amount=400,
        ocr_verdict="match",
        ocr_payer_name="Ali Raza",
        ocr_bank="JazzCash",
        ocr_receiver="Maidan Court",
        ocr_timestamp=None,
        name_match_verdict="match",
        time_check_verdict="within_timer",
        receiver_match_verdict="match",
        is_duplicate=False,
    )
    defaults.update(overrides)
    return Payment(**defaults)


def test_build_payment_checks_all_matched_case():
    now = datetime.now(timezone.utc)
    booking = _make_booking(price=3500, amount_paid=400, balance_due=3100, created_at=now, held_until=now + timedelta(minutes=15))
    payment = _make_payment(ocr_timestamp=now + timedelta(minutes=5))
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")

    assert checks.name.verdict == "match"
    assert "Ali Raza" in checks.name.text and "Matched" in checks.name.text
    assert checks.amount.verdict == "match"
    assert "Matched" in checks.amount.text
    assert checks.balance_text == "Total PKR 3,500. Paid so far PKR 400. Balance due at the venue: PKR 3,100."
    assert checks.time.verdict == "match"
    assert "Within the timer" in checks.time.text
    assert checks.bank.verdict == "match"
    assert checks.duplicate.verdict == "match"


def test_build_payment_checks_name_mismatch_is_a_warning_not_a_failure():
    booking = _make_booking(price=3500, amount_paid=400, balance_due=3100)
    payment = _make_payment(name_match_verdict="mismatch", ocr_payer_name="Someone Else")
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.name.verdict == "mismatch"
    assert "Not matched" in checks.name.text


def test_build_payment_checks_amount_less_than_expected():
    booking = _make_booking(price=3500, amount_paid=0, balance_due=3500, advance_amount=400)
    payment = _make_payment(ocr_amount=300, amount_claimed=400, ocr_verdict="mismatch")
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.amount.verdict == "mismatch"
    assert "100" in checks.amount.text and "less than expected" in checks.amount.text


def test_build_payment_checks_amount_more_than_expected():
    booking = _make_booking(price=3500, amount_paid=0, balance_due=3500, advance_amount=400)
    payment = _make_payment(ocr_amount=450, amount_claimed=400, ocr_verdict="mismatch")
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.amount.verdict == "mismatch"
    assert "50" in checks.amount.text and "more than expected" in checks.amount.text


def test_build_payment_checks_time_before_booking():
    booking = _make_booking()
    payment = _make_payment(time_check_verdict="before_hold")
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.time.verdict == "warning"
    assert checks.time.text == "Paid before the booking started."


def test_build_payment_checks_time_after_timer():
    booking = _make_booking()
    payment = _make_payment(time_check_verdict="after_timer")
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.time.verdict == "warning"
    assert checks.time.text == "Paid after the timer ended."


def test_build_payment_checks_time_not_visible():
    booking = _make_booking()
    payment = _make_payment(time_check_verdict="not_visible", ocr_timestamp=None)
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.time.verdict == "warning"
    assert checks.time.text == "Time not visible."


def test_build_payment_checks_within_timer_still_renders_match_after_held_until_is_cleared():
    """Real bug caught while live-verifying this Part: `booking.held_until`
    is set back to None once the booking leaves HELD (mark_payment_submitted
    /confirm_booking both null it out), which happens before the owner's
    approval card is ever rendered for a non-auto-approved payment. The
    verdict itself was computed and stored once at submission time, before
    that clearing -- render must trust it, not require held_until to still
    be populated."""
    booking = _make_booking(held_until=None)  # already cleared, as it would be by the time an owner sees this
    payment = _make_payment(time_check_verdict="within_timer", ocr_timestamp=datetime.now(timezone.utc))
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.time.verdict == "match"
    assert "Within the timer" in checks.time.text


def test_build_payment_checks_receiver_not_configured_is_informational_only():
    booking = _make_booking()
    payment = _make_payment(receiver_match_verdict="not_configured")
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.bank.verdict == "not_configured"
    assert "hasn't saved bank details" in checks.bank.text


def test_build_payment_checks_duplicate_flagged():
    booking = _make_booking()
    payment = _make_payment(is_duplicate=True)
    checks = build_payment_checks(payment, booking, account_name="Ali Raza")
    assert checks.duplicate.verdict == "mismatch"
    assert "already on file" in checks.duplicate.text


# --- Honest note on OCR accuracy against "messy" screenshots ---------------
#
# Section 32 Part 7 asked to "tell me honestly what accuracy you see on
# messy screenshots." This test suite -- like every other OCR test already
# in this codebase (see test_extract_payment_proof_parses_claude_response
# above) -- mocks the vision provider's HTTP response rather than sending a
# real image to a real vision API; no test here (or anywhere in this
# project's suite) has ever exercised real OCR extraction quality, clean or
# messy. That means: the WIRING is fully tested (strict schema round-trips,
# name/time/receiver verdicts compute correctly from whatever the provider
# returns, auto-approve gates correctly on all five checks), but actual
# vision-model accuracy on real messy JazzCash/Easypaisa screenshots is
# UNVERIFIED by this suite and was not benchmarked in this session --
# doing that honestly needs real screenshots and a live, billed API call,
# which this project's own established test-suite policy deliberately
# avoids (see CLAUDE.md's gotcha about tests/test_gemini.py firing real
# billed calls on every collection, which was treated as a bug and moved
# out of tests/). Before trusting auto-approve at pilot scale, run a
# one-off manual pass (not part of `pytest`) against a handful of real
# JazzCash/Easypaisa screenshots and report the real hit rate, the same way
# Section 21's Gemini switch was verified against a live key before being
# trusted.


# --- _parse_ocr_timestamp (Section 32 Part 7) --------------------------------
# Real receipts print a human, Pakistan-local time and the vision model returns
# it verbatim -- not ISO. These pin that it parses AND that a value with no
# offset is read as PKT (assuming UTC would be 5 hours off and break the check).

def test_parse_ocr_timestamp_human_pkt_format_is_read_as_pkt():
    # 7:12 PM PKT -> 14:12 UTC
    got = PaymentService._parse_ocr_timestamp("24 Sep 2026, 07:12 PM")
    assert got == datetime(2026, 9, 24, 14, 12, tzinfo=timezone.utc)


def test_parse_ocr_timestamp_human_no_comma():
    got = PaymentService._parse_ocr_timestamp("24 Sep 2026 06:30 PM")
    assert got == datetime(2026, 9, 24, 13, 30, tzinfo=timezone.utc)


def test_parse_ocr_timestamp_iso_with_offset_kept():
    got = PaymentService._parse_ocr_timestamp("2026-09-24T19:12:00+05:00")
    assert got == datetime(2026, 9, 24, 14, 12, tzinfo=timezone.utc)


def test_parse_ocr_timestamp_iso_without_offset_is_pkt():
    # A bare ISO with no zone is still a Pakistan wall-clock reading.
    got = PaymentService._parse_ocr_timestamp("2026-09-24T19:12:00")
    assert got == datetime(2026, 9, 24, 14, 12, tzinfo=timezone.utc)


def test_parse_ocr_timestamp_unparseable_is_none():
    assert PaymentService._parse_ocr_timestamp("sometime yesterday") is None
    assert PaymentService._parse_ocr_timestamp(None) is None
    assert PaymentService._parse_ocr_timestamp("") is None


# --- fixture images (Section 32 Part 7) --------------------------------------
# The synthetic JazzCash/Easypaisa fixtures in tests/fixtures/payments/ back the
# honest accuracy run (scripts/ocr_accuracy_report.py, a real-vision-model script
# kept OUT of the suite). This test just guards them from rot: every one is a
# real, decodable image the perceptual-hash dedup path can read.

def test_ocr_fixture_images_are_valid_decodable_images():
    import os
    from app.utils.image import perceptual_hash

    fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures", "payments")
    images = [f for f in os.listdir(fixtures_dir) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
    assert len(images) >= 5, f"expected the Part 7 fixtures, found {images}"
    for name in images:
        with open(os.path.join(fixtures_dir, name), "rb") as fh:
            data = fh.read()
        assert len(data) > 0
        assert perceptual_hash(data) is not None, f"{name} did not decode / hash"
