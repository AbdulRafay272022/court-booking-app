import io
from datetime import date, datetime, timedelta, timezone

from PIL import Image

from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.user import User, UserRole
from app.services.ai.base import PaymentExtraction


def _future_starts_at(days_ahead: int = 1) -> str:
    target = date.today() + timedelta(days=days_ahead)
    return f"{target.isoformat()}T10:00:00+00:00"


def _sample_png_bytes(color=(120, 40, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=color).save(buf, format="PNG")
    return buf.getvalue()


async def _hold_booking(client, court, headers, days_ahead: int = 1) -> dict:
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at(days_ahead)},
    )
    return resp.json()["booking"]


async def _open_all_week(make_schedule, court) -> None:
    """create_hold requires starts_at to be grid-aligned to an active
    schedule_template -- open every day of week wide enough to cover
    10:00 regardless of which weekday `_future_starts_at` lands on."""
    from datetime import time

    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))


def _mock_upload(monkeypatch):
    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)


async def test_submit_payment_proof_and_approve_confirms_booking(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000001", role=UserRole.OWNER)
    customer = await make_user("+923005000002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)

    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.status_code == 201
    body = submit.json()
    assert body["payment"]["ocr_verdict"] == "unreadable"  # no ANTHROPIC_API_KEY configured
    assert body["booking"]["status"] == "payment_submitted"
    payment_id = body["payment"]["id"]

    approve = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers)
    assert approve.status_code == 200
    assert approve.json()["payment"]["review_verdict"] == "approved"
    assert approve.json()["booking"]["status"] == "booked"
    assert approve.json()["booking"]["amount_paid"] == 2000.0


async def test_reject_payment_cancels_booking_and_notifies_waitlist(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)

    # Slot-reopened is Tier 1 (push-only, see Section 8) -- capture pushes,
    # not WhatsApp sends, to confirm the waiter was notified.
    pushed = []

    async def fake_push(self, token, title, body):
        pushed.append(token)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923005000003", role=UserRole.OWNER)
    customer = await make_user("+923005000004", role=UserRole.PLAYER)
    waiter = await make_user("+923005000005", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)
    waiter_headers = await make_auth_headers(waiter)

    await client.post(
        "/api/v1/users/me/fcm-token", headers=waiter_headers, json={"token": "waiter-device-token"}
    )

    booking = await _hold_booking(client, court, customer_headers)

    await client.post(
        "/api/v1/waitlist",
        headers=waiter_headers,
        json={"court_id": str(court.id), "slot_starts_at": booking["starts_at"]},
    )

    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    payment_id = submit.json()["payment"]["id"]

    reject = await client.post(
        f"/api/v1/payments/{payment_id}/reject",
        headers=owner_headers,
        json={"reason": "Amount does not match"},
    )
    assert reject.status_code == 200
    assert reject.json()["payment"]["review_verdict"] == "rejected"
    # The booking is released entirely (not returned to "held") -- the slot
    # is free for anyone, including the original player, to hold again.
    assert reject.json()["booking"]["status"] == "cancelled"
    assert "waiter-device-token" in pushed


async def test_customer_cannot_approve_own_payment(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000006", role=UserRole.OWNER)
    customer = await make_user("+923005000007", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    payment_id = submit.json()["payment"]["id"]

    resp = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=customer_headers)
    assert resp.status_code == 403


async def test_duplicate_proof_hash_flagged_across_bookings(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000008", role=UserRole.OWNER)
    customer_a = await make_user("+923005000009", role=UserRole.PLAYER)
    customer_b = await make_user("+923005000010", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    headers_a = await make_auth_headers(customer_a)
    headers_b = await make_auth_headers(customer_b)

    booking_a = await _hold_booking(client, court, headers_a, days_ahead=1)
    same_image = _sample_png_bytes()

    await client.post(
        f"/api/v1/bookings/{booking_a['id']}/payment-proof",
        headers=headers_a,
        files={"image": ("proof.jpg", io.BytesIO(same_image), "image/jpeg")},
    )

    booking_b = await _hold_booking(client, court, headers_b, days_ahead=2)
    submit_b = await client.post(
        f"/api/v1/bookings/{booking_b['id']}/payment-proof",
        headers=headers_b,
        files={"image": ("proof.jpg", io.BytesIO(same_image), "image/jpeg")},
    )
    assert submit_b.json()["payment"]["is_duplicate"] is True


async def test_reused_ocr_ref_flagged_as_duplicate_even_with_different_image_hash(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """A "trusted" repeat player submitting a screenshot of someone else's
    real transfer -- a visually different image, so the perceptual hash
    never matches -- must still be caught via the reused OCR-extracted
    transaction reference. See finding #16 in AUDIT_FINDINGS.md."""
    _mock_upload(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=2000, reference="TXN-SHARED-REF", timestamp=None, confidence=0.9, raw_response={},
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000037", role=UserRole.OWNER)
    customer_a = await make_user("+923005000038", role=UserRole.PLAYER)
    customer_b = await make_user("+923005000039", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    headers_a = await make_auth_headers(customer_a)
    headers_b = await make_auth_headers(customer_b)

    booking_a = await _hold_booking(client, court, headers_a, days_ahead=1)
    submit_a = await client.post(
        f"/api/v1/bookings/{booking_a['id']}/payment-proof",
        headers=headers_a,
        files={"image": ("proof-a.jpg", io.BytesIO(_sample_png_bytes(color=(10, 20, 30))), "image/jpeg")},
    )
    assert submit_a.json()["payment"]["is_duplicate"] is False

    booking_b = await _hold_booking(client, court, headers_b, days_ahead=2)
    submit_b = await client.post(
        f"/api/v1/bookings/{booking_b['id']}/payment-proof",
        headers=headers_b,
        # A visually distinct image (different color/hash) but the same
        # OCR-extracted reference, via the fake_extract mock above.
        files={"image": ("proof-b.jpg", io.BytesIO(_sample_png_bytes(color=(230, 5, 180))), "image/jpeg")},
    )
    body_b = submit_b.json()["payment"]
    assert body_b["is_duplicate"] is True
    assert body_b["duplicate_of"] == submit_a.json()["payment"]["id"]


async def test_slightly_recompressed_duplicate_still_caught(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Perceptual hash, not exact byte match: re-saving the same image (as a
    JPEG instead of PNG, say) changes the bytes but not what it looks like."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000011", role=UserRole.OWNER)
    customer_a = await make_user("+923005000012", role=UserRole.PLAYER)
    customer_b = await make_user("+923005000013", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    headers_a = await make_auth_headers(customer_a)
    headers_b = await make_auth_headers(customer_b)

    booking_a = await _hold_booking(client, court, headers_a, days_ahead=1)
    original = Image.new("RGB", (64, 64), color=(200, 100, 50))
    png_buf = io.BytesIO()
    original.save(png_buf, format="PNG")

    await client.post(
        f"/api/v1/bookings/{booking_a['id']}/payment-proof",
        headers=headers_a,
        files={"image": ("proof.png", io.BytesIO(png_buf.getvalue()), "image/png")},
    )

    jpeg_buf = io.BytesIO()
    original.save(jpeg_buf, format="JPEG", quality=80)

    booking_b = await _hold_booking(client, court, headers_b, days_ahead=2)
    submit_b = await client.post(
        f"/api/v1/bookings/{booking_b['id']}/payment-proof",
        headers=headers_b,
        files={"image": ("proof.jpg", io.BytesIO(jpeg_buf.getvalue()), "image/jpeg")},
    )
    assert submit_b.json()["payment"]["is_duplicate"] is True


async def test_ocr_mismatch_verdict(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    _mock_upload(monkeypatch)

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=500, reference=None, timestamp=None,
            confidence=0.9, raw_response={},
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000014", role=UserRole.OWNER)
    customer = await make_user("+923005000015", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)  # advance = 3000, screenshot shows 500
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.json()["payment"]["ocr_verdict"] == "mismatch"
    assert submit.json()["payment"]["ocr_amount"] == 500


async def test_ocr_match_within_tolerance(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=2980, reference='TXN1', timestamp=None,
            confidence=0.9, raw_response={},
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000016", role=UserRole.OWNER)
    customer = await make_user("+923005000017", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.json()["payment"]["ocr_verdict"] == "match"


async def test_vision_provider_timeout_degrades_to_manual_review(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """A genuine vendor outage/timeout (not a malformed response -- the
    provider not responding usefully at all) must degrade to the same
    unreadable/manual-review path as an unconfigured provider, not 500 the
    player's payment submission -- see finding #7 in AUDIT_FINDINGS.md.
    Exercises the real retry-then-reraise path in app/services/ai/http.py,
    not just a direct provider-level mock."""
    import httpx

    _mock_upload(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    real_post = httpx.AsyncClient.post

    async def timing_out_post(self, url, headers=None, json=None, **kwargs):
        # Only the vision call should fail -- the test's own API client also
        # runs on an httpx.AsyncClient (over ASGITransport), so a blanket
        # patch here would break every other request this test makes.
        if url == "https://api.anthropic.com/v1/messages":
            raise httpx.TimeoutException("simulated vendor timeout")
        return await real_post(self, url, headers=headers, json=json, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", timing_out_post)

    owner = await make_user("+923005000030", role=UserRole.OWNER)
    customer = await make_user("+923005000031", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.status_code == 201, submit.text
    body = submit.json()
    assert body["payment"]["ocr_verdict"] == "unreadable"
    assert body["booking"]["status"] == "payment_submitted"


async def test_auto_approve_when_conditions_met(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch
):
    _mock_upload(monkeypatch)

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=3000, reference='TXN1', timestamp=None,
            confidence=0.95, raw_response={},
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000018", role=UserRole.OWNER)
    customer = await make_user("+923005000019", role=UserRole.PLAYER)
    venue = await make_venue(owner, auto_approve_enabled=True, auto_approve_min_bookings=5)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    # Give the player 5 prior BOOKED bookings at this venue.
    async with db_session_factory() as session:
        for i in range(5):
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=datetime.now(timezone.utc) - timedelta(days=i + 10),
                    ends_at=datetime.now(timezone.utc) - timedelta(days=i + 10) + timedelta(hours=1),
                    price=3000,
                    amount_paid=3000,
                    status=BookingStatus.COMPLETED,
                )
            )
        await session.commit()

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.json()["payment"]["auto_approved"] is True
    assert submit.json()["booking"]["status"] == "booked"


async def test_global_auto_approve_disabled_forces_manual_review(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch
):
    """The platform-wide kill switch (finding #21) overrides any venue's own
    auto_approve_enabled -- otherwise identical setup to
    test_auto_approve_when_conditions_met, which would normally
    auto-approve."""
    _mock_upload(monkeypatch)

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(settings, "GLOBAL_AUTO_APPROVE_ENABLED", False)

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=3000, reference='TXN1', timestamp=None,
            confidence=0.95, raw_response={},
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000033", role=UserRole.OWNER)
    customer = await make_user("+923005000034", role=UserRole.PLAYER)
    venue = await make_venue(owner, auto_approve_enabled=True, auto_approve_min_bookings=5)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    async with db_session_factory() as session:
        for i in range(5):
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=datetime.now(timezone.utc) - timedelta(days=i + 10),
                    ends_at=datetime.now(timezone.utc) - timedelta(days=i + 10) + timedelta(hours=1),
                    price=3000,
                    amount_paid=3000,
                    status=BookingStatus.COMPLETED,
                )
            )
        await session.commit()

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.json()["payment"]["auto_approved"] is False
    assert submit.json()["booking"]["status"] == "payment_submitted"


async def test_auto_approve_skipped_with_too_few_venue_bookings(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=3000, reference='TXN1', timestamp=None,
            confidence=0.95, raw_response={},
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000020", role=UserRole.OWNER)
    customer = await make_user("+923005000021", role=UserRole.PLAYER)
    venue = await make_venue(owner, auto_approve_enabled=True, auto_approve_min_bookings=5)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.json()["payment"]["auto_approved"] is False
    assert submit.json()["booking"]["status"] == "payment_submitted"


async def test_auto_approve_disabled_by_default(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=3000, reference='TXN1', timestamp=None,
            confidence=0.95, raw_response={},
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000022", role=UserRole.OWNER)
    customer = await make_user("+923005000023", role=UserRole.PLAYER)
    venue = await make_venue(owner)  # auto_approve_enabled defaults to False
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.json()["payment"]["auto_approved"] is False


async def test_proof_url_scoped_to_owning_venue(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _mock_upload(monkeypatch)
    owner_a = await make_user("+923005000024", role=UserRole.OWNER)
    owner_b = await make_user("+923005000025", role=UserRole.OWNER)
    customer = await make_user("+923005000026", role=UserRole.PLAYER)
    venue = await make_venue(owner_a)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    payment_id = submit.json()["payment"]["id"]

    owner_a_headers = await make_auth_headers(owner_a)
    ok = await client.get(f"/api/v1/payments/{payment_id}/proof-url", headers=owner_a_headers)
    assert ok.status_code == 200
    assert ok.json()["expires_in"] == 300

    owner_b_headers = await make_auth_headers(owner_b)
    forbidden = await client.get(f"/api/v1/payments/{payment_id}/proof-url", headers=owner_b_headers)
    assert forbidden.status_code == 403


async def test_rejection_increments_player_rejections_and_drops_reliability(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch
):
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000027", role=UserRole.OWNER)
    customer = await make_user("+923005000028", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    payment_id = submit.json()["payment"]["id"]

    await client.post(
        f"/api/v1/payments/{payment_id}/reject", headers=owner_headers, json={"reason": "no match"}
    )

    async with db_session_factory() as session:
        refreshed = await session.get(User, customer.id)
        assert refreshed.total_rejections == 1
        assert refreshed.reliability_score < 1.0


async def test_oversized_image_dimensions_rejected(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """A crafted file with a spoofed image/* Content-Type and a huge
    declared pixel dimension ("pixel bomb") must be rejected with a clean
    400, not silently stored and decoded later -- see finding #12 in
    AUDIT_FINDINGS.md. Uses a monkeypatched low ceiling against an
    ordinary small test image rather than allocating a real 40MP+ image."""
    _mock_upload(monkeypatch)
    monkeypatch.setattr("app.utils.image.MAX_IMAGE_PIXELS", 100)

    owner = await make_user("+923005000029", role=UserRole.OWNER)
    customer = await make_user("+923005000030", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},  # 32x32 = 1024px > 100px cap
    )
    assert submit.status_code == 400
    assert submit.json()["error"]["code"] == "INVALID_IMAGE_FORMAT"


async def test_player_cancel_of_paid_booking_creates_refund_record(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch
):
    """A player voluntarily cancelling an already-approved (paid) booking
    has the same underlying gap as the auto-expiry dispute (finding #5):
    nothing tracks that the venue owes them a refund. Reuses the same
    payment_disputes queue -- see finding #13 in AUDIT_FINDINGS.md."""
    from app.models.dispute import PaymentDispute
    from app.services.admin_service import AdminService

    _mock_upload(monkeypatch)
    owner = await make_user("+923005000035", role=UserRole.OWNER)
    customer = await make_user("+923005000036", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    payment_id = submit.json()["payment"]["id"]
    approve = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers)
    assert approve.json()["booking"]["status"] == "booked"

    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=customer_headers, json={"reason": "changed plans"}
    )
    assert cancel.status_code == 200
    assert cancel.json()["booking"]["status"] == "cancelled"

    async with db_session_factory() as session:
        from sqlalchemy import select

        result = await session.execute(
            select(PaymentDispute).where(PaymentDispute.booking_id == booking["id"])
        )
        disputes = result.scalars().all()
        assert len(disputes) == 1
        assert str(disputes[0].payment_id) == payment_id
        assert disputes[0].reason == "player_cancelled_paid_booking"

    async with db_session_factory() as session:
        queue = await AdminService(session, get_settings()).list_refund_queue()
        assert any(str(entry.booking_id) == booking["id"] for entry in queue)


async def _book_and_pay(client, court, owner_headers, customer_headers, days_ahead: int = 1) -> dict:
    """Shared setup for the cancellation-policy tests below: hold, submit proof, owner
    approves -- returns the now-`booked` booking dict."""
    booking = await _hold_booking(client, court, customer_headers, days_ahead=days_ahead)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    payment_id = submit.json()["payment"]["id"]
    approve = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers)
    assert approve.json()["booking"]["status"] == "booked"
    return booking


async def test_cancel_blocked_when_venue_disallows_cancellation(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Section 29 Part C: a court can opt out of player cancellation for a paid booking
    entirely, not just gate it behind a time window."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000040", role=UserRole.OWNER)
    customer = await make_user("+923005000041", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, cancellation_allowed=False)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_and_pay(client, court, owner_headers, customer_headers)

    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=customer_headers, json={"reason": "changed plans"}
    )
    assert cancel.status_code == 400
    assert cancel.json()["error"]["code"] == "CANCELLATION_NOT_ALLOWED"

    get = await client.get(f"/api/v1/bookings/{booking['id']}", headers=customer_headers)
    assert get.json()["status"] == "booked"


async def test_cancel_blocked_within_cutoff_window(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """A booking held for tomorrow 10:00 UTC is at most ~34h out (worst case: booked at
    00:01 today) -- a 48h cutoff always falls inside that window regardless of what time
    of day this test runs, so this is deterministic without freezing the clock."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000042", role=UserRole.OWNER)
    customer = await make_user("+923005000043", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, cancellation_allowed=True, cancellation_cutoff_hours=48)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_and_pay(client, court, owner_headers, customer_headers, days_ahead=1)

    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=customer_headers, json={"reason": "changed plans"}
    )
    assert cancel.status_code == 400
    assert cancel.json()["error"]["code"] == "CANCELLATION_WINDOW_CLOSED"
    assert cancel.json()["error"]["details"]["cutoff_hours"] == 48

    get = await client.get(f"/api/v1/bookings/{booking['id']}", headers=customer_headers)
    assert get.json()["status"] == "booked"


async def test_cancel_succeeds_outside_cutoff_window_and_creates_refund_record(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch
):
    """A booking held for tomorrow 10:00 UTC is at least ~10h out (worst case: booked at
    23:59 today) -- a 2h cutoff always falls outside that window, so this is deterministic
    without freezing the clock. Confirms a configured (non-null) cutoff doesn't itself
    block a cancel that's genuinely outside it, and that the existing refund-record path
    (Section 23 finding #13) still fires."""
    from sqlalchemy import select

    from app.models.dispute import PaymentDispute

    _mock_upload(monkeypatch)
    owner = await make_user("+923005000044", role=UserRole.OWNER)
    customer = await make_user("+923005000045", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, cancellation_allowed=True, cancellation_cutoff_hours=2)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_and_pay(client, court, owner_headers, customer_headers, days_ahead=1)

    cancel = await client.post(
        f"/api/v1/bookings/{booking['id']}/cancel", headers=customer_headers, json={"reason": "changed plans"}
    )
    assert cancel.status_code == 200
    assert cancel.json()["booking"]["status"] == "cancelled"

    async with db_session_factory() as session:
        result = await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking["id"]))
        disputes = result.scalars().all()
        assert len(disputes) == 1
        assert disputes[0].reason == "player_cancelled_paid_booking"


async def test_two_courts_at_one_venue_enforce_cancellation_independently(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Section 31: the policy lives on the court, so two courts at the SAME venue can differ.
    Court A forbids cancelling a paid booking; Court B allows it. Each booking is judged by
    its own court's rule, never the venue's or a sibling court's."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000047", role=UserRole.OWNER)
    player_a = await make_user("+923005000048", role=UserRole.PLAYER)
    player_b = await make_user("+923005000049", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court_a = await make_court(venue, name="Court A", cancellation_allowed=False)
    court_b = await make_court(venue, name="Court B", cancellation_allowed=True, cancellation_cutoff_hours=None)
    for court in (court_a, court_b):
        await _open_all_week(make_schedule, court)
        await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    headers_a = await make_auth_headers(player_a)
    headers_b = await make_auth_headers(player_b)

    booking_a = await _book_and_pay(client, court_a, owner_headers, headers_a)
    booking_b = await _book_and_pay(client, court_b, owner_headers, headers_b)

    blocked = await client.post(f"/api/v1/bookings/{booking_a['id']}/cancel", headers=headers_a, json={})
    assert blocked.status_code == 400
    assert blocked.json()["error"]["code"] == "CANCELLATION_NOT_ALLOWED"

    allowed = await client.post(f"/api/v1/bookings/{booking_b['id']}/cancel", headers=headers_b, json={})
    assert allowed.status_code == 200
    assert allowed.json()["booking"]["status"] == "cancelled"

    # Court A's booking is untouched by Court B's cancellation.
    still_booked = await client.get(f"/api/v1/bookings/{booking_a['id']}", headers=headers_a)
    assert still_booked.json()["status"] == "booked"


async def test_patching_one_courts_policy_leaves_sibling_court_alone(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """The post-setup Venue Settings screen edits ONE court via PATCH /courts/{id}. Changing
    Court A's policy (including clearing a cutoff back to null) must not move Court B's."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000050", role=UserRole.OWNER)
    player = await make_user("+923005000051", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court_a = await make_court(venue, name="Court A", cancellation_allowed=False)
    court_b = await make_court(venue, name="Court B", cancellation_allowed=True, cancellation_cutoff_hours=48)
    for court in (court_a, court_b):
        await _open_all_week(make_schedule, court)
        await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    player_headers = await make_auth_headers(player)

    patch_a = await client.patch(
        f"/api/v1/courts/{court_a.id}",
        headers=owner_headers,
        json={"cancellation_allowed": True, "cancellation_cutoff_hours": None},
    )
    assert patch_a.status_code == 200
    assert patch_a.json()["cancellation_allowed"] is True
    assert patch_a.json()["cancellation_cutoff_hours"] is None

    # Sibling court kept its own policy.
    get_b = await client.get(f"/api/v1/courts/{court_b.id}")
    assert get_b.json()["cancellation_allowed"] is True
    assert get_b.json()["cancellation_cutoff_hours"] == 48

    # And the new rule is what's actually enforced on Court A now.
    booking_a = await _book_and_pay(client, court_a, owner_headers, player_headers)
    cancel = await client.post(f"/api/v1/bookings/{booking_a['id']}/cancel", headers=player_headers, json={})
    assert cancel.status_code == 200


async def test_existing_courts_default_to_unrestricted_cancellation(db_session_factory, make_user, make_venue):
    """Directly exercises the migration's SERVER default (not the ORM's Python-side
    default) by inserting a raw courts row through Core with cancellation_allowed and
    cancellation_cutoff_hours both omitted -- this is what happened to every already-
    existing court when `19cf7e553535_add_court_cancellation_policy_fields` ran against
    production: the ADD COLUMN's server_default backfills every pre-existing row, not
    just new ones the ORM inserts. Confirms that backfill preserves today's de facto
    unrestricted behavior rather than silently locking out cancellation everywhere."""
    import uuid

    from sqlalchemy import insert

    from app.models.court import Court

    owner = await make_user("+923005000046", role=UserRole.OWNER)
    venue = await make_venue(owner)

    async with db_session_factory() as session:
        court_id = uuid.uuid4()
        await session.execute(
            insert(Court.__table__).values(id=court_id, venue_id=venue.id, name="Legacy Court", sport="padel")
        )
        await session.commit()
        court = await session.get(Court, court_id)
        assert court.cancellation_allowed is True
        assert court.cancellation_cutoff_hours is None


async def test_undecodable_file_with_spoofed_content_type_rejected(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Client-supplied Content-Type alone is not proof the bytes are a real
    image -- garbage bytes labeled image/jpeg must be rejected, not stored
    to S3 and only fail later (or silently succeed) when something finally
    tries to decode them."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000031", role=UserRole.OWNER)
    customer = await make_user("+923005000032", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(b"not a real image, just garbage bytes"), "image/jpeg")},
    )
    assert submit.status_code == 400
    assert submit.json()["error"]["code"] == "INVALID_IMAGE_FORMAT"
