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


# ---------------------------------------------------------------- item 3: opt-in stored, cash refund row, "Refund maangein"

from datetime import date, datetime, time, timedelta, timezone  # noqa: E402


async def _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923002030001", **venue_kwargs):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner, **venue_kwargs)
    court = await make_court(venue)
    for d in range(7):
        await make_schedule(court, day_of_week=d, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    return owner, venue, court


async def test_walkin_stores_the_whatsapp_tick(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    from app.models.booking import Booking

    owner, _v, court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    day = (date.today() + timedelta(days=3)).isoformat()
    resp = await client.post("/api/v1/bookings/walkin", headers=await make_auth_headers(owner), json={
        "court_id": str(court.id), "starts_at": f"{day}T10:00:00Z", "player_name": "Ali", "player_phone": "0333 1112223",
        "amount_paid": 0, "whatsapp_opt_in": True})
    assert resp.status_code == 201, resp.text
    async with db_session_factory() as s:
        b = await s.get(Booking, resp.json()["booking"]["id"])
        assert b.whatsapp_opt_in is True


async def test_cancelling_a_cash_paid_booking_writes_a_refund_row_without_a_push(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from app.models.dispute import PaymentDispute

    owner, _v, court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923002030002")
    day = (date.today() + timedelta(days=3)).isoformat()
    bid = (await client.post("/api/v1/bookings/walkin", headers=await make_auth_headers(owner), json={
        "court_id": str(court.id), "starts_at": f"{day}T10:00:00Z", "player_name": "Ali", "player_phone": "+923002030002",
        "amount_paid": 600, "whatsapp_opt_in": True})).json()["booking"]["id"]
    assert (await client.post(f"/api/v1/bookings/{bid}/cancel", headers=await make_auth_headers(player), json={})).status_code == 200
    async with db_session_factory() as s:
        rows = (await s.execute(select(PaymentDispute).where(PaymentDispute.booking_id == bid))).scalars().all()
    assert [(r.reason, float(r.refund_amount), r.payment_id) for r in rows] == [("player_cancelled_paid_booking", 600.0, None)]
    assert await _log_rows(db_session_factory, owner.id, "refund_owed") == []
    # it is on the owner's Refunds list
    refunds = (await client.get("/api/v1/owners/refunds", headers=await make_auth_headers(owner))).json()
    assert [r["refund_amount"] for r in refunds] == [600.0]


async def test_refund_request_inside_the_policy_window_goes_to_the_owner(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from app.models.booking import Booking, BookingStatus, CancelledBy
    from app.models.payment import Payment

    owner, venue, court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, cancellation_allowed=True, cancellation_cutoff_hours=6)
    player = await make_user("+923002030011", name="Sana")
    starts = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    async with db_session_factory() as s:
        b = Booking(court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
                    status=BookingStatus.CANCELLED, cancelled_by=CancelledBy.OWNER, price=1000, advance_amount=1000)
        s.add(b)
        await s.flush()
        s.add(Payment(booking_id=b.id, proof_key="p.jpg", amount_claimed=1000, ocr_amount=1000))
        await s.commit()
        bid = b.id
    ph = await make_auth_headers(player)
    detail = (await client.get(f"/api/v1/bookings/{bid}/detail", headers=ph)).json()
    assert detail["refund_request"] == {"state": "eligible", "amount": 1000.0}
    resp = await client.post(f"/api/v1/bookings/{bid}/refund-request", headers=ph, json={"note": "Venue ne cancel kiya"})
    assert resp.status_code == 201, resp.text
    refunds = (await client.get("/api/v1/owners/refunds", headers=await make_auth_headers(owner))).json()
    assert [(r["reason"], r["refund_amount"]) for r in refunds] == [("player_refund_request", 1000.0)]
    assert await _log_rows(db_session_factory, owner.id, "owner_refund_requested")
    assert await _log_rows(db_session_factory, player.id, "player_refund_requested")
    # once is enough
    again = await client.post(f"/api/v1/bookings/{bid}/refund-request", headers=ph, json={})
    assert again.status_code == 409 and again.json()["error"]["details"]["state"] == "already_owed"


async def test_no_refund_request_when_the_venue_policy_says_no_refund(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from app.models.booking import Booking, BookingStatus, CancelledBy

    _o, _v, court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, cancellation_allowed=False)
    player = await make_user("+923002030021")
    starts = datetime.now(timezone.utc) + timedelta(days=3)
    async with db_session_factory() as s:
        b = Booking(court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
                    status=BookingStatus.CANCELLED, cancelled_by=CancelledBy.PLAYER, price=1000, advance_amount=1000, amount_paid=0)
        s.add(b)
        await s.commit()
        bid = b.id
    ph = await make_auth_headers(player)
    assert (await client.get(f"/api/v1/bookings/{bid}/detail", headers=ph)).json()["refund_request"]["state"] == "policy_no_refund"
    assert (await client.post(f"/api/v1/bookings/{bid}/refund-request", headers=ph, json={})).status_code == 409
