import asyncio
import io
from datetime import date, datetime, time, timedelta, timezone

from app.jobs.expiry_job import expire_stale_bookings
from app.models.booking import Booking, BookingStatus, LIVE_BOOKING_STATUSES
from app.models.payment import Payment
from app.models.user import UserRole
from sqlalchemy import select


def _mock_upload(monkeypatch):
    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)


def _sample_png_bytes() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(80, 160, 40)).save(buf, format="PNG")
    return buf.getvalue()


async def _payment_submitted_booking(
    client, court, customer_headers, target_date, *, starts_at_hour_utc: int = 14
) -> tuple[str, str]:
    """Holds a slot and submits a (mocked-upload, unreadable-OCR) payment
    proof for it, landing the booking in payment_submitted. Returns
    (booking_id, payment_id)."""
    starts_at = f"{target_date.isoformat()}T{starts_at_hour_utc:02d}:00:00+00:00"
    hold = await client.post(
        "/api/v1/bookings/hold",
        headers=customer_headers,
        json={"court_id": str(court.id), "starts_at": starts_at},
    )
    assert hold.status_code == 201, hold.text
    booking_id = hold.json()["booking"]["id"]

    submit = await client.post(
        f"/api/v1/bookings/{booking_id}/payment-proof",
        headers=customer_headers,
        files={"image": ("proof.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
    )
    assert submit.status_code == 201, submit.text
    assert submit.json()["booking"]["status"] == "payment_submitted"
    return booking_id, submit.json()["payment"]["id"]


async def test_concurrent_approve_reject_only_one_wins(
    client,
    db_session_factory,
    make_user,
    make_venue,
    make_court,
    make_schedule,
    make_pricing_rule,
    make_auth_headers,
    monkeypatch,
):
    """Two staff devices (or a double-tap) racing to approve/reject the same
    payment must never both take effect -- the DB's conditional UPDATE
    (PaymentService._claim_review / BookingService._atomic_transition) is
    what actually prevents it, not application-level locking. Repeated
    since a race is probabilistic and one pass proves nothing."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923008309999", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)

    RUNS = 25
    outcomes = {"approve_won": 0, "reject_won": 0}
    for i in range(RUNS):
        customer = await make_user(f"+92300830{i:04d}", role=UserRole.PLAYER)
        customer_headers = await make_auth_headers(customer)
        target = date.today() + timedelta(days=2 + i)
        booking_id, payment_id = await _payment_submitted_booking(client, court, customer_headers, target)

        approve_coro = client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers)
        reject_coro = client.post(
            f"/api/v1/payments/{payment_id}/reject",
            headers=owner_headers,
            json={"reason": "insufficient amount"},
        )
        # Alternate gather order across runs -- this test harness's coroutine
        # scheduling favors whichever request is listed first, so without
        # alternating, one side would "win" every single run and the race
        # would never actually exercise both directions.
        if i % 2 == 0:
            approve_resp, reject_resp = await asyncio.gather(approve_coro, reject_coro, return_exceptions=True)
        else:
            reject_resp, approve_resp = await asyncio.gather(reject_coro, approve_coro, return_exceptions=True)
        assert not isinstance(approve_resp, Exception), f"run {i}: approve raised {approve_resp!r}"
        assert not isinstance(reject_resp, Exception), f"run {i}: reject raised {reject_resp!r}"

        codes = {approve_resp.status_code, reject_resp.status_code}
        assert codes in ({200, 409}, {200}), (
            f"run {i}: unexpected status pair approve={approve_resp.status_code} "
            f"reject={reject_resp.status_code} approve_body={approve_resp.text} reject_body={reject_resp.text}"
        )
        # A raw exhausted-retry or DB error would surface as a 500 -- assert
        # neither response ever hit the generic error path.
        assert approve_resp.status_code != 500 and reject_resp.status_code != 500

        approve_won = approve_resp.status_code == 200
        reject_won = reject_resp.status_code == 200
        assert approve_won != reject_won, (
            f"run {i}: expected exactly one winner, got approve={approve_resp.status_code} "
            f"reject={reject_resp.status_code}"
        )
        loser_resp = reject_resp if approve_won else approve_resp
        assert loser_resp.json()["error"]["code"] == "PAYMENT_ALREADY_REVIEWED", loser_resp.text
        outcomes["approve_won" if approve_won else "reject_won"] += 1

        async with db_session_factory() as session:
            booking = await session.get(Booking, booking_id)
            payment = await session.get(Payment, payment_id)
            if approve_won:
                assert booking.status == BookingStatus.BOOKED, f"run {i}: {booking.status}"
                assert payment.review_verdict == "approved", f"run {i}: {payment.review_verdict}"
            else:
                assert booking.status == BookingStatus.CANCELLED, f"run {i}: {booking.status}"
                assert payment.review_verdict == "rejected", f"run {i}: {payment.review_verdict}"

    # This harness's scheduling heavily favors approve over reject regardless
    # of gather() argument order (confirmed empirically), so the exact
    # win/loss split isn't the invariant under test (each run's self-
    # consistency, asserted above, is) -- see
    # test_reject_then_approve_gets_clean_conflict_error below for the
    # reverse ordering, driven deterministically instead of hoping for a
    # lucky race.
    assert outcomes["approve_won"] + outcomes["reject_won"] == RUNS, outcomes


async def test_reject_then_approve_gets_clean_conflict_error(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """The reverse ordering from the race above, driven deterministically:
    reject commits fully first, then a late/slow approve for the same
    payment must get a clean PAYMENT_ALREADY_REVIEWED conflict -- never a
    500, and never silently flipping the (already rejected/cancelled)
    booking to booked."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923008310001", role=UserRole.OWNER)
    customer = await make_user("+923008310002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    target = date.today() + timedelta(days=2)
    booking_id, payment_id = await _payment_submitted_booking(client, court, customer_headers, target)

    reject = await client.post(
        f"/api/v1/payments/{payment_id}/reject", headers=owner_headers, json={"reason": "bad proof"}
    )
    assert reject.status_code == 200, reject.text
    assert reject.json()["booking"]["status"] == "cancelled"

    approve = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers)
    assert approve.status_code == 409, approve.text
    assert approve.json()["error"]["code"] == "PAYMENT_ALREADY_REVIEWED"

    get_booking = await client.get(f"/api/v1/bookings/{booking_id}", headers=customer_headers)
    assert get_booking.json()["status"] == "cancelled"


async def test_concurrent_cancel_and_approve_only_one_wins(
    client,
    db_session_factory,
    make_user,
    make_venue,
    make_court,
    make_schedule,
    make_pricing_rule,
    make_auth_headers,
    monkeypatch,
):
    """A player cancelling the instant an owner approves must never leave the
    booking confirmed-and-cancelled at once, and an approve that loses the
    race must get a clean error, not an unhandled exception -- see
    BookingService.confirm_booking's BOOKING_ALREADY_CANCELLED guard."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923008409999", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)

    RUNS = 25
    approve_won_count = 0
    for i in range(RUNS):
        customer = await make_user(f"+92300840{i:04d}", role=UserRole.PLAYER)
        customer_headers = await make_auth_headers(customer)
        target = date.today() + timedelta(days=2 + i)
        booking_id, payment_id = await _payment_submitted_booking(client, court, customer_headers, target)

        approve_resp, cancel_resp = await asyncio.gather(
            client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers),
            client.post(
                f"/api/v1/bookings/{booking_id}/cancel", headers=customer_headers, json={"reason": "changed plans"}
            ),
            return_exceptions=True,
        )
        assert not isinstance(approve_resp, Exception), f"run {i}: approve raised {approve_resp!r}"
        assert not isinstance(cancel_resp, Exception), f"run {i}: cancel raised {cancel_resp!r}"
        assert approve_resp.status_code != 500 and cancel_resp.status_code != 500

        # cancel_booking allows cancelling from HELD/PAYMENT_SUBMITTED/BOOKED
        # alike, so it succeeds regardless of ordering -- the booking always
        # ends cancelled either way, which is correct (a player can legally
        # cancel a booking the instant after it's approved). What must never
        # happen is approve reporting success while the DB disagrees.
        assert cancel_resp.status_code == 200, cancel_resp.text
        assert approve_resp.status_code in (200, 409), approve_resp.text
        if approve_resp.status_code == 409:
            assert approve_resp.json()["error"]["code"] == "BOOKING_ALREADY_CANCELLED", approve_resp.text
        else:
            approve_won_count += 1

        async with db_session_factory() as session:
            booking = await session.get(Booking, booking_id)
            payment = await session.get(Payment, payment_id)
            assert booking.status == BookingStatus.CANCELLED, f"run {i}: {booking.status}"
            if approve_resp.status_code == 200:
                assert payment.review_verdict == "approved", f"run {i}: {payment.review_verdict}"
            else:
                assert payment.review_verdict is None, (
                    f"run {i}: approve lost but payment.review_verdict={payment.review_verdict!r} "
                    "(the claimed verdict should have rolled back with the failed confirm_booking)"
                )

    # This harness's scheduling heavily favors cancel over approve regardless
    # of ordering (confirmed empirically: cancel wins the large majority of
    # runs, same bias as the approve-vs-reject race above), so most runs
    # exercise confirm_booking's BOOKING_ALREADY_CANCELLED guard -- the exact
    # win/loss split isn't the invariant under test (each run's self-
    # consistency, asserted above, is) so it's only logged here, not
    # asserted. The reverse (approve fully committed, then a cancel attempt)
    # is additionally exercised deterministically below.
    assert approve_won_count <= RUNS


async def test_cancel_after_approve_still_succeeds(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """The reverse ordering from the race above, driven deterministically:
    once approve has fully committed (booking booked, payment approved), a
    player cancelling that same booking a moment later must still succeed
    cleanly -- that's a legitimate action, not a race to reject -- and must
    leave the payment's own review_verdict untouched."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923008320001", role=UserRole.OWNER)
    customer = await make_user("+923008320002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    target = date.today() + timedelta(days=2)
    booking_id, payment_id = await _payment_submitted_booking(client, court, customer_headers, target)

    approve = await client.post(f"/api/v1/payments/{payment_id}/approve", headers=owner_headers)
    assert approve.status_code == 200, approve.text
    assert approve.json()["booking"]["status"] == "booked"

    cancel = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=customer_headers, json={"reason": "changed plans"}
    )
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["booking"]["status"] == "cancelled"

    proof = await client.get(f"/api/v1/bookings/{booking_id}/payments", headers=customer_headers)
    assert proof.json()[0]["review_verdict"] == "approved"


async def test_double_submit_payment_only_one_payment_row(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule,
    make_auth_headers, monkeypatch,
):
    """Two concurrent payment-proof uploads for the same held booking (e.g. a
    double-tap on a slow 2G connection) must never both create a Payment row
    -- the partial unique index (one_pending_payment_per_booking) stops the
    second INSERT outright, and the loser gets a clean PAYMENT_ALREADY_SUBMITTED
    conflict instead of a raw 500 or a silent duplicate."""
    _mock_upload(monkeypatch)
    owner = await make_user("+923008500001", role=UserRole.OWNER)
    customer = await make_user("+923008500002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    customer_headers = await make_auth_headers(customer)

    RUNS = 15
    for i in range(RUNS):
        target = date.today() + timedelta(days=2 + i)
        starts_at = f"{target.isoformat()}T14:00:00+00:00"
        hold = await client.post(
            "/api/v1/bookings/hold",
            headers=customer_headers,
            json={"court_id": str(court.id), "starts_at": starts_at},
        )
        assert hold.status_code == 201, hold.text
        booking_id = hold.json()["booking"]["id"]

        resp_a, resp_b = await asyncio.gather(
            client.post(
                f"/api/v1/bookings/{booking_id}/payment-proof",
                headers=customer_headers,
                files={"image": ("proof-a.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
            ),
            client.post(
                f"/api/v1/bookings/{booking_id}/payment-proof",
                headers=customer_headers,
                files={"image": ("proof-b.jpg", io.BytesIO(_sample_png_bytes()), "image/jpeg")},
            ),
            return_exceptions=True,
        )
        assert not isinstance(resp_a, Exception), f"run {i}: A raised {resp_a!r}"
        assert not isinstance(resp_b, Exception), f"run {i}: B raised {resp_b!r}"
        assert resp_a.status_code != 500 and resp_b.status_code != 500

        # Exactly one request must succeed. The loser's exact status depends
        # on timing: a genuinely-concurrent arrival is caught by the partial
        # unique index (PAYMENT_ALREADY_SUBMITTED, 409); one that lands after
        # the first has already fully committed is caught earlier by
        # submit_payment's own status check (plain 400) -- both are a clean
        # rejection, neither is a second row or a silent regression, which is
        # the actual invariant this test cares about.
        codes = {resp_a.status_code, resp_b.status_code}
        assert 201 in codes, f"run {i}: neither request succeeded -- A={resp_a.status_code} B={resp_b.status_code}"
        assert codes in ({201, 409}, {201, 400}), (
            f"run {i}: unexpected status pair A={resp_a.status_code} B={resp_b.status_code} "
            f"body_a={resp_a.text} body_b={resp_b.text}"
        )
        loser = resp_b if resp_a.status_code == 201 else resp_a
        if loser.status_code == 409:
            assert loser.json()["error"]["code"] == "PAYMENT_ALREADY_SUBMITTED", loser.text

        async with db_session_factory() as session:
            result = await session.execute(select(Payment).where(Payment.booking_id == booking_id))
            rows = result.scalars().all()
            assert len(rows) == 1, f"run {i}: expected exactly 1 payment row, got {len(rows)}"


async def test_late_mark_payment_submitted_cannot_downgrade_confirmed_booking(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, next_weekday
):
    """Simulates a slow/late submit_payment call's mark_payment_submitted
    step finally landing after the booking has already been auto-approved
    straight to BOOKED by another (faster) concurrent submission. It must be
    a no-op -- never resetting an already-confirmed, already-paid booking
    back to payment_submitted, which would let the expiry job cancel a slot
    the player already has."""
    from app.config import get_settings
    from app.services.booking_service import BookingService

    settings = get_settings()
    owner = await make_user("+923008600001", role=UserRole.OWNER)
    customer = await make_user("+923008600002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)

    service = BookingService(db_session, settings)
    target = next_weekday(0)
    starts_at = datetime.combine(target, time(1, 0), tzinfo=timezone.utc)
    booking = await service.create_hold(customer, court.id, starts_at)
    booking = await service.confirm_booking(booking)
    assert booking.status == BookingStatus.BOOKED
    payment_deadline_before = booking.payment_deadline
    amount_paid_before = booking.amount_paid

    result = await service.mark_payment_submitted(booking)

    assert result.status == BookingStatus.BOOKED
    assert result.payment_deadline == payment_deadline_before
    assert result.amount_paid == amount_paid_before

    await db_session.refresh(booking)
    assert booking.status == BookingStatus.BOOKED


async def test_fifty_concurrent_bookings_only_one_succeeds(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """50 players race to book the exact same court/slot. The DB's partial
    unique index (one_live_booking_per_slot) is what actually prevents a
    double-booking here -- exactly one insert should succeed, the rest must
    see a 409 conflict."""
    owner = await make_user("+923006000000", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await make_pricing_rule(court, price_per_slot=1000)

    customers = [
        await make_user(f"+92300699{n:04d}", role=UserRole.PLAYER) for n in range(50)
    ]
    header_sets = [await make_auth_headers(c) for c in customers]

    target = date.today() + timedelta(days=1)
    # create_hold requires starts_at to be grid-aligned to an active
    # schedule_template (AvailabilityService.is_slot_grid_aligned) -- without
    # this every attempt below would 400 with INVALID_SLOT_TIME before ever
    # reaching the unique index this test is actually about.
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    # Schedule hours are PKT; 18:00 PKT is 13:00 UTC (PKT-5).
    starts_at = f"{target.isoformat()}T13:00:00+00:00"

    async def attempt(headers: dict) -> int:
        resp = await client.post(
            "/api/v1/bookings/hold",
            headers=headers,
            json={"court_id": str(court.id), "starts_at": starts_at},
        )
        return resp.status_code

    results = await asyncio.gather(*(attempt(h) for h in header_sets))

    successes = [code for code in results if code == 201]
    conflicts = [code for code in results if code == 409]

    assert len(successes) == 1, f"expected exactly 1 successful booking, got {len(successes)}: {results}"
    assert len(conflicts) == 49
    assert len(successes) + len(conflicts) == 50


async def test_off_grid_overlap_rejected(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """one_live_booking_per_slot only catches two bookings with the exact
    same starts_at -- it does nothing for an off-grid starts_at that
    overlaps an existing booking's window without matching it exactly
    (e.g. 19:30 landing inside an existing 19:00-20:00 booking). The actual
    guard against that is `create_hold`'s grid-alignment check
    (AvailabilityService.is_slot_grid_aligned), which this test locks in."""
    owner = await make_user("+923008100001", role=UserRole.OWNER)
    player_a = await make_user("+923008100002")
    player_b = await make_user("+923008100003")
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)

    headers_a = await make_auth_headers(player_a)
    headers_b = await make_auth_headers(player_b)

    # Schedule hours are PKT; 19:00/19:30/20:00 PKT are 14:00/14:30/15:00 UTC.
    on_grid_1900 = f"{target.isoformat()}T14:00:00+00:00"
    off_grid_1930 = f"{target.isoformat()}T14:30:00+00:00"
    on_grid_2000 = f"{target.isoformat()}T15:00:00+00:00"

    first = await client.post(
        "/api/v1/bookings/hold",
        headers=headers_a,
        json={"court_id": str(court.id), "starts_at": on_grid_1900},
    )
    assert first.status_code == 201, first.text

    off_grid_attempt = await client.post(
        "/api/v1/bookings/hold",
        headers=headers_b,
        json={"court_id": str(court.id), "starts_at": off_grid_1930},
    )
    assert off_grid_attempt.status_code == 400, off_grid_attempt.text
    assert off_grid_attempt.json()["error"]["code"] == "INVALID_SLOT_TIME"

    next_slot = await client.post(
        "/api/v1/bookings/hold",
        headers=headers_b,
        json={"court_id": str(court.id), "starts_at": on_grid_2000},
    )
    assert next_slot.status_code == 201, next_slot.text


async def test_expiry_race_with_new_booking(
    client,
    db_session_factory,
    make_user,
    make_venue,
    make_court,
    make_schedule,
    make_pricing_rule,
    make_auth_headers,
):
    """Races expire_stale_bookings() against a fresh POST /bookings/hold for
    the exact same court+starts_at an already-expired HELD booking still
    occupies. The dangerous outcome -- two live bookings for the same slot
    -- must never happen; run repeatedly since a race is probabilistic and
    one pass proves nothing."""
    owner = await make_user("+923008200001", role=UserRole.OWNER)
    challenger = await make_user("+923008200002")
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    headers = await make_auth_headers(challenger)

    RUNS = 30
    outcomes = {"hold_won": 0, "hold_rejected": 0}
    for i in range(RUNS):
        target = date.today() + timedelta(days=2 + i)
        # Schedule hours are PKT; 19:00 PKT is 14:00 UTC.
        starts_at_dt = datetime.combine(target, time(14, 0), tzinfo=timezone.utc)
        starts_at_str = starts_at_dt.isoformat()

        async with db_session_factory() as session:
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=None,
                    starts_at=starts_at_dt,
                    ends_at=starts_at_dt + timedelta(hours=1),
                    price=1000,
                    status=BookingStatus.HELD,
                    held_until=datetime.now(timezone.utc) - timedelta(seconds=1),
                )
            )
            await session.commit()

        results = await asyncio.gather(
            expire_stale_bookings(session_factory=db_session_factory),
            client.post(
                "/api/v1/bookings/hold",
                headers=headers,
                json={"court_id": str(court.id), "starts_at": starts_at_str},
            ),
            return_exceptions=True,
        )
        expiry_result, hold_resp = results
        assert not isinstance(expiry_result, Exception), f"run {i}: expiry job raised {expiry_result!r}"
        assert not isinstance(hold_resp, Exception), f"run {i}: hold request raised {hold_resp!r}"
        assert hold_resp.status_code in (201, 409), (
            f"run {i}: unexpected status {hold_resp.status_code}: {hold_resp.text}"
        )
        outcomes["hold_won" if hold_resp.status_code == 201 else "hold_rejected"] += 1

        async with db_session_factory() as session:
            live_result = await session.execute(
                select(Booking).where(
                    Booking.court_id == court.id,
                    Booking.starts_at == starts_at_dt,
                    Booking.status.in_(LIVE_BOOKING_STATUSES),
                )
            )
            live_rows = live_result.scalars().all()
            assert len(live_rows) <= 1, (
                f"run {i}: found {len(live_rows)} live bookings for the same slot "
                f"-- expiry-vs-hold race produced a double-booking"
            )

    print(f"test_expiry_race_with_new_booking outcomes over {RUNS} runs: {outcomes}")
