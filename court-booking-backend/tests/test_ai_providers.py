"""Section 21.5: the AIProvider contract, exercised identically against all
three providers with a mocked HTTP layer, plus the factory's config-driven
selection/fallback/fail-loudly behavior and ai_usage_log recording."""

import json

import httpx
import pytest

from app.config import get_settings
from app.services.ai.claude_provider import ClaudeProvider
from app.services.ai.factory import UnconfiguredProviderError, get_chat_provider, get_vision_provider
from app.services.ai.gemini_provider import GeminiProvider
from app.services.ai.openai_provider import OpenAIProvider
from app.services.ai.tools import BOOKING_TOOLS

# ---------------------------------------------------------------------------
# Contract compliance: the same behavior verified against all three providers.
# ---------------------------------------------------------------------------


def _make_provider(name: str):
    if name == "claude":
        return ClaudeProvider("test-key", "claude-haiku", "claude-sonnet")
    if name == "gemini":
        return GeminiProvider("test-key", "gemini-flash", "gemini-pro")
    if name == "openai":
        return OpenAIProvider("test-key", "gpt-4o-mini", "gpt-4o")
    raise ValueError(name)


def _text_response(provider_name: str) -> dict:
    if provider_name == "claude":
        return {
            "content": [{"type": "text", "text": "Hello there!"}],
            "model": "claude-haiku",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    if provider_name == "gemini":
        return {
            "candidates": [{"content": {"role": "model", "parts": [{"text": "Hello there!"}]}}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
        }
    if provider_name == "openai":
        return {
            "choices": [{"message": {"role": "assistant", "content": "Hello there!", "tool_calls": None}}],
            "model": "gpt-4o-mini",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
    raise ValueError(provider_name)


def _tool_call_response(provider_name: str) -> dict:
    if provider_name == "claude":
        return {
            "content": [
                {"type": "tool_use", "id": "toolu_1", "name": "check_availability", "input": {"court_id": "c1", "date": "2026-01-01"}}
            ],
            "model": "claude-haiku",
            "usage": {"input_tokens": 20, "output_tokens": 8},
        }
    if provider_name == "gemini":
        return {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [
                            {
                                "functionCall": {
                                    "name": "check_availability",
                                    "args": {"court_id": "c1", "date": "2026-01-01"},
                                }
                            }
                        ],
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 20, "candidatesTokenCount": 8},
        }
    if provider_name == "openai":
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "check_availability",
                                    "arguments": json.dumps({"court_id": "c1", "date": "2026-01-01"}),
                                },
                            }
                        ],
                    }
                }
            ],
            "model": "gpt-4o-mini",
            "usage": {"prompt_tokens": 20, "completion_tokens": 8},
        }
    raise ValueError(provider_name)


def _vision_response(provider_name: str) -> dict:
    extraction_data = {"amount": 3000, "reference": "TXN1", "timestamp": None, "confidence": 0.9}
    extraction_json = json.dumps(extraction_data)
    if provider_name == "claude":
        return {
            "content": [
                {"type": "tool_use", "id": "toolu_1", "name": "record_payment_extraction", "input": extraction_data}
            ],
            "model": "claude-sonnet",
            "usage": {"input_tokens": 500, "output_tokens": 30},
        }
    if provider_name == "gemini":
        return {
            "candidates": [{"content": {"parts": [{"text": extraction_json}]}}],
            "usageMetadata": {"promptTokenCount": 500, "candidatesTokenCount": 30},
        }
    if provider_name == "openai":
        return {
            "choices": [{"message": {"content": extraction_json}}],
            "model": "gpt-4o",
            "usage": {"prompt_tokens": 500, "completion_tokens": 30},
        }
    raise ValueError(provider_name)


def _mock_post(monkeypatch, response_json: dict):
    async def fake_post(self, url, headers=None, json=None, **kwargs):
        return httpx.Response(200, request=httpx.Request("POST", url), json=response_json)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)


PROVIDER_NAMES = ["claude", "gemini", "openai"]


