import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter
from sqlalchemy import case, select

from app.dependencies import AppSettings, ChatRateLimit, CurrentUser, DbSession, PageParams
from app.models.court import Court
from app.models.message import Message
from app.schemas.chat import ChatActionOut, ChatHistoryItemOut, ChatMessageIn, ChatMessageOut
from app.services import slot_compat
from app.services.ai_chat_service import AIChatService
from app.services.chat_fallbacks import recent_player_texts, run_turn
from app.services.chat_language import conversation_language
from app.services.chat_lock import ConversationBusy, conversation_locks
from app.services.reply_text import busy_message
from app.services.slot_compat import LegacySlotUnits

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/message", response_model=ChatMessageOut)
async def send_chat_message(
    payload: ChatMessageIn,
    db: DbSession,
    settings: AppSettings,
    user: CurrentUser,
    _rate_limit: ChatRateLimit,
    legacy: LegacySlotUnits,
) -> ChatMessageOut:
    chat_service = AIChatService(db, settings)
    user_id = user.id  # the session is rolled back after a failed turn, which expires `user`
    try:
        # One message of this player's in-app conversation at a time, in arrival order (in-process lock: single uvicorn
        # worker, see app/services/chat_lock.py). A second message sent while the first is being answered waits, then sees
        # the first exchange in its history, so it is never answered from stale context and never answered twice.
        async with conversation_locks.hold(("app", user_id)):
            lang = conversation_language([*await recent_player_texts(db, user_id, "app"), payload.message])
            history = await chat_service.load_history(user, "app")
            asked_at = datetime.now(timezone.utc)
            outcome = await run_turn(chat_service, db, user=user, message=payload.message, history=history, channel="app", lang=lang)
            result = outcome.result
            # Both rows are inserted in ONE transaction, so the database's own created_at (the transaction start) would be identical
            # for the question and its reply and the history could list the reply first. Stamp them explicitly, in order.
            answered_at = max(datetime.now(timezone.utc), asked_at + timedelta(milliseconds=1))

            db.add(
                Message(
                    created_at=asked_at,
                    booking_id=payload.booking_id,
                    venue_id=payload.venue_id,
                    sender_id=user_id,
                    sender_type="player",
                    channel="app",
                    content=payload.message,
                )
            )
            db.add(
                Message(
                    created_at=answered_at,
                    booking_id=payload.booking_id,
                    venue_id=payload.venue_id,
                    sender_id=user_id,  # thread owner, not literal sender -- see Message.sender_id
                    sender_type="ai",
                    channel="app",
                    content=result.reply,
                    meta={
                        "model": result.model,
                        "tool_calls": result.tool_calls,
                        "actions": [a.__dict__ for a in result.actions],
                        **({"fallback": True} if outcome.failed else {}),
                    },
                )
            )
            await db.commit()
    except ConversationBusy:
        # The wait for the previous message ran out: say so (nothing is stored; the player can simply send it again).
        lang = conversation_language([payload.message])
        return ChatMessageOut(reply=busy_message(lang), actions=[])

    actions = [ChatActionOut(type=a.type, label=a.label, data=a.data) for a in result.actions]
    if legacy:
        actions = await _legacy_actions(db, actions)
    return ChatMessageOut(reply=result.reply, actions=actions)


async def _legacy_actions(db: DbSession, actions: list[ChatActionOut]) -> list[ChatActionOut]:
    """TRANSITION (delete with app/services/slot_compat.py): an app build from before the 30-minute grid sends the Yes button's
    `slot_count` straight back to POST /bookings/hold, where (without X-Slot-Grid) it counts the court's own slot length. So the
    button it is shown carries the count in those units (the stored message keeps the real 30-minute count). A length an old
    build cannot express (90 minutes on a 60-minute court) gets no button: the player's typed "yes" books it correctly."""
    out: list[ChatActionOut] = []
    drop_decline = False
    for action in actions:
        if action.type == "confirm_booking":
            court = None
            try:
                court = await db.get(Court, uuid.UUID(str(action.data.get("court_id"))))
            except ValueError:
                pass
            data = slot_compat.legacy_action_data(court, action.data)
            if data is None:
                drop_decline = True
                continue
            action = ChatActionOut(type=action.type, label=action.label, data=data)
        out.append(action)
    return [a for a in out if not (drop_decline and a.type == "decline")]


@router.get("/history", response_model=list[ChatHistoryItemOut])
async def get_chat_history(
    db: DbSession,
    user: CurrentUser,
    page: PageParams,
    venue_id: uuid.UUID | None = None,
    booking_id: uuid.UUID | None = None,
) -> list[ChatHistoryItemOut]:
    query = select(Message).where(Message.sender_id == user.id, Message.channel == "app")
    if venue_id is not None:
        query = query.where(Message.venue_id == venue_id)
    if booking_id is not None:
        query = query.where(Message.booking_id == booking_id)
    # rows written before the explicit stamps share one timestamp per exchange: the player's message comes first on a tie
    query = query.order_by(Message.created_at.asc(), case((Message.sender_type == "player", 0), else_=1)).offset(page.offset).limit(page.page_size)

    result = await db.execute(query)
    return [ChatHistoryItemOut.model_validate(m) for m in result.scalars().all()]
