"""OCR/vision extraction behavior. This used to live in a standalone
OCRService; Section 21 moved it (unchanged) into ClaudeProvider.extract_payment_proof
as part of making the AI vendor a config choice -- see tests/test_ai_providers.py
for the provider-selection/factory contract these now sit behind.

Section 21 Part B.2 switched Claude's extraction from prompt-only JSON to a
forced record_payment_extraction tool call (see app/services/ai/schemas.py)
-- the response shape these tests mock changed accordingly."""

import httpx
import pytest

from app.config import get_settings
from app.services.ai.claude_provider import ClaudeProvider
from app.services.ai.schemas import PaymentExtractionValidationError


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
