"""Fixes before merging feat/audit-build, second round (founder, 2026-10-31):

1. an old app pressing "Haan" on a no-show gets "No-show hatane ke liye web dashboard istemal karein (naya app update jald)".
2. balance / no-show-reversal transfers are checked at the venue:
   a. approved -> the approver owns it; the player gets the normal receipt and the points notices (only problems are silent);
   b. the owner marks it "bank mein nahi mila" -> red on "Staff ka kaam" under that staff member; the owner chooses
      "Staff se wasool karein" (no player message, points kept) or "Player se baqi maangein" (the points that transfer earned
      are taken back, audited, and the short-payment flow starts);
   c. rejected -> exactly a short payment (the amount is not counted, Sahi hai / Ghalat hai, +5 within 4 days, -20 after 24 h).
   An advance rejection is unchanged.
Real Postgres; flags are switched on per test."""

from datetime import timedelta

from sqlalchemy import select

from app.models.audit_phase3 import ShortPaymentClaim
from app.models.booking import Booking, BookingStatus
from app.models.notification import NotificationLog
from app.models.payment import Payment
from app.models.payment_entry import PaymentMethod
from app.services import phase3_service as p3
from overview_helpers import seed_venue
from tests.round2_helpers import log_rows, mock_upload
from tests.test_audit_fixes_2026_10_31 import _entries, _noshow, _shot
from tests.test_audit_phase1 import make_staff
from tests.test_audit_phase3 import set_flag
from tests.test_audit_phase3_flows import _balance, _claim, _give_points, _short_booking, completion_url

OLD_APP_TEXT = "No-show hatane ke liye web dashboard istemal karein (naya app update jald)"


async def _pending_payment(sf, booking_id) -> Payment:
    async with sf() as s:
        return (await s.execute(select(Payment).where(Payment.booking_id == booking_id, Payment.review_verdict.is_(None)))).scalar_one()


async def _player_logs_since(sf, player_id, since_count: int) -> list[NotificationLog]:
    return (await log_rows(sf, user_id=player_id))[since_count:]


def _capture(monkeypatch) -> list[tuple[str, str]]:
    """(event, body) of every phase-3 notice (the body is not stored in notification_log)."""
    seen: list[tuple[str, str]] = []
    real = p3._notify

    async def spy(db, settings, user, event, title, body, **kw):
        seen.append((event, body))
        return await real(db, settings, user, event, title, body, **kw)

    monkeypatch.setattr(p3, "_notify", spy)
    return seen


def _bodies(seen, event) -> list[str]:
    return [b for e, b in seen if e == event]


async def _booking(sf, booking_id) -> Booking:
    async with sf() as s:
        return await s.get(Booking, booking_id)


# ---------------------------------------------------------------- 1. old app "Haan" on a no-show


