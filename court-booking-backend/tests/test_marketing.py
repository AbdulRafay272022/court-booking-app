from datetime import date, timedelta

from app.config import get_settings
from app.models.user import UserRole
from app.models.venue import PlanTier


async def _hold_and_book(client, court, headers, days_ahead=1):
    target = date.today() + timedelta(days=days_ahead)
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": f"{target.isoformat()}T10:00:00+00:00"},
    )
    return resp.json()["booking"]


async def _open_all_week(make_schedule, court) -> None:
    """create_hold requires starts_at to be grid-aligned to an active
    schedule_template -- open every day of week wide enough to cover
    10:00 regardless of which weekday `_hold_and_book` lands on."""
    from datetime import time

    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))


async def test_free_tier_venue_cannot_send_marketing(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    # Free tier's cap is 0, so send_marketing_announcement rejects before
    # ever touching WhatsApp -- no need to mock that send here.
    owner = await make_user("+923012000001", role=UserRole.OWNER)
    player = await make_user("+923012000002", role=UserRole.PLAYER)
    venue = await make_venue(owner, plan_tier=PlanTier.FREE)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    player_headers = await make_auth_headers(player)
    await _hold_and_book(client, court, player_headers)

    owner_headers = await make_auth_headers(owner)
    resp = await client.post(
        f"/api/v1/venues/{venue.id}/announcements",
        headers=owner_headers,
        json={"title": "Tournament!", "body": "Join our tournament this weekend."},
    )
    assert resp.status_code == 200
    assert resp.json()["sent"] == 0
    assert resp.json()["skipped_cap_reached"] == 1


async def test_pro_tier_venue_can_send_marketing(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)

    owner = await make_user("+923012000003", role=UserRole.OWNER)
    player = await make_user("+923012000004", role=UserRole.PLAYER)
    venue = await make_venue(owner, plan_tier=PlanTier.PRO)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    player_headers = await make_auth_headers(player)
    await _hold_and_book(client, court, player_headers)

    owner_headers = await make_auth_headers(owner)
    resp = await client.post(
        f"/api/v1/venues/{venue.id}/announcements",
        headers=owner_headers,
        json={"title": "Tournament!", "body": "Join our tournament this weekend."},
    )
    assert resp.status_code == 200
    assert resp.json()["sent"] == 1
    assert resp.json()["skipped_cap_reached"] == 0


async def test_pro_tier_venue_at_monthly_cap_rejected(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    async def fake_send_text(self, to, body):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_send_text)
    # get_settings() is an lru_cache'd singleton -- mutating the instance
    # (not the class) is what actually affects what the app reads.
    monkeypatch.setattr(get_settings(), "MARKETING_CAP_PRO", 0)

    owner = await make_user("+923012000005", role=UserRole.OWNER)
    player = await make_user("+923012000006", role=UserRole.PLAYER)
    venue = await make_venue(owner, plan_tier=PlanTier.PRO)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    player_headers = await make_auth_headers(player)
    await _hold_and_book(client, court, player_headers)

    owner_headers = await make_auth_headers(owner)
    resp = await client.post(
        f"/api/v1/venues/{venue.id}/announcements",
        headers=owner_headers,
        json={"title": "Tournament!", "body": "Cap reached test."},
    )
    assert resp.status_code == 200
    assert resp.json()["sent"] == 0
    assert resp.json()["skipped_cap_reached"] == 1


async def test_non_owner_cannot_send_announcement(client, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923012000007", role=UserRole.OWNER)
    other_owner = await make_user("+923012000008", role=UserRole.OWNER)
    venue = await make_venue(owner, plan_tier=PlanTier.PRO)
    headers = await make_auth_headers(other_owner)

    resp = await client.post(
        f"/api/v1/venues/{venue.id}/announcements",
        headers=headers,
        json={"title": "x", "body": "y"},
    )
    assert resp.status_code == 403
