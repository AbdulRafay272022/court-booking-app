"""fix/nov-9 items 6 + 9-12: refund payout details (masked except for the owing venue, audited), refund screenshot check,
"Mil gaya / Nahi mila", escalations to Khelo and the admin's decision, and server text in the user's language."""

import io
import json
from datetime import datetime, timedelta, timezone

from PIL import Image
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.audit_phase3 import NoShowReply, ShortPaymentClaim
from app.models.booking import Booking, BookingStatus, BookingSource
from app.models.dispute import PaymentDispute
from app.models.notification import NotificationLog
from app.models.refund_flow import RefundTransfer
from app.models.user import User, UserRole
from app.services.ai.base import PaymentExtraction
from app.services.refund_flow_service import judge_refund_screenshot, normalize_payout
from tests.overview_helpers import add_booking
from tests.test_audit_phase3 import set_flag

API = "/api/v1"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(10, 120, 200)).save(buf, format="PNG")
    return buf.getvalue()


async def _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, *, phone_tail="01"):
    owner = await make_user(f"+9230071000{phone_tail}", role=UserRole.OWNER)
    player = await make_user(f"+9230072000{phone_tail}", role=UserRole.PLAYER, name="Ali Raza")
    venue = await make_venue(owner)
    court = await make_court(venue)
    return owner, player, venue, court, await make_auth_headers(owner), await make_auth_headers(player)


async def _owed_refund(db_session_factory, court, player, amount=2000) -> tuple[Booking, PaymentDispute]:
    start = datetime.now(timezone.utc) + timedelta(days=2)
    booking = await add_booking(
        db_session_factory, court, start, status=BookingStatus.CANCELLED, price=4000, paid=amount, player=player,
        source=BookingSource.APP,
    )
    async with db_session_factory() as s:
        d = PaymentDispute(
            booking_id=booking.id, player_id=player.id, reason="player_cancelled_paid_booking", refund_amount=amount,
            refund_status="owed",
        )
        s.add(d)
        await s.commit()
        await s.refresh(d)
    return booking, d


def _fake_ocr(monkeypatch, amount, receiver):
    async def fake(self, data, ctype, expected, *, entitled=True):
        return PaymentExtraction(amount=amount, reference="R1", timestamp=None, confidence=0.9, raw_response={},
                                 receiver_name=receiver)

    monkeypatch.setattr("app.services.payment_service.PaymentService._extract_payment_proof", fake)

    async def fake_upload(*a, **k):
        return "payment-proofs/refund.png"

    monkeypatch.setattr("app.api.owners.upload_private_proof", fake_upload)
    monkeypatch.setattr("app.utils.s3.signed_private_url", lambda key, expires_in=900: f"https://signed/{key}")


# ------------------------------------------------------------------ pure rules


def test_payout_numbers_are_normalized_and_bad_ones_refused():
    assert normalize_payout("jazzcash", "0300 1234567", "Ali Raza", None)[1] == "03001234567"
    assert normalize_payout("easypaisa", "+92 300-1234567", "Ali Raza", None)[1] == "03001234567"
    assert normalize_payout("bank", "pk36 scbl 0000 0011 2345 6702", "Ali Raza", "Meezan")[1] == "PK36SCBL0000001123456702"
    for method, acct in (("bank", "PK36SCBL00000011"), ("jazzcash", "12345"), ("cash", "03001234567")):
        try:
            normalize_payout(method, acct, "Ali Raza", None)
        except Exception as exc:  # noqa: BLE001
            assert getattr(exc, "code", "") == "PAYOUT_INVALID"
        else:
            raise AssertionError((method, acct))


def test_refund_screenshot_check():
    kw = dict(payout_title="Ali Raza", payout_account="03001234567")
    assert judge_refund_screenshot(sent=2000, ocr_amount=2000, ocr_receiver="ALI RAZA", **kw) == ("match", [])
    assert judge_refund_screenshot(sent=2000, ocr_amount=2000, ocr_receiver="0300****4567", **kw) == ("match", [])
    assert judge_refund_screenshot(sent=2000, ocr_amount=1500, ocr_receiver="Ali Raza", **kw) == ("mismatch", ["amount"])
    assert judge_refund_screenshot(sent=2000, ocr_amount=2000, ocr_receiver="Bilal Khan", **kw) == ("mismatch", ["receiver"])
    assert judge_refund_screenshot(sent=2000, ocr_amount=None, ocr_receiver=None, **kw)[0] == "unreadable"
    assert judge_refund_screenshot(sent=2000, ocr_amount=2000, ocr_receiver=None, **kw) == ("unreadable", ["receiver_not_visible"])
    assert judge_refund_screenshot(sent=1, ocr_amount=None, ocr_receiver=None, has_screenshot=False, **kw) == ("no_screenshot", [])


