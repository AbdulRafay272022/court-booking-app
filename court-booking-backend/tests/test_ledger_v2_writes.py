"""Ledger v2 step 4 (docs/design/LEDGER-V2-CONTRACT.md 2, 4, 5, 8): the write paths and the Paisa API, flag ledger_v2 ON."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.dispute import PaymentDispute
from app.models.feature_flag import FeatureFlag
from app.models.ledger_v2 import PlayerCredit
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import UserRole
from app.services.money import load_money
from tests.round2_helpers import future_day, held_and_submitted, mock_upload, open_venue

API = "/api/v1"


async def flag(sf, key="ledger_v2", on=True):
    async with sf() as s:
        row = await s.get(FeatureFlag, key)
        if row is None:
            s.add(FeatureFlag(key=key, label=key, enabled=on))
        else:
            row.enabled = on
        await s.commit()


async def make_staff(sf, make_user, venue, phone, permissions):
    from app.models.staff import StaffMember, StaffPermission

    staff = await make_user(phone, role=UserRole.STAFF, name="Staff")
    async with sf() as s:
        sm = StaffMember(staff_user_id=staff.id, venue_id=venue.id, invited_by_user_id=venue.owner_id, is_active=True)
        s.add(sm)
        await s.flush()
        for p in permissions:
            s.add(StaffPermission(staff_member_id=sm.id, permission=p))
        await s.commit()
    return staff


async def booking(sf, court, *, price=5000, paid=0, status=BookingStatus.BOOKED, hours_from_now=-2, phone="+923001234567",
                  player_id=None, method=PaymentMethod.CASH_AT_VENUE) -> Booking:
    from app.services.payment_ledger_service import recompute_payment_totals

    start = datetime.now(timezone.utc) + timedelta(hours=hours_from_now)
    async with sf() as s:
        b = Booking(court_id=court.id, starts_at=start, ends_at=start + timedelta(hours=1), status=status, source=BookingSource.WALKIN,
                    player_name="Ali", player_phone=phone, player_id=player_id, price=price, advance_amount=min(paid, price))
        s.add(b)
        await s.flush()
        if paid:
            s.add(PaymentEntry(booking_id=b.id, amount_pkr=paid, method=method, note="Advance"))
            await s.flush()
        await recompute_payment_totals(s, b)
        await s.commit()
        await s.refresh(b)
        return b


async def money(sf, booking_id):
    async with sf() as s:
        b = await s.get(Booking, booking_id)
        return b, await load_money(s, b)


@pytest.fixture
async def setup(db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner, venue, court = await open_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923001110100",
                                           price=2000)
    await flag(db_session_factory)
    async with db_session_factory() as s:
        from app.models.venue import Venue

        v = await s.get(Venue, venue.id)
        v.cancellation_allowed, v.cancellation_cutoff_hours = True, 6
        await s.commit()
    staff = await make_staff(db_session_factory, make_user, venue, "+923001110101", ["record_payments", "view_ledger", "check_in",
                                                                                   "cancel_booking"])
    return {"owner": owner, "venue": venue, "court": court, "oh": await make_auth_headers(owner), "staff": staff,
            "sh": await make_auth_headers(staff), "sf": db_session_factory}


async def test_extra_money_needs_a_choice_refund_or_credit(client, setup):
    sf, court, oh, sh = setup["sf"], setup["court"], setup["oh"], setup["sh"]
    b = await booking(sf, court, price=6000)
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh, json={"amount_pkr": 6500, "method": "cash_at_venue"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "EXCESS_CHOICE_REQUIRED"
    assert r.json()["error"]["details"] == {"excess_pkr": 500, "can_credit": True}
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh,
                          json={"amount_pkr": 6500, "method": "cash_at_venue", "excess_choice": "refund"})
    assert r.status_code == 201, r.text
    _b, m = await money(sf, b.id)
    assert (m.net, m.refund_due, m.status) == (6500, 500, "refund_due")
    async with sf() as s:
        d = (await s.scalars(select(PaymentDispute).where(PaymentDispute.booking_id == b.id))).one()
        assert d.reason == "overpayment_excess" and float(d.refund_amount) == 500

    b2 = await booking(sf, court, price=6000, hours_from_now=-5)
    r = await client.post(f"{API}/bookings/{b2.id}/payment-entries", headers=sh,
                          json={"amount_pkr": 6500, "method": "cash_at_venue", "excess_choice": "credit"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "OWNER_ONLY"  # credit is owner-only
    r = await client.post(f"{API}/bookings/{b2.id}/payment-entries", headers=oh,
                          json={"amount_pkr": 6500, "method": "cash_at_venue", "excess_choice": "credit"})
    assert r.status_code == 201, r.text
    _b, m = await money(sf, b2.id)
    assert (m.net, m.refund_due, m.credit_out, m.status) == (6000, 0, 500, "attendance_pending")  # booked, slot over
    async with sf() as s:
        assert sum(c.delta_pkr for c in (await s.scalars(select(PlayerCredit))).all()) == 500


async def test_transfer_must_go_with_its_screenshot(client, setup):
    b = await booking(setup["sf"], setup["court"])
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=setup["oh"],
                          json={"amount_pkr": 1000, "method": "bank_transfer_proof"})
    assert r.status_code == 422


async def test_duplicate_and_business_day_guards(client, setup):
    sf, court, oh = setup["sf"], setup["court"], setup["oh"]
    b = await booking(sf, court)
    body = {"amount_pkr": 1000, "method": "cash_at_venue"}
    assert (await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh, json=body)).status_code == 201
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh, json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "POSSIBLE_DUPLICATE"
    assert (await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh, json={**body, "confirm_duplicate": True})).status_code == 201
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh, json={"amount_pkr": 500, "method": "cash_at_venue",
                                                                                     "business_date": tomorrow})
    assert r.json()["error"]["code"] == "BUSINESS_DATE_IN_FUTURE"
    past = (datetime.now(timezone.utc) - timedelta(days=5)).date().isoformat()
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh, json={"amount_pkr": 500, "method": "cash_at_venue",
                                                                                     "business_date": past})
    assert r.json()["error"]["code"] == "BACKDATE_NOTE_REQUIRED"
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh, json={"amount_pkr": 500, "method": "cash_at_venue",
                                                                                     "business_date": past, "note": "kal ka"})
    assert r.status_code == 201 and r.json()["entry"]["money_business_date"] == past


async def test_typo_reversal_closes_the_refund_and_is_owner_only(client, setup):
    sf, court, oh, sh = setup["sf"], setup["court"], setup["oh"], setup["sh"]
    b = await booking(sf, court, price=2000)
    r = await client.post(f"{API}/bookings/{b.id}/payment-entries", headers=oh,
                          json={"amount_pkr": 4000, "method": "cash_at_venue", "excess_choice": "refund"})
    entry_id = r.json()["entry"]["id"]
    r = await client.post(f"{API}/payment-entries/{entry_id}/reverse", headers=sh, json={"reason": "typo"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "OWNER_ONLY"
    r = await client.post(f"{API}/payment-entries/{entry_id}/reverse", headers=oh, json={"reason": "4,000 likh diya, 2,000 mila"})
    assert r.status_code == 200, r.text
    _b, m = await money(sf, b.id)
    assert (m.net, m.refund_due) == (0, 0)
    async with sf() as s:
        d = (await s.scalars(select(PaymentDispute).where(PaymentDispute.booking_id == b.id))).one()
        assert d.resolved and d.refund_status == "closed"


async def test_noshow_keeps_advance_then_player_was_here(client, setup):
    sf, court, oh, sh = setup["sf"], setup["court"], setup["oh"], setup["sh"]
    b = await booking(sf, court, price=5000, paid=1000, method=PaymentMethod.BANK_TRANSFER_PROOF)
    assert (await client.post(f"{API}/bookings/{b.id}/no-show", headers=sh)).status_code == 200
    _b, m = await money(sf, b.id)
    assert (m.final, m.balance, m.status) == (1000, 0, "noshow_kept")
    r = await client.post(f"{API}/owners/bookings/{b.id}/noshow-reverse", headers=sh,
                          data={"final_price_pkr": "5000", "received_pkr": "0", "method": "cash"})
    assert r.status_code == 403
    r = await client.post(f"{API}/owners/bookings/{b.id}/noshow-reverse", headers=oh,
                          data={"final_price_pkr": "5000", "received_pkr": "0", "method": "cash"})
    assert r.status_code == 200, r.text
    bb, m = await money(sf, b.id)
    assert (bb.status, m.final, m.due) == (BookingStatus.COMPLETED, 5000, 4000)


async def test_noshow_full_charge_leaves_the_rest_due(client, setup):
    sf, court, oh = setup["sf"], setup["court"], setup["oh"]
    async with sf() as s:
        from app.models.venue import Venue

        (await s.get(Venue, setup["venue"].id)).no_show_charge = "full"
        await s.commit()
    b = await booking(sf, court, price=5000, paid=1000)
    assert (await client.post(f"{API}/bookings/{b.id}/no-show", headers=oh)).status_code == 200
    _b, m = await money(sf, b.id)
    assert (m.final, m.due) == (5000, 4000)


async def test_cancel_rules(client, setup, make_user, make_auth_headers):
    sf, court, oh = setup["sf"], setup["court"], setup["oh"]
    player = await make_user("+923001110199", name="Player")
    ph = await make_auth_headers(player)
    early = await booking(sf, court, price=5000, paid=500, hours_from_now=48, player_id=player.id)
    r = await client.get(f"{API}/bookings/{early.id}/cancel-preview", headers=ph)
    assert r.json()["mode"] == "refund" and r.json()["refund_pkr"] == 500
    assert (await client.post(f"{API}/bookings/{early.id}/cancel", headers=ph, json={})).status_code == 200
    _b, m = await money(sf, early.id)
    assert (m.final, m.refund_due, m.status) == (0, 500, "cancel_refund")

    late = await booking(sf, court, price=5000, paid=1000, hours_from_now=2, player_id=player.id)
    r = await client.post(f"{API}/bookings/{late.id}/cancel", headers=ph, json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "CANCEL_KEEPS_ADVANCE"
    assert r.json()["error"]["details"]["advance_pkr"] == 1000
    assert (await client.post(f"{API}/bookings/{late.id}/cancel", headers=ph, json={"accept_keep_advance": True})).status_code == 200
    _b, m = await money(sf, late.id)
    assert (m.final, m.refund_due, m.status) == (1000, 0, "cancel_kept")

    venue_cancel = await booking(sf, court, price=5000, paid=1000, hours_from_now=3)
    r = await client.post(f"{API}/bookings/{venue_cancel.id}/cancel", headers=oh, json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "CANCELLED_FOR_REQUIRED"
    assert (await client.post(f"{API}/bookings/{venue_cancel.id}/cancel", headers=oh, json={"cancelled_for": "venue"})).status_code == 200
    _b, m = await money(sf, venue_cancel.id)
    assert (m.refund_due, m.status) == (1000, "cancel_refund")


async def test_cancel_stays_blocked_where_the_venue_does_not_allow_it(client, setup, make_user, make_auth_headers):
    sf = setup["sf"]
    async with sf() as s:
        from app.models.venue import Venue

        (await s.get(Venue, setup["venue"].id)).cancellation_allowed = False
        await s.commit()
    player = await make_user("+923001110198", name="Player")
    b = await booking(sf, setup["court"], price=5000, paid=1000, hours_from_now=48, player_id=player.id)
    r = await client.post(f"{API}/bookings/{b.id}/cancel", headers=await make_auth_headers(player), json={"accept_keep_advance": True})
    assert r.status_code == 400 and r.json()["error"]["code"] == "CANCELLATION_NOT_ALLOWED"


async def test_waive_and_reduce_are_owner_only_adjustments(client, setup):
    sf, court, oh, sh = setup["sf"], setup["court"], setup["oh"], setup["sh"]
    b = await booking(sf, court, price=5000, paid=3000, status=BookingStatus.COMPLETED)
    url = f"{API}/owners/paisa/bookings/{b.id}/adjustments"
    r = await client.post(url, headers=sh, json={"kind": "waived", "amount_pkr": 2000, "reason": "x"})
    assert r.status_code == 403
    r = await client.post(url, headers=oh, json={"kind": "waived", "amount_pkr": 2500, "reason": "x"})
    assert r.status_code == 400  # waive <= due
    r = await client.post(url, headers=oh, json={"kind": "waived", "amount_pkr": 2000, "reason": "regular player"})
    assert r.status_code == 201, r.text
    assert r.json()["calc"]["final"] == 5000 and r.json()["calc"]["waived"] == 2000 and r.json()["calc"]["due"] == 0
    bb, _m = await money(sf, b.id)
    assert float(bb.price) == 5000 and float(bb.balance_due) == 0  # the price is not cut by a waiver


async def test_walkin_extra_needs_a_choice(client, setup):
    oh, court = setup["oh"], setup["court"]
    day = future_day(2)
    body = {"court_id": str(court.id), "starts_at": f"{day.isoformat()}T10:00:00+00:00", "player_name": "Walk", "player_phone": "03001112233",
            "amount_paid": 4000, "whatsapp_opt_in": False}
    r = await client.post(f"{API}/bookings/walkin", headers=oh, json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "EXCESS_CHOICE_REQUIRED"
    async with setup["sf"]() as s:
        assert (await s.scalar(select(Booking.id).where(Booking.player_name == "Walk"))) is None  # nothing half-created
    r = await client.post(f"{API}/bookings/walkin", headers=oh, json={**body, "excess_choice": "refund"})
    assert r.status_code == 201, r.text
    _b, m = await money(setup["sf"], r.json()["booking"]["id"])
    assert (m.final, m.net, m.refund_due) == (2000, 4000, 2000)


async def test_approve_extra_on_advance_is_choice_then_credited(client, setup, make_user, make_auth_headers, monkeypatch):
    mock_upload(monkeypatch)
    player = await make_user("+923001110197", name="P")
    ph = await make_auth_headers(player)
    bid, pid = await held_and_submitted(client, setup["court"], ph, future_day(3))
    r = await client.post(f"{API}/payments/{pid}/approve", headers=setup["oh"], json={"amount_pkr": 2600})
    assert r.status_code == 409 and r.json()["error"]["code"] == "EXCESS_CHOICE_REQUIRED"
    r = await client.post(f"{API}/payments/{pid}/approve", headers=setup["oh"], json={"amount_pkr": 2600, "excess_choice": "refund"})
    assert r.status_code == 200, r.text
    _b, m = await money(setup["sf"], bid)
    assert (m.final, m.net, m.refund_due) == (2000, 2600, 600)


async def test_refund_marked_paid_in_cash_is_a_linked_refund_entry(client, setup, make_user, make_auth_headers):
    sf = setup["sf"]
    await flag(sf, "refunds")
    player = await make_user("+923001110196", name="P")
    b = await booking(sf, setup["court"], price=5000, paid=500, hours_from_now=48, player_id=player.id)
    await client.post(f"{API}/bookings/{b.id}/cancel", headers=await make_auth_headers(player), json={})
    async with sf() as s:
        d = (await s.scalars(select(PaymentDispute).where(PaymentDispute.booking_id == b.id))).one()
    r = await client.post(f"{API}/owners/refunds/{d.id}/mark-refunded", headers=setup["oh"], data={"method": "cash"})
    assert r.status_code == 422  # a cash refund needs a note
    r = await client.post(f"{API}/owners/refunds/{d.id}/mark-refunded", headers=setup["oh"], data={"method": "cash", "note": "counter par diye"})
    assert r.status_code == 200, r.text
    async with sf() as s:
        e = (await s.scalars(select(PaymentEntry).where(PaymentEntry.booking_id == b.id, PaymentEntry.kind == "refund"))).one()
        assert e.dispute_id == d.id and e.method == PaymentMethod.CASH_AT_VENUE and e.amount_pkr == -500 and e.refund_of_entry_id
    _b, m = await money(sf, b.id)
    assert (m.refund_due, m.status) == (0, "cancel_clear")


async def test_paisa_reads_identity_and_right_now(client, setup):
    sf, court, oh = setup["sf"], setup["court"], setup["oh"]
    await booking(sf, court, price=5000, paid=3000, status=BookingStatus.COMPLETED)
    await booking(sf, court, price=6000, paid=6500, status=BookingStatus.COMPLETED, hours_from_now=-30)
    await booking(sf, court, price=5000, paid=1000, hours_from_now=30)
    vid = str(setup["venue"].id)
    s1 = (await client.get(f"{API}/owners/paisa/summary", headers=oh, params={"venue_id": vid, "period": "this_month"})).json()
    s2 = (await client.get(f"{API}/owners/paisa/summary", headers=oh, params={"venue_id": vid, "period": "today"})).json()
    assert s1["right_now"] == s2["right_now"]  # the date range does not move "Right now"
    st = s1["statement"]
    assert st["final"] == st["received"] + st["due"] + st["due_at_slot"] + st["waived"] - st["refund_due"]
    assert st["booking_amount"] - st["deductions"]["total"] == st["final"]
    rows = (await client.get(f"{API}/owners/paisa/bookings", headers=oh, params={"venue_id": vid, "period": "this_month"})).json()
    assert rows["totals"] == st and rows["total"] == 3
    csv = (await client.get(f"{API}/owners/paisa/bookings.csv", headers=oh, params={"venue_id": vid, "period": "this_month"})).text
    assert csv.strip().splitlines()[-1].split(",")[10] == str(st["final"])  # CSV = screen


async def test_kaam_for_refund_only_staff_and_flag_off(client, setup, make_user, make_auth_headers):
    sf, venue = setup["sf"], setup["venue"]
    refunder = await make_staff(sf, make_user, venue, "+923001110102", ["mark_refunds"])
    rh = await make_auth_headers(refunder)
    t = (await client.get(f"{API}/owners/paisa/tasks", headers=rh, params={"venue_id": str(venue.id)})).json()
    assert {g["key"] for g in t["groups"]} == {"refund_due", "refund_not_got"}
    full = (await client.get(f"{API}/owners/paisa/tasks", headers=setup["oh"], params={"venue_id": str(venue.id)})).json()
    assert [g["key"] for g in full["groups"]] == ["short_decide", "noshow_reply", "refund_due", "refund_not_got", "bank_check",
                                                  "screenshots", "attendance", "due_collect"]


async def test_paisa_api_is_off_without_the_flag(client, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923001110150", role=UserRole.OWNER)
    venue = await make_venue(owner)
    r = await client.get(f"{API}/owners/paisa/tasks", headers=await make_auth_headers(owner), params={"venue_id": str(venue.id)})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FEATURE_DISABLED"


async def test_refund_due_filter_includes_cancelled_and_matches_the_box(client, setup, make_user, make_auth_headers):
    """Statement "Refund due" box -> Bookings list: a cancelled booking still owed money (pill cancel_refund) is in the
    box's total, so the refund_due filter must list it too (web gap 3, 14 Nov)."""
    sf, court, oh = setup["sf"], setup["court"], setup["oh"]
    player = await make_user("+923001110198", name="Player")
    ph = await make_auth_headers(player)
    cancelled = await booking(sf, court, price=5000, paid=500, hours_from_now=48, player_id=player.id)
    assert (await client.post(f"{API}/bookings/{cancelled.id}/cancel", headers=ph, json={})).status_code == 200
    over = await booking(sf, court, price=6000, paid=6500, status=BookingStatus.COMPLETED)
    await booking(sf, court, price=5000, paid=5000, status=BookingStatus.COMPLETED)
    vid = str(setup["venue"].id)
    params = {"venue_id": vid, "period": "this_month"}
    st = (await client.get(f"{API}/owners/paisa/summary", headers=oh, params=params)).json()["statement"]
    rows = (await client.get(f"{API}/owners/paisa/bookings", headers=oh, params={**params, "money_status": "refund_due"})).json()
    assert {i["booking_id"] for i in rows["items"]} == {str(cancelled.id), str(over.id)}
    assert rows["totals"]["refund_due"] == st["refund_due"] == 1000


