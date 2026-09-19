"""Section 21.1: the app's AI tools, defined ONCE in a provider-neutral
format. Each provider's `get_tool_schema()` translates these into its own
native wrapper shape; the JSON Schema in `parameters` itself needs no
translation, since Claude/OpenAI/Gemini function-calling all accept plain
JSON Schema for parameters.

This is the exact 8-tool set the pre-Section-21 Claude-only chat loop used
(Section 10) -- Section 21.1's own illustrative example shows a smaller
5-tool subset, but the instruction to make this "a pure refactor first...
byte-for-byte like today" takes precedence: trimming tools here would be a
behavior change disguised as infrastructure work.
"""

from dataclasses import dataclass


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict  # JSON Schema for parameters


BOOKING_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="search_venues",
        description="Search approved venues by name and/or city.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Venue name or partial name"},
                "city": {"type": "string", "description": "City to filter by"},
            },
        },
    ),
    ToolDefinition(
        name="get_venue_info",
        description="Get a venue's address, city, amenities, sports offered, and contact info.",
        parameters={
            "type": "object",
            "properties": {"venue_id": {"type": "string"}},
            "required": ["venue_id"],
        },
    ),
    ToolDefinition(
        name="get_venue_courts",
        description="List the courts at a venue (id, name, sport).",
        parameters={
            "type": "object",
            "properties": {"venue_id": {"type": "string"}},
            "required": ["venue_id"],
        },
    ),
    ToolDefinition(
        name="check_availability",
        description="Get time slots (with price and status) for a court on a given date.",
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "date": {"type": "string", "format": "date", "description": "YYYY-MM-DD"},
            },
            "required": ["court_id", "date"],
        },
    ),
    ToolDefinition(
        name="propose_booking_confirmation",
        description=(
            "Show the user a Yes/No confirmation for holding a specific court+time. Call this "
            "instead of asking them to type a yes/no reply once you have a concrete slot in mind."
        ),
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time", "description": "ISO 8601 datetime"},
            },
            "required": ["court_id", "starts_at"],
        },
    ),
    ToolDefinition(
        name="hold_slot",
        description="Place a hold on a court slot for the current user. Only call after explicit confirmation.",
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time", "description": "ISO 8601 datetime"},
            },
            "required": ["court_id", "starts_at"],
        },
    ),
    ToolDefinition(
        name="get_payment_instructions",
        description="Get the bank details and amount due for a booking the current user holds.",
        parameters={
            "type": "object",
            "properties": {"booking_id": {"type": "string"}},
            "required": ["booking_id"],
        },
    ),
    ToolDefinition(
        name="cancel_booking",
        description="Cancel one of the current user's own bookings.",
        parameters={
            "type": "object",
            "properties": {"booking_id": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["booking_id"],
        },
    ),
]
