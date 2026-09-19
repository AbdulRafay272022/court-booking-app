from app.config import get_settings
from app.models.user import UserRole


async def test_chat_message_requires_auth(client):
    resp = await client.post("/api/v1/chat/message", json={"message": "hi"})
    assert resp.status_code == 401


async def test_chat_message_no_api_key_returns_fallback(client, make_user, make_auth_headers, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    player = await make_user("+923015000001", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    resp = await client.post("/api/v1/chat/message", headers=headers, json={"message": "hi"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"]
    assert body["actions"] == []


async def test_chat_endpoint_enforces_per_user_rate_limit(client, make_user, make_auth_headers, monkeypatch):
    """Each chat turn is a real paid AI call -- a per-user limit (distinct
    from the blanket per-IP RateLimitMiddleware) is a cost-abuse guard, not
    just an abuse guard. See finding #11 in AUDIT_FINDINGS.md."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "CHAT_RATE_LIMIT_PER_MINUTE", 3)

    player = await make_user("+923015000099", role=UserRole.PLAYER)
    other_player = await make_user("+923015000098", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    other_headers = await make_auth_headers(other_player)

    for _ in range(3):
        resp = await client.post("/api/v1/chat/message", headers=headers, json={"message": "hi"})
        assert resp.status_code == 200

    limited = await client.post("/api/v1/chat/message", headers=headers, json={"message": "hi"})
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "RATE_LIMITED"

    # A different user is on their own counter, unaffected by player's limit.
    other_resp = await client.post("/api/v1/chat/message", headers=other_headers, json={"message": "hi"})
    assert other_resp.status_code == 200


async def test_ai_chat_disabled_returns_clean_error_not_500(client, make_user, make_auth_headers, monkeypatch):
    """Platform-wide kill switch (finding #21): flipping AI_CHAT_ENABLED off
    must degrade gracefully (same 200 + canned reply as an unconfigured
    provider), never a 500 -- and must actually short-circuit before ever
    calling a real provider (a real key configured here would 500/hang on
    a real network call in this test environment if the switch didn't
    work, since httpx isn't mocked)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_CHAT_ENABLED", False)

    player = await make_user("+923015000097", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    resp = await client.post("/api/v1/chat/message", headers=headers, json={"message": "hi"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"]
    assert body["actions"] == []


async def test_chat_history_records_both_turns(client, make_user, make_auth_headers, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    player = await make_user("+923015000002", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    await client.post("/api/v1/chat/message", headers=headers, json={"message": "hello there"})

    history = await client.get("/api/v1/chat/history", headers=headers)
    assert history.status_code == 200
    items = history.json()
    assert len(items) == 2
    assert items[0]["sender_type"] == "player"
    assert items[0]["content"] == "hello there"
    assert items[1]["sender_type"] == "ai"
    assert items[0]["created_at"] <= items[1]["created_at"]


async def test_chat_history_scoped_to_requesting_user(client, make_user, make_auth_headers, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    player_a = await make_user("+923015000003", role=UserRole.PLAYER)
    player_b = await make_user("+923015000004", role=UserRole.PLAYER)
    headers_a = await make_auth_headers(player_a)
    headers_b = await make_auth_headers(player_b)

    await client.post("/api/v1/chat/message", headers=headers_a, json={"message": "player a's message"})

    history_b = await client.get("/api/v1/chat/history", headers=headers_b)
    assert history_b.json() == []

    history_a = await client.get("/api/v1/chat/history", headers=headers_a)
    assert len(history_a.json()) == 2


async def test_chat_history_filters_by_venue(client, make_user, make_venue, make_auth_headers, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    owner = await make_user("+923015000005", role=UserRole.OWNER)
    player = await make_user("+923015000006", role=UserRole.PLAYER)
    venue_a = await make_venue(owner, name="Venue A")
    venue_b = await make_venue(owner, name="Venue B")
    headers = await make_auth_headers(player)

    await client.post(
        "/api/v1/chat/message", headers=headers, json={"venue_id": str(venue_a.id), "message": "about venue a"}
    )
    await client.post(
        "/api/v1/chat/message", headers=headers, json={"venue_id": str(venue_b.id), "message": "about venue b"}
    )

    scoped = await client.get("/api/v1/chat/history", headers=headers, params={"venue_id": str(venue_a.id)})
    contents = [item["content"] for item in scoped.json()]
    assert "about venue a" in contents
    assert "about venue b" not in contents