# ------------------------------------------------------------------ item 10: payout details + masking


async def test_payout_is_masked_everywhere_and_full_only_for_the_owing_venue_audited(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory)
    booking, dispute = await _owed_refund(db_session_factory, court, player)

    bad = await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                           json={"method": "bank", "account": "PK12", "title": "Ali Raza"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "PAYOUT_INVALID"
    r = await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                         json={"method": "jazzcash", "account": "0300 1234567", "title": "Ali Raza"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["payout"]["account_masked"] == "****4567" and body["payout"]["account"] is None
    assert "03001234567" not in r.text

    async with db_session_factory() as s:
        row = await s.get(PaymentDispute, dispute.id)
        assert row.payout_account_enc and "03001234567" not in row.payout_account_enc  # encrypted at rest

    listing = await client.get(f"{API}/owners/refunds", headers=oh)
    assert listing.status_code == 200
    assert "03001234567" not in listing.text and "****4567" in listing.text

    full = await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=oh)
    assert full.status_code == 200 and full.json()["account"] == "03001234567"
    async with db_session_factory() as s:
        logs = (await s.execute(select(AuditLog).where(AuditLog.action == "payout.viewed"))).scalars().all()
        assert len(logs) == 1 and logs[0].actor_id == owner.id

    # another venue's owner, the player and an admin never get the full number
    other = await make_user("+923007300001", role=UserRole.OWNER)
    assert (await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=await make_auth_headers(other))).status_code in (403, 404)
    admin = await make_user("+923007300002", role=UserRole.ADMIN)
    denied = await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=await make_auth_headers(admin))
    assert denied.status_code == 403
    assert (await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=ph)).status_code == 403

    # once nothing is owed any more, the full number is hidden from the venue too
    async with db_session_factory() as s:
        row = await s.get(PaymentDispute, dispute.id)
        row.refunded_amount, row.refund_status = 2000, "refunded"
        await s.commit()
    gone = await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=oh)
    assert gone.status_code == 403 and gone.json()["error"]["code"] == "PAYOUT_NOT_VISIBLE"


# ------------------------------------------------------------------ items 11 + 12: sent, checked, answered, escalated


