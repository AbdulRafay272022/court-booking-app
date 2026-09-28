from datetime import date, time, timedelta

from app.models.user import UserRole


def _png_bytes(colour=(10, 20, 30)):
    """Small in-memory PNG for the upload tests; big enough to be a real image, small enough
    to stay well under the 5 MB avatar cap."""
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (16, 16), colour).save(buf, format="PNG")
    return buf.getvalue()


def _mock_avatar_upload(monkeypatch):
    """Same pattern as tests/test_photos.py's _mock_public_upload -- patch where it's
    imported (app.api.users) rather than where it's defined."""
    counter = {"n": 0}

    async def fake_upload(data, filename, content_type, *, prefix="venues"):
        counter["n"] += 1
        return f"{prefix}/avatar-{counter['n']}.png"

    monkeypatch.setattr("app.api.users.upload_public_photo", fake_upload)


async def test_register_and_delete_fcm_token(client, make_user, make_auth_headers):
    player = await make_user("+923013000001", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    register = await client.post(
        "/api/v1/users/me/fcm-token", headers=headers, json={"token": "device-abc", "platform": "android"}
    )
    assert register.status_code == 201

    delete = await client.delete("/api/v1/users/me/fcm-token/device-abc", headers=headers)
    assert delete.status_code == 204


async def test_delete_unregistered_fcm_token_404s(client, make_user, make_auth_headers):
    player = await make_user("+923013000002", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    resp = await client.delete("/api/v1/users/me/fcm-token/never-registered", headers=headers)
    assert resp.status_code == 404


async def test_cannot_delete_another_users_fcm_token(client, make_user, make_auth_headers):
    player_a = await make_user("+923013000003", role=UserRole.PLAYER)
    player_b = await make_user("+923013000004", role=UserRole.PLAYER)
    headers_a = await make_auth_headers(player_a)
    headers_b = await make_auth_headers(player_b)

    await client.post("/api/v1/users/me/fcm-token", headers=headers_a, json={"token": "device-a-token"})

    resp = await client.delete("/api/v1/users/me/fcm-token/device-a-token", headers=headers_b)
    assert resp.status_code == 404


async def test_notification_history_scoped_to_self(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923013000005", role=UserRole.OWNER)
    player = await make_user("+923013000006", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)

    player_headers = await make_auth_headers(player)
    await client.post(
        "/api/v1/bookings/hold",
        headers=player_headers,
        json={"court_id": str(court.id), "starts_at": f"{target.isoformat()}T10:00:00+00:00"},
    )
    # Holding triggers notify_owner_new_booking -- the owner should see it in
    # their own history, and the player (who has no notifications yet) should
    # see an empty list, not the owner's.

    owner_headers = await make_auth_headers(owner)
    owner_history = await client.get("/api/v1/users/me/notifications", headers=owner_headers)
    assert owner_history.status_code == 200
    event_types = {n["event_type"] for n in owner_history.json()}
    assert "owner_new_booking" in event_types

    player_history = await client.get("/api/v1/users/me/notifications", headers=player_headers)
    assert player_history.status_code == 200
    assert all(n["event_type"] != "owner_new_booking" for n in player_history.json())


# ============================== QA signup-venue round item 7 (avatar upload)


async def test_avatar_upload_persists_url_on_user(client, make_user, make_auth_headers, monkeypatch):
    """Upload writes to the public S3 bucket, resolves to a public URL, and stores that URL on
    users.avatar_url. `user_id` is embedded in the S3 prefix so a leaked key can't be swapped
    for another user's avatar."""
    _mock_avatar_upload(monkeypatch)
    player = await make_user("+923013100001", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    resp = await client.post(
        "/api/v1/users/me/avatar", headers=headers, files={"file": ("me.png", _png_bytes(), "image/png")}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["avatar_url"] is not None
    assert str(player.id) in body["avatar_url"], "S3 key must be namespaced by user id"

    # The value on /auth/me matches -- proves the row was actually committed, not just returned.
    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["avatar_url"] == body["avatar_url"]


async def test_avatar_upload_rejects_non_image(client, make_user, make_auth_headers, monkeypatch):
    _mock_avatar_upload(monkeypatch)  # even mocked out, the endpoint should reject before calling
    player = await make_user("+923013100002", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    resp = await client.post(
        "/api/v1/users/me/avatar", headers=headers, files={"file": ("me.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")}
    )
    assert resp.status_code == 400
    # unchanged on the user
    me = await client.get("/api/v1/auth/me", headers=headers)
    assert me.json()["user"]["avatar_url"] is None


async def test_avatar_upload_rejects_too_large(client, make_user, make_auth_headers, monkeypatch):
    _mock_avatar_upload(monkeypatch)
    player = await make_user("+923013100003", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)

    # 5 MB + 1 byte of PNG-shaped junk. Content-type is accepted; the size check rejects it.
    fat = b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024 + 1)
    resp = await client.post(
        "/api/v1/users/me/avatar", headers=headers, files={"file": ("big.png", fat, "image/png")}
    )
    assert resp.status_code == 400


async def test_avatar_upload_requires_auth(client, monkeypatch):
    _mock_avatar_upload(monkeypatch)
    resp = await client.post(
        "/api/v1/users/me/avatar", files={"file": ("me.png", _png_bytes(), "image/png")}
    )
    assert resp.status_code == 401
