"""Section 21.3: picks the configured AIProvider implementation.

Deliberately NOT `@lru_cache`d (unlike the spec's illustrative pseudocode):
this codebase has no bare importable `settings` singleton (`app.config`
exposes `get_settings()`, cached, and every service takes `settings: Settings`
as a constructor argument -- see `AIChatService`/`PaymentService`). A
provider built from *one* Settings snapshot and cached forever on the
factory function would go stale the moment a test (or a config reload)
changes `AI_PROVIDER`/an API key, since `lru_cache` only ever evaluates a
given set of arguments once. Building a provider is cheap (it just stores a
few strings), so there's no real performance reason to cache it -- the
caching in the spec's version is there for a codebase shaped differently
than this one.
"""

from app.config import Settings
from app.services.ai.base import AIProvider
from app.services.ai.claude_provider import ClaudeProvider


class UnconfiguredProviderError(Exception):
    """Raised when the selected provider's API key is missing."""


def _build_provider(name: str, settings: Settings) -> AIProvider:
    if name == "claude":
        if not settings.ANTHROPIC_API_KEY:
            raise UnconfiguredProviderError("AI_PROVIDER=claude but ANTHROPIC_API_KEY is not set")
        return ClaudeProvider(settings.ANTHROPIC_API_KEY, settings.CLAUDE_HAIKU_MODEL, settings.CLAUDE_SONNET_MODEL)
    if name == "gemini":
        if not settings.GEMINI_API_KEY:
            raise UnconfiguredProviderError("AI_PROVIDER=gemini but GEMINI_API_KEY is not set")
        from app.services.ai.gemini_provider import GeminiProvider

        return GeminiProvider(settings.GEMINI_API_KEY, settings.GEMINI_FLASH_MODEL, settings.GEMINI_PRO_MODEL)
    if name == "openai":
        if not settings.OPENAI_API_KEY:
            raise UnconfiguredProviderError("AI_PROVIDER=openai but OPENAI_API_KEY is not set")
        from app.services.ai.openai_provider import OpenAIProvider

        return OpenAIProvider(settings.OPENAI_API_KEY, settings.OPENAI_MINI_MODEL, settings.OPENAI_FULL_MODEL)
    raise UnconfiguredProviderError(f"Unknown AI_PROVIDER: {name}")


def get_chat_provider(settings: Settings) -> AIProvider:
    """Used by ai_chat_service.py for the booking conversation."""
    return _build_provider(settings.AI_PROVIDER, settings)


def get_vision_provider(settings: Settings) -> AIProvider:
    """Used by payment_service.py's OCR step. Falls back to AI_PROVIDER if
    AI_VISION_PROVIDER isn't set -- lets you e.g. run chat on cheap Gemini
    but keep OCR on Claude if it tests better on real screenshots (see the
    README's manual-test checklist before ever flipping this in production)."""
    return _build_provider(settings.AI_VISION_PROVIDER or settings.AI_PROVIDER, settings)
