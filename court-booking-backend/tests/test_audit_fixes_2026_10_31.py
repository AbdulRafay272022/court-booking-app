"""Fixes before merging feat/audit-build (founder, 2026-10-31):

1. a short-payment reply is taken after the 24 h too; +5 only within 4 days of the notice; "Ghalat hai" always reaches
   the owner; a waive gives the -20 back with a notice.
2. taking back a no-show asks final price / received / cash or transfer; a transfer goes through the balance-proof flow;
   approving it as correct gives +10 once (audited). The full price is never assumed as cash.
3. walk-in welcome to any ticked walk-in, account or not.
4. dues "Done": cash or transfer (screenshot via the balance-proof flow); the price never changes, the due becomes 0.
Real Postgres; flags are switched on per test."""

import io
from datetime import date, datetime, timedelta, timezone

from PIL import Image, ImageDraw
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.audit_phase3 import NoShowReply, PointEntry, ShortPaymentClaim
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.payment import Payment
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.services import phase3_service as p3
from overview_helpers import add_booking, at, past_day, seed_venue
from tests.round2_helpers import log_rows, mock_upload
from tests.test_audit_phase3 import half_advance_venue, set_flag
from tests.test_audit_phase3_flows import _balance, _claim, _give_points, _short_booking, completion_url


def _shot(color=(20, 90, 200)):
    img = Image.new("RGB", (64, 64), color=color)
    ImageDraw.Draw(img).rectangle([6, 6, 44, 28], fill=(250, 250, 250))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return ("transfer.jpg", io.BytesIO(buf.getvalue()), "image/jpeg")


async def _age_claim(sf, claim_id, days: float, status: str | None = None):
    """Pretend the short-payment notice went out `days` ago (and the 24 h are over)."""
    async with sf() as s:
        c = await s.get(ShortPaymentClaim, claim_id)
        c.created_at = datetime.now(timezone.utc) - timedelta(days=days)
        c.reply_deadline_at = c.created_at + timedelta(hours=24)
        if status:
            c.status = status
        await s.commit()


async def _entries(sf, booking_id) -> list[PaymentEntry]:
    async with sf() as s:
        return list((await s.execute(select(PaymentEntry).where(PaymentEntry.booking_id == booking_id).order_by(PaymentEntry.created_at))).scalars())


async def _audits(sf, action) -> list[AuditLog]:
    async with sf() as s:
        return list((await s.execute(select(AuditLog).where(AuditLog.action == action))).scalars())


# ---------------------------------------------------------------- 1. late replies


async def test_late_reply_after_the_penalty_within_4_days_still_gets_the_5(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "short_payment_reply")
    _o, _v, _c, player, b, _oh, ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003120011")
    await _give_points(db_session_factory, player, 50)
    claim = await _claim(db_session_factory, b.id)
    from app.config import get_settings

    async with db_session_factory() as s:
        await p3.run_short_payment_job(s, get_settings(), now=claim.reply_deadline_at + timedelta(minutes=1))
    assert await _balance(db_session_factory, player) == 30  # -20 at 24 h, as before
    await _age_claim(db_session_factory, claim.id, days=2)
    extras = (await client.get(f"/api/v1/bookings/{b.id}/extras", headers=ph)).json()
    assert extras["short_payment"]["can_reply"] is True and extras["short_payment"]["status"] == "no_reply"
    r = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "yes"}, headers=ph)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed" and r.json()["bonus_points"] == 5
    assert await _balance(db_session_factory, player) == 35
    # once per booking
    assert (await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "no"}, headers=ph)).status_code == 409
    assert await _balance(db_session_factory, player) == 35


async def test_reply_after_4_days_is_taken_without_points_and_ghalat_hai_reaches_the_owner(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "short_payment_reply")
    owner, venue, _c, player, b, oh, ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003120021")
    await _give_points(db_session_factory, player, 50)
    claim = await _claim(db_session_factory, b.id)
    from app.config import get_settings

    async with db_session_factory() as s:
        await p3.run_short_payment_job(s, get_settings(), now=claim.reply_deadline_at + timedelta(minutes=1))
    await _age_claim(db_session_factory, claim.id, days=5)
    r = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "no", "reason": "Poore diye the"}, headers=ph)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "disputed" and r.json()["bonus_points"] == 0
    assert await _balance(db_session_factory, player) == 30  # no +5 after 4 days
    assert await log_rows(db_session_factory, user_id=owner.id, event_type="owner_short_dispute")
    dues = (await client.get("/api/v1/owners/dues", params={"venue_id": str(venue.id)}, headers=oh)).json()
    assert dues[0]["status"] == "disputed" and dues[0]["player_reason"] == "Poore diye the"
    # the owner decides for the player: the -20 comes back, with a notice
    d = await client.post(f"/api/v1/owners/short-payments/{claim.id}/decide", json={"decision": "waive"}, headers=oh)
    assert d.status_code == 200 and d.json()["penalty_returned"] is True
    assert await _balance(db_session_factory, player) == 50
    notices = await log_rows(db_session_factory, user_id=player.id, event_type="player_due_resolved")
    assert notices


