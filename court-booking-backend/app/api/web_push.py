"""Web Push subscriptions for the signed-in user (docs/web-push-plan.md section 4)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, select, update

from app.dependencies import AppSettings, CurrentUser, DbSession
from app.errors import AppError, ErrorCode
from app.models.web_push_subscription import WebPushSubscription
from app.schemas.stage2 import WebPushConfigOut, WebPushStatusOut, WebPushSubscribeIn, WebPushUnsubscribeIn
from app.services.feature_flag_service import flag_on
from app.services.web_push import endpoint_allowed, keys_configured

router = APIRouter(prefix="/users/me/web-push", tags=["users"])

MAX_ACTIVE_PER_USER = 10


@router.get("/config", response_model=WebPushConfigOut)
async def web_push_config(db: DbSession, settings: AppSettings, user: CurrentUser) -> WebPushConfigOut:
    """`enabled` = VAPID keys configured AND the admin `push_notifications` flag on. The public key is not secret."""
    configured = keys_configured(settings)
    enabled = configured and await flag_on(db, "push_notifications")
    return WebPushConfigOut(enabled=enabled, public_key=settings.WEB_PUSH_VAPID_PUBLIC_KEY if configured else None)


@router.post("", status_code=status.HTTP_201_CREATED)
async def web_push_subscribe(payload: WebPushSubscribeIn, db: DbSession, user: CurrentUser) -> Response:
    """Upsert by endpoint. The same endpoint under another user (shared browser) moves to this user and is
    re-activated. At most 10 active subscriptions per user (oldest revoked first)."""
    if not endpoint_allowed(payload.endpoint):
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            ErrorCode.WEB_PUSH_ENDPOINT_NOT_ALLOWED,
            "This push endpoint is not accepted.",
            details={"field": "endpoint"},
        )
    now = datetime.now(timezone.utc)
    row = await db.scalar(select(WebPushSubscription).where(WebPushSubscription.endpoint == payload.endpoint))
    if row is None:
        row = WebPushSubscription(endpoint=payload.endpoint, user_id=user.id, p256dh="", auth="")
        db.add(row)
    row.user_id = user.id
    row.p256dh = payload.keys.p256dh
    row.auth = payload.keys.auth
    row.user_agent = payload.user_agent
    row.last_seen_at = now
    row.revoked_at = None
    await db.flush()

    active = (
        await db.execute(
            select(WebPushSubscription.id)
            .where(WebPushSubscription.user_id == user.id, WebPushSubscription.revoked_at.is_(None))
            .order_by(func.coalesce(WebPushSubscription.last_seen_at, WebPushSubscription.created_at).desc())
        )
    ).scalars().all()
    extra = [sid for sid in active[MAX_ACTIVE_PER_USER:] if sid != row.id]
    if extra:
        await db.execute(update(WebPushSubscription).where(WebPushSubscription.id.in_(extra)).values(revoked_at=now))
    await db.commit()
    return Response(status_code=status.HTTP_201_CREATED)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def web_push_unsubscribe(payload: WebPushUnsubscribeIn, db: DbSession, user: CurrentUser) -> Response:
    """Revokes the caller's own row only; unknown (or someone else's) endpoint is still 204."""
    await db.execute(
        update(WebPushSubscription)
        .where(
            WebPushSubscription.endpoint == payload.endpoint,
            WebPushSubscription.user_id == user.id,
            WebPushSubscription.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=WebPushStatusOut)
async def web_push_status(db: DbSession, user: CurrentUser, endpoint: str = Query(..., max_length=2048)) -> WebPushStatusOut:
    row = await db.scalar(
        select(WebPushSubscription.id).where(
            WebPushSubscription.endpoint == endpoint,
            WebPushSubscription.user_id == user.id,
            WebPushSubscription.revoked_at.is_(None),
        )
    )
    return WebPushStatusOut(subscribed=row is not None)

