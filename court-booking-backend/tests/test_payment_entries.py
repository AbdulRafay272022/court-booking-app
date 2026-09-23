"""Section 32 Part 5: split payments (advance now, balance later) and the payment_entries ledger.

Covers exactly what the spec calls out as tests: partial payments summing to the total, an over-payment
being rejected, two owners recording at the same moment (the same atomic-guard concern as payment
approval), and a cancelled booking's payments still appearing in the ledger -- plus the new court-level
advance rule (fixed/percent/minimum, falling back to the pricing rule) and the admin correction path."""
import asyncio
from datetime import date, time, timedelta

from app.models.booking import Booking, BookingStatus
from app.models.court import CourtAdvanceType
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today


async def _open_court(make_court, make_schedule, make_pricing_rule, venue, **court_kwargs):
    court = await make_court(venue, slot_minutes=90, **court_kwargs)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3500, advance_percentage=100.00)
    return court


async def _booked(db_session_factory, court, player, *, price=3500, advance_amount=3500, day_offset=2):
    """A BOOKED booking with no payment_entries yet -- tests seed the entries they need themselves."""
    starts = pkt_time_to_utc(pkt_today() + timedelta(days=day_offset), time(10, 0))
    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(minutes=90),
            price=price, advance_amount=advance_amount, status=BookingStatus.BOOKED,
            player_name=player.name, player_phone=player.phone,
        )
        session.add(booking)
        await session.commit()
        await session.refresh(booking)
        return booking


# ---- advance rule (court-level fixed/percent/minimum, falling back to the pricing rule) ------------------


async def test_advance_rule_fixed_amount_overrides_the_pricing_rule_percentage(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    owner = await make_user("+923070000001", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await _open_court(
        make_court, make_schedule, make_pricing_rule, venue,
        advance_type=CourtAdvanceType.FIXED, advance_value=400,
    )
    day = pkt_today() + timedelta(days=2)
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})
    assert resp.status_code == 200, resp.text
    slot = resp.json()["slots"][0]
    assert slot["price"] == 3500.0
    assert slot["advance_amount"] == 400.0  # not 100% of price, the pricing rule's own fallback


async def test_advance_rule_percent_raised_to_the_minimum_floor(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    owner = await make_user("+923070000002", role=UserRole.OWNER)
    venue = await make_venue(owner)
    # 10% of 3500 = 350, but a 500 minimum floor is set -- the floor wins.
    court = await _open_court(
        make_court, make_schedule, make_pricing_rule, venue,
        advance_type=CourtAdvanceType.PERCENT, advance_value=10, advance_minimum=500,
    )
    day = pkt_today() + timedelta(days=2)
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})
    slot = resp.json()["slots"][0]
    assert slot["advance_amount"] == 500.0


async def test_advance_rule_falls_back_to_pricing_rule_when_court_has_no_override(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """No court-level advance_type set at all -- the pre-Part-5 behavior (pricing_rules.advance_percentage)
    must still work unchanged."""
    owner = await make_user("+923070000003", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=90)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3500, advance_percentage=20.00)

    day = pkt_today() + timedelta(days=2)
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})
    slot = resp.json()["slots"][0]
    assert slot["advance_amount"] == 700.0  # 20% of 3500


async def test_advance_never_exceeds_the_total_price(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    owner = await make_user("+923070000004", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await _open_court(
        make_court, make_schedule, make_pricing_rule, venue,
        advance_type=CourtAdvanceType.FIXED, advance_value=99999,
    )
    day = pkt_today() + timedelta(days=2)
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})
    slot = resp.json()["slots"][0]
    assert slot["advance_amount"] == 3500.0  # capped at the price, never more


