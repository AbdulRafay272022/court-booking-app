from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.jobs.digest_job import send_owner_daily_digests
from app.jobs.expiry_job import (
    escalate_pending_payment_reviews,
    expire_stale_bookings,
    mark_overdue_no_shows,
    run_expiry_job,
)
from app.jobs.growth_job import materialize_nightly_stats
from app.jobs.reminder_job import send_booking_reminders
from app.models.audit import AuditLog
from app.models.booking import Booking, BookingStatus
from app.models.fcm_token import FCMToken
from app.models.notification import NotificationLog
from app.models.stats import SlotStats
from app.models.user import User, UserRole
from app.models.waitlist import WaitlistEntry


async def test_expire_stale_bookings_marks_expired_holds(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923010000001", role=UserRole.OWNER)
    customer = await make_user("+923010000002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=3),
            price=1000,
            status=BookingStatus.HELD,
            held_until=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    expired_count = await expire_stale_bookings(session_factory=db_session_factory)
    assert expired_count == 1

    async with db_session_factory() as session:
        refreshed = await session.get(Booking, booking_id)
        assert refreshed.status == BookingStatus.CANCELLED
        assert refreshed.cancelled_by.value == "system"


async def test_expire_stale_bookings_expires_unactioned_payment_submissions(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923010000003", role=UserRole.OWNER)
    customer = await make_user("+923010000004", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=3),
            price=1000,
            status=BookingStatus.PAYMENT_SUBMITTED,
            payment_deadline=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    expired_count = await expire_stale_bookings(session_factory=db_session_factory)
    assert expired_count == 1

    async with db_session_factory() as session:
        refreshed = await session.get(Booking, booking_id)
        assert refreshed.status == BookingStatus.CANCELLED


async def test_expired_payment_submitted_with_plausible_payment_creates_dispute(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    """A payment_submitted booking that expires because the owner never
    acted, on a proof that looked genuine (OCR verdict != mismatch, not
    flagged a duplicate), must leave a PaymentDispute row so an admin has a
    queue of "player probably paid, got no booking" cases -- see finding #5
    in AUDIT_FINDINGS.md."""
    from app.models.dispute import PaymentDispute
    from app.models.payment import Payment
    from app.services.admin_service import AdminService
    from app.config import get_settings

    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923010000010", role=UserRole.OWNER)
    customer = await make_user("+923010000011", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=3),
            price=1000,
            advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED,
            payment_deadline=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        session.add(booking)
        await session.flush()
        payment = Payment(
            booking_id=booking.id,
            amount_claimed=1000,
            ocr_amount=1000,
            ocr_verdict="match",
            is_duplicate=False,
        )
        session.add(payment)
        await session.commit()
        booking_id = booking.id
        payment_id = payment.id

    expired_count = await expire_stale_bookings(session_factory=db_session_factory)
    assert expired_count == 1

    async with db_session_factory() as session:
        result = await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking_id))
        disputes = result.scalars().all()
        assert len(disputes) == 1
        assert disputes[0].payment_id == payment_id
        assert disputes[0].reason == "payment_review_expired"
        assert disputes[0].resolved is False

    async with db_session_factory() as session:
        queue = await AdminService(session, get_settings()).list_refund_queue()
        assert any(entry.booking_id == booking_id for entry in queue)


async def test_expired_payment_with_mismatch_verdict_does_not_create_dispute(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    """A payment_submitted booking whose proof was an outright amount
    mismatch is exactly what a genuinely-wrong/no payment looks like --
    expiring it should not create a dispute row for an admin to chase."""
    from app.models.dispute import PaymentDispute
    from app.models.payment import Payment

    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923010000012", role=UserRole.OWNER)
    customer = await make_user("+923010000013", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=3),
            price=1000,
            advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED,
            payment_deadline=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        session.add(booking)
        await session.flush()
        payment = Payment(
            booking_id=booking.id,
            amount_claimed=1000,
            ocr_amount=200,
            ocr_verdict="mismatch",
            is_duplicate=False,
        )
        session.add(payment)
        await session.commit()
        booking_id = booking.id

    expired_count = await expire_stale_bookings(session_factory=db_session_factory)
    assert expired_count == 1

    async with db_session_factory() as session:
        result = await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking_id))
        assert result.scalars().all() == []


async def test_expire_stale_bookings_ignores_future_holds(
    db_session_factory, make_user, make_venue, make_court
):
    owner = await make_user("+923010000005", role=UserRole.OWNER)
    customer = await make_user("+923010000006", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=3),
            price=1000,
            status=BookingStatus.HELD,
            held_until=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        session.add(booking)
        await session.commit()

    expired_count = await expire_stale_bookings(session_factory=db_session_factory)
    assert expired_count == 0


async def test_send_owner_daily_digests_runs_without_error(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    sent = []

    async def fake_send_smart(self, to_phone_number, body, *, last_inbound_at, template_name, template_params):
        sent.append(to_phone_number)
        return {"messages": [{"id": "x"}]}, None

    # send_smart, not send_text directly -- Section 29 Part B routed the digest through
    # the window-aware path every other notification uses.
    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_smart", fake_send_smart)

    owner = await make_user("+923010000007", role=UserRole.OWNER)
    venue = await make_venue(owner)
    await make_court(venue)

    result = await send_owner_daily_digests(session_factory=db_session_factory)
    assert result == {"sent": 1, "failed": []}
    assert owner.phone in sent


async def test_digest_job_one_owner_failure_does_not_block_others(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    """The original bug: digest_job called whatsapp.send_text directly with no
    per-owner isolation, so the first owner whose send raised (e.g. a closed 24h
    WhatsApp window -- the common case, since the digest is outbound-initiated)
    aborted the whole run, silently skipping every owner after them. This test
    would have failed against the old code: the loop had no try/except, so
    owner2's raise would propagate out of send_owner_daily_digests entirely and
    owner3 would never be attempted."""
    owner1 = await make_user("+923010000013", role=UserRole.OWNER)
    owner2 = await make_user("+923010000014", role=UserRole.OWNER)
    owner3 = await make_user("+923010000015", role=UserRole.OWNER)
    for owner in (owner1, owner2, owner3):
        venue = await make_venue(owner)
        await make_court(venue)

    sent = []

    async def fake_send_smart(self, to_phone_number, body, *, last_inbound_at, template_name, template_params):
        if to_phone_number == owner2.phone:
            raise RuntimeError("simulated Meta rejection (e.g. closed 24h window)")
        sent.append(to_phone_number)
        return {"messages": [{"id": "x"}]}, None

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_smart", fake_send_smart)

    result = await send_owner_daily_digests(session_factory=db_session_factory)

    assert result["sent"] == 2
    assert result["failed"] == [str(owner2.id)]
    assert owner1.phone in sent
    assert owner3.phone in sent
    assert owner2.phone not in sent


async def test_materialize_nightly_stats_writes_audit_log_and_slot_stats(
    db_session_factory, make_user, make_venue, make_court, make_pricing_rule
):
    owner = await make_user("+923010000008", role=UserRole.OWNER)
    customer = await make_user("+923010000009", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    # Old enough that its booked weekday has occurred >= GROWTH_MIN_OBSERVATIONS
    # times within GROWTH_LOOKBACK_DAYS, and weeks_of_data clears GROWTH_MIN_WEEKS
    # -- otherwise compute_slot_stats's guardrail (Section 14) skips the bucket.
    court = await make_court(venue, created_at=datetime.now(timezone.utc) - timedelta(days=200))
    await make_pricing_rule(court, price_per_slot=1500)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(days=1),
            ends_at=datetime.now(timezone.utc) - timedelta(days=1) + timedelta(hours=1),
            price=1500,
            amount_paid=1500,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()

    stats = await materialize_nightly_stats(session_factory=db_session_factory)
    assert stats["total_venues"] >= 1

    async with db_session_factory() as session:
        audit_result = await session.execute(
            select(AuditLog).where(AuditLog.action == "growth.nightly_snapshot")
        )
        assert audit_result.scalar_one_or_none() is not None

        stats_result = await session.execute(select(SlotStats).where(SlotStats.court_id == court.id))
        rows = stats_result.scalars().all()
        assert len(rows) == 1
        assert rows[0].booked_count == 1
        assert rows[0].total_slots >= 20
        assert rows[0].weeks_of_data >= 6


async def test_compute_slot_stats_guardrail_skips_court_with_too_little_history(
    db_session_factory, make_user, make_venue, make_court, make_pricing_rule
):
    from app.jobs.growth_job import compute_slot_stats

    owner = await make_user("+923010000024", role=UserRole.OWNER)
    customer = await make_user("+923010000025", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    # Only 3 weeks old -- below GROWTH_MIN_WEEKS (6) regardless of how many
    # bookings it has.
    court = await make_court(venue, created_at=datetime.now(timezone.utc) - timedelta(weeks=3))
    await make_pricing_rule(court, price_per_slot=1000)

    async with db_session_factory() as session:
        for i in range(3):
            starts_at = (datetime.now(timezone.utc) - timedelta(weeks=i)).replace(
                hour=10, minute=0, second=0, microsecond=0
            )
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(hours=1),
                    price=1000,
                    amount_paid=1000,
                    status=BookingStatus.BOOKED,
                )
            )
        await session.commit()

    async with db_session_factory() as session:
        await compute_slot_stats(session)
        await session.commit()

    async with db_session_factory() as session:
        stats_result = await session.execute(select(SlotStats).where(SlotStats.court_id == court.id))
        assert stats_result.scalars().all() == []


async def test_compute_slot_stats_guardrail_skips_slot_with_too_few_observations(
    db_session_factory, make_user, make_venue, make_court, make_pricing_rule
):
    from app.jobs.growth_job import compute_slot_stats

    owner = await make_user("+923010000026", role=UserRole.OWNER)
    customer = await make_user("+923010000027", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    # Old enough for weeks_of_data, but the court's schedule is new-ish
    # relative to a full lookback so this particular weekday has occurred
    # well under GROWTH_MIN_OBSERVATIONS (20) times.
    court = await make_court(venue, created_at=datetime.now(timezone.utc) - timedelta(weeks=10))
    await make_pricing_rule(court, price_per_slot=1000)

    async with db_session_factory() as session:
        # Only 5 occurrences of this weekday+hour -- below the 20-observation floor.
        for i in range(5):
            starts_at = (datetime.now(timezone.utc) - timedelta(weeks=i)).replace(
                hour=10, minute=0, second=0, microsecond=0
            )
            session.add(
                Booking(
                    court_id=court.id,
                    player_id=customer.id,
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(hours=1),
                    price=1000,
                    amount_paid=1000,
                    status=BookingStatus.BOOKED,
                )
            )
        await session.commit()

    async with db_session_factory() as session:
        await compute_slot_stats(session)
        await session.commit()

    async with db_session_factory() as session:
        stats_result = await session.execute(select(SlotStats).where(SlotStats.court_id == court.id))
        assert stats_result.scalars().all() == []


async def test_mark_overdue_no_shows_hits_reliability_score(
    db_session_factory, make_user, make_venue, make_court
):
    owner = await make_user("+923010000010", role=UserRole.OWNER)
    customer = await make_user("+923010000011", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) - timedelta(hours=1),
            price=1000,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    count = await mark_overdue_no_shows(session_factory=db_session_factory)
    assert count == 1

    async with db_session_factory() as session:
        refreshed = await session.get(Booking, booking_id)
        assert refreshed.status == BookingStatus.NO_SHOW

        player = await session.get(User, customer.id)
        assert player.total_no_shows == 1
        assert player.reliability_score < 1.0


async def test_mark_overdue_no_shows_ignores_checked_in_bookings(
    db_session_factory, make_user, make_venue, make_court
):
    owner = await make_user("+923010000012", role=UserRole.OWNER)
    customer = await make_user("+923010000013", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) - timedelta(hours=1),
            price=1000,
            status=BookingStatus.BOOKED,
            checked_in_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        session.add(booking)
        await session.commit()

    count = await mark_overdue_no_shows(session_factory=db_session_factory)
    assert count == 0


async def test_escalation_job_sends_whatsapp_then_sms(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    # No prior inbound message from the owner in this test, so the WhatsApp
    # escalation step goes out as the payment_submitted_owner template, not
    # free text -- mock at the _send level (shared by both) to catch it.
    whatsapp_sent = []
    sms_sent = []

    async def fake_send(self, payload):
        whatsapp_sent.append(payload["to"])
        return {"messages": [{"id": "x"}]}

    async def fake_sms(self, to, body):
        sms_sent.append(to)
        return {"status": "sent"}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)
    monkeypatch.setattr("app.services.sms_service.SMSService.send_text", fake_sms)

    owner = await make_user("+923010000014", role=UserRole.OWNER)
    customer = await make_user("+923010000015", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    # payment_deadline = submitted_at + PAYMENT_REVIEW_HOURS(2h); backdate
    # submission by 6 minutes so only the WhatsApp threshold (5min) is due.
    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=2),
            price=1000,
            advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED,
            payment_deadline=datetime.now(timezone.utc) + timedelta(hours=2) - timedelta(minutes=6),
        )
        session.add(booking)
        await session.commit()

    escalated = await escalate_pending_payment_reviews(session_factory=db_session_factory)
    assert escalated == 1
    assert owner.phone.lstrip("+") in whatsapp_sent
    assert sms_sent == []

    # Running again immediately shouldn't re-send the same step.
    escalated_again = await escalate_pending_payment_reviews(session_factory=db_session_factory)
    assert escalated_again == 0


async def test_escalation_job_fires_both_steps_if_run_late(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    async def fake_whatsapp(self, to, body):
        return {"messages": [{"id": "x"}]}

    async def fake_sms(self, to, body):
        return {"status": "sent"}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_whatsapp)
    monkeypatch.setattr("app.services.sms_service.SMSService.send_text", fake_sms)

    owner = await make_user("+923010000016", role=UserRole.OWNER)
    customer = await make_user("+923010000017", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    # 20 minutes since submission: past both the 5-min WhatsApp and 15-min
    # SMS thresholds -- both should fire in a single pass.
    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=2),
            price=1000,
            advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED,
            payment_deadline=datetime.now(timezone.utc) + timedelta(hours=2) - timedelta(minutes=20),
        )
        session.add(booking)
        await session.commit()

    escalated = await escalate_pending_payment_reviews(session_factory=db_session_factory)
    assert escalated == 2


async def test_booking_reminder_sent_within_window(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    pushed = []

    async def fake_push(self, token, title, body, data=None):
        pushed.append(token)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923010000018", role=UserRole.OWNER)
    customer = await make_user("+923010000019", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        session.add(FCMToken(user_id=customer.id, token="reminder-device-token"))
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=1, minutes=30),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=2, minutes=30),
            price=1000,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    sent = await send_booking_reminders(session_factory=db_session_factory)
    assert sent == 1
    assert "reminder-device-token" in pushed

    async with db_session_factory() as session:
        result = await session.execute(
            select(NotificationLog).where(
                NotificationLog.event_type == "booking_reminder", NotificationLog.reference_id == booking_id
            )
        )
        assert result.scalar_one_or_none() is not None

    # Idempotent: running again shouldn't push a second time.
    pushed.clear()
    await send_booking_reminders(session_factory=db_session_factory)
    assert pushed == []


async def test_booking_reminder_ignores_bookings_outside_window(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    pushed = []

    async def fake_push(self, token, title, body, data=None):
        pushed.append(token)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923010000020", role=UserRole.OWNER)
    customer = await make_user("+923010000021", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=5),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=6),
            price=1000,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()

    sent = await send_booking_reminders(session_factory=db_session_factory)
    assert sent == 0


async def test_run_expiry_job_runs_all_steps_and_is_idempotent(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923010000022", role=UserRole.OWNER)
    customer = await make_user("+923010000023", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    async with db_session_factory() as session:
        held = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) + timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) + timedelta(hours=3),
            price=1000,
            status=BookingStatus.HELD,
            held_until=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        no_show = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) - timedelta(hours=1),
            price=1000,
            status=BookingStatus.BOOKED,
        )
        past_waitlist = WaitlistEntry(
            court_id=court.id, player_id=customer.id, slot_starts_at=datetime.now(timezone.utc) - timedelta(hours=5)
        )
        session.add_all([held, no_show, past_waitlist])
        await session.commit()

    result = await run_expiry_job(session_factory=db_session_factory)
    assert result["expired_bookings"] == 1
    assert result["no_shows"] == 1
    assert result["waitlist_entries_deactivated"] == 1

    # Running again immediately should be a no-op -- nothing left to process,
    # no errors on the now-already-cancelled/no_show/deactivated rows.
    result_again = await run_expiry_job(session_factory=db_session_factory)
    assert result_again["expired_bookings"] == 0
    assert result_again["no_shows"] == 0
    assert result_again["waitlist_entries_deactivated"] == 0
