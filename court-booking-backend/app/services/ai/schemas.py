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

Section 32 Part 7 extended the shape: payer name, bank/wallet name, and
receiver name/account tail (all null if not clearly visible -- never
guessed), plus a `flags` list for images that aren't a clean receipt at
all (not a receipt, cropped, edited/re-screenshotted, a failed or pending
transaction). These flags are informational for the owner's approval
card, not an auto-reject signal -- nothing in payment_service treats a
flag as grounds to refuse the payment outright.
"""

from pydantic import BaseModel, ValidationError

# Known values for `flags` -- informational tags the owner's approval card
# renders as extra warnings, never used to auto-reject. A model returning an
# unlisted string here is not an error (flags are treated as free-form by
# validation) but the frontend copy is only written for these four.
KNOWN_OCR_FLAGS = (
    "not_a_receipt",
    "cropped",
    "edited_or_rescreenshotted",
    "failed_or_pending_transaction",
)


class PaymentExtractionSchema(BaseModel):
    amount: float | None = None
    reference: str | None = None
    timestamp: str | None = None
    confidence: float | None = None
    payer_name: str | None = None
    bank_name: str | None = None
    receiver_name: str | None = None
    flags: list[str] = []


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
# enforced by each provider's own schema mechanism below, not by asking
# nicely in the prompt; this text only tells the model WHAT to look for and
# how strict to be about guessing.
OCR_EXTRACTION_INSTRUCTIONS = (
    "This is a screenshot of a mobile banking or mobile wallet payment (e.g. JazzCash, Easypaisa, "
    "a bank transfer receipt). Extract exactly what is visible -- never infer or guess a value that "
    "isn't clearly shown. Return: the transaction amount (numeric), the transaction reference/ID, "
    "the transaction date and time exactly as printed on the receipt (do not convert time zones or "
    "reformat it), the payer's name as printed on the receipt, the bank or wallet name (e.g. JazzCash, "
    "Easypaisa, HBL, Meezan), and the receiver's name or the last few digits of the receiver's "
    "account/number if shown. Use null for any field that is not clearly legible -- a blurry or "
    "absent value must be null, never a best guess. Include a confidence score from 0.0 to 1.0 for "
    "the extraction as a whole. Also set flags for any of: the image is not a payment receipt at "
    "all (not_a_receipt), the image looks cropped so information may be missing (cropped), the "
    "image looks edited or is a screenshot of another screenshot (edited_or_rescreenshotted), or the "
    "transaction shown is marked failed, declined, or still pending (failed_or_pending_transaction). "
    "Leave flags empty if none apply."
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
            "timestamp": {"type": ["string", "null"], "description": "Transaction date/time exactly as printed on the receipt"},
            "confidence": {"type": "number", "description": "0.0-1.0 confidence in this extraction"},
            "payer_name": {"type": ["string", "null"], "description": "Payer's name as printed on the receipt"},
            "bank_name": {"type": ["string", "null"], "description": "Bank or wallet name, e.g. JazzCash, Easypaisa, HBL"},
            "receiver_name": {
                "type": ["string", "null"],
                "description": "Receiver's name or last digits of the receiving account, if shown",
            },
            "flags": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Any of: not_a_receipt, cropped, edited_or_rescreenshotted, "
                    "failed_or_pending_transaction. Empty array if none apply."
                ),
            },
        },
        "required": [
            "amount",
            "reference",
            "timestamp",
            "confidence",
            "payer_name",
            "bank_name",
            "receiver_name",
            "flags",
        ],
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
        "payer_name": {"type": ["string", "null"]},
        "bank_name": {"type": ["string", "null"]},
        "receiver_name": {"type": ["string", "null"]},
        "flags": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "amount",
        "reference",
        "timestamp",
        "confidence",
        "payer_name",
        "bank_name",
        "receiver_name",
        "flags",
    ],
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
        "payer_name": {"type": "STRING", "nullable": True},
        "bank_name": {"type": "STRING", "nullable": True},
        "receiver_name": {"type": "STRING", "nullable": True},
        "flags": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": [
        "amount",
        "reference",
        "timestamp",
        "confidence",
        "payer_name",
        "bank_name",
        "receiver_name",
        "flags",
    ],
}
