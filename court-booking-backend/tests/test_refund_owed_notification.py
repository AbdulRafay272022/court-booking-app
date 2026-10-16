"""Owner Overview spec 5.3: when a PLAYER cancels a booking that was paid for, the venue owner is told a refund is owed
(push + best-effort WhatsApp, event_type refund_owed, reference_id = booking id). Never fails the cancel."""
import io
from datetime import date, time, timedelta

from PIL import Image
from sqlalchemy import select

from app.models.fcm_token import FCMToken
from app.models.notification import NotificationLog
from app.models.user import UserRole
from app.services.fcm import PushOutcome


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(80, 160, 40)).save(buf, format="PNG")
    return buf.getvalue()


async def _setup(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch, phones):
    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)

    pushes: list[dict] = []

    async def fake_push(self, token, title, body, data=None):
        pushes.append({"token": token, "title": title, "body": body, "data": data or {}})
        return PushOutcome.SENT

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user(phones[0], role=UserRole.OWNER)
    player = await make_user(phones[1], role=UserRole.PLAYER, name="Pat Player")
    venue = await make_venue(owner)
    court = await make_court(venue, name="Centre Court")
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=2000, advance_percentage=100)
    async with db_session_factory() as session:
        session.add(FCMToken(user_id=owner.id, token="owner-device-token", platform="android"))
        await session.commit()
    return owner, player, court, await make_auth_headers(owner), await make_auth_headers(player), pushes


async def _paid_booking(client, court, owner_headers, player_headers, days_ahead=1):
    target = date.today() + timedelta(days=days_ahead)
    hold = await client.post(
        "/api/v1/bookings/hold", headers=player_headers,
        json={"court_id": str(court.id), "starts_at": f"{target.isoformat()}T10:00:00+00:00"},
    )
    booking = hold.json()["booking"]
    submit = await client.post(
        f"/api/v1/bookings/{booking['id']}/payment-proof", headers=player_headers,
        files={"image": ("proof.jpg", io.BytesIO(_png()), "image/jpeg")},
    )
    approve = await client.post(f"/api/v1/payments/{submit.json()['payment']['id']}/approve", headers=owner_headers)
    assert approve.json()["booking"]["status"] == "booked"
    return booking


async def _logs(db_session_factory, user_id, event_type):
    async with db_session_factory() as session:
        rows = await session.execute(
            select(NotificationLog).where(NotificationLog.user_id == user_id, NotificationLog.event_type == event_type)
        )
        return list(rows.scalars().all())


async def test_player_cancel_of_a_paid_booking_notifies_the_owner(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    sent = []

    async def fake_send_template(self, to, template_name, language_code, components=None):
        sent.append(("template", to, template_name, components))
        return {"messages": [{"id": "x"}]}

    async def fake_send_text(self, to, body):
        sent.append(("text", to, body))
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", fake_send_template)
    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)
    owner, player, court, oh, ph, pushes = await _setup(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch,
        ("+923007700001", "+923007700002"),
    )
    booking = await _paid_booking(client, court, oh, ph)
    pushes.clear()
    sent.clear()

    resp = await client.post(f"/api/v1/bookings/{booking['id']}/cancel", headers=ph, json={"reason": "plans changed"})
    assert resp.status_code == 200 and resp.json()["booking"]["status"] == "cancelled"

    owner_pushes = [p for p in pushes if p["token"] == "owner-device-token"]
    assert len(owner_pushes) == 1
    p = owner_pushes[0]
    assert p["data"] == {"event_type": "refund_owed", "reference_id": booking["id"]}
    assert "Centre Court" in p["body"] and "PKR 2,000" in p["body"] and "Pat Player" in p["body"]
    assert any(s[1] == owner.phone for s in sent), "the owner is also sent a WhatsApp"
    push_logs = await _logs(db_session_factory, owner.id, "refund_owed")
    assert {(l.channel, l.status) for l in push_logs} == {("push", "sent"), ("whatsapp", "sent")}
    assert all(str(l.reference_id) == booking["id"] for l in push_logs)
    # the player's own cancellation notice is unchanged
    assert await _logs(db_session_factory, player.id, "booking_cancelled")


async def test_whatsapp_failure_never_breaks_the_cancel(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    owner, player, court, oh, ph, pushes = await _setup(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch,
        ("+923007700003", "+923007700004"),
    )
    booking = await _paid_booking(client, court, oh, ph)
    pushes.clear()

    async def boom(self, *a, **k):
        raise RuntimeError("Meta is down")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", boom)
    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", boom)

    resp = await client.post(f"/api/v1/bookings/{booking['id']}/cancel", headers=ph, json={"reason": "plans changed"})
    assert resp.status_code == 200 and resp.json()["booking"]["status"] == "cancelled"
    logs = await _logs(db_session_factory, owner.id, "refund_owed")
    by_channel = {l.channel: l for l in logs}
    assert by_channel["whatsapp"].status == "failed" and by_channel["push"].status == "sent"
    assert any(p["data"].get("event_type") == "refund_owed" for p in pushes)  # the push still went out


async def test_a_crash_inside_the_owner_notification_still_returns_the_cancel(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    owner, player, court, oh, ph, pushes = await _setup(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch,
        ("+923007700005", "+923007700006"),
    )
    booking = await _paid_booking(client, court, oh, ph)

    async def explode(self, **kwargs):
        raise RuntimeError("notification bug")

    monkeypatch.setattr("app.services.notification_service.NotificationService.notify_owner_refund_owed", explode)
    resp = await client.post(f"/api/v1/bookings/{booking['id']}/cancel", headers=ph, json={})
    assert resp.status_code == 200 and resp.json()["booking"]["status"] == "cancelled"


async def test_no_owner_refund_notice_for_owner_cancel_or_unpaid_cancel(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    async def ok(self, *a, **k):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_template", ok)
    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", ok)
    owner, player, court, oh, ph, pushes = await _setup(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch,
        ("+923007700007", "+923007700008"),
    )
    # the OWNER cancels a paid booking: not a player cancel, so no "refund owed" notice to the owner
    paid = await _paid_booking(client, court, oh, ph, days_ahead=1)
    assert (await client.post(f"/api/v1/bookings/{paid['id']}/cancel", headers=oh, json={"reason": "rain"})).status_code == 200
    # a player cancels a hold that was never paid
    target = date.today() + timedelta(days=2)
    hold = await client.post(
        "/api/v1/bookings/hold", headers=ph, json={"court_id": str(court.id), "starts_at": f"{target.isoformat()}T10:00:00+00:00"}
    )
    assert (await client.post(f"/api/v1/bookings/{hold.json()['booking']['id']}/cancel", headers=ph, json={})).status_code == 200
    assert await _logs(db_session_factory, owner.id, "refund_owed") == []
    assert not [p for p in pushes if p["data"].get("event_type") == "refund_owed"]
