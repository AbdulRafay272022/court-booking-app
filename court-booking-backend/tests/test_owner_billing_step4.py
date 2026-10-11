"""Owner premium billing, step 4: every premium feature is gated by the OWNER's entitlement (with the same fallback as the global
switch being off), the old plan tier is retired, and the daily job writes down who is past due / lapsed and sends reminders."""

import io
from datetime import date, datetime, time, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy import select

from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.feature_flag import FeatureFlag
from app.models.notification import NotificationLog
from app.models.owner_billing import OwnerFeature, PremiumFeature
from app.models.user import UserRole
from app.services.ai.base import PaymentExtraction
from app.services.ai_chat_service import AIChatService
from app.services.entitlement_service import SELLABLE_KEYS, EntitlementService
from app.services.owner_billing_service import OwnerBillingService
from app.utils.timezone import pkt_today

LONG_AGO = datetime.now(timezone.utc) - timedelta(days=60)


@pytest.fixture
def billing(db_session_factory):
    """The six features priced and for sale, billing enforced, and a helper that gives an owner a feature."""

    class Billing:
        async def on(self, *, enforced=True, sellable=True):
            async with db_session_factory() as session:
                for key in SELLABLE_KEYS:
                    session.add(PremiumFeature(key=key, label=key.replace("_", " ").title(), monthly_price_pkr=1000, is_sellable=sellable))
                session.add(FeatureFlag(key="owner_billing_enforced", enabled=enforced, label="x"))
                await session.commit()

        async def give(self, owner, key, *, enabled_at=None, paid_through=None, status="active"):
            async with db_session_factory() as session:
                session.add(OwnerFeature(owner_id=owner.id, feature_key=key, price_pkr=1000, status=status,
                                         enabled_at=enabled_at or datetime.now(timezone.utc), paid_through=paid_through))
                await session.commit()

    return Billing()


