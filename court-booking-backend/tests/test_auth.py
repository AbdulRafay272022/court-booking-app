from app.config import get_settings


def _mock_otp(monkeypatch):
    captured = {}

    async def fake_send_otp(self, phone, code):
        captured["code"] = code
        return {"messages": [{"id": "wamid.local"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_otp", fake_send_otp)
    return captured


async def test_request_otp_returns_expiry(client, monkeypatch):
    _mock_otp(monkeypatch)
    resp = await client.post("/api/v1/auth/request-otp", json={"phone": "+923001234567"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["expires_in"] == get_settings().OTP_EXPIRE_MINUTES * 60
    assert "message" in body


async def test_otp_request_rate_limiting(client, monkeypatch):
    _mock_otp(monkeypatch)
    phone = "+923001110001"
    for _ in range(5):
        resp = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
        assert resp.status_code == 200

    resp = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    assert resp.status_code == 429


async def test_otp_send_failure_does_not_consume_rate_limit(client, db_session, monkeypatch):
    """A WhatsApp delivery failure must not both burn a rate-limit attempt
    for an OTP that never arrived AND surface as a raw 500 -- see finding #6
    in AUDIT_FINDINGS.md."""
    from sqlalchemy import select

    from app.models.user import OtpRequest

    async def failing_send(self, payload):
        raise RuntimeError("simulated WhatsApp Cloud API outage")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", failing_send)
    phone = "+923001114444"

    resp = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "OTP_DELIVERY_FAILED"

    rows = (
        await db_session.execute(select(OtpRequest).where(OtpRequest.phone == phone))
    ).scalars().all()
    assert rows == [], "the OTP row must be rolled back on delivery failure, not left consuming a rate-limit slot"

    # A subsequent successful path should still have all 5 attempts available.
    _mock_otp(monkeypatch)
    for _ in range(5):
        ok = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
        assert ok.status_code == 200, ok.text

    locked = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    assert locked.status_code == 429


async def test_verify_otp_issues_token(client, monkeypatch):
    captured = _mock_otp(monkeypatch)

    resp = await client.post("/api/v1/auth/request-otp", json={"phone": "+923001234567"})
    assert resp.status_code == 200

    resp = await client.post(
        "/api/v1/auth/verify-otp",
        json={"phone": "+923001234567", "otp": captured["code"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["phone"] == "+923001234567"
    assert body["token"]
    assert body["is_new_user"] is True

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json()["user"]["phone"] == "+923001234567"
    assert "session" in me.json()


async def test_dev_fixed_otp_used_when_debug_and_set(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "DEV_FIXED_OTP", "111111")
    captured = _mock_otp(monkeypatch)

    resp = await client.post("/api/v1/auth/request-otp", json={"phone": "+923001234568"})
    assert resp.status_code == 200
    assert captured["code"] == "111111"

    resp = await client.post(
        "/api/v1/auth/verify-otp",
        json={"phone": "+923001234568", "otp": "111111"},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["phone"] == "+923001234568"


async def test_dev_fixed_otp_ignored_when_debug_is_false(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "DEV_FIXED_OTP", "111111")
    captured = _mock_otp(monkeypatch)

    resp = await client.post("/api/v1/auth/request-otp", json={"phone": "+923001234569"})
    assert resp.status_code == 200
    assert captured["code"] != "111111"

    resp = await client.post(
        "/api/v1/auth/verify-otp",
        json={"phone": "+923001234569", "otp": "111111"},
    )
    assert resp.status_code == 400


async def test_verify_otp_wrong_code_increments_attempts(client, monkeypatch):
    _mock_otp(monkeypatch)
    await client.post("/api/v1/auth/request-otp", json={"phone": "+923001112222"})

    resp = await client.post(
        "/api/v1/auth/verify-otp", json={"phone": "+923001112222", "otp": "000000"}
    )
    assert resp.status_code == 400


async def test_verify_otp_locked_after_five_wrong_attempts(client, monkeypatch):
    _mock_otp(monkeypatch)
    await client.post("/api/v1/auth/request-otp", json={"phone": "+923001113333"})

    for _ in range(5):
        resp = await client.post(
            "/api/v1/auth/verify-otp", json={"phone": "+923001113333", "otp": "000000"}
        )
        assert resp.status_code == 400

    # A 6th attempt (even with an otherwise-valid-shaped code) is locked out.
    resp = await client.post(
        "/api/v1/auth/verify-otp", json={"phone": "+923001113333", "otp": "111111"}
    )
    assert resp.status_code == 429


async def test_me_requires_auth(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_invalid_phone_number_rejected(client):
    resp = await client.post("/api/v1/auth/request-otp", json={"phone": "0300123"})
    assert resp.status_code == 422


async def test_session_persistence_and_logout(client, monkeypatch):
    captured = _mock_otp(monkeypatch)
    await client.post("/api/v1/auth/request-otp", json={"phone": "+923004440001"})
    verify = await client.post(
        "/api/v1/auth/verify-otp", json={"phone": "+923004440001", "otp": captured["code"]}
    )
    token = verify.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200
    assert (
        await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"})
    ).status_code == 401

    logout = await client.post("/api/v1/auth/logout", headers=headers)
    assert logout.status_code == 200
    assert logout.json()["message"]

    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401


async def test_multi_device_sessions_are_independent(client, monkeypatch):
    captured = {}

    async def fake_send_otp(self, phone, code):
        captured["code"] = code
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_otp", fake_send_otp)
    phone = "+923005550001"

    await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    verify_a = await client.post(
        "/api/v1/auth/verify-otp",
        json={"phone": phone, "otp": captured["code"], "device_id": "device-a", "device_name": "Pixel"},
    )
    token_a = verify_a.json()["token"]

    await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    verify_b = await client.post(
        "/api/v1/auth/verify-otp",
        json={"phone": phone, "otp": captured["code"], "device_id": "device-b", "device_name": "iPhone"},
    )
    token_b = verify_b.json()["token"]

    assert token_a != token_b
    assert verify_a.json()["user"]["id"] == verify_b.json()["user"]["id"]

    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    assert (await client.get("/api/v1/auth/me", headers=headers_a)).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=headers_b)).status_code == 200

    await client.post("/api/v1/auth/logout", headers=headers_a)
    assert (await client.get("/api/v1/auth/me", headers=headers_a)).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=headers_b)).status_code == 200


async def test_new_user_vs_returning_user(client, monkeypatch):
    captured = _mock_otp(monkeypatch)
    phone = "+923006660001"

    await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    first = await client.post("/api/v1/auth/verify-otp", json={"phone": phone, "otp": captured["code"]})
    assert first.json()["is_new_user"] is True
    user_id = first.json()["user"]["id"]

    await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    second = await client.post("/api/v1/auth/verify-otp", json={"phone": phone, "otp": captured["code"]})
    assert second.json()["is_new_user"] is False
    assert second.json()["user"]["id"] == user_id


async def test_refresh_issues_new_token_and_revokes_old(client, monkeypatch):
    captured = _mock_otp(monkeypatch)
    await client.post("/api/v1/auth/request-otp", json={"phone": "+923007770001"})
    verify = await client.post(
        "/api/v1/auth/verify-otp", json={"phone": "+923007770001", "otp": captured["code"]}
    )
    old_token = verify.json()["token"]
    headers = {"Authorization": f"Bearer {old_token}"}

    refresh = await client.post("/api/v1/auth/refresh", headers=headers)
    assert refresh.status_code == 200
    new_token = refresh.json()["token"]
    assert new_token != old_token

    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
    assert (
        await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_token}"})
    ).status_code == 200


# --- TEMPORARY free-form OTP delivery (tied to Meta Business Verification) ---
# WhatsAppService.send_otp sends type "text" instead of the `whatsapp_otp`
# template until an Authentication template is approved. Revert these two
# tests together with send_otp (see its docstring / CLAUDE.md).


async def test_otp_send_uses_freeform_text_not_template(client, monkeypatch):
    import re

    sent = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "wamid.local"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)
    phone = "+923001115555"

    resp = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    assert resp.status_code == 200

    assert len(sent) == 1
    payload = sent[0]
    assert payload["type"] == "text"
    assert "template" not in payload
    assert payload["to"] == phone.lstrip("+")
    body = payload["text"]["body"]
    assert "do not share this code" in body
    assert f"{get_settings().OTP_EXPIRE_MINUTES} minutes" in body

    # Generation/hashing is untouched: the code that went out over WhatsApp
    # is the one verify-otp accepts.
    code = re.match(r"(\d{6}) is your verification code", body).group(1)
    verify = await client.post("/api/v1/auth/verify-otp", json={"phone": phone, "otp": code})
    assert verify.status_code == 200, verify.text


async def test_otp_send_with_no_open_window_fails_cleanly(client, db_session, monkeypatch):
    """No open 24h window -> Meta answers HTTP 400 / error 131047. That must
    come out as OTP_DELIVERY_FAILED (finding #6's existing handling), not a
    raw 500, and must not leave an OTP row consuming a rate-limit slot. Mocked
    at the httpx layer (not `_send`) so the real raise_for_status + retry path
    is exercised."""
    import httpx
    from sqlalchemy import select

    from app.models.user import OtpRequest
    from app.services.whatsapp_service import WhatsAppService

    monkeypatch.setattr(get_settings(), "WHATSAPP_API_TOKEN", "test-token")

    async def no_sleep(_seconds):
        return None

    # `_send` retries 3x with exponential backoff; skip the real waiting.
    monkeypatch.setattr(WhatsAppService._send.retry, "sleep", no_sleep)

    graph_calls = []
    real_post = httpx.AsyncClient.post

    async def fake_post(self, url, *args, **kwargs):
        if "graph.facebook.com" not in str(url):
            return await real_post(self, url, *args, **kwargs)  # the test client's own requests
        graph_calls.append(kwargs["json"])
        return httpx.Response(
            400,
            json={
                "error": {
                    "message": "(#131047) Re-engagement message",
                    "type": "OAuthException",
                    "code": 131047,
                }
            },
            request=httpx.Request("POST", str(url)),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    phone = "+923001116666"

    resp = await client.post("/api/v1/auth/request-otp", json={"phone": phone})

    assert graph_calls, "the free-form send should actually have been attempted"
    assert graph_calls[0]["type"] == "text"
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "OTP_DELIVERY_FAILED"
    rows = (
        await db_session.execute(select(OtpRequest).where(OtpRequest.phone == phone))
    ).scalars().all()
    assert rows == []