async def test_old_app_haan_on_a_no_show_gets_the_roman_urdu_message(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    await set_flag(db_session_factory, "noshow_reply")
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003130011")
    player = await make_user("+923003130012")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    b = await _noshow(db_session_factory, court, player)
    for body in ({"result": "yes"}, {"result": "no", "received_pkr": 0, "reason": "x"}):
        r = await client.post(completion_url(b.id), json=body, headers=oh)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "NOSHOW_REVERSAL_REQUIRED" and r.json()["error"]["message"] == OLD_APP_TEXT
    await client.post(f"/api/v1/bookings/{b.id}/noshow-reply", json={"note": "aaya tha"}, headers=ph)
    async with db_session_factory() as s:
        from app.models.audit_phase3 import NoShowReply

        reply = (await s.execute(select(NoShowReply).where(NoShowReply.booking_id == b.id))).scalar_one()
    d = await client.post(f"/api/v1/owners/noshow-replies/{reply.id}/decide", json={"decision": "reverse"}, headers=oh)
    assert d.status_code == 409 and d.json()["error"]["message"] == OLD_APP_TEXT
    assert (await _booking(db_session_factory, b.id)).status == BookingStatus.NO_SHOW


# ---------------------------------------------------------------- 2a. approved at the venue: the normal good news


async def test_approving_a_noshow_reversal_transfer_sends_the_receipt_and_the_points_notices(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    seen = _capture(monkeypatch)
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "player_points")
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003130021")
    player = await make_user("+923003130022")
    oh = await make_auth_headers(owner)
    b = await _noshow(db_session_factory, court, player)
    r = await client.post(f"/api/v1/owners/bookings/{b.id}/noshow-reverse",
                          data={"final_price_pkr": 2000, "received_pkr": 1500, "method": "transfer"}, files={"screenshot": _shot()}, headers=oh)
    assert r.status_code == 200, r.text
    pay = await _pending_payment(db_session_factory, b.id)
    assert (await client.post(f"/api/v1/payments/{pay.id}/approve", headers=oh)).status_code == 200
    bk = await _booking(db_session_factory, b.id)
    assert float(bk.amount_paid) == 2000 and float(bk.balance_due) == 0
    # the receipt (push + in-app; WhatsApp only with whatsapp_templates), not "booking confirmed"
    receipts = _bodies(seen, "payment_receipt")
    assert len(receipts) == 1 and "PKR 1,500 mil gaye" in receipts[0] and "baqi PKR 0" in receipts[0]
    assert await log_rows(db_session_factory, user_id=player.id, event_type="payment_receipt")
    assert not await log_rows(db_session_factory, user_id=player.id, event_type="booking_confirmed")
    # +50 (fully paid by transfer) and +10 (no-show transfer), each with its own notice
    points = _bodies(seen, "player_points_reward")
    assert any("+50 points mile, kul 50" in t for t in points), points
    assert any("+10 points mile, kul 60" in t for t in points), points
    assert await _balance(db_session_factory, player) == 60


async def test_approving_a_due_done_transfer_sends_the_receipt(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    seen = _capture(monkeypatch)
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "player_dues")
    _o, _v, _c, player, b, oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003130031")
    claim = await _claim(db_session_factory, b.id)
    assert (await client.post(f"/api/v1/owners/dues/{claim.id}/done", data={"method": "transfer"}, files={"screenshot": _shot()}, headers=oh)).status_code == 200
    pay = await _pending_payment(db_session_factory, b.id)
    assert (await client.post(f"/api/v1/payments/{pay.id}/approve", headers=oh)).status_code == 200
    assert (await _claim(db_session_factory, b.id)).resolution == "paid"
    assert [t for t in _bodies(seen, "payment_receipt") if "PKR 1,000 mil gaye" in t]
    assert not await log_rows(db_session_factory, user_id=player.id, event_type="booking_confirmed")
    assert not await log_rows(db_session_factory, user_id=player.id, event_type="balance_payment_wa")


# ---------------------------------------------------------------- 2c. rejected at the venue = a short payment


async def test_rejecting_a_noshow_reversal_transfer_starts_the_short_payment_flow(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    seen = _capture(monkeypatch)
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "short_payment_reply")
    await set_flag(db_session_factory, "player_dues")
    owner, venue, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003130041")
    player = await make_user("+923003130042")
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    await _give_points(db_session_factory, player, 50)
    b = await _noshow(db_session_factory, court, player)
    r = await client.post(f"/api/v1/owners/bookings/{b.id}/noshow-reverse",
                          data={"final_price_pkr": 2000, "received_pkr": 1500, "method": "transfer"}, files={"screenshot": _shot()}, headers=oh)
    assert r.status_code == 200, r.text
    assert await _claim(db_session_factory, b.id) is None  # nothing asked while the screenshot waits
    pay = await _pending_payment(db_session_factory, b.id)
    rj = await client.post(f"/api/v1/payments/{pay.id}/reject", json={"reason": "Account ghalat"}, headers=oh)
    assert rj.status_code == 200, rj.text
    bk = await _booking(db_session_factory, b.id)
    assert float(bk.amount_paid) == 500 and float(bk.balance_due) == 1500  # the rejected 1,500 is not counted
    claim = await _claim(db_session_factory, b.id)
    assert claim is not None and claim.status == "awaiting_reply" and claim.due_pkr == 1500
    assert len(await log_rows(db_session_factory, user_id=player.id, event_type="player_short_ask")) == 1
    asks = _bodies(seen, "player_short_ask")
    assert len(asks) == 1
    assert "qabool nahi hua" in asks[0] and "Account ghalat" in asks[0]
    assert "Total PKR 2,000" in asks[0] and "baqi PKR 1,500" in asks[0]
    assert not await log_rows(db_session_factory, user_id=player.id, event_type="payment_rejected")
    # the due is carried like any short payment
    dues = (await client.get("/api/v1/owners/dues", params={"venue_id": str(venue.id)}, headers=oh)).json()
    assert [d["booking_id"] for d in dues] == [str(b.id)]
    # -20 after 24 h without a reply, then "Ghalat hai" still goes to the owner
    from app.config import get_settings

    async with db_session_factory() as s:
        await p3.run_short_payment_job(s, get_settings(), now=claim.reply_deadline_at + timedelta(minutes=1))
    assert await _balance(db_session_factory, player) == 30
    no = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "no", "reason": "bheje the"}, headers=ph)
    assert no.status_code == 200 and no.json()["bonus_points"] == 5  # within 4 days
    assert await log_rows(db_session_factory, user_id=owner.id, event_type="owner_short_dispute")


