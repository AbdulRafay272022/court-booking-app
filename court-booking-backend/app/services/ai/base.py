"""Section 21.1: the provider-agnostic AI interface. Nothing outside
app/services/ai/ should ever import a vendor SDK or call a vendor's REST API
directly -- business logic (ai_chat_service.py, payment_service.py) only
ever talks to an `AIProvider`, obtained from `factory.py`.

The wire format for `chat()`'s `messages` is Claude's native shape (a
`role` plus `content` that's either a string or a list of content blocks:
`{"type": "text", ...}`, `{"type": "tool_use", "id", "name", "input"}`,
`{"type": "tool_result", "tool_use_id", "content"}`). That isn't a neutral
invention -- it's the format the existing (pre-Section-21) Claude-only chat
loop already used, and it round-trips cleanly (an assistant turn's tool
calls carry an id/name/input that the next turn's tool-result blocks
reference by id). Every non-Claude provider is responsible for translating
this shape to and from its own native call in its own `chat()`
implementation; `ai_chat_service.py` (the caller) never needs to know which
provider is active.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    """A tool the model wants to invoke, normalized across providers."""

    name: str
    arguments: dict[str, Any]
    call_id: str  # provider-specific ID needed to send the result back
    provider_data: dict[str, Any] | None = None
    """Opaque, provider-specific data that must be echoed back verbatim in
    a later turn for this exact call -- e.g. Gemini's `thoughtSignature`
    (confirmed live during Part B.1: a thinking-enabled Gemini model 400s
    with "Function call is missing a thought_signature" if a prior
    functionCall is replayed into history without it). Claude/OpenAI leave
    this None; ai_chat_service.py carries it through generically in the
    neutral tool_use content block without needing to know what's in it."""


@dataclass
class AIReply:
    """Normalized response from any provider."""

    text: str | None  # Natural language reply, if any
    tool_calls: list[ToolCall] = field(default_factory=list)  # Empty if the model just replied with text
    raw_usage: dict[str, int] = field(default_factory=dict)  # {"input_tokens": N, "output_tokens": N}
    model_used: str = ""  # e.g. "claude-haiku-4-20250514" -- logged for cost tracking


@dataclass
class PaymentExtraction:
    """Normalized OCR/vision result from a payment screenshot.

    `model_used`/`raw_usage` aren't in Section 21.1's original interface
    sketch, but every provider's raw vision response shapes its token-usage
    field differently (Claude/OpenAI use different key names for the same
    concept; Gemini's differs again, and doesn't echo the model name back
    at all) -- without these two normalized fields, `payment_service.py`
    would have to parse `raw_response` per-provider to log `ai_usage_log`,
    which is exactly the kind of vendor-specific business logic Section 21
    exists to eliminate. Mirrors `AIReply`'s same two fields for the same
    reason.
    """

    amount: float | None
    reference: str | None
    timestamp: str | None
    confidence: float | None  # 0.0 to 1.0, None if the model didn't return one
    raw_response: dict  # Full provider response, stored for debugging
    model_used: str = ""
    raw_usage: dict[str, int] = field(default_factory=dict)


class AIProvider(ABC):
    """Every AI vendor integration implements this. Business logic never
    talks to a vendor SDK directly -- only to this interface."""

    @abstractmethod
    async def chat(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict],  # Tool definitions in THIS provider's native schema (see get_tool_schema)
        model_tier: str = "routine",  # "routine" -> cheap/fast model, "complex" -> smarter model
    ) -> AIReply:
        """Run one conversational turn. May return text, tool calls, or both."""
        ...

    @abstractmethod
    async def extract_payment_proof(
        self,
        image_bytes: bytes,
        mime_type: str,
        expected_amount: float,
    ) -> PaymentExtraction:
        """Vision call: read a payment screenshot and extract amount/reference/timestamp."""
        ...

    @abstractmethod
    def get_tool_schema(self, tool_defs: list["Any"]) -> list[dict]:
        """Convert the app's provider-neutral tool definitions (ToolDefinition,
        see tools.py) into this provider's native function/tool-calling JSON."""
        ...