async def test_owner_sets_the_courts_advance_rule_via_patch(
    client, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923070000005", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)

    resp = await client.patch(
        f"/api/v1/courts/{court.id}",
        headers=headers,
        json={"advance_type": "fixed", "advance_value": 400, "advance_minimum": None},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["advance_type"] == "fixed"
    assert body["advance_value"] == 400.0


async def test_setting_advance_type_without_a_value_is_rejected(
    client, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923070000006", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)

    resp = await client.patch(f"/api/v1/courts/{court.id}", headers=headers, json={"advance_type": "percent"})
    assert resp.status_code == 422


# ---- recording payments: partial payments summing to the total, over-payment rejected --------------------


async def test_partial_payments_sum_to_the_total(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000010", role=UserRole.OWNER)
    player = await make_user("+923070000011", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    booking = await _booked(db_session_factory, court, player, price=3500, advance_amount=400)
    headers = await make_auth_headers(owner)

    # The advance (400) was recorded elsewhere (approve_payment) in real life; simulate it directly here.
    async with db_session_factory() as session:
        session.add(PaymentEntry(booking_id=booking.id, amount_pkr=400, method=PaymentMethod.BANK_TRANSFER_PROOF))
        await session.commit()

    resp = await client.post(
        f"/api/v1/bookings/{booking.id}/payment-entries",
        headers=headers,
        json={"amount_pkr": 3100, "method": "cash_at_venue", "note": "Paid the rest at the venue"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["amount_paid"] == 3500.0
    assert body["balance_due"] == 0.0

    entries = (await client.get(f"/api/v1/bookings/{booking.id}/payment-entries", headers=headers)).json()
    assert len(entries) == 2
    assert sum(e["amount_pkr"] for e in entries) == 3500


async def test_overpayment_is_rejected_not_clamped(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000012", role=UserRole.OWNER)
    player = await make_user("+923070000013", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    booking = await _booked(db_session_factory, court, player, price=3500, advance_amount=400)
    headers = await make_auth_headers(owner)

    resp = await client.post(
        f"/api/v1/bookings/{booking.id}/payment-entries",
        headers=headers,
        json={"amount_pkr": 5000, "method": "cash_at_venue"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"] == "PAYMENT_EXCEEDS_BALANCE"

    async with db_session_factory() as session:
        refreshed = await session.get(Booking, booking.id)
        assert float(refreshed.amount_paid) == 0.0  # untouched -- nothing was recorded


async def test_a_zero_or_negative_amount_is_rejected(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000014", role=UserRole.OWNER)
    player = await make_user("+923070000015", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    booking = await _booked(db_session_factory, court, player)
    headers = await make_auth_headers(owner)

    resp = await client.post(
        f"/api/v1/bookings/{booking.id}/payment-entries",
        headers=headers,
        json={"amount_pkr": 0, "method": "cash_at_venue"},
    )
    assert resp.status_code == 422  # Pydantic's gt=0 on PaymentEntryIn.amount_pkr


async def test_an_owner_of_a_different_venue_cannot_record_a_payment(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000016", role=UserRole.OWNER)
    other_owner = await make_user("+923070000017", role=UserRole.OWNER)
    player = await make_user("+923070000018", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    booking = await _booked(db_session_factory, court, player)
    other_headers = await make_auth_headers(other_owner)

    resp = await client.post(
        f"/api/v1/bookings/{booking.id}/payment-entries",
        headers=other_headers,
        json={"amount_pkr": 100, "method": "cash_at_venue"},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "NOT_YOUR_BOOKING"


# ---- concurrency: two owners recording at the same moment (same atomic-guard concern as payment approval) -


async def test_concurrent_record_payment_never_lets_the_total_exceed_the_price(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """Two staff devices (or a double-tap) racing to record a payment on the same booking must never both
    take effect if together they'd overpay it -- PaymentLedgerService.record_entry row-locks the booking
    (SELECT ... FOR UPDATE) for exactly this reason, the same concern payment_service._claim_review guards
    for approve/reject, solved with a lock instead of a conditional UPDATE because the invariant here is a
    running SUM across child rows, not a single column's value. Repeated since a race is probabilistic."""
    owner = await make_user("+923070000020", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    headers = await make_auth_headers(owner)

    RUNS = 8
    for i in range(RUNS):
        player = await make_user(f"+92307000{i:04d}", role=UserRole.PLAYER)
        # Balance due is 3100 (3500 - 400 advance). Two concurrent 2000 recordings can't both fit.
        booking = await _booked(db_session_factory, court, player, price=3500, advance_amount=400, day_offset=5 + i)
        async with db_session_factory() as session:
            session.add(PaymentEntry(booking_id=booking.id, amount_pkr=400, method=PaymentMethod.BANK_TRANSFER_PROOF))
            await session.commit()

        coro_a = client.post(
            f"/api/v1/bookings/{booking.id}/payment-entries", headers=headers,
            json={"amount_pkr": 2000, "method": "cash_at_venue", "note": "device A"},
        )
        coro_b = client.post(
            f"/api/v1/bookings/{booking.id}/payment-entries", headers=headers,
            json={"amount_pkr": 2000, "method": "cash_at_venue", "note": "device B"},
        )
        resp_a, resp_b = await asyncio.gather(coro_a, coro_b, return_exceptions=True)
        assert not isinstance(resp_a, Exception), f"run {i}: {resp_a!r}"
        assert not isinstance(resp_b, Exception), f"run {i}: {resp_b!r}"
        assert resp_a.status_code != 500 and resp_b.status_code != 500

        codes = {resp_a.status_code, resp_b.status_code}
        # Exactly one 201 (2000 fits in the 3100 balance) and one 400 (a second 2000 would overpay by 900).
        assert codes == {201, 400}, f"run {i}: got {resp_a.status_code} and {resp_b.status_code}"

        async with db_session_factory() as session:
            refreshed = await session.get(Booking, booking.id)
            assert float(refreshed.amount_paid) == 2400.0  # 400 advance + exactly one 2000, never both
            assert float(refreshed.balance_due) == 1100.0


# ---- a cancelled booking's payments still appear in the ledger -------------------------------------------


async def test_cancelled_bookings_payments_still_appear_in_the_ledger(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000030", role=UserRole.OWNER)
    player = await make_user("+923070000031", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    booking = await _booked(db_session_factory, court, player, price=3500, advance_amount=400)
    headers = await make_auth_headers(owner)

    async with db_session_factory() as session:
        entry = PaymentEntry(booking_id=booking.id, amount_pkr=400, method=PaymentMethod.BANK_TRANSFER_PROOF)
        session.add(entry)
        await session.flush()
        recorded_at = entry.created_at  # captured before commit expires the attribute
        refreshed = await session.get(Booking, booking.id)
        refreshed.status = BookingStatus.CANCELLED
        await session.commit()

    resp = await client.get(
        "/api/v1/owners/ledger",
        headers=headers,
        params={"start_date": recorded_at.date().isoformat(), "end_date": (recorded_at.date() + timedelta(days=1)).isoformat()},
    )
    assert resp.status_code == 200, resp.text
    entries = resp.json()["entries"]
    assert any(e["booking_id"] == str(booking.id) and e["booking_status"] == "cancelled" for e in entries)


# ---- admin correction: no silent edits/deletes, corrections are reversing entries -------------------------


async def test_admin_correction_is_a_reversing_entry_not_an_edit(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000040", role=UserRole.OWNER)
    admin = await make_user("+923070000041", role=UserRole.ADMIN)
    player = await make_user("+923070000042", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    booking = await _booked(db_session_factory, court, player, price=3500, advance_amount=400)
    owner_headers = await make_auth_headers(owner)
    admin_headers = await make_auth_headers(admin)

    record = await client.post(
        f"/api/v1/bookings/{booking.id}/payment-entries", headers=owner_headers,
        json={"amount_pkr": 3500, "method": "cash_at_venue"},
    )
    assert record.status_code == 201, record.text
    entry_id = record.json()["entry"]["id"]

    reverse = await client.post(
        f"/api/v1/admin/payment-entries/{entry_id}/reverse", headers=admin_headers,
        json={"reason": "Owner fat-fingered the amount, player only paid the advance"},
    )
    assert reverse.status_code == 200, reverse.text
    assert reverse.json()["amount_pkr"] == -3500
    assert reverse.json()["reverses_entry_id"] == entry_id

    entries = (await client.get(f"/api/v1/bookings/{booking.id}/payment-entries", headers=owner_headers)).json()
    assert len(entries) == 2  # original row untouched, plus the new reversing row -- no edit, no delete
    assert {e["amount_pkr"] for e in entries} == {3500, -3500}

    async with db_session_factory() as session:
        refreshed = await session.get(Booking, booking.id)
        assert float(refreshed.amount_paid) == 0.0
        assert float(refreshed.balance_due) == 3500.0


async def test_only_admin_can_reverse_a_payment_entry(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000043", role=UserRole.OWNER)
    player = await make_user("+923070000044", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    booking = await _booked(db_session_factory, court, player)
    owner_headers = await make_auth_headers(owner)

    record = await client.post(
        f"/api/v1/bookings/{booking.id}/payment-entries", headers=owner_headers,
        json={"amount_pkr": 100, "method": "cash_at_venue"},
    )
    entry_id = record.json()["entry"]["id"]

    resp = await client.post(
        f"/api/v1/admin/payment-entries/{entry_id}/reverse", headers=owner_headers, json={"reason": "test"}
    )
    assert resp.status_code == 403


# ---- walk-ins record a real payment_entries row -------------------------------------------------------


async def test_walkin_records_a_payment_entry(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923070000050", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await _open_court(make_court, make_schedule, make_pricing_rule, venue)
    headers = await make_auth_headers(owner)
    starts = pkt_time_to_utc(pkt_today() + timedelta(days=3), time(9, 0))

    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=headers,
        json={
            "court_id": str(court.id), "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "player_name": "Bilal", "amount_paid": 3500,
        },
    )
    assert resp.status_code == 201, resp.text
    booking_id = resp.json()["booking"]["id"]
    assert resp.json()["booking"]["amount_paid"] == 3500.0
    assert resp.json()["booking"]["balance_due"] == 0.0

    entries = (await client.get(f"/api/v1/bookings/{booking_id}/payment-entries", headers=headers)).json()
    assert len(entries) == 1
    assert entries[0]["method"] == "cash_at_venue"
    assert entries[0]["amount_pkr"] == 3500
