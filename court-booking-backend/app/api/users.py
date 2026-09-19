from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import CurrentUser, DbSession, PageParams
from app.models.fcm_token import FCMToken
from app.models.notification import NotificationLog
from app.schemas.auth import FCMTokenRegisterIn
from app.schemas.notification import NotificationLogOut

router = APIRouter(prefix="/users/me", tags=["users"])


@router.post("/fcm-token", status_code=status.HTTP_201_CREATED)
async def register_fcm_token(payload: FCMTokenRegisterIn, user: CurrentUser, db: DbSession) -> None:
    existing = await db.scalar(select(FCMToken).where(FCMToken.token == payload.token))
    if existing is not None:
        existing.user_id = user.id
        existing.platform = payload.platform
        existing.is_active = True
    else:
        db.add(FCMToken(user_id=user.id, token=payload.token, platform=payload.platform))
    await db.commit()


@router.delete("/fcm-token/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_fcm_token(token: str, user: CurrentUser, db: DbSession) -> None:
    fcm_token = await db.scalar(
        select(FCMToken).where(FCMToken.token == token, FCMToken.user_id == user.id)
    )
    if fcm_token is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not registered to you")
    await db.delete(fcm_token)
    await db.commit()


@router.get("/notifications", response_model=list[NotificationLogOut])
async def list_my_notifications(db: DbSession, user: CurrentUser, page: PageParams) -> list[NotificationLogOut]:
    result = await db.execute(
        select(NotificationLog)
        .where(NotificationLog.user_id == user.id)
        .order_by(NotificationLog.created_at.desc())
        .offset(page.offset)
        .limit(page.page_size)
    )
    return [NotificationLogOut.model_validate(n) for n in result.scalars().all()]
