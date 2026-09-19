"""Section 21.2.2: Gemini, via raw REST (no `google-generativeai` SDK
dependency -- see the note at the top of claude_provider.py for why all
three providers in this package speak REST directly instead of a vendor
SDK). `function_declarations`/`inline_data` are kept in snake_case to
match Section 21.5's explicit tool-schema test expectation -- confirmed
against a live call (Part B.1, 2026-09-07) that Google's JSON parsing
accepts this.

Verified against the real API with a live key on 2026-09-07 (Part B.1)
and again on 2026-09-08 after switching the chat-tier model: chat()
(including a full multi-turn tool-calling conversation through
/chat/message, ending in a real hold_slot confirmation) and
extract_payment_proof() (structured-output vision extraction against a
synthetic receipt, every field correct) both work end-to-end. Findings
from those passes, all fixed here:
  1. `gemini-2.0-flash`/`-pro` (this file's original models) and even
     `gemini-2.5-flash`/`-pro` are dead ("no longer available to new
     users"). `gemini-3.6-flash` was confirmed live 2026-09-07 and used
     briefly as the chat-tier default; superseded 2026-09-08 by
     `gemini-3.5-flash-lite` (current default, also live-verified for
     chat/tool-calling/vision -- see config.py). `gemini-pro-latest`
     (vision default) exists but this test key's plan 429s on every
     "pro"-tier model tried, a billing constraint not a code bug. Google
     churns model names fast here; re-verify before trusting any of
     these defaults again.
  2. Thinking-enabled models (the entire current lineup, flash-lite
     included) omit `candidatesTokenCount` for some plain-text replies,
     reporting those tokens under `thoughtsTokenCount` instead --
     `chat()`'s raw_usage now sums both, or ai_usage_log silently
     undercounts Gemini cost.
  3. A thinking model's `functionCall` part carries a `thoughtSignature`
     that MUST be echoed back verbatim if that call is replayed into a
     later turn's history, or the API 400s with "Function call is
     missing a thought_signature" -- this broke every multi-turn
     tool-calling conversation until fixed via `ToolCall.provider_data`
     (see base.py and ai_chat_service.py). Confirmed present on
     `gemini-3.5-flash-lite` too. See test_ai_providers.py's
     `test_gemini_tool_call_carries_thought_signature` for the mocked
     regression test.
Not yet verified live: the vision model being genuinely quota-limited
("pro" tier 429'd repeatedly on the key used) means production-scale
vision usage under this exact key/plan is untested; the OCR-quality
comparison against real JazzCash/Easypaisa screenshots this file
previously flagged as unverified is *still* unverified (the synthetic
receipt used in testing was clean, rendered text, not a real messy
screenshot).
"""

import json

import structlog

from app.services.ai.base import AIProvider, AIReply, PaymentExtraction, ToolCall
from app.services.ai.http import post_json
from app.services.ai.schemas import (
    OCR_EXTRACTION_INSTRUCTIONS,
    PAYMENT_EXTRACTION_GEMINI_SCHEMA,
    PaymentExtractionValidationError,
    validate_extraction,
)
from app.services.ai.tools import ToolDefinition