@pytest.mark.parametrize("provider_name", PROVIDER_NAMES)
async def test_chat_with_no_tool_call_returns_text(provider_name, monkeypatch):
    provider = _make_provider(provider_name)
    _mock_post(monkeypatch, _text_response(provider_name))

    reply = await provider.chat("system prompt", [{"role": "user", "content": "hi"}], tools=[], model_tier="routine")
    assert reply.text == "Hello there!"
    assert reply.tool_calls == []
    assert isinstance(reply.raw_usage["input_tokens"], int) and reply.raw_usage["input_tokens"] >= 0
    assert isinstance(reply.raw_usage["output_tokens"], int) and reply.raw_usage["output_tokens"] >= 0


@pytest.mark.parametrize("provider_name", PROVIDER_NAMES)
async def test_chat_with_tool_the_model_should_call(provider_name, monkeypatch):
    provider = _make_provider(provider_name)
    _mock_post(monkeypatch, _tool_call_response(provider_name))

    tools = provider.get_tool_schema(BOOKING_TOOLS)
    reply = await provider.chat("system prompt", [{"role": "user", "content": "is court 1 free?"}], tools=tools, model_tier="routine")
    assert len(reply.tool_calls) == 1
    call = reply.tool_calls[0]
    assert call.name == "check_availability"
    assert call.arguments == {"court_id": "c1", "date": "2026-01-01"}
    assert call.call_id  # non-empty, whatever shape this provider uses


@pytest.mark.parametrize("provider_name", PROVIDER_NAMES)
async def test_extract_payment_proof_returns_non_null_amount(provider_name, monkeypatch):
    provider = _make_provider(provider_name)
    _mock_post(monkeypatch, _vision_response(provider_name))

    extraction = await provider.extract_payment_proof(b"fake-image-bytes", "image/jpeg", expected_amount=3000)
    assert extraction.amount == 3000
    assert isinstance(extraction.raw_usage.get("input_tokens", 0), int)
    assert isinstance(extraction.raw_usage.get("output_tokens", 0), int)


def test_tool_schema_translation_claude_is_flat_with_input_schema():
    provider = _make_provider("claude")
    schema = provider.get_tool_schema(BOOKING_TOOLS)
    assert all("input_schema" in t and "name" in t and "type" not in t for t in schema)
    assert schema[0]["input_schema"] == BOOKING_TOOLS[0].parameters


def test_tool_schema_translation_openai_wraps_in_type_function():
    provider = _make_provider("openai")
    schema = provider.get_tool_schema(BOOKING_TOOLS)
    assert all(t["type"] == "function" for t in schema)
    assert all("parameters" in t["function"] for t in schema)


async def test_gemini_tool_call_carries_thought_signature(monkeypatch):
    """Part B.1's live verification against the real API found that a
    thinking-enabled Gemini model (gemini-3.6-flash, then reconfirmed on
    gemini-3.5-flash-lite when that became the chat-tier default) 400s on
    the *second* turn of a tool-calling conversation -- "Function call is
    missing a thought_signature in functionCall parts" -- unless that
    signature, returned alongside the first turn's functionCall, is
    echoed back verbatim when that call is replayed into history. This is
    a mocked
    regression test for the fix (ToolCall.provider_data / GeminiProvider);
    the real-API confirmation itself isn't repeatable here without a live
    key and cost."""
    provider = _make_provider("gemini")
    _mock_post(
        monkeypatch,
        {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [
                            {
                                "functionCall": {"name": "check_availability", "args": {"court_id": "c1", "date": "2026-01-01"}},
                                "thoughtSignature": "opaque-signature-abc123",
                            }
                        ],
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 20, "candidatesTokenCount": 8},
        },
    )

    reply = await provider.chat("system prompt", [{"role": "user", "content": "hi"}], tools=[], model_tier="routine")
    call = reply.tool_calls[0]
    assert call.provider_data == {"thought_signature": "opaque-signature-abc123"}

    # Replaying that tool_use block into history must carry the signature
    # forward on the reconstructed functionCall part.
    history = provider._to_gemini_history(
        [
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": call.call_id, "name": call.name, "input": call.arguments, "provider_data": call.provider_data}
                ],
            }
        ]
    )
    reconstructed = history[0]["parts"][0]
    assert reconstructed["thoughtSignature"] == "opaque-signature-abc123"