async def test_refund_sent_is_checked_answered_and_taken_to_khelo(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers, monkeypatch
):
    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, phone_tail="02")
    booking, dispute = await _owed_refund(db_session_factory, court, player)
    await set_flag(db_session_factory, "refunds")
    await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                     json={"method": "easypaisa", "account": "03001234567", "title": "Ali Raza"})

    # a partial refund whose screenshot shows a different amount -> "Farq hai"
    _fake_ocr(monkeypatch, 900, "Ali Raza")
    sent = await client.post(
        f"{API}/owners/refunds/{dispute.id}/mark-refunded", headers=oh,
        data={"reference": "EP-1", "amount": "1000"}, files={"screenshot": ("r.png", _png(), "image/png")},
    )
    assert sent.status_code == 200, sent.text
    t1 = sent.json()["transfers"][0]
    assert t1["ocr_verdict"] == "mismatch" and t1["ocr_reasons"] == ["amount"] and t1["amount"] == 1000

    # the rest, matching
    _fake_ocr(monkeypatch, 1000, "0300****4567")
    sent2 = await client.post(
        f"{API}/owners/refunds/{dispute.id}/mark-refunded", headers=oh,
        data={"reference": "EP-2", "amount": "1000"}, files={"screenshot": ("r2.png", _png(), "image/png")},
    )
    assert sent2.json()["transfers"][1]["ocr_verdict"] == "match"

    state = (await client.get(f"{API}/bookings/{booking.id}/disputes", headers=ph)).json()["refund"]
    assert state["sent"] == 2000 and state["remaining"] == 0 and state["status"] == "refunded"
    assert [t["ocr_verdict"] for t in state["transfers"]] == ["mismatch", "match"]
    assert state["transfers"][0]["screenshot_url"].startswith("https://signed/")
    assert state["transfers"][0]["can_answer"] is True

    first, second = state["transfers"]
    ok = await client.post(f"{API}/refund-transfers/{second['id']}/answer", headers=ph, json={"answer": "received"})
    assert ok.status_code == 200 and ok.json()["player_response"] == "received"
    # nothing to take to Khelo yet
    no = await client.post(f"{API}/bookings/{booking.id}/escalate", headers=ph, json={"kind": "refund"})
    assert no.status_code == 409 and no.json()["error"]["code"] == "ESCALATION_NOT_ALLOWED"

    nope = await client.post(f"{API}/refund-transfers/{first['id']}/answer", headers=ph,
                             json={"answer": "not_received", "note": "sirf 900 aaye"})
    assert nope.status_code == 200
    # fully sent, but the player says one part never came: it stays on the owner's list until the venue replies
    listed = (await client.get(f"{API}/owners/refunds", headers=oh)).json()
    assert [r["id"] for r in listed] == [str(dispute.id)] and listed[0]["transfers"][0]["player_response"] == "not_received"
    reply = await client.post(f"{API}/owners/refund-transfers/{first['id']}/reply", headers=oh, json={"note": "1000 bheje the"})
    assert reply.status_code == 200 and reply.json()["owner_reply"] == "1000 bheje the"
    assert (await client.get(f"{API}/owners/refunds", headers=oh)).json() == []

    admin = await make_user("+923007300003", role=UserRole.ADMIN)
    ah = await make_auth_headers(admin)
    esc = await client.post(f"{API}/bookings/{booking.id}/escalate", headers=ph, json={"kind": "refund", "reason": "100 kam"})
    assert esc.status_code == 201, esc.text
    again = await client.post(f"{API}/bookings/{booking.id}/escalate", headers=ph, json={"kind": "refund"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "ALREADY_ESCALATED"

    queue = (await client.get(f"{API}/admin/escalations?status=open", headers=ah)).json()
    assert len(queue) == 1 and queue[0]["kind"] == "refund" and queue[0]["detail"]["transfer"]["ocr_verdict"] == "mismatch"
    assert queue[0]["detail"]["payout"]["account"] is None  # masked for Khelo's admin too
    assert (await client.post(f"{API}/admin/escalations/{queue[0]['id']}/decide", headers=ph,
                              json={"decision": "player", "note": "x"})).status_code == 403
    decided = await client.post(f"{API}/admin/escalations/{queue[0]['id']}/decide", headers=ah,
                                json={"decision": "player", "note": "Screenshot mein 900 hain"})
    assert decided.status_code == 200 and decided.json()["admin_decision"] == "player"

    async with db_session_factory() as s:
        d = await s.get(PaymentDispute, dispute.id)
        assert d.refund_status == "owed" and float(d.refunded_amount) == 1000.0  # the 1000 is owed again
        b = await s.get(Booking, booking.id)
        assert float(b.amount_paid) == 1000.0  # 2000 paid - 2000 refunded + 1000 taken back
        events = {(n.user_id, n.event_type) for n in (await s.execute(select(NotificationLog))).scalars()}
    assert (owner.id, "owner_escalated") in events and (admin.id, "admin_escalation") in events
    assert (player.id, "player_escalation_decided") in events and (owner.id, "owner_escalation_decided") in events
    # the venue owes it again, so it may see the number again
    assert (await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=oh)).status_code == 200


# ------------------------------------------------------------------ item 9: no-show + short payment escalations


async def test_noshow_kept_by_the_venue_goes_to_khelo_and_a_player_win_reopens_it(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, phone_tail="03")
    start = datetime.now(timezone.utc) - timedelta(days=1)
    booking = await add_booking(db_session_factory, court, start, status=BookingStatus.NO_SHOW, player=player, source=BookingSource.APP)
    async with db_session_factory() as s:
        reply = NoShowReply(booking_id=booking.id, player_id=player.id, note="main aaya tha")
        s.add(reply)
        await s.commit()
        await s.refresh(reply)
    early = await client.post(f"{API}/bookings/{booking.id}/escalate", headers=ph, json={"kind": "no_show"})
    assert early.status_code == 409  # the venue has not said no yet
    async with db_session_factory() as s:
        r = await s.get(NoShowReply, reply.id)
        r.owner_decision, r.decided_by = "keep", owner.id
        await s.commit()

    state = (await client.get(f"{API}/bookings/{booking.id}/disputes", headers=ph)).json()
    assert state["escalations"] == [{"kind": "no_show", "can_escalate": True, "escalation": None}]
    esc = await client.post(f"{API}/bookings/{booking.id}/escalate", headers=ph, json={"kind": "no_show", "reason": "GPS dekhein"})
    assert esc.status_code == 201
    admin = await make_user("+923007300004", role=UserRole.ADMIN)
    ah = await make_auth_headers(admin)
    bad = await client.post(f"{API}/admin/escalations/{esc.json()['id']}/decide", headers=ah, json={"decision": "player", "note": " "})
    assert bad.status_code == 422
    ok = await client.post(f"{API}/admin/escalations/{esc.json()['id']}/decide", headers=ah,
                           json={"decision": "player", "note": "GPS ke mutabiq player venue par tha"})
    assert ok.status_code == 200
    twice = await client.post(f"{API}/admin/escalations/{esc.json()['id']}/decide", headers=ah, json={"decision": "venue", "note": "x"})
    assert twice.status_code == 409
    async with db_session_factory() as s:
        r = await s.get(NoShowReply, reply.id)
        assert r.owner_decision is None  # the owner's "Player sahi hai, no-show hatao" is open again
    state = (await client.get(f"{API}/bookings/{booking.id}/disputes", headers=ph)).json()
    assert state["escalations"][0]["escalation"]["admin_decision"] == "player"


async def test_disputed_due_kept_by_the_venue_is_waived_when_khelo_sides_with_the_player(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, phone_tail="04")
    start = datetime.now(timezone.utc) - timedelta(days=1)
    booking = await add_booking(db_session_factory, court, start, status=BookingStatus.COMPLETED, price=3500, paid=3000,
                                player=player, source=BookingSource.APP)
    async with db_session_factory() as s:
        claim = ShortPaymentClaim(
            booking_id=booking.id, venue_id=venue.id, player_id=player.id, total_pkr=3500, paid_pkr=3000, due_pkr=500,
            status="disputed", reply_deadline_at=start, owner_decision="collect", player_reason="poore diye the",
        )
        s.add(claim)
        await s.commit()
        await s.refresh(claim)
    esc = await client.post(f"{API}/bookings/{booking.id}/escalate", headers=ph, json={"kind": "short_payment"})
    assert esc.status_code == 201
    admin = await make_user("+923007300005", role=UserRole.ADMIN)
    ah = await make_auth_headers(admin)
    row = (await client.get(f"{API}/admin/escalations", headers=ah)).json()[0]
    assert row["detail"]["due_pkr"] == 500 and row["booking_code"].startswith("KH-")
    await client.post(f"{API}/admin/escalations/{row['id']}/decide", headers=ah, json={"decision": "player", "note": "Cash receipt dekhi"})
    async with db_session_factory() as s:
        c = await s.get(ShortPaymentClaim, claim.id)
        b = await s.get(Booking, booking.id)
        assert c.resolution == "waived" and c.resolved_at is not None
        # ledger v2 (contract 2.5, flag-free): Khelo's "player is right" is a 'waived' adjustment, the price stays
        from app.services.money import load_money

        m = await load_money(s, b)
        assert float(b.price) == 3500.0 and float(b.balance_due) == 0.0 and m.waived == 500 and m.due == 0
        assert (await s.execute(select(AuditLog).where(AuditLog.action == "escalation.decided"))).scalars().first() is not None


# ------------------------------------------------------------------ item 6: language


async def test_language_is_saved_and_server_text_follows_it(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers, monkeypatch
):
    sent: list[tuple] = []

    async def capture(self, user, event, title, body, **kw):
        sent.append((user.id, event, title, body))

    monkeypatch.setattr("app.services.notification_service.NotificationService._audit_tier", capture)
    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, phone_tail="05")
    me = await client.patch(f"{API}/auth/me", headers=ph, json={"language": "en"})
    assert me.status_code == 200 and me.json()["language"] == "en"
    assert (await client.patch(f"{API}/auth/me", headers=ph, json={"language": "fr"})).status_code == 422
    booking, dispute = await _owed_refund(db_session_factory, court, player)
    async with db_session_factory() as s:
        o = await s.get(User, owner.id)
        o.language = "ru"
        await s.commit()
    await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                     json={"method": "jazzcash", "account": "03001234567", "title": "Ali Raza"})
    # the owner (Roman Urdu) hears it in Roman Urdu, nothing in English
    owner_msgs = [m for m in sent if m[0] == owner.id and m[1] == "owner_refund_payout"]
    assert owner_msgs and owner_msgs[0][2] == "Refund ka account mil gaya" and "player ne refund" in owner_msgs[0][3]
    # and the English player hears an English text
    from app.services.refund_flow_service import _notify
    from app.config import get_settings

    async with db_session_factory() as s:
        p = await s.get(User, player.id)
        await _notify(s, get_settings(), p, "x", ("Ru title", "En title"), ("Ru body", "En body"), reference_id=None)
    assert sent[-1][2:] == ("En title", "En body")


