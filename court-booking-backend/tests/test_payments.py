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

    async def fake_push(self, token, title, body, data=None):
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
    """Section 32 Part 7 made auto-approve additionally require the name and
    time checks to genuinely pass (and the receiver check to match or have
    nothing configured) -- this test's fake extraction now supplies a
    matching payer_name and an in-window timestamp so the "everything lines
    up" case still auto-approves. See test_auto_approve_blocked_by_name_mismatch
    /_time_check_outside_timer below for the new blocking cases."""
    _mock_upload(monkeypatch)

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=3000, reference='TXN1', timestamp=datetime.now(timezone.utc).isoformat(),
            confidence=0.95, raw_response={}, payer_name="Ali Raza",
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000018", role=UserRole.OWNER)
    customer = await make_user("+923005000019", role=UserRole.PLAYER, name="Ali Raza")
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


async def test_auto_approve_blocked_by_name_mismatch(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch
):
    """Section 32 Part 7: auto-approve now requires the name check to
    genuinely match -- otherwise identical setup to
    test_auto_approve_when_conditions_met, but the screenshot's payer name
    doesn't match the player's account name, so it must fall through to
    manual review (payment_submitted), never an auto-reject."""
    _mock_upload(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=3000, reference='TXN1', timestamp=datetime.now(timezone.utc).isoformat(),
            confidence=0.95, raw_response={}, payer_name="Someone Else Entirely",
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000060", role=UserRole.OWNER)
    customer = await make_user("+923005000061", role=UserRole.PLAYER, name="Ali Raza")
    venue = await make_venue(owner, auto_approve_enabled=True, auto_approve_min_bookings=5)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    async with db_session_factory() as session:
        for i in range(5):
            session.add(
                Booking(
                    court_id=court.id, player_id=customer.id,
                    starts_at=datetime.now(timezone.utc) - timedelta(days=i + 10),
                    ends_at=datetime.now(timezone.utc) - timedelta(days=i + 10) + timedelta(hours=1),
                    price=3000, amount_paid=3000, status=BookingStatus.COMPLETED,
                )
            )
        await session.commit()

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    body = submit.json()
    assert body["payment"]["auto_approved"] is False
    assert body["payment"]["name_match_verdict"] == "mismatch"
    assert body["booking"]["status"] == "payment_submitted"


async def test_auto_approve_blocked_by_time_check_outside_timer(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch
):
    """Same as above but for the time check: a screenshot timestamped well
    after the 15-minute hold timer ended must block auto-approve, but still
    only route to manual review, never a 500 or an auto-reject."""
    _mock_upload(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        # held_until is ~BOOKING_HOLD_MINUTES (15) after the hold was just
        # created "now" -- a timestamp 2 hours in the FUTURE relative to
        # that is safely past held_until + the 2-minute tolerance, i.e.
        # genuinely "after_timer" (paid after the timer ended). A timestamp
        # in the past relative to "now" would instead be before_hold (paid
        # before the hold even existed) -- a different case, covered above.
        too_late = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        return PaymentExtraction(
            amount=3000, reference='TXN1', timestamp=too_late,
            confidence=0.95, raw_response={}, payer_name="Ali Raza",
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000062", role=UserRole.OWNER)
    customer = await make_user("+923005000063", role=UserRole.PLAYER, name="Ali Raza")
    venue = await make_venue(owner, auto_approve_enabled=True, auto_approve_min_bookings=5)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    customer_headers = await make_auth_headers(customer)

    async with db_session_factory() as session:
        for i in range(5):
            session.add(
                Booking(
                    court_id=court.id, player_id=customer.id,
                    starts_at=datetime.now(timezone.utc) - timedelta(days=i + 10),
                    ends_at=datetime.now(timezone.utc) - timedelta(days=i + 10) + timedelta(hours=1),
                    price=3000, amount_paid=3000, status=BookingStatus.COMPLETED,
                )
            )
        await session.commit()

    booking = await _hold_booking(client, court, customer_headers)
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    body = submit.json()
    assert body["payment"]["auto_approved"] is False
    assert body["payment"]["time_check_verdict"] == "after_timer"
    assert body["booking"]["status"] == "payment_submitted"


async def test_pending_approvals_includes_the_five_plain_language_checks(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """The owner's approval-card data (Section 32 Part 7) -- confirm
    GET /owners/pending-approvals actually returns the `checks` object with
    ready-made sentences, not just the raw OCR fields."""
    _mock_upload(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        return PaymentExtraction(
            amount=500, reference="TXN1", timestamp=datetime.now(timezone.utc).isoformat(),
            confidence=0.9, raw_response={}, payer_name="Someone Else", bank_name="Easypaisa",
        )

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)

    owner = await make_user("+923005000064", role=UserRole.OWNER, name="Owner Person")
    customer = await make_user("+923005000065", role=UserRole.PLAYER, name="Ali Raza")
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)  # advance 3000, screenshot shows 500 -> mismatch
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _hold_booking(client, court, customer_headers)
    await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )

    resp = await client.get("/api/v1/owners/pending-approvals", headers=owner_headers)
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    checks = rows[0]["checks"]
    assert checks["name"]["verdict"] == "mismatch"
    assert "Someone Else" in checks["name"]["text"] and "Ali Raza" in checks["name"]["text"]
    assert checks["amount"]["verdict"] == "mismatch"
    assert "less than expected" in checks["amount"]["text"]
    assert checks["balance_text"].startswith("Total PKR 3,000.")
    assert checks["time"]["verdict"] == "match"
    assert checks["bank"]["text"].startswith("Paid via Easypaisa")
    assert checks["duplicate"]["verdict"] == "match"


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
    """Section 29 Part C, moved to the VENUE in Section 32 Part 4: a venue can opt out of player
    cancellation for a paid booking entirely, not just gate it behind a time window."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000040", role=UserRole.OWNER)
    customer = await make_user("+923005000041", role=UserRole.PLAYER)
    venue = await make_venue(owner, cancellation_allowed=False)
    court = await make_court(venue)
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
    venue = await make_venue(owner, cancellation_allowed=True, cancellation_cutoff_hours=48)
    court = await make_court(venue)
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
    # the message a player reads must be human time, not an ISO/UTC string
    message = cancel.json()["error"]["message"]
    assert "+00:00" not in message and not __import__("re").search(r"\d{4}-\d{2}-\d{2}", message), message

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
    venue = await make_venue(owner, cancellation_allowed=True, cancellation_cutoff_hours=2)
    court = await make_court(venue)
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


async def test_payment_approval_survives_a_failed_whatsapp_notification(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Same failure mode as venue approval (see test_admin): the approval commits, then the
    player's WhatsApp confirmation fails. The owner must still get a 200 and a `booked` booking,
    not a 500 for an action that actually succeeded."""
    _mock_upload(monkeypatch)

    async def failing_send(self, payload):
        raise RuntimeError("(#132001) Template name does not exist in the translation")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", failing_send)

    owner = await make_user("+923005000052", role=UserRole.OWNER)
    customer = await make_user("+923005000053", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    booking = await _book_and_pay(client, court, owner_headers, customer_headers)  # asserts approve -> booked

    got = await client.get(f"/api/v1/bookings/{booking['id']}", headers=customer_headers)
    assert got.json()["status"] == "booked"


async def test_two_courts_at_one_venue_share_one_cancellation_policy(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Section 32 Part 4 REVERSES Section 31: the policy lives on the VENUE, so both courts obey it
    (Section 31's test here pinned two courts differing). The venue forbids cancelling a paid booking,
    so a paid booking on either court is refused."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000047", role=UserRole.OWNER)
    player_a = await make_user("+923005000048", role=UserRole.PLAYER)
    player_b = await make_user("+923005000049", role=UserRole.PLAYER)
    venue = await make_venue(owner, cancellation_allowed=False)
    court_a = await make_court(venue, name="Court A")
    court_b = await make_court(venue, name="Court B")
    for court in (court_a, court_b):
        await _open_all_week(make_schedule, court)
        await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    headers_a = await make_auth_headers(player_a)
    headers_b = await make_auth_headers(player_b)

    booking_a = await _book_and_pay(client, court_a, owner_headers, headers_a)
    booking_b = await _book_and_pay(client, court_b, owner_headers, headers_b)

    for booking, headers in ((booking_a, headers_a), (booking_b, headers_b)):
        blocked = await client.post(f"/api/v1/bookings/{booking['id']}/cancel", headers=headers, json={})
        assert blocked.status_code == 400
        assert blocked.json()["error"]["code"] == "CANCELLATION_NOT_ALLOWED"
        still_booked = await client.get(f"/api/v1/bookings/{booking['id']}", headers=headers)
        assert still_booked.json()["status"] == "booked"


async def test_patching_the_venue_policy_moves_every_court_and_a_court_cannot_override_it(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Venue Settings edits ONE policy via PATCH /venues/{id}; it applies to every court. A client that
    still sends the old per-court fields to PATCH /courts/{id} (an app build from before Section 32 Part 4)
    has them ignored -- nothing writes the deprecated court columns, so there is never a second source of
    truth. The court responses still MIRROR the venue's policy for those old builds."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923005000050", role=UserRole.OWNER)
    player = await make_user("+923005000051", role=UserRole.PLAYER)
    venue = await make_venue(owner, cancellation_allowed=False)
    court_a = await make_court(venue, name="Court A")
    court_b = await make_court(venue, name="Court B")
    for court in (court_a, court_b):
        await _open_all_week(make_schedule, court)
        await make_pricing_rule(court, price_per_slot=2000)
    owner_headers = await make_auth_headers(owner)
    player_headers = await make_auth_headers(player)

    # an old client trying to set a per-court policy is ignored
    stale = await client.patch(
        f"/api/v1/courts/{court_a.id}", headers=owner_headers, json={"cancellation_allowed": True, "name": "Court A2"}
    )
    assert stale.status_code == 200
    assert stale.json()["name"] == "Court A2"
    assert stale.json()["cancellation_allowed"] is False  # the mirror shows the VENUE's policy
    venue_now = await client.get(f"/api/v1/venues/by-slug/{venue.slug}")
    assert venue_now.json()["cancellation_allowed"] is False

    # the venue-level PATCH is the one control, and it moves both courts
    patch = await client.patch(
        f"/api/v1/venues/{venue.id}",
        headers=owner_headers,
        json={"cancellation_allowed": True, "cancellation_cutoff_hours": 6},
    )
    assert patch.status_code == 200
    assert patch.json()["cancellation_allowed"] is True
    assert patch.json()["cancellation_cutoff_hours"] == 6
    for court in (court_a, court_b):
        got = await client.get(f"/api/v1/courts/{court.id}")
        assert got.json()["cancellation_allowed"] is True
        assert got.json()["cancellation_cutoff_hours"] == 6

    # and it is what is actually enforced
    booking = await _book_and_pay(client, court_b, owner_headers, player_headers)
    cancel = await client.post(f"/api/v1/bookings/{booking['id']}/cancel", headers=player_headers, json={})
    assert cancel.status_code == 200

    # switching cancelling off clears the cutoff (it means nothing then)
    off = await client.patch(
        f"/api/v1/venues/{venue.id}", headers=owner_headers, json={"cancellation_allowed": False}
    )
    assert off.json()["cancellation_allowed"] is False
    assert off.json()["cancellation_cutoff_hours"] is None


async def test_existing_venues_default_to_unrestricted_cancellation(db_session_factory, make_user):
    """Directly exercises the migration's SERVER default (not the ORM's Python-side default) by inserting
    a raw venues row through Core with the two cancellation columns omitted -- what the ADD COLUMN does
    for every pre-existing venue. Confirms it preserves today's unrestricted behaviour."""
    import uuid

    from sqlalchemy import insert

    from app.models.venue import Venue

    owner = await make_user("+923005000046", role=UserRole.OWNER)
    async with db_session_factory() as session:
        venue_id = uuid.uuid4()
        await session.execute(
            insert(Venue.__table__).values(
                id=venue_id, owner_id=owner.id, name="Legacy", slug=f"legacy-{venue_id.hex[:6]}",
                address="x", city="Karachi", location="SRID=4326;POINT(67.0 24.8)", sports=["padel"],
            )
        )
        await session.commit()
        venue = await session.get(Venue, venue_id)
        assert venue.cancellation_allowed is True
        assert venue.cancellation_cutoff_hours is None


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
