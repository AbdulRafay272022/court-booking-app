from datetime import datetime, timedelta, timezone

import httpx

from app.config import get_settings
from app.services.whatsapp_service import WhatsAppService
from app.services.whatsapp_templates import TEMPLATES, build_components


def test_verify_webhook_challenge_success(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "secret-token")
    service = WhatsAppService(settings)
    result = service.verify_webhook_challenge("subscribe", "secret-token", "challenge-123")
    assert result == "challenge-123"


def test_verify_webhook_challenge_wrong_token(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "secret-token")
    service = WhatsAppService(settings)
    result = service.verify_webhook_challenge("subscribe", "wrong-token", "challenge-123")
    assert result is None


def test_parse_inbound_text_message():
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "923001234567",
                                    "id": "wamid.abc",
                                    "type": "text",
                                    "text": {"body": "Hi, is court 2 free tonight?"},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }
    messages = WhatsAppService.parse_inbound_messages(payload)
    assert len(messages) == 1
    assert messages[0]["phone_number"] == "+923001234567"
    assert messages[0]["text"] == "Hi, is court 2 free tonight?"


def test_parse_inbound_ignores_empty_payload():
    assert WhatsAppService.parse_inbound_messages({}) == []


async def test_send_text_skips_without_token(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "")
    service = WhatsAppService(settings)
    result = await service.send_text("+923001234567", "hello")
    assert result["messages"][0]["id"] == "local-dev-noop"


def test_parse_inbound_image_message():
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "923001234567",
                                    "id": "wamid.img",
                                    "type": "image",
                                    "image": {"id": "media-99", "mime_type": "image/png"},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }
    messages = WhatsAppService.parse_inbound_messages(payload)
    assert messages[0]["type"] == "image"
    assert messages[0]["image_id"] == "media-99"
    assert messages[0]["image_mime_type"] == "image/png"
    assert messages[0]["text"] is None


def test_parse_inbound_interactive_button_reply():
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "923001234567",
                                    "id": "wamid.btn",
                                    "type": "interactive",
                                    "interactive": {
                                        "button_reply": {"id": "confirm:abc:2026-01-01T10:00:00+00:00", "title": "Yes"}
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }
    messages = WhatsAppService.parse_inbound_messages(payload)
    assert messages[0]["type"] == "interactive"
    assert messages[0]["button_id"] == "confirm:abc:2026-01-01T10:00:00+00:00"
    assert messages[0]["button_text"] == "Yes"


def test_parse_inbound_template_button_reply():
    """Legacy `button` shape (a reply to a template's quick-reply CTA), as
    opposed to the `interactive` shape used for our own confirm/decline
    prompts."""
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "923001234567",
                                    "id": "wamid.btn2",
                                    "type": "button",
                                    "button": {"payload": "decline", "text": "No thanks"},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }
    messages = WhatsAppService.parse_inbound_messages(payload)
    assert messages[0]["button_id"] == "decline"
    assert messages[0]["button_text"] == "No thanks"


def test_template_registry_param_counts_match_render():
    for template in TEMPLATES.values():
        params = [f"p{i}" for i in range(template.param_count)]
        rendered = template.render(params)
        assert isinstance(rendered, str)
        assert rendered  # renders something non-empty for a full param set


def test_build_components_empty_params():
    assert build_components([]) == []


def test_build_components_shapes_body_parameters():
    components = build_components(["Court 1", "5pm"])
    assert components == [
        {
            "type": "body",
            "parameters": [{"type": "text", "text": "Court 1"}, {"type": "text", "text": "5pm"}],
        }
    ]


async def test_is_within_free_window_none_last_inbound():
    service = WhatsAppService(get_settings())
    assert await service.is_within_free_window(None) is False


async def test_is_within_free_window_recent_message():
    service = WhatsAppService(get_settings())
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    assert await service.is_within_free_window(recent) is True


async def test_is_within_free_window_stale_message():
    service = WhatsAppService(get_settings())
    stale = datetime.now(timezone.utc) - timedelta(hours=25)
    assert await service.is_within_free_window(stale) is False