# ------------------------------------------------------------------ the encryption key: lost / rotated


async def test_a_lost_key_never_breaks_the_app_it_only_asks_the_player_again(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers, monkeypatch
):
    """The Fernet key (SSM BANK_DETAILS_ENCRYPTION_KEY) is replaced without keeping the old one: the stored number can't be
    read. Nothing 500s: the owner gets PAYOUT_UNREADABLE, the player's screen asks for the account again, a refund can
    still be marked sent (the check uses the account title), and the new number is stored with the new key."""
    from app.config import get_settings

    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, phone_tail="06")
    booking, dispute = await _owed_refund(db_session_factory, court, player)
    await set_flag(db_session_factory, "refunds")
    await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                     json={"method": "jazzcash", "account": "03001234567", "title": "Ali Raza"})
    settings = get_settings()
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "a-completely-new-key-old-one-lost")

    gone = await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=oh)
    assert gone.status_code == 409 and gone.json()["error"]["code"] == "PAYOUT_UNREADABLE"
    assert (await client.get(f"{API}/owners/refunds", headers=oh)).status_code == 200
    state = (await client.get(f"{API}/bookings/{booking.id}/disputes", headers=ph)).json()["refund"]
    assert state["needs_payout"] is True and state["payout"] is None and state["previous_payout"] is None

    _fake_ocr(monkeypatch, 1000, "Ali Raza")
    sent = await client.post(f"{API}/owners/refunds/{dispute.id}/mark-refunded", headers=oh,
                             data={"reference": "EP-9", "amount": "1000"}, files={"screenshot": ("r.png", _png(), "image/png")})
    assert sent.status_code == 200 and sent.json()["transfers"][0]["ocr_verdict"] == "match"  # matched on the title

    again = await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                             json={"method": "jazzcash", "account": "03007654321", "title": "Ali Raza"})
    assert again.status_code == 200 and again.json()["needs_payout"] is False
    full = await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=oh)
    assert full.status_code == 200 and full.json()["account"] == "03007654321"


