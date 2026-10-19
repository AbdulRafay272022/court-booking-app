"""Owner Overview "Booking completed" (Haan / Nahi) through the payment ledger. Real Postgres."""
import uuid
from datetime import time, timedelta

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.booking import Booking, BookingStatus, CancelledBy
from app.models.feature_flag import FeatureFlag
from app.models.payment_entry import PaymentEntry
from app.models.user import User, UserRole
from app.utils.timezone import pkt_today
from overview_helpers import add_booking, at, make_staff, past_day, seed_venue

OV = "/api/v1/owners/overview"
HIST = "/api/v1/owners/bookings-history"


def completion_url(booking_id) -> str:
    return f"/api/v1/owners/bookings/{booking_id}/completion"


@pytest.fixture
def seed(make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    async def _seed(phone):
        return await seed_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone)

    return _seed


async def _entries(sf, booking_id):
    async with sf() as session:
        rows = await session.execute(
            select(PaymentEntry).where(PaymentEntry.booking_id == booking_id).order_by(PaymentEntry.created_at, PaymentEntry.id)
        )
        return list(rows.scalars().all())


async def _booking(sf, booking_id) -> Booking:
    async with sf() as session:
        return await session.get(Booking, booking_id)


async def _audit(sf, booking_id):
    async with sf() as session:
        rows = await session.execute(
            select(AuditLog)
            .where(AuditLog.entity_id == booking_id, AuditLog.action == "booking.completion_marked")
            .order_by(AuditLog.id)
        )
        return list(rows.scalars().all())


async def _consistent(sf, booking_id):
    """bookings.amount_paid / balance_due are exactly the ledger sum (recompute is their only writer)."""
    entries = await _entries(sf, booking_id)
    booking = await _booking(sf, booking_id)
    assert float(booking.amount_paid) == sum(e.amount_pkr for e in entries)
    assert float(booking.balance_due) == max(float(booking.price) - sum(e.amount_pkr for e in entries), 0)