async def test_every_statement_box_filter_lists_exactly_its_total(client, setup, make_user, make_auth_headers):
    """Founder 14 Nov: tapping a Statement box (Mila, Lena baqi, Slot par lena, Maaf kiya, Wapas dena, Kami) lists exactly the
    bookings in that box's number: sum of the listed rows = the box, on every box. Before, Due / Due at slot filtered on the
    part_paid / advance_paid pill and missed unpaid and no-show bookings."""
    sf, court, oh = setup["sf"], setup["court"], setup["oh"]
    player = await make_user("+923001110196", name="Player")
    done = BookingStatus.COMPLETED
    unpaid_played = await booking(sf, court, price=4000, status=done, hours_from_now=-2)                                   # due, pill unpaid
    await booking(sf, court, price=5000, paid=3000, status=done, hours_from_now=-4)                     # due, part_paid
    noshow = await booking(sf, court, price=3000, paid=1000, status=BookingStatus.NO_SHOW, hours_from_now=-6)               # due, no-show pill
    await booking(sf, court, price=5000, paid=1000, hours_from_now=30)                                  # due at slot, advance_paid
    unpaid_later = await booking(sf, court, price=3000, hours_from_now=33)                              # due at slot, pill unpaid
    waived = await booking(sf, court, price=5000, paid=3000, status=done, hours_from_now=-8)
    reduced = await booking(sf, court, price=6000, paid=5000, status=done, hours_from_now=-10)
    await booking(sf, court, price=6000, paid=6500, status=done, hours_from_now=-12)                                        # refund due
    cancelled = await booking(sf, court, price=5000, paid=500, hours_from_now=48, player_id=player.id)  # refund due, cancel pill
    await booking(sf, court, price=5000, paid=5000, status=done, hours_from_now=-14)                                        # paid in full only
    url = f"{API}/owners/paisa/bookings"
    r = await client.post(f"{url}/{waived.id}/adjustments", headers=oh, json={"kind": "waived", "amount_pkr": 2000, "reason": "x"})
    assert r.status_code == 201, r.text
    r = await client.post(f"{url}/{reduced.id}/adjustments", headers=oh, json={"kind": "price_reduced", "amount_pkr": 1000, "reason": "x"})
    assert r.status_code == 201, r.text
    r = await client.post(f"{API}/bookings/{cancelled.id}/cancel", headers=await make_auth_headers(player), json={})
    assert r.status_code == 200, r.text

    today = datetime.now(timezone.utc).date()
    params = {"venue_id": str(setup["venue"].id), "period": "custom", "from": str(today - timedelta(days=3)),
              "to": str(today + timedelta(days=3)), "page_size": 200}
    st = (await client.get(f"{API}/owners/paisa/summary", headers=oh, params=params)).json()["statement"]
    box_total = {"received": st["received"], "due": st["due"], "due_at_slot": st["due_at_slot"], "waived": st["waived"],
                 "refund_due": st["refund_due"], "deductions": st["deductions"]["total"]}
    assert box_total == {"received": 25000, "due": 8000, "due_at_slot": 7000, "waived": 2000, "refund_due": 1000, "deductions": 6000}
    lists = {}
    for box, total in box_total.items():
        r = await client.get(url, headers=oh, params={**params, "box": box})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == len(data["items"])
        assert sum(i[box] for i in data["items"]) == total, box
        t = data["totals"]["deductions"]["total"] if box == "deductions" else data["totals"][box]
        assert t == total, box
        assert all(i[box] != 0 for i in data["items"]), box  # nothing in the list that the box does not count
        lists[box] = {i["booking_id"] for i in data["items"]}
    assert len(lists["received"]) == 8  # every booking that has money on it (not the unpaid ones)
    assert {str(unpaid_played.id), str(noshow.id)} <= lists["due"] and len(lists["due"]) == 3
    assert str(unpaid_later.id) in lists["due_at_slot"] and len(lists["due_at_slot"]) == 2
    assert lists["waived"] == {str(waived.id)} and lists["deductions"] == {str(reduced.id), str(cancelled.id)}  # cancel = Final 0
    assert str(cancelled.id) in lists["refund_due"] and len(lists["refund_due"]) == 2
    r = await client.get(url, headers=oh, params={**params, "box": "nope"})
    assert r.status_code == 422