async def test_a_rotated_key_keeps_old_numbers_readable_through_the_old_keys_setting(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers, monkeypatch
):
    from app.config import get_settings

    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, phone_tail="07")
    booking, dispute = await _owed_refund(db_session_factory, court, player)
    settings = get_settings()
    old_key = settings.BANK_DETAILS_ENCRYPTION_KEY or settings.SESSION_TOKEN_SECRET
    await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                     json={"method": "bank", "account": "PK36SCBL0000001123456702", "title": "Ali Raza"})
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "the-new-key")
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEYS_OLD", old_key)
    full = await client.get(f"{API}/owners/refunds/{dispute.id}/payout", headers=oh)
    assert full.status_code == 200 and full.json()["account"] == "PK36SCBL0000001123456702"


async def test_no_key_on_the_server_refuses_to_store_a_number_cleanly(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers, monkeypatch
):
    from app.config import get_settings

    owner, player, venue, court, oh, ph = await _setup(make_user, make_venue, make_court, make_auth_headers, db_session_factory, phone_tail="08")
    booking, dispute = await _owed_refund(db_session_factory, court, player)
    settings = get_settings()
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "")
    monkeypatch.setattr(settings, "DEBUG", False)
    r = await client.put(f"{API}/bookings/{booking.id}/refund-payout", headers=ph,
                         json={"method": "jazzcash", "account": "03001234567", "title": "Ali Raza"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "PAYOUT_STORAGE_UNAVAILABLE"
    async with db_session_factory() as s:
        assert (await s.get(PaymentDispute, dispute.id)).payout_method is None  # nothing stored, never in clear


# ------------------------------------------------------------------ khelo_booking_reminder {{3}} = booking ID


async def test_booking_reminder_template_sends_the_booking_short_code_as_the_third_variable(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    from app.config import get_settings
    from app.services.notification_service import NotificationService
    from app.services.whatsapp_service import WhatsAppService

    sent: list[dict] = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "wamid.r"}]}

    monkeypatch.setattr(WhatsAppService, "_send", fake_send)
    import uuid

    player = await make_user("+923007200009")
    await set_flag(db_session_factory, "whatsapp_templates")
    booking_id = uuid.uuid4()
    start = datetime.now(timezone.utc) + timedelta(hours=2)
    async with db_session_factory() as s:
        user = await s.get(User, player.id)
        await NotificationService(s, get_settings()).notify_booking_reminder(
            user=user, court_name="Futsal 1", starts_at=start, ends_at=start + timedelta(hours=1), booking_id=booking_id,
        )
    tpl = [p["template"] for p in sent if p.get("template", {}).get("name") == "khelo_booking_reminder"]
    assert len(tpl) == 1
    params = [x["text"] for x in tpl[0]["components"][0]["parameters"]]
    assert params[0] == "Futsal 1" and params[2] == "KH-" + booking_id.hex[:8].upper() and "Khelo" not in params
