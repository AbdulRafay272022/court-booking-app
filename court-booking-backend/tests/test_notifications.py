from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.config import get_settings
from app.models.message import Message
from app.models.notification import NotificationLog
from app.services.notification_service import NotificationService


async def _seed_inbound(db_session, player, *, hours_ago: float) -> None:
    db_session.add(
        Message(
            venue_id=None,
            sender_id=player.id,
            sender_type="player",
            channel="whatsapp",
            content="hi",
            created_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        )
    )
    await db_session.commit()


async def test_notify_booking_confirmed_within_window_sends_free_text(
    db_session, make_user, monkeypatch
):
    sent = {}

    async def fake_send_text(self, to, body):
        sent["to"] = to
        sent["body"] = body
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    player = await make_user("+923009999999")
    await _seed_inbound(db_session, player, hours_ago=1)

    service = NotificationService(db_session, get_settings())
    await service.notify_booking_confirmed(user=player, court_name="Court A", starts_at="2026-01-01T10:00:00")

    assert sent["to"] == "+923009999999"
    assert "Court A" in sent["body"]
    assert "confirmed" in sent["body"].lower()

    result = await db_session.execute(
        select(NotificationLog).where(NotificationLog.event_type == "booking_confirmed")
    )
    logs = result.scalars().all()
    assert len(logs) == 1
    assert logs[0].channel == "whatsapp"
    assert logs[0].template_name is None  # sent as free text, not a template


async def test_notify_booking_confirmed_outside_window_uses_template(
    db_session, make_user, monkeypatch
):
    sent = {}

    async def fake_send_template(self, to, template_name, language_code, components=None):
        sent["to"] = to
        sent["template_name"] = template_name
        sent["components"] = components
        return {"messages": [{"id": "x"}]}

    async def fail_send_text(self, to, body):
        raise AssertionError("should not send free text outside the 24h window")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", fake_send_template)
    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fail_send_text)

    player = await make_user("+923009999996")
    # No inbound message at all -- definitely outside any window.
    service = NotificationService(db_session, get_settings())
    await service.notify_booking_confirmed(user=player, court_name="Court A", starts_at="2026-01-01T10:00:00")

    assert sent["template_name"] == "booking_confirmed"
    assert sent["components"][0]["parameters"][0]["text"] == "Court A"

    result = await db_session.execute(
        select(NotificationLog).where(NotificationLog.event_type == "booking_confirmed")
    )
    log = result.scalars().one()
    assert log.template_name == "booking_confirmed"


async def test_notify_booking_confirmed_stale_window_uses_template(db_session, make_user, monkeypatch):
    """An inbound message over 24h old doesn't keep the window open."""
    sent = {}

    async def fake_send_template(self, to, template_name, language_code, components=None):
        sent["template_name"] = template_name
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", fake_send_template)

    player = await make_user("+923009999995")
    await _seed_inbound(db_session, player, hours_ago=25)

    service = NotificationService(db_session, get_settings())
    await service.notify_booking_confirmed(user=player, court_name="Court A", starts_at="2026-01-01T10:00:00")

    assert sent["template_name"] == "booking_confirmed"


async def test_push_skipped_without_active_tokens(db_session, make_user):
    # No FCMToken rows and no FCM_SERVICE_ACCOUNT_KEY configured in the test
    # environment, so this should be a silent no-op rather than raising.
    player = await make_user("+923009999998")
    service = NotificationService(db_session, get_settings())
    tokens = await service._active_tokens(player.id)
    assert tokens == []


async def test_notify_payment_rejected_includes_reason(db_session, make_user, monkeypatch):
    sent = {}

    async def fake_send_text(self, to, body):
        sent["body"] = body
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    player = await make_user("+923009999997")
    await _seed_inbound(db_session, player, hours_ago=1)

    service = NotificationService(db_session, get_settings())
    await service.notify_payment_rejected(user=player, court_name="Court B", reason="Screenshot unreadable")
    assert "Screenshot unreadable" in sent["body"]
