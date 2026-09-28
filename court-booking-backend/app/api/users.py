from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select

from app.dependencies import CurrentUser, DbSession, PageParams
from app.models.fcm_token import FCMToken
from app.models.notification import NotificationLog
from app.schemas.auth import FCMTokenRegisterIn, UserOut
from app.schemas.notification import NotificationLogOut
from app.utils.s3 import public_url, upload_public_photo

router = APIRouter(prefix="/users/me", tags=["users"])

# Same content-type + size caps as venue photos so we don't have two different rules for
# "an image the app accepts from a user" -- kept in lock-step with app/api/venues.py.
_ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_AVATAR_BYTES = 5 * 1024 * 1024


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


@router.post("/avatar", response_model=UserOut)
async def upload_my_avatar(
    user: CurrentUser, db: DbSession, file: UploadFile = File(...)
) -> UserOut:
    """QA signup-venue round item 7: upload a profile avatar. Same storage pattern as venue
    photos (public S3 bucket via CloudFront) and the same accepted content-types + 5 MB size
    cap, so the app has one rule for "an image accepted from a user". The resulting public URL
    is written to `users.avatar_url` (which already exists on the model; no migration). Old
    keys are NOT deleted here -- S3 lifecycle handles that, and keeping them means a naive undo
    on the profile screen still works if the user hasn't picked a new avatar yet."""
    if file.content_type not in _ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported image type")
    data = await file.read()
    if len(data) > _MAX_AVATAR_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image too large")

    # Namespaced by user id so a leaked / guessed key from one user can't be swapped for another.
    key = await upload_public_photo(
        data, file.filename or "avatar.jpg", file.content_type, prefix=f"avatars/{user.id}"
    )
    user.avatar_url = public_url(key)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


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
