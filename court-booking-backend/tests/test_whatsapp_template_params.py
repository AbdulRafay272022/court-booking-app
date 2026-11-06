"""WhatsApp template parameters Meta will accept, and a notification_log row for every failed send.

Production 2026-10-29..11-04: the owner digest went out as a multi-line {{1}} of generic_notification every
morning and Meta refused it, and those failures never reached notification_log (only successes did)."""

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.jobs.digest_job import send_owner_daily_digests
from app.models.notification import NotificationLog
from app.models.user import UserRole
from app.services.notification_service import NotificationService
from app.services.whatsapp_templates import EMPTY_PARAM, build_components, clean_param


def _meta_404_132001() -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://graph.facebook.com/v20.0/123/messages")
    response = httpx.Response(
        404,
        request=request,
        json={"error": {"code": 132001, "type": "OAuthException", "message": "(#132001) Template name does not exist"}},
    )
    return httpx.HTTPStatusError("404 Not Found", request=request, response=response)


def _texts(components: list[dict]) -> list[str]:
    return [p["text"] for p in components[0]["parameters"]]


# -- clean_param / build_components -------------------------------------------------------------------------------


def test_clean_param_joins_lines_and_collapses_whitespace():
    assert clean_param("Good morning!\n- A: 3 bookings\r\n\n- B: 1 booking") == "Good morning! | - A: 3 bookings | - B: 1 booking"
    assert clean_param("a\tb      c") == "a b c"
    assert clean_param("  plain  ") == "plain"


def test_clean_param_never_returns_empty():
    assert clean_param("") == EMPTY_PARAM
    assert clean_param("   \n\t ") == EMPTY_PARAM
    assert clean_param(None) == EMPTY_PARAM
    assert clean_param(0) == "0"


def test_build_components_cleans_every_body_param():
    texts = _texts(build_components(["line 1\nline 2", "", "ok"]))
    assert texts == ["line 1 | line 2", EMPTY_PARAM, "ok"]
    assert not any("\n" in t or "\t" in t or t == "" for t in texts)


# -- booking_confirmed {{5}} ----------------------------------------------------------------------------------------


async def test_booking_confirmed_without_amount_sends_zero_not_empty(db_session, make_user, monkeypatch):
    sent = {}

    async def fake_send_template(self, to, template_name, language_code, components=None):
        sent["template_name"], sent["components"] = template_name, components
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", fake_send_template)
    player = await make_user("+923009990001")  # no inbound message: outside the 24h window -> template

    await NotificationService(db_session, get_settings()).notify_booking_confirmed(
        user=player, court_name="Court 1", starts_at="Thu, 5 Nov", venue_name="Kha Legends Arena"
    )

    assert sent["template_name"] == "booking_confirmed"
    texts = _texts(sent["components"])
    assert len(texts) == 5
    assert texts[4] == "0"
    assert all(t.strip() for t in texts)


# -- owner daily digest ---------------------------------------------------------------------------------------------


async def test_digest_template_param_is_one_line(db_session_factory, make_user, make_venue, make_court, monkeypatch):
    sent = {}

    async def fake_send_template(self, to, template_name, language_code, components=None):
        sent["template_name"], sent["components"] = template_name, components
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", fake_send_template)
    owner = await make_user("+923010009001", role=UserRole.OWNER, name="Ali")
    venue = await make_venue(owner)
    await make_court(venue)

    result = await send_owner_daily_digests(session_factory=db_session_factory)

    assert result == {"sent": 1, "failed": []}
    assert sent["template_name"] == "generic_notification"
    (param,) = _texts(sent["components"])
    assert "\n" not in param
    assert param.startswith("Good morning Ali! Here's today's summary: | Test Arena: ")
    assert " | - " not in param  # the bullet dash is dropped in the one-line form


async def test_digest_inside_window_keeps_line_breaks(db_session_factory, make_user, make_venue, make_court, monkeypatch):
    """Free text (24h window open) may have newlines; only the template parameter is flattened."""
    from datetime import datetime, timedelta, timezone

    from app.models.message import Message

    sent = {}

    async def fake_send_text(self, to, body):
        sent["body"] = body
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)
    owner = await make_user("+923010009002", role=UserRole.OWNER, name="Ali")
    venue = await make_venue(owner)
    await make_court(venue)
    async with db_session_factory() as session:
        session.add(Message(venue_id=None, sender_id=owner.id, sender_type="player", channel="whatsapp", content="hi",
                            created_at=datetime.now(timezone.utc) - timedelta(hours=1)))
        await session.commit()

    await send_owner_daily_digests(session_factory=db_session_factory)

    assert "\n- Test Arena: " in sent["body"]


async def test_failed_digest_is_logged_with_meta_error_code(db_session_factory, make_user, make_venue, make_court, monkeypatch):
    async def failing_send_template(self, to, template_name, language_code, components=None):
        raise _meta_404_132001()

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", failing_send_template)
    owner = await make_user("+923010009003", role=UserRole.OWNER)
    venue = await make_venue(owner)
    await make_court(venue)

    result = await send_owner_daily_digests(session_factory=db_session_factory)

    assert result["failed"] == [str(owner.id)]
    async with db_session_factory() as session:
        rows = (await session.execute(
            select(NotificationLog).where(NotificationLog.user_id == owner.id, NotificationLog.channel == "whatsapp")
        )).scalars().all()
    assert len(rows) == 1
    assert rows[0].event_type == "owner_daily_digest"
    assert rows[0].status == "failed"
    assert "meta_error_code=132001" in rows[0].error_message


# -- the other paths ------------------------------------------------------------------------------------------------


async def test_failed_template_notification_is_logged_with_meta_error_code(db_session, make_user, monkeypatch):
    """_send_push_and_whatsapp (booking/venue/payment notifications) records the failure, never raises."""

    async def failing_send_template(self, to, template_name, language_code, components=None):
        raise _meta_404_132001()

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", failing_send_template)
    player = await make_user("+923009990002")

    await NotificationService(db_session, get_settings()).notify_booking_cancelled(
        user=player, court_name="Court 1", starts_at="Thu, 5 Nov"
    )

    row = (await db_session.execute(
        select(NotificationLog).where(NotificationLog.user_id == player.id, NotificationLog.channel == "whatsapp")
    )).scalars().one()
    assert row.status == "failed"
    assert "meta_error_code=132001" in row.error_message


async def test_failed_marketing_send_is_logged(db_session, make_user, make_venue, monkeypatch):
    async def failing_send_text(self, to, body):
        raise _meta_404_132001()

    async def always_allowed(self, venue):
        return True

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", failing_send_text)
    monkeypatch.setattr(NotificationService, "can_send_marketing", always_allowed)
    owner = await make_user("+923010009004", role=UserRole.OWNER)
    player = await make_user("+923009990003")
    venue = await make_venue(owner)

    service = NotificationService(db_session, get_settings())
    try:
        await service.send_marketing_announcement(venue=venue, user=player, title="Cup", body="Padel cup Saturday")
    except httpx.HTTPStatusError:
        pass
    else:
        raise AssertionError("the send failure should still reach the caller")

    row = (await db_session.execute(
        select(NotificationLog).where(NotificationLog.user_id == player.id, NotificationLog.channel == "whatsapp")
    )).scalars().one()
    assert row.status == "failed"
    assert row.cost_category == "marketing"
    assert "meta_error_code=132001" in row.error_message