async def test_refused_before_the_slot_ends_and_for_unconfirmed_bookings(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900001")
    headers = await make_auth_headers(owner)
    future = await add_booking(db_session_factory, court, at(pkt_today() + timedelta(days=3), 12), 1, paid=500)
    r = await client.post(completion_url(future.id), json={"result": "yes"}, headers=headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "COMPLETION_TOO_EARLY"

    d = past_day()
    held = await add_booking(db_session_factory, court, at(d, 11), 1, status=BookingStatus.HELD)
    cancelled = await add_booking(
        db_session_factory, court, at(d, 13), 1, status=BookingStatus.CANCELLED, cancelled_by=CancelledBy.OWNER
    )
    submitted = await add_booking(db_session_factory, court, at(d, 15), 1, status=BookingStatus.PAYMENT_SUBMITTED)
    for b in (held, cancelled, submitted):
        r = await client.post(completion_url(b.id), json={"result": "yes"}, headers=headers)
        assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_BOOKING_STATE", b.status
    assert await _audit(db_session_factory, future.id) == []
    assert (await client.post(completion_url(uuid.uuid4()), json={"result": "yes"}, headers=headers)).status_code == 404


async def test_haan_pays_the_remaining_due_through_the_ledger(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900002")
    headers = await make_auth_headers(owner)
    b = await add_booking(db_session_factory, court, at(past_day(), 18), 1, price=2000, paid=500, advance=500, name="Hina")

    r = await client.post(completion_url(b.id), json={"result": "yes"}, headers=headers)
    assert r.status_code == 200, r.text
    row = r.json()
    assert (row["total"], row["total_paid"], row["due"]) == (2000, 2000, 0)
    assert row["completion"]["result"] == "yes" and row["completion"]["received_pkr"] == 2000
    assert row["completion"]["marked_by_name"] == "Owner One" and row["slot_ended"] is True

    entries = await _entries(db_session_factory, b.id)
    assert [e.amount_pkr for e in entries] == [500, 1500]
    assert entries[1].method.value == "cash_at_venue" and entries[1].note == "Booking completed"
    await _consistent(db_session_factory, b.id)
    logs = await _audit(db_session_factory, b.id)
    assert len(logs) == 1 and logs[0].old_value is None
    assert logs[0].new_value == {"result": "yes", "received_pkr": 2000, "reason": None}

    # Haan again: no second payment (nothing left to pay) but the click is still recorded
    again = await client.post(completion_url(b.id), json={"result": "yes"}, headers=headers)
    assert again.status_code == 200
    assert [e.amount_pkr for e in await _entries(db_session_factory, b.id)] == [500, 1500]
    logs = await _audit(db_session_factory, b.id)
    assert len(logs) == 2 and logs[1].old_value["result"] == "yes"
    await _consistent(db_session_factory, b.id)


async def test_haan_on_a_fully_paid_booking_adds_no_entry(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900003")
    b = await add_booking(db_session_factory, court, at(past_day(), 18), 1, price=1000, paid=1000)
    r = await client.post(completion_url(b.id), json={"result": "yes"}, headers=await make_auth_headers(owner))
    assert r.status_code == 200 and r.json()["due"] == 0
    assert len(await _entries(db_session_factory, b.id)) == 1
    assert len(await _audit(db_session_factory, b.id)) == 1


async def test_nahi_adjusts_total_paid_up_or_down_never_editing_rows(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900004")
    headers = await make_auth_headers(owner)
    b = await add_booking(db_session_factory, court, at(past_day(), 18), 1, price=2000, paid=500, advance=500)

    # Nahi with more than recorded: a positive cash entry for the difference
    up = await client.post(completion_url(b.id), json={"result": "no", "received_pkr": 1200, "reason": "Paid half at the desk"}, headers=headers)
    assert up.status_code == 200, up.text
    row = up.json()
    assert (row["total_paid"], row["due"]) == (1200, 800)
    assert row["completion"] == {**row["completion"], "result": "no", "received_pkr": 1200, "reason": "Paid half at the desk"}
    assert [e.amount_pkr for e in await _entries(db_session_factory, b.id)] == [500, 700]

    # Nahi with less than recorded: a NEGATIVE `other` correction entry, nothing deleted or edited
    down = await client.post(completion_url(b.id), json={"result": "no", "received_pkr": 300}, headers=headers)
    assert down.status_code == 200
    assert (down.json()["total_paid"], down.json()["due"]) == (300, 1700)
    entries = await _entries(db_session_factory, b.id)
    assert [e.amount_pkr for e in entries] == [500, 700, -900]
    assert entries[2].method.value == "other" and entries[2].reverses_entry_id is None
    await _consistent(db_session_factory, b.id)

    # nothing received at all
    zero = await client.post(completion_url(b.id), json={"result": "no", "received_pkr": 0}, headers=headers)
    assert (zero.json()["total_paid"], zero.json()["due"]) == (0, 2000)
    await _consistent(db_session_factory, b.id)
    assert len(await _audit(db_session_factory, b.id)) == 3


async def test_change_haan_to_nahi_is_recorded_and_ledger_stays_consistent(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900005")
    headers = await make_auth_headers(owner)
    d = past_day()
    b = await add_booking(db_session_factory, court, at(d, 18), 1, price=2000, paid=2000, name="Changer")
    await client.post(completion_url(b.id), json={"result": "yes"}, headers=headers)
    changed = await client.post(completion_url(b.id), json={"result": "no", "received_pkr": 1500, "reason": "Short by 500"}, headers=headers)
    assert changed.status_code == 200
    assert (changed.json()["total_paid"], changed.json()["due"]) == (1500, 500)

    logs = await _audit(db_session_factory, b.id)
    assert len(logs) == 2
    assert logs[1].old_value == {"result": "yes", "received_pkr": 2000, "reason": None}
    assert logs[1].new_value == {"result": "no", "received_pkr": 1500, "reason": "Short by 500"}
    assert [e.amount_pkr for e in await _entries(db_session_factory, b.id)] == [2000, -500]
    await _consistent(db_session_factory, b.id)

    # the current state is the LATEST row everywhere: Overview, History filters, detail
    ov = (await client.get(OV, params={"date": d.isoformat()}, headers=headers)).json()
    assert ov["rows"][0]["completion"]["result"] == "no"
    assert ov["money"] == {"collected": 1500, "due": 500, "due_bookings": 1}
    base = {"date_from": d.isoformat(), "date_to": d.isoformat()}
    assert (await client.get(HIST, params={**base, "statuses": "short_paid"}, headers=headers)).json()["total"] == 1
    assert (await client.get(HIST, params={**base, "statuses": "completed"}, headers=headers)).json()["total"] == 0
    det = (await client.get(f"/api/v1/owners/bookings/{b.id}/overview-detail", headers=headers)).json()
    assert det["completion"]["result"] == "no" and det["completion"]["reason"] == "Short by 500"
    assert [e["kind"] for e in det["timeline"]].count("completion_marked") == 2

    # ledger page: today's entries sum to exactly what the booking now holds (no double counting)
    ledger = (
        await client.get("/api/v1/owners/ledger", params={"start_date": pkt_today().isoformat(), "end_date": pkt_today().isoformat()}, headers=headers)
    ).json()
    assert ledger["summary"]["total_in_range"] == 1500
    assert ledger["summary"]["outstanding_balance"] == 500


async def test_nahi_validation(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900006")
    headers = await make_auth_headers(owner)
    b = await add_booking(db_session_factory, court, at(past_day(), 18), 1, price=2000, paid=500)
    assert (await client.post(completion_url(b.id), json={"result": "no"}, headers=headers)).status_code == 400
    assert (await client.post(completion_url(b.id), json={"result": "no", "received_pkr": 2001}, headers=headers)).status_code == 400
    assert (await client.post(completion_url(b.id), json={"result": "no", "received_pkr": -1}, headers=headers)).status_code == 422
    assert (await client.post(completion_url(b.id), json={"result": "maybe"}, headers=headers)).status_code == 422
    assert await _audit(db_session_factory, b.id) == []
    assert [e.amount_pkr for e in await _entries(db_session_factory, b.id)] == [500]


async def test_no_show_and_checked_in_bookings_can_be_completed(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900007")
    headers = await make_auth_headers(owner)
    ns = await add_booking(db_session_factory, court, at(past_day(), 11), 1, status=BookingStatus.NO_SHOW, price=1000, paid=0)
    ci = await add_booking(db_session_factory, court, at(past_day(), 13), 1, status=BookingStatus.COMPLETED, price=1000, paid=400, checked_in=True)
    for b in (ns, ci):
        r = await client.post(completion_url(b.id), json={"result": "yes"}, headers=headers)
        assert r.status_code == 200 and r.json()["due"] == 0
    # Round 2 Stage 2 (spec C.3): Haan/Nahi now settles the status too -- a no_show becomes completed
    assert (await _booking(db_session_factory, ns.id)).status == BookingStatus.COMPLETED
    assert (await _booking(db_session_factory, ci.id)).status == BookingStatus.COMPLETED


async def test_completion_permission_is_record_payments_and_not_behind_split_payments(
    seed, make_auth_headers, client, db_session_factory, make_user
):
    owner, venue, (court,) = await seed("+923009900008")
    owner_headers = await make_auth_headers(owner)
    async with db_session_factory() as s:
        s.add(FeatureFlag(key="split_payments", enabled=False, label="split"))
        await s.commit()
    b = await add_booking(db_session_factory, court, at(past_day(), 18), 1, price=2000, paid=500)

    async def load_user(uid):
        async with db_session_factory() as session:
            return await session.get(User, uid)

    _u1, reader = await make_staff(client, owner_headers, venue, "+923009900101", ["view_ledger"], load_user, make_auth_headers)
    _u2, no_flag_perm = await make_staff(client, owner_headers, venue, "+923009900102", ["check_in"], load_user, make_auth_headers)
    assert (await client.post(completion_url(b.id), json={"result": "yes"}, headers=reader)).status_code == 403
    assert (await client.post(completion_url(b.id), json={"result": "yes"}, headers=no_flag_perm)).status_code == 403
    player = await make_user("+923009900103")
    assert (await client.post(completion_url(b.id), json={"result": "yes"}, headers=await make_auth_headers(player))).status_code == 403
    other_owner = await make_user("+923009900104", role=UserRole.OWNER)
    assert (await client.post(completion_url(b.id), json={"result": "yes"}, headers=await make_auth_headers(other_owner))).status_code == 403
    assert await _audit(db_session_factory, b.id) == []

    # the owner may, even though the split_payments flag is OFF (plain bookings must work)
    ok = await client.post(completion_url(b.id), json={"result": "yes"}, headers=owner_headers)
    assert ok.status_code == 200 and ok.json()["total_paid"] == 2000
    await _consistent(db_session_factory, b.id)


async def test_staff_with_record_payments_can_complete(seed, make_auth_headers, client, db_session_factory):
    owner, venue, (court,) = await seed("+923009900009")
    owner_headers = await make_auth_headers(owner)
    b = await add_booking(db_session_factory, court, at(past_day(), 18), 1, price=2000, paid=500)

    async def load_user(uid):
        async with db_session_factory() as session:
            return await session.get(User, uid)

    staff, headers = await make_staff(
        client, owner_headers, venue, "+923009900105", ["view_ledger", "record_payments"], load_user, make_auth_headers
    )
    r = await client.post(completion_url(b.id), json={"result": "yes"}, headers=headers)
    assert r.status_code == 200 and r.json()["completion"]["marked_by_name"] == "Staff Sam"
    logs = await _audit(db_session_factory, b.id)
    assert logs[0].actor_id == staff.id and logs[0].actor_type == "staff"
    await _consistent(db_session_factory, b.id)
