"""Section 21 Part B.2: the payment-extraction shape, enforced natively by
each provider's own structured-output feature instead of trusted from
prompt text ("Return JSON: {...}"), which occasionally came back malformed
or wrapped in prose. One Pydantic model validates whatever shape a provider
hands back, regardless of how it got there (Claude's tool_use `input`,
OpenAI's `response_format` JSON string, Gemini's `response_schema` JSON
string) -- so a response that doesn't match the expected shape at all
raises loudly (`PaymentExtractionValidationError`) instead of silently
becoming a bunch of Nones that look identical to a legitimate "I couldn't
read this screenshot" response (which is *also* all-null fields, but valid
against this same schema, so it must NOT raise).
"""

from pydantic import BaseModel, ValidationError


class PaymentExtractionSchema(BaseModel):
    amount: float | None = None
    reference: str | None = None
    timestamp: str | None = None
    confidence: float | None = None


class PaymentExtractionValidationError(Exception):
    """The provider's response didn't match PaymentExtractionSchema at all
    (missing entirely, wrong types that can't coerce) -- as opposed to a
    schema-valid all-null response, which is a legitimate "unreadable"
    verdict and must be returned normally, not raised."""


def validate_extraction(data: dict) -> PaymentExtractionSchema:
    try:
        return PaymentExtractionSchema.model_validate(data)
    except ValidationError as exc:
        raise PaymentExtractionValidationError(str(exc)) from exc


# Plain instruction text -- what to extract. The *shape* of the answer is
# now enforced by each provider's own schema mechanism below, not by
# asking nicely in the prompt.
OCR_EXTRACTION_INSTRUCTIONS = (
    "Extract from this payment screenshot: the transaction amount (numeric), the transaction "
    "reference/ID, and the transaction date/time (ISO 8601). If you cannot read a field, use "
    "null for it. Include a confidence score from 0.0 to 1.0 for the extraction as a whole."
)

# Claude: forced tool-use (Claude has no separate "strict JSON mode").
RECORD_PAYMENT_EXTRACTION_TOOL = {
    "name": "record_payment_extraction",
    "description": "Record the extracted payment details read from the screenshot.",
    "input_schema": {
        "type": "object",
        "properties": {
            "amount": {"type": ["number", "null"], "description": "Transaction amount, numeric"},
            "reference": {"type": ["string", "null"], "description": "Transaction reference/ID"},
            "timestamp": {"type": ["string", "null"], "description": "ISO 8601 transaction date/time"},
            "confidence": {"type": "number", "description": "0.0-1.0 confidence in this extraction"},
        },
        "required": ["amount", "reference", "timestamp", "confidence"],
    },
}

# OpenAI: response_format={"type": "json_schema", ..., "strict": True} --
# strict mode requires every property listed in "required" (nullable
# fields express optionality via a ["type", "null"] union instead) and
# additionalProperties: false.
PAYMENT_EXTRACTION_OPENAI_SCHEMA = {
    "type": "object",
    "properties": {
        "amount": {"type": ["number", "null"]},
        "reference": {"type": ["string", "null"]},
        "timestamp": {"type": ["string", "null"]},
        "confidence": {"type": "number"},
    },
    "required": ["amount", "reference", "timestamp", "confidence"],
    "additionalProperties": False,
}

# Gemini: generation_config.response_schema, a subset of the OpenAPI 3.0
# Schema Object -- uppercase type names, "nullable" instead of a type
# union. Not verified against a live call (see README's AI provider notes
# -- no real Gemini key was exercised when this was written); confirm this
# shape during the Part B.1 manual verification pass before trusting it.
PAYMENT_EXTRACTION_GEMINI_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "amount": {"type": "NUMBER", "nullable": True},
        "reference": {"type": "STRING", "nullable": True},
        "timestamp": {"type": "STRING", "nullable": True},
        "confidence": {"type": "NUMBER"},
    },
    "required": ["amount", "reference", "timestamp", "confidence"],
}