async def test_a_settled_due_takes_no_reply(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "short_payment_reply")
    _o, _v, _c, _p, b, oh, ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003120031")
    claim = await _claim(db_session_factory, b.id)
    assert (await client.post(f"/api/v1/owners/dues/{claim.id}/done", data={"method": "cash"}, headers=oh)).status_code == 200
    r = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "no"}, headers=ph)
    assert r.status_code == 409 and r.json()["error"]["code"] == "REPLY_WINDOW_CLOSED"


# ---------------------------------------------------------------- 2. no-show reversal


async def _noshow(sf, court, player, *, price=2000, paid=500):
    return await add_booking(sf, court, at(past_day(1), 12), 1, player=player, status=BookingStatus.NO_SHOW, price=price,
                             paid=paid, source=BookingSource.APP, name="Hamza")


async def test_haan_on_a_no_show_no_longer_records_the_full_price_as_cash(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003120041")
    player = await make_user("+923003120042")
    oh = await make_auth_headers(owner)
    b = await _noshow(db_session_factory, court, player)
    r = await client.post(completion_url(b.id), json={"result": "yes"}, headers=oh)
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOSHOW_REVERSAL_REQUIRED"
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert bk.status == BookingStatus.NO_SHOW and float(bk.amount_paid) == 500
    assert len(await _entries(db_session_factory, b.id)) == 1


async def test_reverse_with_cash_records_only_what_the_owner_says(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003120051")
    player = await make_user("+923003120052")
    oh = await make_auth_headers(owner)
    b = await _noshow(db_session_factory, court, player)
    url = f"/api/v1/owners/bookings/{b.id}/noshow-reverse"
    # received more than the final price allows
    bad = await client.post(url, data={"final_price_pkr": 1800, "received_pkr": 1500, "method": "cash"}, headers=oh)
    assert bad.status_code == 400 and bad.json()["error"]["details"]["max"] == 1300
    r = await client.post(url, data={"final_price_pkr": 1800, "received_pkr": 1300, "method": "cash"}, headers=oh)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert float(bk.price) == 1800 and float(bk.amount_paid) == 1800 and float(bk.balance_due) == 0
    entries = await _entries(db_session_factory, b.id)
    assert [(e.amount_pkr, e.method) for e in entries[1:]] == [(1300, PaymentMethod.CASH_AT_VENUE)]
    rev = await _audits(db_session_factory, "booking.noshow_reversed")
    assert rev and rev[-1].new_value["price"] == 1800 and rev[-1].old_value["price"] == 2000
    assert await log_rows(db_session_factory, user_id=player.id, event_type="player_noshow_decision")
    # a second reversal: it is no longer a no-show
    assert (await client.post(url, data={"final_price_pkr": 1800, "received_pkr": 0, "method": "cash"}, headers=oh)).status_code == 400


async def test_reverse_with_nothing_received_records_nothing(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003120061")
    player = await make_user("+923003120062")
    b = await _noshow(db_session_factory, court, player)
    r = await client.post(f"/api/v1/owners/bookings/{b.id}/noshow-reverse", data={"final_price_pkr": 2000, "received_pkr": 0, "method": "cash"},
                          headers=await make_auth_headers(owner))
    assert r.status_code == 200, r.text
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert bk.status == BookingStatus.COMPLETED and float(bk.amount_paid) == 500 and float(bk.balance_due) == 1500
    assert len(await _entries(db_session_factory, b.id)) == 1


async def test_main_aaya_tha_reverse_by_transfer_needs_a_screenshot_and_approval_gives_10_once(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "noshow_reply")
    await set_flag(db_session_factory, "player_points")
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003120071")
    player = await make_user("+923003120072", name="Hamza")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    b = await _noshow(db_session_factory, court, player)
    assert (await client.post(f"/api/v1/bookings/{b.id}/noshow-reply", json={"note": "aaya tha"}, headers=ph)).status_code == 201
    async with db_session_factory() as s:
        reply = (await s.execute(select(NoShowReply).where(NoShowReply.booking_id == b.id))).scalar_one()
    # the old one-tap "reverse" is refused: the money must be stated
    d = await client.post(f"/api/v1/owners/noshow-replies/{reply.id}/decide", json={"decision": "reverse"}, headers=oh)
    assert d.status_code == 409 and d.json()["error"]["code"] == "NOSHOW_REVERSAL_REQUIRED"
    url = f"/api/v1/owners/bookings/{b.id}/noshow-reverse"
    form = {"final_price_pkr": 2000, "received_pkr": 1500, "method": "transfer", "reply_id": str(reply.id)}
    no_shot = await client.post(url, data=form, headers=oh)
    assert no_shot.status_code == 400 and no_shot.json()["error"]["code"] == "PROOF_REQUIRED"
    r = await client.post(url, data=form, files={"screenshot": _shot()}, headers=oh)
    assert r.status_code == 200, r.text
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert bk.status == BookingStatus.COMPLETED and float(bk.amount_paid) == 500  # nothing credited before approval
        assert (await s.get(NoShowReply, reply.id)).owner_decision == "reverse"
        pay = (await s.execute(select(Payment).where(Payment.booking_id == b.id, Payment.review_verdict.is_(None)))).scalar_one()
        assert pay.ocr_raw["purpose"] == "balance" and pay.ocr_raw["origin"] == "noshow_reverse" and float(pay.amount_claimed) == 1500
    assert len(await _entries(db_session_factory, b.id)) == 1
    queue = (await client.get("/api/v1/owners/approvals-queue", headers=oh)).json()
    card = next(c for c in queue["items"] if c["booking_id"] == str(b.id))
    assert card["state"] == "awaiting" and card["is_balance"] is True
    badges = (await client.get("/api/v1/owners/badges", headers=oh)).json()
    assert badges["approvals"] >= 1

    ok = await client.post(f"/api/v1/payments/{pay.id}/approve", headers=oh)
    assert ok.status_code == 200, ok.text
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert float(bk.amount_paid) == 2000 and float(bk.balance_due) == 0
        pts = list((await s.execute(select(PointEntry).where(PointEntry.booking_id == b.id))).scalars())
    assert [p.reason for p in pts if p.reason == "noshow_transfer_ok"] == ["noshow_transfer_ok"]
    assert sum(p.delta for p in pts if p.reason == "noshow_transfer_ok") == 10
    assert await _audits(db_session_factory, "points.noshow_transfer_awarded")
    # audit fixes 2026-10-31 (a): approved at the venue -> the points are given without a message
    assert not await log_rows(db_session_factory, user_id=player.id, event_type="player_points_reward")
    # once per booking
    async with db_session_factory() as s:
        from app.config import get_settings
        from app.models.user import User

        again = await p3.award_noshow_transfer_points(s, get_settings(), await s.get(User, owner.id), await s.get(Booking, b.id), await s.get(Payment, pay.id))
    assert again == 0


async def test_noshow_transfer_points_need_the_points_flag(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003120081")
    player = await make_user("+923003120082")
    oh = await make_auth_headers(owner)
    b = await _noshow(db_session_factory, court, player)
    r = await client.post(f"/api/v1/owners/bookings/{b.id}/noshow-reverse",
                          data={"final_price_pkr": 2000, "received_pkr": 1500, "method": "transfer"}, files={"screenshot": _shot()}, headers=oh)
    assert r.status_code == 200, r.text
    async with db_session_factory() as s:
        pay = (await s.execute(select(Payment).where(Payment.booking_id == b.id, Payment.review_verdict.is_(None)))).scalar_one()
    assert (await client.post(f"/api/v1/payments/{pay.id}/approve", headers=oh)).status_code == 200
    assert await _balance(db_session_factory, player) == 0


# ---------------------------------------------------------------- 4. dues "Done"


async def test_due_done_cash_adds_an_entry_today_and_keeps_the_price(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "player_dues")
    _o, _v, _c, _p, b, oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003120091")
    claim = await _claim(db_session_factory, b.id)
    r = await client.post(f"/api/v1/owners/dues/{claim.id}/done", data={"method": "cash"}, headers=oh)
    assert r.status_code == 200, r.text
    assert r.json()["resolution"] == "paid" and r.json()["due_pkr"] == 0
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert float(bk.price) == 2000 and float(bk.balance_due) == 0
    last = (await _entries(db_session_factory, b.id))[-1]
    assert last.amount_pkr == 1000 and last.method == PaymentMethod.CASH_AT_VENUE
    assert last.created_at.date() >= (datetime.now(timezone.utc) - timedelta(days=1)).date()


async def test_due_done_by_transfer_waits_for_the_screenshot_approval(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "player_dues")
    _o, venue, _c, _p, b, oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003120101")
    claim = await _claim(db_session_factory, b.id)
    url = f"/api/v1/owners/dues/{claim.id}/done"
    no_shot = await client.post(url, data={"method": "transfer"}, headers=oh)
    assert no_shot.status_code == 400 and no_shot.json()["error"]["code"] == "PROOF_REQUIRED"
    r = await client.post(url, data={"method": "transfer"}, files={"screenshot": _shot((90, 20, 20))}, headers=oh)
    assert r.status_code == 200, r.text
    assert r.json()["resolved_at"] is None and r.json()["due_pkr"] == 1000  # still due until approved
    async with db_session_factory() as s:
        pay = (await s.execute(select(Payment).where(Payment.booking_id == b.id, Payment.review_verdict.is_(None)))).scalar_one()
        assert pay.ocr_raw["origin"] == "due_done" and float(pay.amount_claimed) == 1000
    ok = await client.post(f"/api/v1/payments/{pay.id}/approve", headers=oh)
    assert ok.status_code == 200, ok.text
    c = await _claim(db_session_factory, b.id)
    assert c.resolved_at is not None and c.resolution == "paid"
    async with db_session_factory() as s:
        bk = await s.get(Booking, b.id)
        assert float(bk.price) == 2000 and float(bk.balance_due) == 0
    last = (await _entries(db_session_factory, b.id))[-1]
    assert last.amount_pkr == 1000 and last.method == PaymentMethod.BANK_TRANSFER_PROOF
    assert (await client.get("/api/v1/owners/dues", params={"venue_id": str(venue.id)}, headers=oh)).json() == []


async def test_due_done_with_no_body_is_cash_for_older_apps(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "player_dues")
    _o, _v, _c, _p, b, oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003120111")
    claim = await _claim(db_session_factory, b.id)
    r = await client.post(f"/api/v1/owners/dues/{claim.id}/done", headers=oh)
    assert r.status_code == 200 and r.json()["resolution"] == "paid"


# ---------------------------------------------------------------- 3. walk-in welcome


async def test_walkin_welcome_goes_to_a_ticked_phone_without_an_account(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    from app.services.whatsapp_service import WhatsAppService

    sent = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "wamid.w"}]}

    monkeypatch.setattr(WhatsAppService, "_send", fake_send)
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003120121")
    oh = await make_auth_headers(owner)
    day = (date.today() + timedelta(days=3)).isoformat()
    body = {"court_id": str(court.id), "starts_at": f"{day}T10:00:00Z", "player_name": "Walk In", "amount_paid": 0,
            "player_phone": "+923003129999", "whatsapp_opt_in": True}
    # flag off: nothing
    assert (await client.post("/api/v1/bookings/walkin", headers=oh, json=body)).status_code == 201
    assert sent == []
    await set_flag(db_session_factory, "whatsapp_templates")
    r = await client.post("/api/v1/bookings/walkin", headers=oh, json={**body, "starts_at": f"{day}T12:00:00Z"})
    assert r.status_code == 201, r.text
    welcome = [p for p in sent if p.get("template", {}).get("name") == "khelo_walkin_welcome"]
    assert len(welcome) == 1 and welcome[0]["to"].endswith("3003129999")
    audits = await _audits(db_session_factory, "walkin.welcome_whatsapp")
    assert audits and audits[-1].new_value["sent"] is True and audits[-1].new_value["account"] is False
    # not ticked: nothing
    await client.post("/api/v1/bookings/walkin", headers=oh, json={**body, "starts_at": f"{day}T14:00:00Z", "whatsapp_opt_in": False})
    assert len([p for p in sent if p.get("template", {}).get("name") == "khelo_walkin_welcome"]) == 1


async def test_walkin_welcome_still_goes_to_a_ticked_phone_with_an_account(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    from app.services.whatsapp_service import WhatsAppService

    async def fake_send(self, payload):
        return {"messages": [{"id": "wamid.w2"}]}

    monkeypatch.setattr(WhatsAppService, "_send", fake_send)
    await set_flag(db_session_factory, "whatsapp_templates")
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003120131")
    player = await make_user("+923003120132")
    oh = await make_auth_headers(owner)
    day = (date.today() + timedelta(days=3)).isoformat()
    r = await client.post("/api/v1/bookings/walkin", headers=oh, json={
        "court_id": str(court.id), "starts_at": f"{day}T10:00:00Z", "player_name": "Acc", "amount_paid": 0,
        "player_phone": player.phone, "whatsapp_opt_in": True})
    assert r.status_code == 201, r.text
    assert await log_rows(db_session_factory, user_id=player.id, event_type="walkin_welcome_wa")
