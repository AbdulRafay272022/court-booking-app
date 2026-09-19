import uuid

from fastapi import APIRouter
from sqlalchemy import select

from app.dependencies import AppSettings, ChatRateLimit, CurrentUser, DbSession, PageParams
from app.models.message import Message
from app.schemas.chat import ChatActionOut, ChatHistoryItemOut, ChatMessageIn, ChatMessageOut
from app.services.ai_chat_service import AIChatService

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/message", response_model=ChatMessageOut)
async def send_chat_message(
    payload: ChatMessageIn, db: DbSession, settings: AppSettings, user: CurrentUser, _rate_limit: ChatRateLimit
) -> ChatMessageOut:
    chat_service = AIChatService(db, settings)
    history = await chat_service.load_history(user, "app")
    result = await chat_service.process_message(user=user, message=payload.message, history=history)

    db.add(
        Message(
            booking_id=payload.booking_id,
            venue_id=payload.venue_id,
            sender_id=user.id,
            sender_type="player",
            channel="app",
            content=payload.message,
        )
    )
    db.add(
        Message(
            booking_id=payload.booking_id,
            venue_id=payload.venue_id,
            sender_id=user.id,  # thread owner, not literal sender -- see Message.sender_id
            sender_type="ai",
            channel="app",
            content=result.reply,
            meta={
                "model": result.model,
                "tool_calls": result.tool_calls,
                "actions": [a.__dict__ for a in result.actions],
            },
        )
    )
    await db.commit()

    return ChatMessageOut(
        reply=result.reply,
        actions=[ChatActionOut(type=a.type, label=a.label, data=a.data) for a in result.actions],
    )


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
    query = query.order_by(Message.created_at.asc()).offset(page.offset).limit(page.page_size)

    result = await db.execute(query)
    return [ChatHistoryItemOut.model_validate(m) for m in result.scalars().all()]
