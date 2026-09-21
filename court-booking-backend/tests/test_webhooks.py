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

# --- typed "yes" after an assistant proposal (production chat 2026-09-20) --------------------------
#
# The assistant's Yes/No buttons were stored in the message metadata but never SENT (the handler only
# sent the reply text), so a player saw "Kya aap ... confirm karna chahte hain?" and typed "Yesss".
# Chat history is plain text, so the model had no idea WHICH slot was proposed: it re-asked, with a
# different date each time, and finally told the player to click a button that did not exist.


def test_plain_affirmative_detection():
    from app.api.webhooks import _is_plain_affirmative as yes

    for text in ("Yes", "Yesss", "yess!", "Haan bhai yes book kardo", "Haaan bhai book kardo", "ok", "Okay", "ji", "han", "book kar do", "confirm"):
        assert yes(text), text
    # Anything that adds information, or disagrees, is NOT a bare yes and must reach the assistant.
    for text in ("No", "nahi", "yes but 9pm", "haan 22 September", "book 10 to 11:30 raat", "", "   ", "what is the price?", "yes, and what about tomorrow at 8?"):
        assert not yes(text), text


async def _seed_proposal(db_session_factory, user, court, starts_at, *, age_minutes=0):
    from datetime import datetime, timezone

    async with db_session_factory() as session:
        session.add(
            Message(
                sender_id=user.id,
                sender_type="ai",
                channel="whatsapp",
                content="Kya aap booking confirm karna chahte hain?",
                message_type="text",
                created_at=datetime.now(timezone.utc) - timedelta(minutes=age_minutes),
                meta={
                    "actions": [
                        {"type": "confirm_booking", "label": "Yes, book it", "data": {"court_id": str(court.id), "starts_at": starts_at}},
                        {"type": "decline", "label": "No, thanks", "data": {}},
                    ]
                },
            )
        )
        await session.commit()


async def _proposal_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone):
    from app.utils.encryption import encrypt_json

    owner = await make_user("+923020000030", role=UserRole.OWNER)
    player = await make_user(phone, role=UserRole.PLAYER)
    bank = encrypt_json({"bank": "HBL", "account_title": "Maidan Court", "account_number": "1234567890"}, get_settings())
    venue = await make_venue(owner, name="Maidan Court", bank_details=bank)
    court = await make_court(venue, slot_minutes=90)
    target = date.today() + timedelta(days=2)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3500)
    starts_at = target.isoformat() + "T16:00:00+00:00"  # 21:00 PKT
    return player, court, starts_at


async def test_typed_yes_books_the_slot_that_was_proposed_without_asking_the_ai_again(
    client, db_session, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    sent = _mock_whatsapp_send(monkeypatch)

    async def must_not_be_called(self, **kwargs):
        raise AssertionError("a plain 'yes' to a pending proposal must not go back to the model")

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.process_message", must_not_be_called)

    player, court, starts_at = await _proposal_setup(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923020000031"
    )
    await _seed_proposal(db_session_factory, player, court, starts_at)

    resp = await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923020000031", "wamid.yes-1", "Haan bhai yes book kardo"))
    assert resp.status_code == 200

    booking = await db_session.scalar(select(Booking).where(Booking.player_id == player.id))
    assert booking is not None and booking.status == BookingStatus.HELD
    assert booking.court_id == court.id
    body = sent[-1]["body"]
    assert body.startswith("Held!")
    assert "9:00 PM to 10:30 PM" in body and "UTC" not in body  # Pakistan time, never UTC
    assert "HBL" in body and "1234567890" in body  # says WHERE to pay


async def test_typed_yes_with_extra_information_still_goes_to_the_assistant(
    client, db_session, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    sent = _mock_whatsapp_send(monkeypatch)
    calls = []

    async def fake_process(self, *, user, message, history=None):
        from app.services.ai_chat_service import ChatResult

        calls.append(message)
        return ChatResult(reply="Sure, let me check 9pm.")

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.process_message", fake_process)
    player, court, starts_at = await _proposal_setup(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923020000032"
    )
    await _seed_proposal(db_session_factory, player, court, starts_at)

    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923020000032", "wamid.yes-2", "yes but 9pm"))

    assert calls == ["yes but 9pm"]
    assert await db_session.scalar(select(Booking).where(Booking.player_id == player.id)) is None
    assert sent[-1]["body"] == "Sure, let me check 9pm."


async def test_typed_yes_without_a_pending_proposal_or_after_it_went_stale_is_not_a_booking(
    client, db_session, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    _mock_whatsapp_send(monkeypatch)
    calls = []

    async def fake_process(self, *, user, message, history=None):
        from app.services.ai_chat_service import ChatResult

        calls.append(message)
        return ChatResult(reply="What would you like to book?")

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.process_message", fake_process)
    player, court, starts_at = await _proposal_setup(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923020000033"
    )

    # 1) nothing proposed at all
    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923020000033", "wamid.yes-3", "yes"))
    # 2) a proposal that is 45 minutes old (limit is 30)
    await _seed_proposal(db_session_factory, player, court, starts_at, age_minutes=45)
    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923020000033", "wamid.yes-4", "yes"))

    assert calls == ["yes", "yes"]
    assert await db_session.scalar(select(Booking).where(Booking.player_id == player.id)) is None


async def test_proposal_reply_is_sent_with_real_yes_no_buttons(client, db_session, monkeypatch):
    from app.services.ai_chat_service import ChatAction, ChatResult

    payloads = []

    async def fake_send(self, payload):
        payloads.append(payload)
        return {"messages": [{"id": f"wamid.out.{len(payloads)}"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)

    court_id = "0b7a5b0c-1111-4222-8333-444455556666"
    starts_at = "2026-09-22T16:00:00+00:00"

    async def fake_process(self, *, user, message, history=None):
        return ChatResult(
            reply="Court 1, Tue 22 Sep, 9:00 PM - 10:30 PM for PKR 3,500. Confirm?",
            actions=[
                ChatAction(type="confirm_booking", label="Yes, book it", data={"court_id": court_id, "starts_at": starts_at}),
                ChatAction(type="decline", label="No, thanks", data={}),
            ],
        )

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.process_message", fake_process)

    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923020000034", "wamid.btn-out", "padel booking chahiye"))

    assert len(payloads) == 1
    interactive = payloads[0]["interactive"]
    assert payloads[0]["type"] == "interactive" and interactive["type"] == "button"
    assert interactive["body"]["text"].startswith("Court 1, Tue 22 Sep")
    buttons = [b["reply"] for b in interactive["action"]["buttons"]]
    assert buttons[0] == {"id": f"confirm:{court_id}:{starts_at}", "title": "Yes, book it"}
    assert buttons[1] == {"id": "decline", "title": "No, thanks"}
    assert all(len(b["title"]) <= 20 for b in buttons)