def test_gemini_tool_call_without_thought_signature_omits_it(monkeypatch):
    """Older/non-thinking responses (or the mocked tests elsewhere in this
    file) don't carry a thoughtSignature at all -- provider_data must stay
    None rather than a dict of Nones, and reconstruction must not emit a
    spurious `thoughtSignature: null`."""
    provider = _make_provider("gemini")
    history = provider._to_gemini_history(
        [{"role": "assistant", "content": [{"type": "tool_use", "id": "check_availability", "name": "check_availability", "input": {}}]}]
    )
    assert "thoughtSignature" not in history[0]["parts"][0]


def test_tool_schema_translation_gemini_wraps_in_function_declarations():
    provider = _make_provider("gemini")
    schema = provider.get_tool_schema(BOOKING_TOOLS)
    assert len(schema) == 1
    assert "function_declarations" in schema[0]
    assert len(schema[0]["function_declarations"]) == len(BOOKING_TOOLS)


# ---------------------------------------------------------------------------
# Provider selection via config (the factory)
# ---------------------------------------------------------------------------


def test_get_chat_provider_selects_claude(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    assert isinstance(get_chat_provider(settings), ClaudeProvider)


def test_get_chat_provider_selects_gemini(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    assert isinstance(get_chat_provider(settings), GeminiProvider)


def test_get_chat_provider_selects_openai(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "openai")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")
    assert isinstance(get_chat_provider(settings), OpenAIProvider)


def test_get_chat_provider_unknown_provider_raises(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "nonsense")
    with pytest.raises(UnconfiguredProviderError):
        get_chat_provider(settings)


def test_missing_api_key_fails_loudly_naming_the_env_var(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    with pytest.raises(UnconfiguredProviderError, match="GEMINI_API_KEY"):
        get_chat_provider(settings)


def test_vision_provider_falls_back_to_chat_provider_when_unset(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_VISION_PROVIDER", "")
    assert isinstance(get_vision_provider(settings), GeminiProvider)


def test_vision_provider_independent_override(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_VISION_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    assert isinstance(get_chat_provider(settings), GeminiProvider)
    assert isinstance(get_vision_provider(settings), ClaudeProvider)


# ---------------------------------------------------------------------------
# ai_usage_log recording, regardless of provider
# ---------------------------------------------------------------------------


async def test_ai_usage_log_records_chat_turns_per_provider(db_session, make_user, monkeypatch):
    from sqlalchemy import select

    from app.models.ai_usage import AIUsageLog
    from app.models.user import UserRole
    from app.services.ai_chat_service import AIChatService

    player = await make_user("+923013000001", role=UserRole.PLAYER)
    settings = get_settings()

    monkeypatch.setattr(settings, "AI_PROVIDER", "claude")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    _mock_post(monkeypatch, _text_response("claude"))

    service = AIChatService(db_session, settings)
    await service.process_message(user=player, message="hi", history=[])

    rows = (await db_session.execute(select(AIUsageLog).where(AIUsageLog.provider == "claude"))).scalars().all()
    assert len(rows) == 1
    assert rows[0].purpose == "chat"
    assert rows[0].input_tokens == 10
    assert rows[0].output_tokens == 5

    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-key")
    _mock_post(monkeypatch, _text_response("gemini"))

    await service.process_message(user=player, message="hi again", history=[])

    gemini_rows = (await db_session.execute(select(AIUsageLog).where(AIUsageLog.provider == "gemini"))).scalars().all()
    assert len(gemini_rows) == 1

    by_provider = (
        await db_session.execute(
            select(AIUsageLog.provider, AIUsageLog.input_tokens).order_by(AIUsageLog.provider)
        )
    ).all()
    providers_seen = {row[0] for row in by_provider}
    assert providers_seen == {"claude", "gemini"}


# ---------------------------------------------------------------------------
# Existing pre-Section-21 behavior stays green with AI_PROVIDER=claude (the default)
# ---------------------------------------------------------------------------


def test_default_provider_is_claude():
    settings = get_settings()
    assert settings.AI_PROVIDER == "claude"
