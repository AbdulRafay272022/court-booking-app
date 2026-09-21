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
        description=(
            "List the courts at a venue (id, name, sport, slot_minutes, and `durations`: the booking lengths "
            "a player can choose on that court, each with a ready-made label)."
        ),
        parameters={
            "type": "object",
            "properties": {"venue_id": {"type": "string"}},
            "required": ["venue_id"],
        },
    ),
    ToolDefinition(
        name="check_availability",
        description=(
            "Get the available time slots for a court on a given date. Each slot has a ready-made `label` and "
            "`price_text`; one slot is one court slot_minutes long (a longer booking takes several in a row)."
        ),
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
        name="quote_booking",
        description=(
            "Price a booking BEFORE proposing it: for a court, a start time and how long the player wants to "
            "play, returns the ready-made range `label`, `duration_text`, `total_price_text` and "
            "`advance_text`. If the range cannot be booked it returns an `error` explaining why."
        ),
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time", "description": "starts_at of the first slot, copied unchanged from check_availability"},
                "duration_minutes": {"type": "integer", "description": "How long to play, in minutes; a multiple of the court's slot_minutes"},
            },
            "required": ["court_id", "starts_at", "duration_minutes"],
        },
    ),
    ToolDefinition(
        name="propose_booking_confirmation",
        description=(
            "Show the user a Yes/No confirmation for holding a specific court, start time and duration. Call "
            "this instead of asking them to type a yes/no reply once you have a concrete booking in mind."
        ),
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time", "description": "ISO 8601 datetime"},
                "duration_minutes": {"type": "integer", "description": "How long to play, in minutes; a multiple of the court's slot_minutes. Omit for one slot."},
            },
            "required": ["court_id", "starts_at"],
        },
    ),
    ToolDefinition(
        name="hold_slot",
        description="Place a hold on a court booking for the current user. Only call after explicit confirmation.",
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time", "description": "ISO 8601 datetime"},
                "duration_minutes": {"type": "integer", "description": "How long to play, in minutes; a multiple of the court's slot_minutes. Omit for one slot."},
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
