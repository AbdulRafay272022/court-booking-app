from app.config import get_settings


async def test_health_check_reports_uptime_and_db(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "healthy"
    assert body["database"] == "connected"
    assert "version" in body
    assert isinstance(body["uptime_seconds"], int)
    assert body["uptime_seconds"] >= 0


async def test_readiness_check_all_unconfigured_dependencies_still_ready(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "AWS_ACCESS_KEY_ID", "")
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "")

    resp = await client.get("/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["s3"] == "not_configured"
    assert body["checks"]["whatsapp"] == "not_configured"


async def test_readiness_check_reports_unreachable_whatsapp(client, monkeypatch):
    import httpx

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_API_TOKEN", "test-token")

    # Only the outbound call to the WhatsApp Graph API should fail here --
    # not the test client's own ASGI-transport request to our app, which
    # also happens to go through httpx.AsyncClient.get.
    original_get = httpx.AsyncClient.get

    async def fake_get(self, url, *args, **kwargs):
        if isinstance(url, str) and settings.WHATSAPP_API_URL in url:
            raise httpx.ConnectError("connection refused")
        return await original_get(self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    resp = await client.get("/health/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["whatsapp"] == "unreachable"
