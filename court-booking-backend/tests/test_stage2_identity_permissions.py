"""Round 2 Stage 2: GET /owners/me/permissions and the owner CNIC (identity) endpoints. Real Postgres; S3 mocked."""
import io

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models.audit import AuditLog
from app.models.owner_identity import OwnerIdentity
from app.models.staff import StaffPermissionKey
from app.models.user import User, UserRole
from app.utils.encryption import decrypt_json
from overview_helpers import make_staff
from round2_helpers import png_bytes

ALL = sorted(p.value for p in StaffPermissionKey)
CNIC = "42101-1234567-3"


async def test_my_permissions_owner_staff_admin(client, db_session_factory, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923022000001", role=UserRole.OWNER)
    v1 = await make_venue(owner, name="One")
    v2 = await make_venue(owner, name="Two")
    oh = await make_auth_headers(owner)
    body = (await client.get("/api/v1/owners/me/permissions", headers=oh)).json()
    assert body["role"] == "owner"
    assert {vp["venue_id"] for vp in body["venue_permissions"]} == {str(v1.id), str(v2.id)}
    assert all(sorted(vp["permissions"]) == ALL for vp in body["venue_permissions"])

    async def load_user(uid):
        async with db_session_factory() as s:
            return await s.get(User, uid)

    _u, sh = await make_staff(client, oh, v1, "+923022000002", ["check_in", "view_ledger"], load_user, make_auth_headers)
    body = (await client.get("/api/v1/owners/me/permissions", headers=sh)).json()
    assert body == {"role": "staff", "venue_permissions": [{"venue_id": str(v1.id), "permissions": ["check_in", "view_ledger"]}]}

    admin = await make_user("+923022000003", role=UserRole.ADMIN)
    body = (await client.get("/api/v1/owners/me/permissions", headers=await make_auth_headers(admin))).json()
    assert body["role"] == "admin" and {str(v1.id), str(v2.id)} <= {vp["venue_id"] for vp in body["venue_permissions"]}

    player = await make_user("+923022000004")
    assert (await client.get("/api/v1/owners/me/permissions", headers=await make_auth_headers(player))).status_code == 403


@pytest.fixture
def s3(monkeypatch):
    uploads: dict[str, bytes] = {}

    async def fake_upload(data, key, bucket, content_type="application/octet-stream", *, private=False):
        assert private is True and bucket == get_settings().S3_BUCKET_PRIVATE
        uploads[key] = data
        return key

    monkeypatch.setattr("app.services.owner_identity_service.upload_bytes", fake_upload)
    monkeypatch.setattr("app.services.owner_identity_service.signed_private_url", lambda key, exp=300: f"https://signed/{key}")
    monkeypatch.setattr(get_settings(), "CNIC_HASH_KEY", "test-cnic-hash-key")
    return uploads


def _card_png() -> bytes:
    """A CNIC-shaped (ID-1, ~1.59:1) image: audit 2026-10-28 Phase 2 flags uploads that do not look like a card."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (856, 540), (200, 200, 200)).save(buf, format="PNG")
    return buf.getvalue()


def _files(number=CNIC, front=None, back=None, ctype="image/png"):
    return {
        "number": (None, number),
        "front": ("front.png", io.BytesIO(front if front is not None else _card_png()), ctype),
        "back": ("back.png", io.BytesIO(back if back is not None else _card_png()), ctype),
    }


async def test_identity_submit_get_masked_and_stored_encrypted(client, db_session_factory, make_user, make_auth_headers, s3):
    owner = await make_user("+923022000011", role=UserRole.OWNER)
    oh = await make_auth_headers(owner)
    assert (await client.get("/api/v1/owners/identity", headers=oh)).json() == {"status": "missing", "masked": None, "flags": [], "rejection_reason": None}

    resp = await client.post("/api/v1/owners/identity", headers=oh, files=_files())
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "submitted", "masked": "*****-*******-3", "flags": [], "rejection_reason": None}
    assert "4210112345673" not in resp.text and "1234567" not in resp.text
    assert set(s3) == {f"owner-identity/{owner.id}/front.png", f"owner-identity/{owner.id}/back.png"}

    async with db_session_factory() as s:
        row = await s.scalar(select(OwnerIdentity).where(OwnerIdentity.user_id == owner.id))
        assert "4210112345673" not in str(row.cnic_encrypted)
        assert decrypt_json(row.cnic_encrypted, get_settings()) == {"number": "4210112345673"}
        assert row.cnic_last4 == "5673" and len(row.cnic_hash) == 64
        audit = (await s.execute(select(AuditLog).where(AuditLog.entity_id == row.id))).scalars().all()
        assert audit and all("4210112345673" not in str(a.new_value) for a in audit)


async def test_identity_validation(client, make_user, make_auth_headers, s3):
    owner = await make_user("+923022000012", role=UserRole.OWNER)
    oh = await make_auth_headers(owner)
    # QA: Arabic-Indic digits are 13 "digits" to Python's \d but not a CNIC (and would hash apart from the ASCII number).
    for bad in ("12345", "42101-1234567-33", "4210A12345673", "", "٤٢١٠١١٢٣٤٥٦٧٣"):
        resp = await client.post("/api/v1/owners/identity", headers=oh, files=_files(number=bad))
        assert resp.status_code == 422, (bad, resp.text)
        if bad:
            assert resp.json()["error"]["code"] == "CNIC_INVALID"
    resp = await client.post("/api/v1/owners/identity", headers=oh, files=_files(front=b"not an image"))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_IMAGE_FORMAT"
    resp = await client.post("/api/v1/owners/identity", headers=oh, files=_files(ctype="application/pdf"))
    assert resp.status_code == 400
    player = await make_user("+923022000013")
    assert (await client.post("/api/v1/owners/identity", headers=await make_auth_headers(player), files=_files())).status_code == 403


async def test_identity_not_configured_outside_debug(client, make_user, make_auth_headers, s3, monkeypatch):
    owner = await make_user("+923022000014", role=UserRole.OWNER)
    monkeypatch.setattr(get_settings(), "CNIC_HASH_KEY", "")
    monkeypatch.setattr(get_settings(), "DEBUG", False)
    resp = await client.post("/api/v1/owners/identity", headers=await make_auth_headers(owner), files=_files())
    assert resp.status_code == 503 and resp.json()["error"]["code"] == "CNIC_NOT_CONFIGURED"
    assert s3 == {}  # nothing uploaded


async def test_duplicate_cnic_flags_both_rows_and_replace_clears_it(client, make_user, make_auth_headers, s3):
    a = await make_user("+923022000021", role=UserRole.OWNER)
    b = await make_user("+923022000022", role=UserRole.OWNER)
    ah, bh = await make_auth_headers(a), await make_auth_headers(b)
    assert (await client.post("/api/v1/owners/identity", headers=ah, files=_files())).json()["flags"] == []
    second = await client.post("/api/v1/owners/identity", headers=bh, files=_files(number="4210112345673"))
    assert second.status_code == 200 and second.json()["flags"] == ["duplicate_cnic"]  # never blocked
    assert (await client.get("/api/v1/owners/identity", headers=ah)).json()["flags"] == ["duplicate_cnic"]
    # b replaces with a different number: both rows lose the flag
    assert (await client.post("/api/v1/owners/identity", headers=bh, files=_files(number="35202-7654321-9"))).json()["flags"] == []
    assert (await client.get("/api/v1/owners/identity", headers=ah)).json()["flags"] == []


async def test_admin_identity_list_full_view_audited_and_verify(client, db_session_factory, make_user, make_auth_headers, s3):
    owner = await make_user("+923022000031", role=UserRole.OWNER, name="Abbas")
    missing = await make_user("+923022000032", role=UserRole.OWNER, name="No Cnic")
    admin = await make_user("+923022000033", role=UserRole.ADMIN)
    adh = await make_auth_headers(admin)
    await client.post("/api/v1/owners/identity", headers=await make_auth_headers(owner), files=_files())

    page = (await client.get("/api/v1/admin/owner-identities?filter=all", headers=adh)).json()
    assert "4210112345673" not in str(page) and "1234567" not in str(page)
    rows = {r["user_id"]: r for r in page["items"]}
    assert rows[str(owner.id)]["masked"] == "*****-*******-3" and rows[str(owner.id)]["phone_last4"] == "0031"
    assert rows[str(missing.id)]["status"] == "missing"
    assert [r["user_id"] for r in (await client.get("/api/v1/admin/owner-identities?filter=missing", headers=adh)).json()["items"]] == [str(missing.id)]
    assert [r["user_id"] for r in (await client.get("/api/v1/admin/owner-identities?filter=unverified", headers=adh)).json()["items"]] == [str(owner.id)]

    for _ in range(2):
        full = await client.get(f"/api/v1/admin/owner-identities/{owner.id}", headers=adh)
        assert full.status_code == 200
        assert full.json()["number"] == "42101-1234567-3"
        assert full.json()["front_url"].startswith("https://signed/owner-identity/")
    async with db_session_factory() as s:
        views = (await s.execute(select(AuditLog).where(AuditLog.action == "owner_identity.viewed"))).scalars().all()
        assert len(views) == 2 and all(v.actor_id == admin.id for v in views)
        assert all("4210112345673" not in str(v.new_value) for v in views)

    verified = await client.post(f"/api/v1/admin/owner-identities/{owner.id}/verify", headers=adh)
    assert verified.status_code == 200 and verified.json()["status"] == "verified" and verified.json()["verified_at"]
    assert (await client.get("/api/v1/owners/identity", headers=await make_auth_headers(owner))).json()["status"] == "verified"
    assert (await client.get(f"/api/v1/admin/owner-identities/{missing.id}", headers=adh)).status_code == 404
    # admin only
    assert (await client.get("/api/v1/admin/owner-identities", headers=await make_auth_headers(owner))).status_code == 403