async def test_send_smart_uses_free_text_within_window(monkeypatch):
    settings = get_settings()
    service = WhatsAppService(settings)

    sent = {}

    async def fake_send_text(to, body):
        sent["to"] = to
        sent["body"] = body
        return {"messages": [{"id": "wamid.text"}]}

    monkeypatch.setattr(service, "send_text", fake_send_text)
    result, template_used = await service.send_smart(
        "+923001234567",
        "Your booking is confirmed",
        last_inbound_at=datetime.now(timezone.utc) - timedelta(hours=2),
        template_name="booking_confirmed",
        template_params=["Court 1", "Venue X", "2026-01-01", "5pm", "3000"],
    )
    assert template_used is None
    assert sent["body"] == "Your booking is confirmed"


async def test_send_smart_falls_back_to_template_outside_window(monkeypatch):
    settings = get_settings()
    service = WhatsAppService(settings)

    called = {}

    async def fake_send_registered_template(to, template_name, params, language_code="en"):
        called["template_name"] = template_name
        called["params"] = params
        return {"messages": [{"id": "wamid.tmpl"}]}

    monkeypatch.setattr(service, "send_registered_template", fake_send_registered_template)
    result, template_used = await service.send_smart(
        "+923001234567",
        "Your booking is confirmed",
        last_inbound_at=None,
        template_name="booking_confirmed",
        template_params=["Court 1", "Venue X", "2026-01-01", "5pm", "3000"],
    )
    assert template_used == "booking_confirmed"
    assert called["template_name"] == "booking_confirmed"
    assert called["params"] == ["Court 1", "Venue X", "2026-01-01", "5pm", "3000"]


async def test_send_smart_uses_generic_fallback_for_unknown_template(monkeypatch):
    settings = get_settings()
    service = WhatsAppService(settings)

    called = {}

    async def fake_send_registered_template(to, template_name, params, language_code="en"):
        called["template_name"] = template_name
        called["params"] = params
        return {"messages": [{"id": "wamid.tmpl"}]}

    monkeypatch.setattr(service, "send_registered_template", fake_send_registered_template)
    result, template_used = await service.send_smart(
        "+923001234567",
        "Some ad-hoc message",
        last_inbound_at=None,
        template_name="not_a_real_template",
        template_params=[],
    )
    assert template_used == "generic_notification"
    assert called["template_name"] == "generic_notification"
    assert called["params"] == ["Some ad-hoc message"]


async def test_download_media_skips_without_token(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "")
    service = WhatsAppService(settings)
    result = await service.download_media("media-1")
    assert result is None


