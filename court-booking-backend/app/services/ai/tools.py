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
            "List the courts at a venue (id, name, sport, slot_minutes = the minimum booking time, and `durations`: the booking lengths "
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
            "`price_text`; slots start every 30 minutes and only start times where the court's minimum booking fits are listed (a longer booking takes several 30-minute slots in a row). "
            "`date` is the date the booking STARTS on. When the player has named a start time (and an end time), "
            "pass `start_time` and `end_time` too: the result's `requested_range` then says whether exactly that "
            "range can be booked (`available`), with its `starts_at`, `duration_minutes`, `label` and price, or an "
            "`error`. An end at or before the start is the next morning, e.g. 21:00 to 00:00 on the 26th is a "
            "booking on the 26th that ends at midnight."
        ),
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "date": {"type": "string", "format": "date", "description": "YYYY-MM-DD, the date the booking starts on"},
                "start_time": {"type": "string", "description": "Optional. The player's start time on `date`, Pakistan time, e.g. 21:00"},
                "end_time": {"type": "string", "description": "Optional. The player's end time, e.g. 00:00 for 12 AM / midnight. Never move `date` to the end's date."},
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
                "duration_minutes": {"type": "integer", "description": "How long to play, in minutes; a multiple of 30 and at least the court's slot_minutes (its minimum booking)"},
            },
            "required": ["court_id", "starts_at", "duration_minutes"],
        },
    ),
    ToolDefinition(
        name="propose_booking_confirmation",
        description=(
            "Show the user a Yes/No confirmation for holding a specific court, start time and duration. Call "
            "this instead of asking them to type a yes/no reply once you have a concrete booking in mind. Your "
            "message must also state the exact slot (court, sport, date, start to end time, total price). If the "
            "account has no name on file and the player gave none, ask for the booking name first."
        ),
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time", "description": "ISO 8601 datetime"},
                "duration_minutes": {"type": "integer", "description": "How long to play, in minutes; a multiple of 30 and at least the court's slot_minutes (its minimum booking). Omit for the minimum."},
                "player_name": {"type": "string", "description": "The name the booking is for: what the player said when you asked (once) 'what name should I put the booking under?', or one they volunteered (their own, or 'for my friend Ali Khan'). Omit when the account already has a name or the player gave none. Never a venue, court, sport or city word."},
                "name_is_players_own": {"type": "boolean", "description": "true only when player_name is the player's OWN name (so it is saved on their account when it has none); false/omit for a friend's name."},
            },
            "required": ["court_id", "starts_at"],
        },
    ),
    ToolDefinition(
        name="hold_slot",
        description=(
            "Place a hold on a court booking for the current user. Only call after the player explicitly confirmed "
            "an exact slot you stated in your previous message; a bare 'yes' to an unstated or changed slot is not "
            "confirmation (re-state it via propose_booking_confirmation first)."
        ),
        parameters={
            "type": "object",
            "properties": {
                "court_id": {"type": "string"},
                "starts_at": {"type": "string", "format": "date-time", "description": "ISO 8601 datetime"},
                "duration_minutes": {"type": "integer", "description": "How long to play, in minutes; a multiple of 30 and at least the court's slot_minutes (its minimum booking). Omit for the minimum."},
                "player_name": {"type": "string", "description": "The name the booking is for: what the player said when you asked (once) 'what name should I put the booking under?', or one they volunteered (their own, or 'for my friend Ali Khan'). Omit when the account already has a name or the player gave none. Never a venue, court, sport or city word."},
                "name_is_players_own": {"type": "boolean", "description": "true only when player_name is the player's OWN name (so it is saved on their account when it has none); false/omit for a friend's name."},
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