async def test_rejecting_a_due_done_transfer_starts_a_fresh_round_on_the_open_due(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    seen = _capture(monkeypatch)
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "short_payment_reply")
    _o, _v, _c, player, b, oh, ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003130051")
    claim = await _claim(db_session_factory, b.id)
    # the player answered the first notice (no bonus window used: replied late)
    async with db_session_factory() as s:
        c = await s.get(ShortPaymentClaim, claim.id)
        c.reply_deadline_at = c.reply_deadline_at - timedelta(days=6)
        await s.commit()
    assert (await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "yes"}, headers=ph)).json()["bonus_points"] == 0
    assert (await client.post(f"/api/v1/owners/dues/{claim.id}/done", data={"method": "transfer"}, files={"screenshot": _shot()}, headers=oh)).status_code == 200
    pay = await _pending_payment(db_session_factory, b.id)
    assert (await client.post(f"/api/v1/payments/{pay.id}/reject", json={"reason": "Paise nahi aaye"}, headers=oh)).status_code == 200
    c = await _claim(db_session_factory, b.id)
    assert c.resolved_at is None and c.status == "awaiting_reply" and c.replied_at is None
    assert c.reply_deadline_at > c.updated_at  # a new 24 h from now
    assert len(await log_rows(db_session_factory, user_id=player.id, event_type="player_short_ask")) == 2
    asks = _bodies(seen, "player_short_ask")
    assert len(asks) == 2 and "Paise nahi aaye" in asks[-1]
    # a new 4-day bonus window: the reply now earns the +5
    r = await client.post(f"/api/v1/short-payments/{claim.id}/reply", json={"answer": "yes"}, headers=ph)
    assert r.status_code == 200 and r.json()["bonus_points"] == 5


