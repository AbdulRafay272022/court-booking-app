import hashlib
import hmac
import io
import json as json_module
from datetime import date, time, timedelta

from PIL import Image
from sqlalchemy import select

from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.message import Message
from app.models.user import User, UserRole


def _text_payload(phone_digits: str, message_id: str, text: str) -> dict:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {"from": phone_digits, "id": message_id, "type": "text", "text": {"body": text}}
                            ]
                        }
                    }
                ]
            }
        ]
    }


def _image_payload(phone_digits: str, message_id: str, image_id: str) -> dict:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": phone_digits,
                                    "id": message_id,
                                    "type": "image",
                                    "image": {"id": image_id, "mime_type": "image/jpeg"},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }


def _button_payload(phone_digits: str, message_id: str, button_id: str) -> dict:
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": phone_digits,
                                    "id": message_id,
                                    "type": "interactive",
                                    "interactive": {"button_reply": {"id": button_id, "title": "Yes"}},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }


def _mock_whatsapp_send(monkeypatch):
    sent = []

    async def fake_send_text(self, to, body):
        sent.append({"to": to, "body": body})
        return {"messages": [{"id": f"wamid.reply.{len(sent)}"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)
    return sent


async def test_webhook_rejects_missing_signature(client, db_session, monkeypatch):
    """No X-Hub-Signature-256 header at all, with a real app secret
    configured (i.e. production-like), must be refused -- see finding #1 in
    AUDIT_FINDINGS.md."""
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_APP_SECRET", "test-app-secret")
    monkeypatch.setattr(settings, "DEBUG", False)

    resp = await client.post(
        "/api/v1/webhooks/whatsapp", json=_text_payload("923020000099", "wamid.sig.1", "hi")
    )
    assert resp.status_code == 403


async def test_webhook_rejects_invalid_signature(client, db_session, monkeypatch):
    """A signature header that doesn't match the body's real HMAC (a forged
    payload claiming to be from any phone number) must be refused."""
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_APP_SECRET", "test-app-secret")
    monkeypatch.setattr(settings, "DEBUG", False)

    resp = await client.post(
        "/api/v1/webhooks/whatsapp",
        json=_text_payload("923020000098", "wamid.sig.2", "hi"),
        headers={"X-Hub-Signature-256": "sha256=" + "0" * 64},
    )
    assert resp.status_code == 403


async def test_webhook_accepts_valid_signature(client, db_session, monkeypatch):
    """A real HMAC-SHA256 of the exact raw body, keyed with the configured
    app secret, must be accepted and processed normally."""
    sent = _mock_whatsapp_send(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_APP_SECRET", "test-app-secret")
    monkeypatch.setattr(settings, "DEBUG", False)

    body = json_module.dumps(_text_payload("923020000097", "wamid.sig.3", "hi")).encode()
    signature = hmac.new(b"test-app-secret", body, hashlib.sha256).hexdigest()

    resp = await client.post(
        "/api/v1/webhooks/whatsapp",
        content=body,
        headers={"Content-Type": "application/json", "X-Hub-Signature-256": f"sha256={signature}"},
    )
    assert resp.status_code == 200
    assert len(sent) == 1

    user = await db_session.scalar(select(User).where(User.phone == "+923020000097"))
    assert user is not None


async def test_incoming_text_creates_guest_user_and_replies(client, db_session, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)

    resp = await client.post(
        "/api/v1/webhooks/whatsapp",
        json=_text_payload("923020000001", "wamid.1", "I want to book a padel court tomorrow at 5pm"),
    )
    assert resp.status_code == 200

    user = await db_session.scalar(select(User).where(User.phone == "+923020000001"))
    assert user is not None
    assert user.role == UserRole.PLAYER

    assert len(sent) == 1
    assert sent[0]["to"] == "+923020000001"

    messages = (
        await db_session.execute(select(Message).where(Message.sender_id == user.id).order_by(Message.created_at))
    ).scalars().all()
    assert len(messages) == 2
    assert messages[0].sender_type == "player"
    assert messages[0].content == "I want to book a padel court tomorrow at 5pm"
    assert messages[1].sender_type == "ai"


async def test_deduplication_same_message_id_processed_once(client, db_session, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    payload = _text_payload("923020000002", "wamid.dup-1", "hello")

    first = await client.post("/api/v1/webhooks/whatsapp", json=payload)
    second = await client.post("/api/v1/webhooks/whatsapp", json=payload)
    assert first.status_code == 200
    assert second.status_code == 200

    # Only one reply should have gone out -- the second delivery of the same
    # whatsapp_msg_id is recognized as a duplicate and skipped entirely.
    assert len(sent) == 1

    user = await db_session.scalar(select(User).where(User.phone == "+923020000002"))
    inbound = (
        await db_session.execute(
            select(Message).where(Message.sender_id == user.id, Message.sender_type == "player")
        )
    ).scalars().all()
    assert len(inbound) == 1


async def test_incoming_image_without_held_booking(client, db_session, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)

    resp = await client.post(
        "/api/v1/webhooks/whatsapp", json=_image_payload("923020000003", "wamid.img-1", "media-1")
    )
    assert resp.status_code == 200
    assert "pending booking" in sent[0]["body"].lower() or "hold a slot" in sent[0]["body"].lower()


async def test_incoming_image_submits_payment_for_held_booking(
    client, db_session, db_session_factory, make_user, make_venue, make_court, make_pricing_rule, monkeypatch
):
    sent = _mock_whatsapp_send(monkeypatch)

    async def fake_download_media(self, media_id):
        buf = io.BytesIO()
        Image.new("RGB", (32, 32), color=(10, 20, 30)).save(buf, format="PNG")
        return buf.getvalue(), "image/jpeg"

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.download_media", fake_download_media)

    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)

    owner = await make_user("+923020000004", role=UserRole.OWNER)
    guest_phone = "+923020000005"
    venue = await make_venue(owner)
    court = await make_court(venue)
    await make_pricing_rule(court, price_per_slot=2000)

    async with db_session_factory() as session:
        guest = User(phone=guest_phone, role=UserRole.PLAYER)
        session.add(guest)
        await session.flush()
        booking = Booking(
            court_id=court.id,
            player_id=guest.id,
            starts_at=None,
            ends_at=None,
            price=2000,
            advance_amount=2000,
            status=BookingStatus.HELD,
        )
        # starts_at/ends_at are required -- fill with a real future slot.
        from datetime import datetime, timezone

        starts = datetime.now(timezone.utc) + timedelta(days=1)
        booking.starts_at = starts
        booking.ends_at = starts + timedelta(hours=1)
        session.add(booking)
        await session.commit()

    resp = await client.post(
        "/api/v1/webhooks/whatsapp", json=_image_payload("923020000005", "wamid.img-2", "media-2")
    )
    assert resp.status_code == 200

    async with db_session_factory() as session:
        from app.models.payment import Payment

        payment_result = await session.execute(select(Payment).where(Payment.booking_id == booking.id))
        payment = payment_result.scalar_one()
        assert payment.proof_key == "payment-proofs/fake.jpg"

        refreshed_booking = await session.get(Booking, booking.id)
        assert refreshed_booking.status == BookingStatus.PAYMENT_SUBMITTED

    assert "thanks" in sent[0]["body"].lower()


async def test_button_reply_confirms_booking(
    client,
    db_session,
    db_session_factory,
    make_user,
    make_venue,
    make_court,
    make_schedule,
    make_pricing_rule,
    monkeypatch,
):
    sent = _mock_whatsapp_send(monkeypatch)

    owner = await make_user("+923020000006", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1500)

    starts_at = target.isoformat() + "T10:00:00+00:00"
    button_id = f"confirm:{court.id}:{starts_at}"

    resp = await client.post(
        "/api/v1/webhooks/whatsapp", json=_button_payload("923020000007", "wamid.btn-1", button_id)
    )
    assert resp.status_code == 200

    user = await db_session.scalar(select(User).where(User.phone == "+923020000007"))
    booking = await db_session.scalar(select(Booking).where(Booking.player_id == user.id))
    assert booking is not None
    assert booking.status == BookingStatus.HELD
    assert "held" in sent[0]["body"].lower()


async def test_button_decline_does_not_create_booking(client, db_session, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)

    resp = await client.post(
        "/api/v1/webhooks/whatsapp", json=_button_payload("923020000008", "wamid.btn-2", "decline")
    )
    assert resp.status_code == 200

    user = await db_session.scalar(select(User).where(User.phone == "+923020000008"))
    booking = await db_session.scalar(select(Booking).where(Booking.player_id == user.id))
    assert booking is None
    assert "no problem" in sent[0]["body"].lower()


async def test_whatsapp_created_booking_visible_via_app_api(
    client,
    db_session,
    make_user,
    make_venue,
    make_court,
    make_schedule,
    make_pricing_rule,
    make_auth_headers,
    monkeypatch,
):
    _mock_whatsapp_send(monkeypatch)

    owner = await make_user("+923020000009", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)

    starts_at = target.isoformat() + "T11:00:00+00:00"
    button_id = f"confirm:{court.id}:{starts_at}"
    await client.post(
        "/api/v1/webhooks/whatsapp", json=_button_payload("923020000010", "wamid.btn-3", button_id)
    )

    guest = await db_session.scalar(select(User).where(User.phone == "+923020000010"))
    headers = await make_auth_headers(guest)

    listing = await client.get("/api/v1/bookings/mine", headers=headers)
    assert listing.status_code == 200
    assert len(listing.json()) == 1
    assert listing.json()[0]["court_id"] == str(court.id)


async def test_status_callback_is_logged_and_creates_no_user_or_message(client, db_session, monkeypatch):
    """A `statuses` callback (delivery outcome of a message we sent) used to
    be silently ignored. It must now be logged -- a `failed` one at warning
    level with Meta's error code -- while still creating no user/message and
    still answering 200 so Meta doesn't retry."""
    from structlog.testing import capture_logs

    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "statuses": [
                                {
                                    "id": "wamid.OTPFAIL",
                                    "status": "failed",
                                    "recipient_id": "923118366981",
                                    "errors": [{"code": 131047, "title": "Re-engagement message"}],
                                },
                                {"id": "wamid.OTPOK", "status": "delivered", "recipient_id": "923118366981"},
                            ]
                        }
                    }
                ]
            }
        ]
    }
    with capture_logs() as logs:
        resp = await client.post("/api/v1/webhooks/whatsapp", json=payload)
    assert resp.status_code == 200

    by_wamid = {e["wamid"]: e for e in logs if e["event"] == "whatsapp.status"}
    assert by_wamid["wamid.OTPFAIL"]["log_level"] == "warning"
    assert by_wamid["wamid.OTPFAIL"]["errors"][0]["code"] == 131047
    assert by_wamid["wamid.OTPFAIL"]["to"] == "***6981"
    assert by_wamid["wamid.OTPOK"]["log_level"] == "info"

    assert await db_session.scalar(select(User).where(User.phone == "+923118366981")) is None
    assert (await db_session.execute(select(Message))).scalars().all() == []
