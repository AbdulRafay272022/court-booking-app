"""The push log must say what really happened: only a push the provider accepted is "sent"."""
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models.fcm_token import FCMToken
from app.models.notification import NotificationLog
from app.services.fcm import PushOutcome
from app.services.notification_service import NotificationService


@pytest.mark.parametrize(
    "outcome,expected_status,token_active",
    [
        (PushOutcome.SENT, "sent", True),
        (PushOutcome.FAILED, "failed", True),
        (PushOutcome.SKIPPED, "failed", True),
        (PushOutcome.UNREGISTERED, "failed", False),
    ],
)
async def test_push_log_status_follows_the_provider_outcome(
    db_session, make_user, monkeypatch, outcome, expected_status, token_active
):
    user = await make_user("+923001112233")
    db_session.add(FCMToken(user_id=user.id, token="tok-1", platform="android"))
    await db_session.commit()

    async def fake_push(self, token, title, body, data=None):
        return outcome

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    await NotificationService(db_session, get_settings())._send_push_tier(user, "payment_submitted", "T", "B")

    rows = (await db_session.execute(select(NotificationLog).where(NotificationLog.user_id == user.id))).scalars().all()
    assert [r.channel for r in rows] == ["push"]
    assert rows[0].status == expected_status
    assert (rows[0].error_message is None) == (expected_status == "sent")
    token = await db_session.scalar(select(FCMToken).where(FCMToken.token == "tok-1"))
    assert token.is_active is token_active


async def test_no_tokens_means_no_push_row(db_session, make_user):
    user = await make_user("+923001112244")
    await NotificationService(db_session, get_settings())._send_push_tier(user, "payment_submitted", "T", "B")
    rows = (await db_session.execute(select(NotificationLog).where(NotificationLog.user_id == user.id))).scalars().all()
    assert rows == []
