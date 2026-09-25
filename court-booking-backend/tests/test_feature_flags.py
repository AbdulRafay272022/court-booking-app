import uuid

from app.models.feature_flag import FeatureFlag
from app.models.user import UserRole


async def _seed_flag(db_session_factory, key: str, enabled: bool = True) -> None:
    async with db_session_factory() as s:
        s.add(FeatureFlag(key=key, enabled=enabled, label=key))
        await s.commit()


async def test_public_flags_reflect_db(client, db_session_factory):
    await _seed_flag(db_session_factory, "reviews", True)
    await _seed_flag(db_session_factory, "waitlist", False)
    resp = await client.get("/api/v1/feature-flags")
    assert resp.status_code == 200
    flags = resp.json()["flags"]
    assert flags["reviews"] is True
    assert flags["waitlist"] is False


async def test_admin_can_toggle_flag(client, make_user, make_auth_headers, db_session_factory):
    await _seed_flag(db_session_factory, "reviews", True)
    admin = await make_user("+923016000001", role=UserRole.ADMIN)
    headers = await make_auth_headers(admin)

    resp = await client.patch("/api/v1/admin/feature-flags/reviews", headers=headers, json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False

    pub = await client.get("/api/v1/feature-flags")
    assert pub.json()["flags"]["reviews"] is False


async def test_admin_toggle_unknown_flag_is_404(client, make_user, make_auth_headers):
    admin = await make_user("+923016000002", role=UserRole.ADMIN)
    headers = await make_auth_headers(admin)
    resp = await client.patch("/api/v1/admin/feature-flags/does_not_exist", headers=headers, json={"enabled": False})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "FEATURE_FLAG_NOT_FOUND"


async def test_non_admin_cannot_toggle_flag(client, make_user, make_auth_headers, db_session_factory):
    await _seed_flag(db_session_factory, "reviews", True)
    owner = await make_user("+923016000003", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)
    resp = await client.patch("/api/v1/admin/feature-flags/reviews", headers=headers, json={"enabled": False})
    assert resp.status_code == 403


async def test_disabled_feature_blocks_gated_endpoint(client, make_user, make_auth_headers, db_session_factory):
    await _seed_flag(db_session_factory, "waitlist", False)
    player = await make_user("+923016000004", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    resp = await client.post(
        "/api/v1/waitlist",
        headers=headers,
        json={"court_id": str(uuid.uuid4()), "slot_starts_at": "2027-01-01T10:00:00Z"},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FEATURE_DISABLED"


async def test_missing_flag_row_is_treated_as_on(client, make_user, make_auth_headers):
    # No feature_flags row exists (fail-open) -> the gate must NOT block; the
    # request proceeds to its own validation (a bogus court -> not a 403).
    player = await make_user("+923016000005", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    resp = await client.post(
        "/api/v1/waitlist",
        headers=headers,
        json={"court_id": str(uuid.uuid4()), "slot_starts_at": "2027-01-01T10:00:00Z"},
    )
    assert resp.status_code != 403