async def test_download_media_two_step_fetch(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "test-token")
    service = WhatsAppService(settings)

    calls = {"n": 0}

    async def fake_get(self, url, headers=None, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                200,
                request=httpx.Request("GET", url),
                json={"url": "https://cdn.example.com/media-1", "mime_type": "image/jpeg"},
            )
        return httpx.Response(
            200,
            request=httpx.Request("GET", url),
            content=b"fake-image-bytes",
            headers={"content-type": "image/jpeg"},
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    result = await service.download_media("media-1")
    assert result is not None
    data, content_type = result
    assert data == b"fake-image-bytes"
    assert content_type == "image/jpeg"
    assert calls["n"] == 2


# --- Observability: what Meta actually said about a send -------------------
# Added after an OTP that Meta accepted (HTTP 200) never arrived and left no
# trace: neither the send response nor the later `statuses` callback was logged.

_FAILED_STATUS_PAYLOAD = {
    "entry": [
        {
            "changes": [
                {
                    "value": {
                        "statuses": [
                            {
                                "id": "wamid.OTP1",
                                "status": "failed",
                                "recipient_id": "923118366981",
                                "timestamp": "1789000000",
                                "errors": [
                                    {
                                        "code": 131047,
                                        "title": "Re-engagement message",
                                        "message": "Re-engagement message",
                                        "error_data": {"details": "more than 24 hours have passed"},
                                    }
                                ],
                            }
                        ]
                    }
                }
            ]
        }
    ]
}


def test_parse_status_updates_extracts_failed_delivery_with_error_code():
    updates = WhatsAppService.parse_status_updates(_FAILED_STATUS_PAYLOAD)
    assert len(updates) == 1
    assert updates[0]["message_id"] == "wamid.OTP1"
    assert updates[0]["status"] == "failed"
    assert updates[0]["errors"][0]["code"] == 131047
    assert updates[0]["errors"][0]["details"] == "more than 24 hours have passed"


def test_parse_status_updates_ignores_inbound_message_and_empty_payloads():
    assert WhatsAppService.parse_status_updates({}) == []
    inbound = {"entry": [{"changes": [{"value": {"messages": [{"from": "1", "id": "w", "type": "text"}]}}]}]}
    assert WhatsAppService.parse_status_updates(inbound) == []


async def test_send_logs_wamid_on_accept_and_never_the_token(monkeypatch):
    from structlog.testing import capture_logs

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "super-secret-token")

    async def fake_post(self, url, **kwargs):
        return httpx.Response(200, json={"messages": [{"id": "wamid.ACCEPTED"}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with capture_logs() as logs:
        await WhatsAppService(settings).send_text("+923118366981", "hello")

    accepted = [e for e in logs if e["event"] == "whatsapp.send.accepted"]
    assert len(accepted) == 1
    assert accepted[0]["wamid"] == "wamid.ACCEPTED"
    assert accepted[0]["to"] == "***6981", "phone must be masked in logs"
    assert "super-secret-token" not in str(logs)


async def test_send_logs_metas_error_object_on_rejection(monkeypatch):
    from structlog.testing import capture_logs

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "super-secret-token")

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(WhatsAppService._send.retry, "sleep", no_sleep)

    async def fake_post(self, url, **kwargs):
        return httpx.Response(
            400,
            json={
                "error": {
                    "message": "(#131047) Re-engagement message",
                    "type": "OAuthException",
                    "code": 131047,
                    "fbtrace_id": "abc123",
                }
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    with capture_logs() as logs:
        try:
            await WhatsAppService(settings).send_text("+923118366981", "hello")
        except httpx.HTTPStatusError:
            # Section 32 Part 8: a deterministic 400 now raises directly and is NOT retried
            # (it used to be wrapped in a RetryError after 3 wasted attempts).
            pass
        else:
            raise AssertionError("a 400 from Meta must still raise")

    rejected = [e for e in logs if e["event"] == "whatsapp.send.rejected"]
    assert rejected, "Meta's error body must be logged, not just the status line"
    assert len(rejected) == 1, "a deterministic 400 must not be retried"
    assert rejected[0]["http_status"] == 400
    assert rejected[0]["meta_error"]["code"] == 131047
    assert rejected[0]["log_level"] == "warning"
    assert "super-secret-token" not in str(logs)


async def test_send_retries_5xx_and_429_but_not_other_4xx(monkeypatch):
    """Section 32 Part 8 / open item 8: a deterministic 4xx (404 template missing,
    400 bad payload) fails identically on every retry, so _send must NOT retry it
    (that just added ~4s of latency to a doomed request). 429 and 5xx still retry."""
    import asyncio

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "test-token")

    async def _no_sleep(*a, **k):
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)  # keep tenacity's backoff instant
    service = WhatsAppService(settings)

    for status_code, expected_attempts in [(404, 1), (400, 1), (401, 1), (429, 3), (500, 3), (503, 3)]:
        calls = {"n": 0}

        async def fake_post(self, url, headers=None, json=None, _sc=status_code, _calls=calls):
            _calls["n"] += 1
            return httpx.Response(
                _sc, json={"error": {"code": 0, "message": "x"}}, request=httpx.Request("POST", url)
            )

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
        raised = False
        try:
            await service._send({"to": "923001234567", "type": "text"})
        except Exception:  # noqa: BLE001
            raised = True
        assert raised, f"status {status_code} should have raised"
        assert calls["n"] == expected_attempts, f"status {status_code}: {calls['n']} attempts, expected {expected_attempts}"