async def test_rejection_with_the_reply_flag_off_keeps_the_plain_message(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    owner, _v, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923003130061")
    player = await make_user("+923003130062")
    oh = await make_auth_headers(owner)
    b = await _noshow(db_session_factory, court, player)
    await client.post(f"/api/v1/owners/bookings/{b.id}/noshow-reverse",
                      data={"final_price_pkr": 2000, "received_pkr": 1500, "method": "transfer"}, files={"screenshot": _shot()}, headers=oh)
    pay = await _pending_payment(db_session_factory, b.id)
    assert (await client.post(f"/api/v1/payments/{pay.id}/reject", json={"reason": "x"}, headers=oh)).status_code == 200
    assert await _claim(db_session_factory, b.id) is None
    assert await log_rows(db_session_factory, user_id=player.id, event_type="payment_rejected")


# ---------------------------------------------------------------- 2b. "bank mein nahi mila"


async def _staff_approved_balance(client, sf, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch, phone):
    """A completed booking of PKR 2,000 with PKR 1,000 due; the due's transfer screenshot was approved by a staff member."""
    mock_upload(monkeypatch)
    await set_flag(sf, "player_dues")
    owner, venue, _c, player, b, oh, ph = await _short_booking(client, sf, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, phone)
    staff = await make_staff(sf, make_user, venue, phone[:-1] + "7", ["approve_payments", "record_payments", "view_ledger"])
    sh = await make_auth_headers(staff)
    claim = await _claim(sf, b.id)
    assert (await client.post(f"/api/v1/owners/dues/{claim.id}/done", data={"method": "transfer"}, files={"screenshot": _shot()}, headers=sh)).status_code == 200
    pay = await _pending_payment(sf, b.id)
    assert (await client.post(f"/api/v1/payments/{pay.id}/approve", headers=sh)).status_code == 200
    entry = (await _entries(sf, b.id))[-1]
    assert entry.method == PaymentMethod.BANK_TRANSFER_PROOF and entry.recorded_by == staff.id
    return owner, venue, player, staff, b, oh, sh, ph, entry


async def test_bank_not_received_is_red_under_the_staff_member_and_staff_se_wasool_settles_it_silently(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    owner, venue, player, staff, b, oh, sh, _ph, entry = await _staff_approved_balance(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch, "+923003130071")
    q = {"venue_id": str(venue.id)}
    items = (await client.get("/api/v1/owners/bank-check", params=q, headers=oh)).json()["items"]
    item = next(i for i in items if i["entry_id"] == str(entry.id))
    assert item["kind"] == "balance" and item["can_mark"] is True and item["not_received"] is False
    # staff can see the list but cannot mark
    staff_items = (await client.get("/api/v1/owners/bank-check", params=q, headers=sh)).json()["items"]
    assert next(i for i in staff_items if i["entry_id"] == str(entry.id))["can_mark"] is False
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/not-received", headers=sh)).status_code == 403

    before = len(await log_rows(db_session_factory, user_id=player.id))
    m = await client.post(f"/api/v1/owners/bank-check/{entry.id}/not-received", headers=oh)
    assert m.status_code == 200, m.text
    assert m.json()["not_received"] is True and m.json()["decision"] is None
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/not-received", headers=oh)).status_code == 409
    bk = await _booking(db_session_factory, b.id)
    assert float(bk.balance_due) == 1000  # the transfer no longer counts
    last = (await _entries(db_session_factory, b.id))[-1]
    assert last.amount_pkr == -1000 and last.reverses_entry_id == entry.id

    act = (await client.get("/api/v1/owners/staff-activity", params=q, headers=oh)).json()
    row = next(p for p in act["people"] if p["user_id"] == str(staff.id))
    assert row["bank_missing"] == 1 and row["bank_missing_pkr"] == 1000 and row["bank_missing_open"] == 1
    flagged = act["bank_missing"]
    assert len(flagged) == 1 and flagged[0]["approved_by_id"] == str(staff.id) and flagged[0]["decision"] is None
    marked_page = (await client.get("/api/v1/owners/bank-check", params=q, headers=oh)).json()
    assert next(i for i in marked_page["items"] if i["entry_id"] == str(entry.id))["not_received"] is True
    total_before = sum(i["amount_pkr"] for i in items)
    assert marked_page["total_pkr"] == total_before - 1000  # not in the bank: out of the day's total

    d = await client.post(f"/api/v1/owners/bank-check/{entry.id}/decide", json={"decision": "staff"}, headers=oh)
    assert d.status_code == 200, d.text
    assert d.json()["decision"] == "staff"
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/decide", json={"decision": "player"}, headers=oh)).status_code == 409
    bk = await _booking(db_session_factory, b.id)
    assert float(bk.balance_due) == 0 and float(bk.price) == 2000
    last = (await _entries(db_session_factory, b.id))[-1]
    assert last.method == PaymentMethod.OTHER and last.amount_pkr == 1000 and "Staff se wasool" in last.note
    assert await _player_logs_since(db_session_factory, player.id, before) == []
    act = (await client.get("/api/v1/owners/staff-activity", params=q, headers=oh)).json()
    row = next(p for p in act["people"] if p["user_id"] == str(staff.id))
    assert row["bank_missing_open"] == 0 and act["bank_missing"][0]["decision"] == "staff"


async def test_bank_not_received_player_se_baqi_starts_the_short_payment_flow(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    seen = _capture(monkeypatch)
    await set_flag(db_session_factory, "short_payment_reply")
    owner, venue, player, _staff, b, oh, _sh, ph, entry = await _staff_approved_balance(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch, "+923003130081")
    assert (await _claim(db_session_factory, b.id)).resolution == "paid"
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/decide", json={"decision": "player"}, headers=oh)).status_code == 400  # mark first
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/not-received", headers=oh)).status_code == 200
    d = await client.post(f"/api/v1/owners/bank-check/{entry.id}/decide", json={"decision": "player"}, headers=oh)
    assert d.status_code == 200, d.text
    c = await _claim(db_session_factory, b.id)
    assert c.resolved_at is None and c.status == "awaiting_reply" and c.due_pkr == 1000
    assert "bank mein nahi mila" in _bodies(seen, "player_short_ask")[-1]
    dues = (await client.get("/api/v1/owners/dues", params={"venue_id": str(venue.id)}, headers=oh)).json()
    assert [x["booking_id"] for x in dues] == [str(b.id)]
    assert (await client.post(f"/api/v1/short-payments/{c.id}/reply", json={"answer": "no"}, headers=ph)).status_code == 200
    assert await log_rows(db_session_factory, user_id=owner.id, event_type="owner_short_dispute")


async def _staff_approved_noshow_transfer(client, sf, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch, phone):
    """A no-show taken back by transfer (PKR 1,500 on PKR 500 paid), the screenshot approved by STAFF: +50 and +10 points."""
    mock_upload(monkeypatch)
    await set_flag(sf, "player_points")
    owner, venue, (court,) = await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone)
    player = await make_user(phone[:-1] + "9")
    staff = await make_staff(sf, make_user, venue, phone[:-1] + "7", ["approve_payments", "record_payments", "view_ledger"])
    oh, sh, ph = await make_auth_headers(owner), await make_auth_headers(staff), await make_auth_headers(player)
    b = await _noshow(sf, court, player)
    r = await client.post(f"/api/v1/owners/bookings/{b.id}/noshow-reverse",
                          data={"final_price_pkr": 2000, "received_pkr": 1500, "method": "transfer"}, files={"screenshot": _shot()}, headers=sh)
    assert r.status_code == 200, r.text
    pay = await _pending_payment(sf, b.id)
    assert (await client.post(f"/api/v1/payments/{pay.id}/approve", headers=sh)).status_code == 200
    assert await _balance(sf, player) == 60
    entry = (await _entries(sf, b.id))[-1]
    assert entry.recorded_by == staff.id and entry.amount_pkr == 1500
    return owner, player, b, oh, ph, entry


async def test_player_se_baqi_takes_back_the_points_that_transfer_earned_and_says_so(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    seen = _capture(monkeypatch)
    await set_flag(db_session_factory, "short_payment_reply")
    _owner, player, b, oh, _ph, entry = await _staff_approved_noshow_transfer(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch, "+923003130101")
    # the player spent some points meanwhile: the take-back never goes below 0
    async with db_session_factory() as s:
        from app.models.audit_phase3 import PointEntry

        s.add(PointEntry(player_id=player.id, delta=-25, reason="redeem"))
        await s.commit()
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/not-received", headers=oh)).status_code == 200
    assert await _balance(db_session_factory, player) == 35  # marking alone takes nothing
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/decide", json={"decision": "player"}, headers=oh)).status_code == 200
    assert await _balance(db_session_factory, player) == 0
    async with db_session_factory() as s:
        from app.models.audit import AuditLog
        from app.models.audit_phase3 import PointEntry

        taken = {p.reason: p.delta for p in (await s.execute(select(PointEntry).where(PointEntry.booking_id == b.id, PointEntry.delta < 0))).scalars()}
        audit = (await s.execute(select(AuditLog).where(AuditLog.action == "points.bank_missing_taken_back"))).scalars().all()
    assert sum(taken.values()) == -35 and set(taken) <= {"transfer_booking_taken_back", "noshow_transfer_taken_back"}
    assert len(audit) == 1 and audit[0].new_value["points"] == 35
    ask = _bodies(seen, "player_short_ask")[-1]
    assert "bank mein nahi mila" in ask and "35 points wapas liye gaye, ab kul 0" in ask
    # a second decision is refused, so nothing is taken twice
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/decide", json={"decision": "player"}, headers=oh)).status_code == 409


async def test_staff_se_wasool_keeps_the_points_and_sends_nothing(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    _owner, player, b, oh, _ph, entry = await _staff_approved_noshow_transfer(
        client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch, "+923003130111")
    before = len(await log_rows(db_session_factory, user_id=player.id))
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/not-received", headers=oh)).status_code == 200
    assert (await client.post(f"/api/v1/owners/bank-check/{entry.id}/decide", json={"decision": "staff"}, headers=oh)).status_code == 200
    assert await _balance(db_session_factory, player) == 60
    assert await _player_logs_since(db_session_factory, player.id, before) == []
    assert float((await _booking(db_session_factory, b.id)).balance_due) == 0


async def test_an_owner_approved_transfer_cannot_be_put_on_staff_and_an_advance_cannot_be_marked(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    await set_flag(db_session_factory, "player_dues")
    _o, venue, _c, _p, b, oh, _ph = await _short_booking(client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, "+923003130091")
    claim = await _claim(db_session_factory, b.id)
    await client.post(f"/api/v1/owners/dues/{claim.id}/done", data={"method": "transfer"}, files={"screenshot": _shot()}, headers=oh)
    pay = await _pending_payment(db_session_factory, b.id)
    assert (await client.post(f"/api/v1/payments/{pay.id}/approve", headers=oh)).status_code == 200
    entries = await _entries(db_session_factory, b.id)
    balance_entry = entries[-1]
    assert (await client.post(f"/api/v1/owners/bank-check/{balance_entry.id}/not-received", headers=oh)).status_code == 200
    assert (await client.post(f"/api/v1/owners/bank-check/{balance_entry.id}/decide", json={"decision": "staff"}, headers=oh)).status_code == 400
    # the advance (or any non-balance entry) is not markable
    first = entries[0]
    assert (await client.post(f"/api/v1/owners/bank-check/{first.id}/not-received", headers=oh)).status_code == 400