async def test_kaam_refund_not_got_counts_an_unanswered_not_received(client, setup, make_user, make_auth_headers):
    """Kaam "Paisa nahi mila": the player says a refund transfer never arrived and the venue has not replied yet. The refund
    rows carry their transfers as dicts, so the group used to read 0 forever (found on the 14 Nov screenshot run)."""
    from app.models.refund_flow import RefundTransfer

    sf, court, oh = setup["sf"], setup["court"], setup["oh"]
    player = await make_user("+923001110195", name="Player")
    ph = await make_auth_headers(player)
    b = await booking(sf, court, price=5000, paid=1000, hours_from_now=48, player_id=player.id)
    assert (await client.post(f"{API}/bookings/{b.id}/cancel", headers=ph, json={})).status_code == 200
    params = {"venue_id": str(setup["venue"].id)}
    groups = lambda t: {g["key"]: g["count"] for g in t["groups"]}  # noqa: E731
    t = (await client.get(f"{API}/owners/paisa/tasks", headers=oh, params=params)).json()
    refund = next(g for g in t["groups"] if g["key"] == "refund_due")["items"][0]
    assert groups(t)["refund_not_got"] == 0
    r = await client.post(f"{API}/owners/refunds/{refund['id']}/mark-refunded", headers=oh, data={"reference": "TX-1", "amount": "400"})
    assert r.status_code == 200, r.text
    async with sf() as s:
        tid = (await s.scalars(select(RefundTransfer.id).where(RefundTransfer.booking_id == b.id))).one()
    r = await client.post(f"{API}/refund-transfers/{tid}/answer", headers=ph, json={"answer": "not_received", "note": "nahi aaya"})
    assert r.status_code == 200, r.text
    t = (await client.get(f"{API}/owners/paisa/tasks", headers=oh, params=params)).json()
    assert groups(t)["refund_not_got"] == 1
    r = await client.post(f"{API}/owners/refund-transfers/{tid}/reply", headers=oh, json={"note": "Dobara bhej diya"})
    assert r.status_code == 200, r.text
    t = (await client.get(f"{API}/owners/paisa/tasks", headers=oh, params=params)).json()
    assert groups(t)["refund_not_got"] == 0