logger = structlog.get_logger(__name__)

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiProvider(AIProvider):
    def __init__(self, api_key: str, flash_model: str, pro_model: str) -> None:
        self.api_key = api_key
        self.flash_model = flash_model  # "routine" tier
        self.pro_model = pro_model  # "complex" tier

    def get_tool_schema(self, tool_defs: list[ToolDefinition]) -> list[dict]:
        # Gemini wraps functions in a single "function_declarations" list.
        return [
            {
                "function_declarations": [
                    {"name": t.name, "description": t.description, "parameters": t.parameters}
                    for t in tool_defs
                ]
            }
        ]

    @staticmethod
    def _to_gemini_history(messages: list[dict]) -> list[dict]:
        """Translate the neutral (Claude-shaped) message list into Gemini's
        `contents` format: role='assistant' -> 'model', text/tool_use/
        tool_result blocks -> text/functionCall/functionResponse parts.
        A tool_result's `tool_use_id` doubles as the function name here,
        since GeminiProvider.chat() sets ToolCall.call_id = function name.
        A live call (Part B.1 manual verification, gemini-3.6-flash and
        gemini-3.5-flash-lite) showed Gemini's functionCall now *does*
        carry its own `id` field -- but
        functionResponse still only matches by `name`, not by that id (per
        the documented schema), so switching call_id to the real id would
        break this round-trip, not fix it. This remains a real limitation
        for two same-named tool calls in one turn (their results can't be
        disambiguated) -- not introduced by this code, and not something a
        live call resolved, so it's left as-is rather than guessed at."""
        contents = []
        for m in messages:
            role = "model" if m["role"] == "assistant" else "user"
            content = m["content"]
            if isinstance(content, str):
                contents.append({"role": role, "parts": [{"text": content}]})
                continue

            parts = []
            for block in content:
                block_type = block.get("type")
                if block_type == "text":
                    parts.append({"text": block["text"]})
                elif block_type == "tool_use":
                    function_call_part: dict = {
                        "functionCall": {"name": block["name"], "args": block.get("input", {})}
                    }
                    thought_signature = (block.get("provider_data") or {}).get("thought_signature")
                    if thought_signature:
                        # Required by thinking-enabled Gemini models (confirmed
                        # live, Part B.1) -- replaying a prior functionCall into
                        # history without it 400s with "Function call is missing
                        # a thought_signature in functionCall parts."
                        function_call_part["thoughtSignature"] = thought_signature
                    parts.append(function_call_part)
                elif block_type == "tool_result":
                    result_text = "".join(
                        c.get("text", "") for c in block.get("content", []) if c.get("type") == "text"
                    )
                    parts.append(
                        {
                            "functionResponse": {
                                "name": block["tool_use_id"],
                                "response": {"result": result_text},
                            }
                        }
                    )
            contents.append({"role": role, "parts": parts})
        return contents

    async def chat(
        self, system_prompt: str, messages: list[dict], tools: list[dict], model_tier: str = "routine"
    ) -> AIReply:
        model_name = self.flash_model if model_tier == "routine" else self.pro_model
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": self._to_gemini_history(messages),
            "tools": tools,
        }
        url = f"{API_BASE}/{model_name}:generateContent?key={self.api_key}"
        data = await post_json(url, json=payload, timeout=30)

        candidate = (data.get("candidates") or [{}])[0]
        parts = candidate.get("content", {}).get("parts", [])
        text = None
        tool_calls = []
        for part in parts:
            if part.get("text"):
                text = part["text"]
            function_call = part.get("functionCall")
            if function_call:
                thought_signature = part.get("thoughtSignature")
                tool_calls.append(
                    ToolCall(
                        name=function_call["name"],
                        arguments=dict(function_call.get("args", {})),
                        call_id=function_call["name"],  # see note below on why this is still name, not id
                        provider_data={"thought_signature": thought_signature} if thought_signature else None,
                    )
                )

        usage = data.get("usageMetadata", {})
        return AIReply(
            text=text,
            tool_calls=tool_calls,
            raw_usage={
                "input_tokens": usage.get("promptTokenCount", 0),
                # A live gemini-3.6-flash call (Part B.1 manual verification) showed
                # "thinking" models report reasoning tokens under a separate
                # thoughtsTokenCount that isn't included in candidatesTokenCount --
                # sometimes candidatesTokenCount is entirely absent (a plain-text
                # reply with no visible non-thinking tokens). Summing both is what
                # actually matches usageMetadata.totalTokenCount - promptTokenCount.
                "output_tokens": usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0),
            },
            model_used=model_name,
        )

    async def extract_payment_proof(
        self, image_bytes: bytes, mime_type: str, expected_amount: float
    ) -> PaymentExtraction:
        """Uses generation_config.response_schema -- the API itself
        guarantees the response matches PAYMENT_EXTRACTION_GEMINI_SCHEMA, so
        this no longer relies on the model choosing to comply with a
        prompt-text instruction to "return JSON"."""
        import base64

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode()}},
                        {"text": OCR_EXTRACTION_INSTRUCTIONS},
                    ],
                }
            ],
            "generation_config": {
                "response_mime_type": "application/json",
                "response_schema": PAYMENT_EXTRACTION_GEMINI_SCHEMA,
            },
        }
        url = f"{API_BASE}/{self.pro_model}:generateContent?key={self.api_key}"
        data = await post_json(url, json=payload, timeout=30)

        candidate = (data.get("candidates") or [{}])[0]
        parts = candidate.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts)
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            logger.error("gemini_provider.ocr_parse_failed", raw=text)
            raise PaymentExtractionValidationError(f"Gemini response was not valid JSON: {text!r}") from None
        extracted = validate_extraction(parsed)

        usage = data.get("usageMetadata", {})
        return PaymentExtraction(
            amount=extracted.amount,
            reference=extracted.reference,
            timestamp=extracted.timestamp,
            confidence=extracted.confidence,
            raw_response=data,
            model_used=self.pro_model,  # Gemini's response body doesn't echo the model name back
            raw_usage={
                "input_tokens": usage.get("promptTokenCount", 0),
                "output_tokens": usage.get("candidatesTokenCount", 0),
            },
        )