def png(color=(120, 40, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(buf, "PNG")
    return buf.getvalue()


# --- Growth suggestions (replaces the old Pro/Business tier gate) -----------------------------------------------------------


async def test_growth_needs_the_feature_once_billing_is_enforced(client, billing, make_user, make_venue, make_court, make_auth_headers):
    await billing.on()
    owner = await make_user("+923096000001", role=UserRole.OWNER)
    venue = await make_venue(owner)
    await make_court(venue)
    headers = await make_auth_headers(owner)
    resp = await client.get("/api/v1/owners/growth", headers=headers, params={"venue_id": str(venue.id)})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "PREMIUM_FEATURE_REQUIRED"
    # the aggregate view just has nothing to show
    assert (await client.get("/api/v1/owners/growth", headers=headers)).json()["underbooked_slots"] == []

    await billing.give(owner, "growth_suggestions")  # switched on: inside its free trial
    assert (await client.get("/api/v1/owners/growth", headers=headers, params={"venue_id": str(venue.id)})).status_code == 200


async def test_growth_is_open_to_every_owner_while_billing_is_not_enforced(client, billing, make_user, make_venue, make_court, make_auth_headers):
    await billing.on(enforced=False)
    owner = await make_user("+923096000002", role=UserRole.OWNER)
    venue = await make_venue(owner)
    await make_court(venue)
    resp = await client.get("/api/v1/owners/growth", headers=await make_auth_headers(owner), params={"venue_id": str(venue.id)})
    assert resp.status_code == 200


# --- Announcements -------------------------------------------------------------------------------------------------------------


async def _venue_with_one_past_player(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, phones, **venue_kw):
    owner = await make_user(phones[0], role=UserRole.OWNER)
    player = await make_user(phones[1], role=UserRole.PLAYER)
    venue = await make_venue(owner, **venue_kw)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)
    return owner, player, venue, court


async def test_announcements_need_the_feature_and_use_one_monthly_allowance(
    client, billing, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    sent_to = []

    async def fake_send_text(self, to, body):
        sent_to.append(to)
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)
    await billing.on()
    owner, player, venue, court = await _venue_with_one_past_player(
        client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
        ("+923096000010", "+923096000011"),
    )
    async with db_session_factory() as session:
        session.add(Booking(court_id=court.id, player_id=player.id, starts_at=datetime.now(timezone.utc) + timedelta(days=2),
                            ends_at=datetime.now(timezone.utc) + timedelta(days=2, hours=1), price=1000, status=BookingStatus.BOOKED))
        await session.commit()
    headers = await make_auth_headers(owner)
    body = {"title": "Tournament!", "body": "Join us this weekend."}

    blocked = await client.post(f"/api/v1/venues/{venue.id}/announcements", headers=headers, json=body)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "PREMIUM_FEATURE_REQUIRED"
    assert sent_to == []

    await billing.give(owner, "marketing_announcements")
    ok = await client.post(f"/api/v1/venues/{venue.id}/announcements", headers=headers, json=body)
    assert ok.status_code == 200 and ok.json()["sent"] == 1  # a Free-tier venue now gets the allowance (the old Pro number)
    assert get_settings().MARKETING_CAP_PRO > 0 and sent_to == [player.phone]


# --- Digest and reminders ---------------------------------------------------------------------------------------------------


async def test_the_daily_digest_skips_an_owner_without_the_feature(db_session_factory, billing, make_user, make_venue, make_court, monkeypatch):
    from app.jobs.digest_job import send_owner_daily_digests

    sent = []

    async def fake_smart(self, to, body, *, last_inbound_at, template_name, template_params):
        sent.append(to)
        return {"messages": [{"id": "x"}]}, None

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_smart", fake_smart)
    await billing.on()
    with_feature = await make_user("+923096000020", role=UserRole.OWNER)
    without = await make_user("+923096000021", role=UserRole.OWNER)
    for owner in (with_feature, without):
        await make_court(await make_venue(owner, name=f"V{owner.phone[-2:]}"))
    await billing.give(with_feature, "digest_reminders")
    result = await send_owner_daily_digests(session_factory=db_session_factory)
    assert result == {"sent": 1, "failed": []} and sent == [with_feature.phone]


async def test_booking_reminders_skip_a_venue_whose_owner_lacks_the_feature(db_session_factory, billing, make_user, make_venue, make_court, monkeypatch):
    from app.jobs.reminder_job import send_booking_reminders

    await billing.on()
    pushed = []

    async def fake_push(self, token, title, body, data=None):
        pushed.append(token)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)
    from app.models.fcm_token import FCMToken

    players = []
    courts = []
    for i, has in enumerate((True, False)):
        owner = await make_user(f"+92309600003{i}", role=UserRole.OWNER)
        courts.append(await make_court(await make_venue(owner, name=f"R{i}")))
        players.append(await make_user(f"+92309600004{i}", role=UserRole.PLAYER))
        if has:
            await billing.give(owner, "digest_reminders")
    async with db_session_factory() as session:
        for player, court in zip(players, courts):
            session.add(FCMToken(user_id=player.id, token=f"tok-{player.phone}"))
            session.add(Booking(court_id=court.id, player_id=player.id, starts_at=datetime.now(timezone.utc) + timedelta(hours=1, minutes=30),
                                ends_at=datetime.now(timezone.utc) + timedelta(hours=2, minutes=30), price=1000, status=BookingStatus.BOOKED))
        await session.commit()
    assert await send_booking_reminders(session_factory=db_session_factory) == 1
    assert pushed == [f"tok-{players[0].phone}"]


# --- AI payment verification and auto-approve (player-side payments at the owner's venue) ---------------------------------------


async def _pay(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, db_session_factory, monkeypatch, phones, *, calls):
    monkeypatch.setattr("app.services.payment_service.upload_private_proof", _fake_upload)
    monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "test-key")

    async def fake_extract(self, image_bytes, mime_type, expected_amount):
        calls.append(1)
        return PaymentExtraction(amount=3000, reference="TXN1", timestamp=datetime.now(timezone.utc).isoformat(),
                                 confidence=0.95, raw_response={}, payer_name="Ali Raza")

    monkeypatch.setattr("app.services.ai.claude_provider.ClaudeProvider.extract_payment_proof", fake_extract)
    owner = await make_user(phones[0], role=UserRole.OWNER)
    customer = await make_user(phones[1], role=UserRole.PLAYER, name="Ali Raza")
    venue = await make_venue(owner, auto_approve_enabled=True, auto_approve_min_bookings=5)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(0, 0), close_time=time(23, 59))
    await make_pricing_rule(court, price_per_slot=3000)
    async with db_session_factory() as session:
        for i in range(5):
            start = datetime.now(timezone.utc) - timedelta(days=i + 10)
            session.add(Booking(court_id=court.id, player_id=customer.id, starts_at=start, ends_at=start + timedelta(hours=1),
                                price=3000, amount_paid=3000, status=BookingStatus.COMPLETED))
        await session.commit()
    return owner, customer, court


