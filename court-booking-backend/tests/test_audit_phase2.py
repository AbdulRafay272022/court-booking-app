"""Audit build 2026-10-28, Phase 2 (migration f7c3a9d2b415). One section per item; see docs/audit-build-progress.md."""

import io

from PIL import Image
from sqlalchemy import select

from app.models.user import UserRole
from tests.test_stage2_identity_permissions import _files, s3  # noqa: F401  (pytest fixture re-export)


def _png(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 200, 200)).save(buf, format="PNG")
    return buf.getvalue()


CARD = _png(856, 540)
SCREENSHOT = _png(540, 1170)


async def _log_rows(db_session_factory, user_id, event):
    from app.models.notification import NotificationLog

    async with db_session_factory() as s:
        return list(
            (await s.execute(select(NotificationLog).where(NotificationLog.user_id == user_id, NotificationLog.event_type == event))).scalars().all()
        )


# ---------------------------------------------------------------- item 1: CNIC review


async def test_admin_can_not_approve_with_a_reason_and_the_owner_reuploads(
    client, db_session_factory, make_user, make_auth_headers, s3  # noqa: F811
):
    owner = await make_user("+923002010001", role=UserRole.OWNER, name="Owner A")
    admin = await make_user("+923002010002", role=UserRole.ADMIN)
    oh, ah = await make_auth_headers(owner), await make_auth_headers(admin)
    assert (await client.post("/api/v1/owners/identity", headers=oh, files=_files(front=CARD, back=CARD))).status_code in (200, 201)
    assert (await client.get("/api/v1/owners/identity", headers=oh)).json()["status"] == "submitted"

    # a reason is required
    assert (await client.post(f"/api/v1/admin/owner-identities/{owner.id}/reject", headers=ah, json={"reason": ""})).status_code == 422
    resp = await client.post(f"/api/v1/admin/owner-identities/{owner.id}/reject", headers=ah, json={"reason": "Photo dhundli hai"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected" and resp.json()["rejection_reason"] == "Photo dhundli hai"
    mine = (await client.get("/api/v1/owners/identity", headers=oh)).json()
    assert mine["status"] == "rejected" and mine["rejection_reason"] == "Photo dhundli hai"
    rows = await _log_rows(db_session_factory, owner.id, "owner_cnic_result")
    assert rows, "the owner must be told"

    listed = (await client.get("/api/v1/admin/owner-identities?filter=rejected", headers=ah)).json()
    assert [i["status"] for i in listed["items"]] == ["rejected"]

    # re-upload: back to waiting, the reason is gone
    assert (await client.post("/api/v1/owners/identity", headers=oh, files=_files(front=CARD, back=CARD))).status_code in (200, 201)
    again = (await client.get("/api/v1/owners/identity", headers=oh)).json()
    assert again["status"] == "submitted" and again["rejection_reason"] is None

    ok = await client.post(f"/api/v1/admin/owner-identities/{owner.id}/verify", headers=ah)
    assert ok.status_code == 200 and ok.json()["status"] == "verified"
    assert len(await _log_rows(db_session_factory, owner.id, "owner_cnic_result")) == 2


async def test_an_upload_that_does_not_look_like_a_card_is_flagged_for_the_admin(
    client, make_user, make_auth_headers, s3  # noqa: F811
):
    owner = await make_user("+923002010011", role=UserRole.OWNER)
    oh = await make_auth_headers(owner)
    shot = (await client.post("/api/v1/owners/identity", headers=oh, files=_files(front=SCREENSHOT, back=CARD))).json()
    assert "not_cnic_like" in shot["flags"]
    card = (await client.post("/api/v1/owners/identity", headers=oh, files=_files(front=CARD, back=CARD))).json()
    assert "not_cnic_like" not in card["flags"]
