import uuid

from sqlalchemy import select

from app.models.feature_flag import FeatureFlag
from app.models.user import User, UserRole


async def _make_owner_venue_court(make_user, make_venue, make_court, phone):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    return owner, venue, court


async def _load_user(db_session_factory, user_id) -> User:
    async with db_session_factory() as s:
        return await s.get(User, uuid.UUID(str(user_id)))


async def test_owner_creates_staff_with_permissions(
    client, make_user, make_venue, make_court, make_auth_headers
):
    owner, venue, _court = await _make_owner_venue_court(make_user, make_venue, make_court, "+923017000001")
    headers = await make_auth_headers(owner)
    resp = await client.post(
        "/api/v1/staff",
        headers=headers,
        json={
            "venue_id": str(venue.id),
            "name": "Bob Manager",
            "phone": "+923017000101",
            "password": "staffpass123",
            "permissions": ["check_in", "view_ledger"],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["venue_id"] == str(venue.id)
    assert set(body["permissions"]) == {"check_in", "view_ledger"}
    assert body["is_active"] is True
    assert body["phone"] == "+923017000101"


async def test_player_cannot_manage_staff(client, make_user, make_venue, make_court, make_auth_headers):
    _owner, venue, _court = await _make_owner_venue_court(make_user, make_venue, make_court, "+923017000002")
    player = await make_user("+923017000202", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    resp = await client.post(
        "/api/v1/staff",
        headers=headers,
        json={"venue_id": str(venue.id), "name": "X", "phone": "+923017000203", "password": "staffpass123"},
    )
    assert resp.status_code == 403


async def test_staff_acts_only_with_granted_permission(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, venue, court = await _make_owner_venue_court(make_user, make_venue, make_court, "+923017000003")
    owner_headers = await make_auth_headers(owner)

    # Staff A: has edit_court_settings.
    created_a = await client.post(
        "/api/v1/staff",
        headers=owner_headers,
        json={
            "venue_id": str(venue.id),
            "name": "Sara",
            "phone": "+923017000303",
            "password": "staffpass123",
            "permissions": ["edit_court_settings"],
        },
    )
    assert created_a.status_code == 201
    staff_a = await _load_user(db_session_factory, created_a.json()["staff_user_id"])
    assert staff_a.role == UserRole.STAFF
    headers_a = await make_auth_headers(staff_a)

    ok = await client.patch(f"/api/v1/courts/{court.id}", headers=headers_a, json={"name": "Renamed by staff"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "Renamed by staff"

    # Staff B: only view_ledger -> the SAME court edit is refused with NOT_STAFF_PERMITTED
    # (the court exists, so the permission gate is what fires, not a 404).
    created_b = await client.post(
        "/api/v1/staff",
        headers=owner_headers,
        json={
            "venue_id": str(venue.id),
            "name": "Vic",
            "phone": "+923017000304",
            "password": "staffpass123",
            "permissions": ["view_ledger"],
        },
    )
    assert created_b.status_code == 201
    staff_b = await _load_user(db_session_factory, created_b.json()["staff_user_id"])
    headers_b = await make_auth_headers(staff_b)

    denied = await client.patch(f"/api/v1/courts/{court.id}", headers=headers_b, json={"name": "nope"})
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "NOT_STAFF_PERMITTED"


async def test_staff_cannot_touch_another_owners_venue(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner_a, venue_a, _court_a = await _make_owner_venue_court(make_user, make_venue, make_court, "+923017000004")
    owner_b, _venue_b, court_b = await _make_owner_venue_court(make_user, make_venue, make_court, "+923017000005")
    owner_a_headers = await make_auth_headers(owner_a)
    created = await client.post(
        "/api/v1/staff",
        headers=owner_a_headers,
        json={
            "venue_id": str(venue_a.id),
            "name": "Ali",
            "phone": "+923017000404",
            "password": "staffpass123",
            "permissions": ["edit_court_settings"],
        },
    )
    assert created.status_code == 201
    staff_user = await _load_user(db_session_factory, created.json()["staff_user_id"])
    staff_headers = await make_auth_headers(staff_user)

    # Owner B's court is off-limits to owner A's staff.
    resp = await client.patch(
        f"/api/v1/courts/{court_b.id}", headers=staff_headers, json={"name": "hijack"}
    )
    assert resp.status_code == 403


async def test_deactivating_staff_revokes_their_sessions(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, venue, _court = await _make_owner_venue_court(make_user, make_venue, make_court, "+923017000006")
    owner_headers = await make_auth_headers(owner)
    created = await client.post(
        "/api/v1/staff",
        headers=owner_headers,
        json={
            "venue_id": str(venue.id),
            "name": "Zed",
            "phone": "+923017000406",
            "password": "staffpass123",
            "permissions": ["view_ledger"],
        },
    )
    staff_member_id = created.json()["id"]
    staff_user = await _load_user(db_session_factory, created.json()["staff_user_id"])
    staff_headers = await make_auth_headers(staff_user)

    # Session works before deactivation.
    before = await client.get("/api/v1/owners/venues", headers=staff_headers)
    assert before.status_code == 200

    # Owner deactivates -> sessions killed immediately.
    off = await client.patch(
        f"/api/v1/staff/{staff_member_id}/active", headers=owner_headers, json={"is_active": False}
    )
    assert off.status_code == 200
    assert off.json()["is_active"] is False

    after = await client.get("/api/v1/owners/venues", headers=staff_headers)
    assert after.status_code == 401


async def test_cannot_grant_permission_whose_flag_is_off(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory
):
    owner, venue, _court = await _make_owner_venue_court(make_user, make_venue, make_court, "+923017000007")
    async with db_session_factory() as s:
        s.add(FeatureFlag(key="reviews", enabled=False, label="reviews"))
        await s.commit()
    owner_headers = await make_auth_headers(owner)
    resp = await client.post(
        "/api/v1/staff",
        headers=owner_headers,
        json={
            "venue_id": str(venue.id),
            "name": "No Reviews",
            "phone": "+923017000407",
            "password": "staffpass123",
            "permissions": ["respond_reviews"],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_STAFF_PERMISSION"


async def test_permission_catalog_marks_off_flags_unavailable(
    client, make_user, make_auth_headers, db_session_factory
):
    async with db_session_factory() as s:
        s.add(FeatureFlag(key="refunds", enabled=False, label="refunds"))
        await s.commit()
    owner = await make_user("+923017000008", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)
    resp = await client.get("/api/v1/staff/permissions", headers=headers)
    assert resp.status_code == 200
    by_key = {item["key"]: item for item in resp.json()}
    assert by_key["mark_refunds"]["available"] is False  # refunds flag off
    assert by_key["check_in"]["available"] is True  # not flag-bound
