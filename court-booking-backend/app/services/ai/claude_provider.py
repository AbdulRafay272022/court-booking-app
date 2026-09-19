"""Section 21.2.1: Claude, wrapping the exact HTTP calls the pre-Section-21
code made directly (`ai_chat_service._call_claude`, `ocr_service.extract_payment_proof`).

Deliberately uses raw httpx against the Messages API rather than the
`anthropic` SDK the spec's illustrative pseudocode shows: the existing code
this wraps was never written against that SDK (it isn't even an installed
dependency), and "byte-for-byte like today" means moving that code, not
swapping its transport. The same reasoning applies to Gemini/OpenAI below --
all three providers speak REST directly, so no vendor SDK is a dependency
of this project at all, not even a lazily-imported one.
"""

import base64

import structlog

from app.services.ai.base import AIProvider, AIReply, PaymentExtraction, ToolCall
from app.services.ai.http import post_json
from app.services.ai.schemas import (
    OCR_EXTRACTION_INSTRUCTIONS,
    RECORD_PAYMENT_EXTRACTION_TOOL,
    PaymentExtractionValidationError,
    validate_extraction,
)
from app.services.ai.tools import ToolDefinition

logger = structlog.get_logger(__name__)

MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class ClaudeProvider(AIProvider):
    def __init__(self, api_key: str, haiku_model: str, sonnet_model: str) -> None:
        self.api_key = api_key
        self.haiku_model = haiku_model
        self.sonnet_model = sonnet_model

    def _headers(self) -> dict:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    def get_tool_schema(self, tool_defs: list[ToolDefinition]) -> list[dict]:
        return [
            {"name": t.name, "description": t.description, "input_schema": t.parameters}
            for t in tool_defs
        ]

    async def chat(
        self, system_prompt: str, messages: list[dict], tools: list[dict], model_tier: str = "routine"
    ) -> AIReply:
        model = self.haiku_model if model_tier == "routine" else self.sonnet_model
        payload = {
            "model": model,
            "max_tokens": 500,
            "system": system_prompt,
            "tools": tools,
            "messages": messages,
        }
        data = await post_json(MESSAGES_URL, headers=self._headers(), json=payload, timeout=30)

        content = data.get("content", [])
        text = "".join(b.get("text", "") for b in content if b.get("type") == "text") or None
        tool_calls = [
            ToolCall(name=b["name"], arguments=b.get("input", {}), call_id=b["id"])
            for b in content
            if b.get("type") == "tool_use"
        ]
        usage = data.get("usage", {})
        return AIReply(
            text=text,
            tool_calls=tool_calls,
            raw_usage={
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
            },
            model_used=model,
        )

    async def extract_payment_proof(
        self, image_bytes: bytes, mime_type: str, expected_amount: float
    ) -> PaymentExtraction:
        """Forces the record_payment_extraction tool rather than asking for
        JSON in prose -- Claude has no separate strict-JSON mode, but a
        forced tool call gives the same shape guarantee its tool-calling
        already enforces for BOOKING_TOOLS."""
        b64_image = base64.b64encode(image_bytes).decode()
        payload = {
            "model": self.sonnet_model,  # vision quality matters more than latency here
            "max_tokens": 300,
            "tools": [RECORD_PAYMENT_EXTRACTION_TOOL],
            "tool_choice": {"type": "tool", "name": "record_payment_extraction"},
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": mime_type, "data": b64_image},
                        },
                        {"type": "text", "text": OCR_EXTRACTION_INSTRUCTIONS},
                    ],
                }
            ],
        }
        data = await post_json(MESSAGES_URL, headers=self._headers(), json=payload, timeout=30)

        content = data.get("content", [])
        tool_use = next((b for b in content if b.get("type") == "tool_use"), None)
        if tool_use is None:
            logger.error("claude_provider.ocr_no_tool_call", raw=data)
            raise PaymentExtractionValidationError("Claude did not call record_payment_extraction")
        extracted = validate_extraction(tool_use.get("input", {}))

        usage = data.get("usage", {})
        return PaymentExtraction(
            amount=extracted.amount,
            reference=extracted.reference,
            timestamp=extracted.timestamp,
            confidence=extracted.confidence,
            raw_response=data,
            model_used=data.get("model", self.sonnet_model),
            raw_usage={
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
            },
        )
