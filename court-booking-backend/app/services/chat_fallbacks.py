"""Safety wrappers around one chat turn, shared by the WhatsApp webhook and the in-app chat endpoint.

A player must never see a raw error, JSON, a tool name or stack text, and must never get silence. `run_turn` calls the chat
service's public `process_message` under a timeout and turns every failure (model error, tool failure inside the turn, timeout,
an empty or leaky reply) into a localized fallback message plus a log line (the details go to the log, never to the player).
"""

import asyncio
import re
from dataclasses import dataclass
from datetime import datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.services.chat_language import Lang, conversation_language
from app.services.reply_text import generic_failure, localize_button_title, localize_known_reply

logger = structlog.get_logger(__name__)

# A whole turn (up to MAX_TOOL_ITERATIONS model calls plus tools). Tests lower it. Must stay below chat_lock.LOCK_WAIT_SECONDS.
TURN_TIMEOUT_SECONDS = 60.0

# Tools that change something for the player. If one ran, a dropped or failed reply must not hide it.
MUTATING_TOOLS = frozenset({"hold_slot", "cancel_booking"})

_TOOL_NAMES = (
    "search_venues|get_venue_info|get_venue_courts|check_availability|quote_booking|propose_booking_confirmation|"
    "hold_slot|get_payment_instructions|cancel_booking"
)
# Things that are never player text: stack traces, exception class names, raw HTTP errors, JSON, tool plumbing.
_LEAK_RE = re.compile(
    r"Traceback \(most recent|^\s*[\{\[]\s*[\"']|\b(" + _TOOL_NAMES + r")\b|tool_use|tool_result|function_call|functionCall|"
    r"\b(HTTPStatusError|RetryError|ReadTimeout|ConnectError|TimeoutError|KeyError|TypeError|ValueError|AttributeError|"
    r"IntegrityError|MissingGreenlet|asyncpg|sqlalchemy|httpx)\b|\b[45]\d\d (Client|Server) Error|"
    r"\bstatus_code\b",
    re.IGNORECASE | re.MULTILINE,
)


def leaks_internals(text: str) -> bool:
    return bool(_LEAK_RE.search(text or ""))


async def recent_player_texts(db: AsyncSession, user_id, channel: str, limit: int = 6) -> list[str]:
    """The player's last few text messages on this channel, oldest first (input for `conversation_language`)."""
    rows = (
        await db.scalars(
            select(Message.content)
            .where(Message.sender_id == user_id, Message.channel == channel, Message.sender_type == "player", Message.message_type == "text")
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
    ).all()
    return list(reversed(rows))


async def player_language(db: AsyncSession, user_id, channel: str) -> Lang:
    """Roman Urdu or English from the player's own recent messages (English when there is no signal at all)."""
    try:
        return conversation_language(await recent_player_texts(db, user_id, channel))
    except Exception:  # noqa: BLE001 -- the language is a nicety; never let it fail a reply
        logger.warning("chat.language_lookup_failed", exc_info=True)
        return "en"


async def newer_text_exists(db: AsyncSession, user_id, channel: str, since: datetime) -> bool:
    """True when the player has sent another TEXT message after the one created at `since` (so an answer to the older one is stale)."""
    found = await db.scalar(
        select(Message.id)
        .where(
            Message.sender_id == user_id,
            Message.channel == channel,
            Message.sender_type == "player",
            Message.message_type == "text",
            Message.created_at > since,
        )
        .limit(1)
    )
    return found is not None


@dataclass
class TurnOutcome:
    result: object  # ChatResult (kept untyped here so tests can pass simple fakes)
    failed: bool = False  # True when `result` is the fallback, not the model's answer


async def _reset_session(db: AsyncSession) -> None:
    """After a failed or cancelled turn the session may hold a half-finished transaction; make it usable again."""
    try:
        await db.rollback()
    except Exception:  # noqa: BLE001
        logger.warning("chat.session_rollback_failed", exc_info=True)
        try:
            await db.invalidate()
        except Exception:  # noqa: BLE001
            logger.warning("chat.session_invalidate_failed", exc_info=True)


async def run_turn(chat_service, db: AsyncSession, *, user, message: str, history: list[dict], channel: str, lang: Lang) -> TurnOutcome:
    """`chat_service.process_message(...)` made safe: bounded by TURN_TIMEOUT_SECONDS, every failure becomes `generic_failure(lang)`.

    A reply that is empty or looks like internals (stack text, JSON, a tool name) is replaced too. The chat service's own fixed
    English fallbacks and default button labels are put into `lang`. The caller must not touch `user` attributes after a
    failure (the session was rolled back); capture ids/phone before the turn."""
    # Imported here: ChatResult lives in the chat service module, which imports a lot.
    from app.services.ai_chat_service import ChatResult

    def fallback() -> TurnOutcome:
        return TurnOutcome(ChatResult(reply=generic_failure(lang), model=None), failed=True)

    try:
        result = await asyncio.wait_for(
            chat_service.process_message(user=user, message=message, history=history, channel=channel), TURN_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        logger.error("chat.turn_timed_out", channel=channel, timeout_seconds=TURN_TIMEOUT_SECONDS)
        await _reset_session(db)
        return fallback()
    except Exception as exc:  # noqa: BLE001 -- model/provider/tool failure: log the details, show the player nothing technical
        logger.error("chat.turn_failed", channel=channel, error_type=type(exc).__name__, error=str(exc)[:300], exc_info=True)
        await _reset_session(db)
        return fallback()

    reply = getattr(result, "reply", None)
    if not isinstance(reply, str) or not reply.strip():
        logger.error("chat.turn_empty_reply", channel=channel)
        return fallback()
    if leaks_internals(reply):
        logger.error("chat.turn_leaky_reply", channel=channel, reply_head=reply[:120])
        return fallback()
    result.reply = localize_known_reply(reply, lang)
    for action in getattr(result, "actions", None) or []:
        if getattr(action, "label", None):
            action.label = localize_button_title(action.label, lang)
    return TurnOutcome(result)