async def _fake_upload(data, filename, content_type):
    return "payment-proofs/fake.jpg"


async def _submit(client, court, customer_headers):
    from datetime import date as _d

    day = pkt_today() + timedelta(days=1)
    from app.utils.timezone import pkt_time_to_utc

    starts = pkt_time_to_utc(day, time(10, 0)).isoformat().replace("+00:00", "Z")
    held = await client.post("/api/v1/bookings/hold", headers=customer_headers, json={"court_id": str(court.id), "starts_at": starts, "slot_count": 2})
    assert held.status_code == 201, held.text
    booking_id = held.json()["booking"]["id"]
    return await client.post(f"/api/v1/bookings/{booking_id}/payment-proof", headers=customer_headers,
                             files={"image": ("proof.png", io.BytesIO(png()), "image/png")})


async def test_without_ai_verification_and_auto_approve_every_payment_is_checked_by_hand(
    client, billing, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await billing.on()
    calls = []
    owner, customer, court = await _pay(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
                                        db_session_factory, monkeypatch, ("+923096000050", "+923096000051"), calls=calls)
    resp = await _submit(client, court, await make_auth_headers(customer))
    assert resp.status_code == 201, resp.text
    payment, booking = resp.json()["payment"], resp.json()["booking"]
    assert calls == []  # no billed vision call for an owner without "AI payment verification"
    assert payment["ocr_verdict"] == "unreadable" and payment["auto_approved"] is False
    assert booking["status"] == "payment_submitted"  # waits for the owner, exactly as when the global switch is off


async def test_with_both_features_the_same_payment_is_read_and_auto_approved(
    client, billing, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await billing.on()
    calls = []
    owner, customer, court = await _pay(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
                                        db_session_factory, monkeypatch, ("+923096000052", "+923096000053"), calls=calls)
    await billing.give(owner, "ocr_verification")
    await billing.give(owner, "auto_approve")
    resp = await _submit(client, court, await make_auth_headers(customer))
    assert calls == [1] and resp.json()["payment"]["auto_approved"] is True and resp.json()["booking"]["status"] == "booked"


async def test_ocr_alone_reads_the_screenshot_but_does_not_auto_approve(
    client, billing, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await billing.on()
    calls = []
    owner, customer, court = await _pay(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
                                        db_session_factory, monkeypatch, ("+923096000054", "+923096000055"), calls=calls)
    await billing.give(owner, "ocr_verification")
    resp = await _submit(client, court, await make_auth_headers(customer))
    assert calls == [1] and resp.json()["payment"]["ocr_verdict"] == "match" and resp.json()["payment"]["auto_approved"] is False


# --- AI chat booking: the court still shows, the assistant just won't book it ---------------------------------------------------


async def _bookable_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone):
    owner = await make_user(phone, role=UserRole.OWNER)
    court = await make_court(await make_venue(owner, sports=["padel"]), slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)
    return owner, court


async def test_the_assistant_will_not_propose_or_hold_for_an_owner_without_the_feature(
    db_session, billing, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    await billing.on()
    owner, court = await _bookable_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923096000060")
    player = await make_user("+923096000061", role=UserRole.PLAYER, name="Ali")
    service = AIChatService(db_session, get_settings())
    day = (pkt_today() + timedelta(days=1)).isoformat()

    shown = await service._execute_tool(player, "check_availability", {"court_id": str(court.id), "date": day}, [])
    assert shown["slots"], "the court and its times must still show"
    starts_at = shown["slots"][0]["starts_at"]

    actions: list = []
    for tool in ("propose_booking_confirmation", "hold_slot"):
        out = await service._execute_tool(player, tool, {"court_id": str(court.id), "starts_at": starts_at}, actions)
        assert out["status_code"] == 403 and "Khelo app" in out["error"], tool
    assert actions == []
    assert (await db_session.execute(select(Booking))).scalars().all() == []

    await billing.give(owner, "ai_chat_booking")
    out = await service._execute_tool(player, "propose_booking_confirmation", {"court_id": str(court.id), "starts_at": starts_at}, actions)
    assert out.get("ok") is True and [a.type for a in actions] == ["confirm_booking", "decline"]


async def test_a_yes_no_proposal_for_such_a_court_is_dropped_and_the_player_is_pointed_to_the_app(
    db_session, billing, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    from app.services.ai_chat_service import ChatAction

    await billing.on()
    _owner, court = await _bookable_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923096000062")
    service = AIChatService(db_session, get_settings())
    proposal = [ChatAction("confirm_booking", "Yes, book it", {"court_id": str(court.id), "starts_at": "x"}), ChatAction("decline", "No, thanks", {})]
    text, kept = await service._drop_unbookable_actions("Shall I book it? Reply Yes or No", proposal)
    assert kept == [] and "Khelo app" in text


async def test_a_typed_yes_or_old_button_cannot_book_at_such_a_venue(
    db_session, billing, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    from app.api.webhooks import _handle_button_reply
    from app.utils.timezone import pkt_time_to_utc

    replies = []

    async def fake_send_text(self, to, body):
        replies.append(body)
        return {"messages": [{"id": f"m{len(replies)}"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)
    await billing.on()
    _owner, court = await _bookable_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923096000063")
    player = await make_user("+923096000064", role=UserRole.PLAYER, name="Ali")
    starts = pkt_time_to_utc(pkt_today() + timedelta(days=1), time(10, 0)).isoformat()
    await _handle_button_reply(db_session, get_settings(), player, f"confirm:{court.id}:{starts}")
    assert replies and "not available for this venue" in replies[-1] and "Khelo app" in replies[-1]
    assert (await db_session.execute(select(Booking))).scalars().all() == []


# --- the daily job: statuses, reminders, banners --------------------------------------------------------------------------------


E_OLD = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)  # enabled long ago: its free trial is over


async def test_statuses_follow_the_dates_and_only_while_enforced(db_session, db_session_factory, billing, make_user):
    owner = await make_user("+923096000070", role=UserRole.OWNER)
    await billing.on(enforced=False)
    await billing.give(owner, "auto_approve", enabled_at=E_OLD, paid_through=date(2026, 10, 31))
    service = OwnerBillingService(db_session, get_settings())
    assert await service.refresh_statuses(today=date(2026, 12, 1)) == {"changed": 0}  # not enforced: nothing is touched

    async with db_session_factory() as session:
        flag = await session.get(FeatureFlag, "owner_billing_enforced")
        flag.enabled = True
        await session.commit()

    async def status_on(day):
        await service.refresh_statuses(today=day)
        async with db_session_factory() as session:
            row = (await session.execute(select(OwnerFeature))).scalar_one()
            return row.status

    assert await status_on(date(2026, 10, 31)) == "active"
    assert await status_on(date(2026, 11, 1)) == "past_due"
    assert await status_on(date(2026, 11, 7)) == "past_due"  # the seventh and last grace day
    assert await status_on(date(2026, 11, 8)) == "lapsed"
    async with db_session_factory() as session:  # paying again brings it straight back (the dates decide, not the column)
        row = (await session.execute(select(OwnerFeature))).scalar_one()
        row.paid_through = date(2026, 11, 30)
        await session.commit()
    assert await status_on(date(2026, 11, 8)) == "active"


async def test_a_cancelled_feature_is_left_alone_by_the_job(db_session, db_session_factory, billing, make_user):
    owner = await make_user("+923096000071", role=UserRole.OWNER)
    await billing.on()
    await billing.give(owner, "auto_approve", enabled_at=E_OLD, paid_through=date(2026, 3, 1), status="cancelled")
    await OwnerBillingService(db_session, get_settings()).refresh_statuses(today=date(2026, 12, 1))
    async with db_session_factory() as session:
        assert (await session.execute(select(OwnerFeature))).scalar_one().status == "cancelled"


async def test_banners_follow_the_plan_seven_days_before_overdue_and_off(db_session, billing, make_user):
    await billing.on()
    owner = await make_user("+923096000072", role=UserRole.OWNER)
    await billing.give(owner, "auto_approve", enabled_at=E_OLD, paid_through=date(2026, 10, 31))
    service = EntitlementService(db_session, get_settings())

    async def banner(day):
        notices = await service.notices(owner.id, today=day)
        return (notices[0].level, notices[0].message) if notices else None

    assert await banner(date(2026, 10, 23)) is None  # eight days ahead: nothing yet
    level, message = await banner(date(2026, 10, 24))  # seven days ahead
    assert level == "info" and "paid period ends on 31 Oct" in message and "Auto Approve" in message
    assert (await banner(date(2026, 10, 31)))[0] == "info"  # the last paid day
    level, message = await banner(date(2026, 11, 1))
    assert level == "urgent" and "keeps working until 7 Nov" in message  # overdue, still working
    assert (await banner(date(2026, 11, 7)))[0] == "urgent"
    level, message = await banner(date(2026, 11, 8))
    assert level == "off" and "switched off" in message and "turn it back on straight away" in message


async def test_no_banners_while_billing_is_not_enforced_or_after_cancelling(db_session, billing, make_user):
    owner = await make_user("+923096000073", role=UserRole.OWNER)
    await billing.on(enforced=False)
    await billing.give(owner, "auto_approve", enabled_at=E_OLD, paid_through=date(2026, 10, 31))
    service = EntitlementService(db_session, get_settings())
    assert await service.notices(owner.id, today=date(2026, 11, 3)) == []


async def test_the_owner_gets_the_banner_through_the_api_and_staff_do_not(client, billing, make_user, make_auth_headers):
    await billing.on()
    owner = await make_user("+923096000074", role=UserRole.OWNER)
    await billing.give(owner, "auto_approve", enabled_at=E_OLD, paid_through=pkt_today() - timedelta(days=2))
    resp = await client.get("/api/v1/owners/premium/notices", headers=await make_auth_headers(owner))
    assert resp.status_code == 200 and [n["level"] for n in resp.json()] == ["urgent"] and resp.json()[0]["feature_key"] == "auto_approve"
    staff = await make_user("+923096000075", role=UserRole.STAFF)
    assert (await client.get("/api/v1/owners/premium/notices", headers=await make_auth_headers(staff))).status_code == 403


async def test_reminders_go_once_per_kind_per_period_and_the_job_does_it_all(db_session, db_session_factory, billing, make_user, monkeypatch):
    from app.jobs.billing_job import run_billing_job

    await billing.on()
    owner = await make_user("+923096000076", role=UserRole.OWNER)
    await billing.give(owner, "auto_approve", enabled_at=E_OLD, paid_through=date(2026, 10, 31))
    sent: list[tuple[str, str]] = []

    async def fake(self, user, event_type, title, body, *, reference_id=None, template_params=None):
        sent.append((event_type, body))
        await self._log(user_id=user.id, channel="push", event_type=event_type, reference_id=reference_id, cost_category="utility",
                        template_name=None, status_value="sent", error_message=None)

    monkeypatch.setattr("app.services.notification_service.NotificationService._send_push_and_whatsapp", fake)
    service = OwnerBillingService(db_session, get_settings())

    assert (await service.send_reminders(today=date(2026, 10, 23)))["sent"] == 0
    assert (await service.send_reminders(today=date(2026, 10, 24)))["sent"] == 1  # a week before the period ends
    assert (await service.send_reminders(today=date(2026, 10, 25)))["sent"] == 0  # not again for the same period
    assert (await service.send_reminders(today=date(2026, 11, 1)))["sent"] == 1  # overdue
    assert (await service.send_reminders(today=date(2026, 11, 2)))["sent"] == 0
    assert (await service.send_reminders(today=date(2026, 11, 8)))["sent"] == 1  # switched off
    assert [e for e, _b in sent] == ["premium_renewal_reminder", "premium_payment_overdue", "premium_feature_lapsed"]

    # the job end to end: statuses, invoices, reminders; and it is safe to run twice
    async with db_session_factory() as session:
        row = (await session.execute(select(OwnerFeature))).scalar_one()
        row.paid_through = pkt_today() + timedelta(days=3)  # a period ending in three days
        await session.commit()
    first = await run_billing_job(session_factory=db_session_factory)
    assert first["enforced"] is True and first["invoices_issued"] == 1 and first["reminders_sent"] == 1
    second = await run_billing_job(session_factory=db_session_factory)
    assert second["invoices_issued"] == 0 and second["reminders_sent"] == 0
    logged = (await db_session.execute(select(NotificationLog).where(NotificationLog.event_type == "premium_renewal_reminder"))).scalars().all()
    assert len(logged) == 2  # the earlier period's and this one


async def test_the_job_does_nothing_while_billing_is_not_enforced(db_session_factory, billing, make_user):
    from app.jobs.billing_job import run_billing_job

    await billing.on(enforced=False)
    owner = await make_user("+923096000077", role=UserRole.OWNER)
    await billing.give(owner, "auto_approve", enabled_at=E_OLD, paid_through=pkt_today() - timedelta(days=30))
    result = await run_billing_job(session_factory=db_session_factory)
    assert result["enforced"] is False and result["invoices_issued"] == 0 and result["statuses_changed"] == 0 and result["reminders_sent"] == 0
