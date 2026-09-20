import uuid
from datetime import datetime, timedelta, timezone

from app.models.booking import Booking, BookingStatus
from app.models.payment import Payment
from app.models.user import UserRole
from app.models.venue import VenueStatus


async def test_non_admin_cannot_access_stats(client, make_user, make_auth_headers):
    owner = await make_user("+923008000001", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)
    resp = await client.get("/api/v1/admin/stats", headers=headers)
    assert resp.status_code == 403


async def test_admin_can_view_platform_stats(client, make_user, make_venue, make_court, make_auth_headers):
    admin = await make_user("+923008000002", role=UserRole.ADMIN)
    owner = await make_user("+923008000003", role=UserRole.OWNER)
    venue = await make_venue(owner)
    await make_court(venue)
    headers = await make_auth_headers(admin)

    resp = await client.get("/api/v1/admin/stats", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_venues"] >= 1
    assert body["total_courts"] >= 1


async def test_venue_approval_survives_a_failed_whatsapp_notification(
    client, make_user, make_venue, make_auth_headers, db_session_factory, monkeypatch
):
    """Production incident 2026-09-20: approving a venue saved the approval, then the owner's
    WhatsApp notification failed (Meta 132001, the `venue_approved` template isn't registered
    yet) and the uncaught error turned the request into a 500 -- which the browser showed as a
    "server connection error" even though the venue WAS approved. A failed notification must
    never fail the action that triggered it; it is recorded as a failed notification instead."""
    from sqlalchemy import select

    from app.models.notification import NotificationLog

    async def failing_send(self, payload):
        raise RuntimeError("(#132001) Template name does not exist in the translation")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", failing_send)

    admin = await make_user("+923008000090", role=UserRole.ADMIN)
    owner = await make_user("+923008000091", role=UserRole.OWNER)
    venue = await make_venue(owner, status=VenueStatus.PENDING)
    headers = await make_auth_headers(admin)

    resp = await client.post(f"/api/v1/admin/venues/{venue.id}/approve", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"

    async with db_session_factory() as session:
        rows = (
            await session.execute(
                select(NotificationLog).where(
                    NotificationLog.user_id == owner.id, NotificationLog.event_type == "venue_approved"
                )
            )
        ).scalars().all()
    whatsapp = [r for r in rows if r.channel == "whatsapp"]
    assert len(whatsapp) == 1
    assert whatsapp[0].status == "failed"
    assert "132001" in (whatsapp[0].error_message or "")


async def test_admin_can_approve_pending_venue(client, make_user, make_venue, make_auth_headers, monkeypatch):
    # Mock at the _send level (shared by send_text and send_template) since
    # the owner won't have an open 24h WhatsApp window in this test, so the
    # approval notification goes out as the venue_approved template, not
    # free text -- this test only cares that *a* message reached them.
    sent = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)

    admin = await make_user("+923008000004", role=UserRole.ADMIN)
    owner = await make_user("+923008000005", role=UserRole.OWNER)
    venue = await make_venue(owner, status=VenueStatus.PENDING)
    headers = await make_auth_headers(admin)

    resp = await client.post(f"/api/v1/admin/venues/{venue.id}/approve", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    assert any(payload["to"] == owner.phone.lstrip("+") for payload in sent)

    # Approved venues are now visible in public search.
    listing = await client.get("/api/v1/venues")
    assert venue.id in [uuid.UUID(v["id"]) for v in listing.json()["venues"]]


async def test_admin_can_reject_pending_venue_with_reason(client, make_user, make_venue, make_auth_headers):
    admin = await make_user("+923008000006", role=UserRole.ADMIN)
    owner = await make_user("+923008000007", role=UserRole.OWNER)
    venue = await make_venue(owner, status=VenueStatus.PENDING)
    headers = await make_auth_headers(admin)

    resp = await client.post(
        f"/api/v1/admin/venues/{venue.id}/reject",
        headers=headers,
        json={"reason": "Missing valid address"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "Missing valid address"


async def test_admin_can_request_changes(client, make_user, make_venue, make_auth_headers):
    admin = await make_user("+923008000008", role=UserRole.ADMIN)
    owner = await make_user("+923008000009", role=UserRole.OWNER)
    venue = await make_venue(owner, status=VenueStatus.PENDING)
    headers = await make_auth_headers(admin)

    resp = await client.post(
        f"/api/v1/admin/venues/{venue.id}/request-changes",
        headers=headers,
        json={"reason": "Please upload clearer photos of your courts"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "changes_requested"
    assert resp.json()["rejection_reason"] == "Please upload clearer photos of your courts"


async def test_pending_venues_listing_only_shows_pending(client, make_user, make_venue, make_auth_headers):
    admin = await make_user("+923008000010", role=UserRole.ADMIN)
    owner = await make_user("+923008000011", role=UserRole.OWNER)
    await make_venue(owner, status=VenueStatus.APPROVED, name="Already Approved")
    await make_venue(owner, status=VenueStatus.PENDING, name="Needs Review")
    headers = await make_auth_headers(admin)

    resp = await client.get("/api/v1/admin/venues/pending", headers=headers)
    assert resp.status_code == 200
    names = {v["name"] for v in resp.json()}
    assert names == {"Needs Review"}


async def test_non_admin_cannot_approve_venue(client, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923008000012", role=UserRole.OWNER)
    venue = await make_venue(owner, status=VenueStatus.PENDING)
    headers = await make_auth_headers(owner)

    resp = await client.post(f"/api/v1/admin/venues/{venue.id}/approve", headers=headers)
    assert resp.status_code == 403


async def test_admin_access_control_across_new_endpoints(client, make_user, make_auth_headers):
    admin = await make_user("+923008000013", role=UserRole.ADMIN)
    player = await make_user("+923008000014", role=UserRole.PLAYER)
    owner = await make_user("+923008000015", role=UserRole.OWNER)

    for endpoint in ("/api/v1/admin/dashboard", "/api/v1/admin/bookings", "/api/v1/admin/disputes"):
        admin_resp = await client.get(endpoint, headers=await make_auth_headers(admin))
        assert admin_resp.status_code == 200, endpoint

        player_resp = await client.get(endpoint, headers=await make_auth_headers(player))
        assert player_resp.status_code == 403, endpoint

        owner_resp = await client.get(endpoint, headers=await make_auth_headers(owner))
        assert owner_resp.status_code == 403, endpoint


async def test_admin_dashboard_stats_accuracy(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    admin = await make_user("+923008000016", role=UserRole.ADMIN)
    owner = await make_user("+923008000017", role=UserRole.OWNER)
    customer = await make_user("+923008000018", role=UserRole.PLAYER)
    venue_approved = await make_venue(owner, status=VenueStatus.APPROVED, name="Approved Venue")
    await make_venue(owner, status=VenueStatus.PENDING, name="Pending Venue")
    court = await make_court(venue_approved)

    today = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    async with db_session_factory() as session:
        session.add(
            Booking(
                court_id=court.id,
                player_id=customer.id,
                starts_at=today,
                ends_at=today + timedelta(hours=1),
                price=2000,
                amount_paid=2000,
                status=BookingStatus.BOOKED,
            )
        )
        await session.commit()

    headers = await make_auth_headers(admin)
    resp = await client.get("/api/v1/admin/dashboard", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_venues"] == 2
    assert body["active_venues"] == 1
    assert body["pending_approval"] == 1
    assert body["total_bookings_today"] == 1
    assert body["total_revenue_today"] == 2000.0
    assert body["total_users"] >= 3


async def _make_rejected_payment(session, *, court, player, when) -> None:
    booking = Booking(
        court_id=court.id,
        player_id=player.id,
        starts_at=when,
        ends_at=when + timedelta(hours=1),
        price=1000,
        advance_amount=1000,
        status=BookingStatus.CANCELLED,
        cancellation_reason="payment_rejected",
    )
    session.add(booking)
    await session.flush()
    session.add(
        Payment(
            booking_id=booking.id,
            proof_key="payment-proofs/x.jpg",
            amount_claimed=1000,
            review_verdict="rejected",
            rejection_reason="Amount mismatch",
            reviewed_at=datetime.now(timezone.utc),
        )
    )
    # payment_service.reject_payment() normally bumps this counter -- since
    # this helper seeds a rejected Payment row directly (bypassing that
    # service method), mirror the side effect so User.total_rejections
    # (what the "flagged" user filter checks) stays consistent with reality.
    # `player` was loaded in a different session (the make_user fixture's),
    # so re-fetch it in *this* session before mutating -- otherwise the
    # increment is invisible to this session's flush/commit.
    from app.models.user import User as UserModel

    live_player = await session.get(UserModel, player.id)
    live_player.total_rejections += 1


async def test_dispute_detection_flags_repeatedly_rejected_player(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    admin = await make_user("+923008000019", role=UserRole.ADMIN)
    owner = await make_user("+923008000020", role=UserRole.OWNER)
    flagged_player = await make_user("+923008000021", role=UserRole.PLAYER)
    clean_player = await make_user("+923008000022", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        base = datetime.now(timezone.utc) - timedelta(days=5)
        for i in range(3):
            await _make_rejected_payment(session, court=court, player=flagged_player, when=base + timedelta(days=i))
        await session.commit()

    headers = await make_auth_headers(admin)
    resp = await client.get("/api/v1/admin/disputes", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    player_ids = {d["player_id"] for d in body}
    assert str(flagged_player.id) in player_ids
    assert str(clean_player.id) not in player_ids

    dispute = next(d for d in body if d["player_id"] == str(flagged_player.id))
    assert dispute["rejection_count"] == 3
    assert len(dispute["recent_rejections"]) == 3


async def test_dispute_detection_ignores_player_with_no_rejections(
    client, make_user, make_auth_headers
):
    admin = await make_user("+923008000023", role=UserRole.ADMIN)
    await make_user("+923008000024", role=UserRole.PLAYER)
    headers = await make_auth_headers(admin)

    resp = await client.get("/api/v1/admin/disputes", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def _make_expired_review_booking(session, *, court, player, when) -> None:
    booking = Booking(
        court_id=court.id,
        player_id=player.id,
        starts_at=when,
        ends_at=when + timedelta(hours=1),
        price=1000,
        advance_amount=1000,
        status=BookingStatus.CANCELLED,
        cancellation_reason="payment_review_expired",
    )
    session.add(booking)


async def test_admin_disputes_view_surfaces_passive_owner_inaction(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    """An owner who never opens the approvals screen produces zero explicit
    payment rejections, which the rejection-count dispute query alone
    can't see -- payment_review_expired cancellations are a separate,
    necessary signal. See finding #14 in AUDIT_FINDINGS.md."""
    admin = await make_user("+923008000040", role=UserRole.ADMIN)
    passive_owner = await make_user("+923008000041", role=UserRole.OWNER)
    active_owner = await make_user("+923008000042", role=UserRole.OWNER)
    player = await make_user("+923008000043", role=UserRole.PLAYER)
    passive_venue = await make_venue(passive_owner, name="Passive Venue")
    active_venue = await make_venue(active_owner, name="Active Venue")
    passive_court = await make_court(passive_venue)
    active_court = await make_court(active_venue)

    async with db_session_factory() as session:
        base = datetime.now(timezone.utc) - timedelta(days=5)
        for i in range(3):
            await _make_expired_review_booking(session, court=passive_court, player=player, when=base + timedelta(days=i))
        await session.commit()

    headers = await make_auth_headers(admin)

    # The passive owner has zero explicit rejections, so the rejection-count
    # dispute view alone doesn't see them.
    disputes = await client.get("/api/v1/admin/disputes", headers=headers)
    assert str(passive_venue.id) not in {d.get("venue_id") for d in disputes.json()}

    resp = await client.get("/api/v1/admin/disputes/passive-venues", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    venue_ids = {v["venue_id"] for v in body}
    assert str(passive_venue.id) in venue_ids
    assert str(active_venue.id) not in venue_ids

    flagged = next(v for v in body if v["venue_id"] == str(passive_venue.id))
    assert flagged["expired_review_count"] == 3
    assert flagged["owner_phone"] == passive_owner.phone


async def test_admin_users_search_and_flagged_filter(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    admin = await make_user("+923008000025", role=UserRole.ADMIN)
    owner = await make_user("+923008000026", role=UserRole.OWNER)
    flagged_player = await make_user("+923008000027", role=UserRole.PLAYER, name="Flagged Fahad")
    await make_user("+923008000028", role=UserRole.PLAYER, name="Clean Chris")
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        base = datetime.now(timezone.utc) - timedelta(days=5)
        for i in range(2):
            await _make_rejected_payment(session, court=court, player=flagged_player, when=base + timedelta(days=i))
        await session.commit()

    headers = await make_auth_headers(admin)
    flagged_resp = await client.get("/api/v1/admin/users", headers=headers, params={"flagged": "true"})
    resp_ids = {u["id"] for u in flagged_resp.json()}
    assert str(flagged_player.id) in resp_ids

    search_resp = await client.get("/api/v1/admin/users", headers=headers, params={"search": "fahad"})
    names = {u["name"] for u in search_resp.json()}
    assert "Flagged Fahad" in names
    assert "Clean Chris" not in names


async def test_admin_can_suspend_and_unsuspend_user(client, make_user, make_auth_headers):
    admin = await make_user("+923008000029", role=UserRole.ADMIN)
    player = await make_user("+923008000030", role=UserRole.PLAYER)
    admin_headers = await make_auth_headers(admin)
    player_headers = await make_auth_headers(player)

    suspend_resp = await client.post(
        f"/api/v1/admin/users/{player.id}/suspend",
        headers=admin_headers,
        json={"reason": "Repeated fraudulent payment screenshots"},
    )
    assert suspend_resp.status_code == 200
    assert suspend_resp.json()["is_active"] is False
    assert suspend_resp.json()["suspension_reason"] == "Repeated fraudulent payment screenshots"

    # The player's existing session is now rejected -- suspension takes effect immediately.
    blocked = await client.get("/api/v1/auth/me", headers=player_headers)
    assert blocked.status_code == 401

    unsuspend_resp = await client.post(f"/api/v1/admin/users/{player.id}/unsuspend", headers=admin_headers)
    assert unsuspend_resp.status_code == 200
    assert unsuspend_resp.json()["is_active"] is True
    assert unsuspend_resp.json()["suspension_reason"] is None


async def test_concurrent_suspend_calls_idempotent(client, make_user, make_auth_headers, db_session_factory):
    """VERIFY tier (finding #29): confirmed before this fix that two
    concurrent suspend calls, while never corrupting is_active (it's
    naturally idempotent -- setting it False twice is still just False),
    each wrote their own audit_log row for the same action. Not a
    correctness bug, but avoidable clutter for a compliance reviewer --
    AdminService.suspend_user/unsuspend_user now short-circuit as a no-op
    if the user is already in the target state, a best-effort guard (not
    the full atomic-transition pattern booking/payment state changes use,
    which isn't justified for how low-stakes a duplicate audit row is)."""
    import asyncio

    from app.models.audit import AuditLog
    from app.models.user import User
    from sqlalchemy import select

    admin = await make_user("+923008000031", role=UserRole.ADMIN)
    target = await make_user("+923008000032", role=UserRole.PLAYER)
    admin_headers = await make_auth_headers(admin)

    responses = await asyncio.gather(
        client.post(f"/api/v1/admin/users/{target.id}/suspend", headers=admin_headers, json={"reason": "abuse"}),
        client.post(f"/api/v1/admin/users/{target.id}/suspend", headers=admin_headers, json={"reason": "abuse"}),
        return_exceptions=True,
    )
    for resp in responses:
        assert not isinstance(resp, Exception), f"suspend raised {resp!r}"
        assert resp.status_code == 200

    async with db_session_factory() as session:
        refreshed = await session.get(User, target.id)
        assert refreshed.is_active is False

        rows = (
            await session.execute(
                select(AuditLog).where(AuditLog.entity_id == target.id, AuditLog.action == "user.suspended")
            )
        ).scalars().all()
        assert len(rows) == 1, f"expected exactly 1 audit row, got {len(rows)}"


async def test_admin_bookings_filter_by_status_and_venue(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    admin = await make_user("+923008000031", role=UserRole.ADMIN)
    owner = await make_user("+923008000032", role=UserRole.OWNER)
    customer = await make_user("+923008000033", role=UserRole.PLAYER)
    venue_a = await make_venue(owner, name="Venue A")
    venue_b = await make_venue(owner, name="Venue B")
    court_a = await make_court(venue_a)
    court_b = await make_court(venue_b)

    async with db_session_factory() as session:
        now = datetime.now(timezone.utc) + timedelta(days=1)
        session.add(
            Booking(
                court_id=court_a.id,
                player_id=customer.id,
                starts_at=now,
                ends_at=now + timedelta(hours=1),
                price=1000,
                status=BookingStatus.BOOKED,
            )
        )
        session.add(
            Booking(
                court_id=court_b.id,
                player_id=customer.id,
                starts_at=now,
                ends_at=now + timedelta(hours=1),
                price=1000,
                status=BookingStatus.HELD,
                held_until=now + timedelta(minutes=15),
            )
        )
        await session.commit()

    headers = await make_auth_headers(admin)
    by_venue = await client.get(
        "/api/v1/admin/bookings", headers=headers, params={"venue_id": str(venue_a.id)}
    )
    assert len(by_venue.json()) == 1
    assert by_venue.json()[0]["venue_name"] == "Venue A"

    by_status = await client.get("/api/v1/admin/bookings", headers=headers, params={"status": "held"})
    assert len(by_status.json()) == 1
    assert by_status.json()[0]["status"] == "held"
