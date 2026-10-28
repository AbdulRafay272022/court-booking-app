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


# ---------------------------------------------------------------- item 2: cnic_visibility_gate (flag, default OFF)


async def _gate(db_session_factory, on: bool):
    from app.models.feature_flag import FeatureFlag

    async with db_session_factory() as s:
        row = await s.get(FeatureFlag, "cnic_visibility_gate")
        if row is None:
            s.add(FeatureFlag(key="cnic_visibility_gate", label="CNIC gate", enabled=on))
        else:
            row.enabled = on
        await s.commit()


async def test_cnic_gate_hides_unapproved_owners_venues_everywhere_only_when_on(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from datetime import date, time, timedelta

    from app.models.owner_identity import OwnerIdentity

    owner = await make_user("+923002020001", role=UserRole.OWNER)
    venue = await make_venue(owner, name="Gate Arena")
    court = await make_court(venue)
    for d in range(7):
        await make_schedule(court, day_of_week=d, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    player = await make_user("+923002020002")
    ph = await make_auth_headers(player)
    starts = f"{(date.today() + timedelta(days=3)).isoformat()}T10:00:00Z"

    # flag OFF (default): nothing changes, even without any CNIC
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 200
    assert [v["name"] for v in (await client.get("/api/v1/venues")).json()["venues"]] == ["Gate Arena"]

    await _gate(db_session_factory, True)
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 404
    assert (await client.get("/api/v1/venues")).json()["venues"] == []
    assert (await client.put(f"/api/v1/venues/{venue.id}/favorite", headers=ph)).status_code == 404
    hold = await client.post("/api/v1/bookings/hold", headers=ph, json={"court_id": str(court.id), "starts_at": starts})
    assert hold.status_code == 400
    # the owner still sees it, with the reason for the banner
    mine = (await client.get(f"/api/v1/venues/{venue.id}", headers=await make_auth_headers(owner))).json()
    assert mine["player_hidden_reason"] == "cnic"

    # approve the owner's CNIC: visible again
    async with db_session_factory() as s:
        s.add(OwnerIdentity(user_id=owner.id, cnic_encrypted={"v": 1}, cnic_last4="1234", cnic_hash="a" * 64,
                            front_key="f", back_key="b", flags=[], cnic_status="approved"))
        await s.commit()
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 200
    assert [v["name"] for v in (await client.get("/api/v1/venues")).json()["venues"]] == ["Gate Arena"]
