"""Section 21.2.3: OpenAI, via raw REST against the Chat Completions API (no
`openai` SDK dependency -- see the note at the top of claude_provider.py)."""

import base64
import json

import structlog

from app.services.ai.base import AIProvider, AIReply, PaymentExtraction, ToolCall
from app.services.ai.http import post_json
from app.services.ai.schemas import (
    OCR_EXTRACTION_INSTRUCTIONS,
    PAYMENT_EXTRACTION_OPENAI_SCHEMA,
    PaymentExtractionValidationError,
    validate_extraction,
)
from app.services.ai.tools import ToolDefinition

logger = structlog.get_logger(__name__)

CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"


class OpenAIProvider(AIProvider):
    def __init__(self, api_key: str, mini_model: str, full_model: str) -> None:
        self.api_key = api_key
        self.mini_model = mini_model  # "routine" tier, e.g. gpt-4o-mini
        self.full_model = full_model  # "complex" tier, e.g. gpt-4o

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def get_tool_schema(self, tool_defs: list[ToolDefinition]) -> list[dict]:
        return [
            {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
            for t in tool_defs
        ]

    @staticmethod
    def _to_openai_messages(system_prompt: str, messages: list[dict]) -> list[dict]:
        """Translate the neutral (Claude-shaped) message list into OpenAI's
        flat format: an assistant turn's tool_use blocks become a single
        message with a `tool_calls` array; each tool_result block in a
        neutral "user" turn becomes its OWN separate `role: "tool"` message
        (OpenAI has no single message carrying several tool results)."""
        out: list[dict] = [{"role": "system", "content": system_prompt}]
        for m in messages:
            content = m["content"]
            if isinstance(content, str):
                out.append({"role": m["role"], "content": content})
                continue

            if m["role"] == "assistant":
                text_parts = [b["text"] for b in content if b.get("type") == "text"]
                tool_use_blocks = [b for b in content if b.get("type") == "tool_use"]
                assistant_msg: dict = {"role": "assistant", "content": " ".join(text_parts) or None}
                if tool_use_blocks:
                    assistant_msg["tool_calls"] = [
                        {
                            "id": b["id"],
                            "type": "function",
                            "function": {"name": b["name"], "arguments": json.dumps(b.get("input", {}))},
                        }
                        for b in tool_use_blocks
                    ]
                out.append(assistant_msg)
            else:
                for block in content:
                    if block.get("type") != "tool_result":
                        continue
                    result_text = "".join(
                        c.get("text", "") for c in block.get("content", []) if c.get("type") == "text"
                    )
                    out.append({"role": "tool", "tool_call_id": block["tool_use_id"], "content": result_text})
        return out

    async def chat(
        self, system_prompt: str, messages: list[dict], tools: list[dict], model_tier: str = "routine"
    ) -> AIReply:
        model = self.mini_model if model_tier == "routine" else self.full_model
        full_messages = self._to_openai_messages(system_prompt, messages)
        payload = {"model": model, "messages": full_messages, "tools": tools}

        data = await post_json(CHAT_COMPLETIONS_URL, headers=self._headers(), json=payload, timeout=30)

        choice = data["choices"][0]["message"]
        tool_calls = [
            ToolCall(name=tc["function"]["name"], arguments=json.loads(tc["function"]["arguments"]), call_id=tc["id"])
            for tc in (choice.get("tool_calls") or [])
        ]
        usage = data.get("usage", {})
        return AIReply(
            text=choice.get("content"),
            tool_calls=tool_calls,
            raw_usage={
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
            },
            model_used=model,
        )

    async def extract_payment_proof(
        self, image_bytes: bytes, mime_type: str, expected_amount: float
    ) -> PaymentExtraction:
        """Uses response_format's strict json_schema mode -- the API itself
        guarantees the response matches PAYMENT_EXTRACTION_OPENAI_SCHEMA, so
        this no longer relies on the model choosing to comply with a
        prompt-text instruction to "return JSON"."""
        b64_image = base64.b64encode(image_bytes).decode()
        payload = {
            "model": self.full_model,  # vision quality matters more than latency here
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": OCR_EXTRACTION_INSTRUCTIONS},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_image}"}},
                    ],
                }
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "payment_extraction",
                    "strict": True,
                    "schema": PAYMENT_EXTRACTION_OPENAI_SCHEMA,
                },
            },
        }
        data = await post_json(CHAT_COMPLETIONS_URL, headers=self._headers(), json=payload, timeout=30)

        text = data["choices"][0]["message"].get("content") or ""
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            logger.error("openai_provider.ocr_parse_failed", raw=text)
            raise PaymentExtractionValidationError(f"OpenAI response was not valid JSON: {text!r}") from None
        extracted = validate_extraction(parsed)

        usage = data.get("usage", {})
        return PaymentExtraction(
            amount=extracted.amount,
            reference=extracted.reference,
            timestamp=extracted.timestamp,
            confidence=extracted.confidence,
            raw_response=data,
            model_used=data.get("model", self.full_model),
            raw_usage={
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
            },
        )
