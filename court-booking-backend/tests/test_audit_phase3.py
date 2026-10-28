"""Audit build 2026-10-28, Phase 3 (flags default OFF). One section per item; see docs/audit-build-progress.md."""

from datetime import time

from sqlalchemy import select

from app.models.booking import Booking, BookingStatus
from app.models.feature_flag import FeatureFlag
from app.models.user import UserRole
from tests.round2_helpers import future_day, hold, mock_upload, submit_proof


async def set_flag(db_session_factory, key: str, on: bool = True):
    async with db_session_factory() as s:
        row = await s.get(FeatureFlag, key)
        if row is None:
            s.add(FeatureFlag(key=key, label=key, enabled=on))
        else:
            row.enabled = on
        await s.commit()


async def half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone="+923003010001"):
    owner = await make_user(phone, role=UserRole.OWNER, name="Owner P3")
    venue = await make_venue(owner, name="P3 Arena")
    court = await make_court(venue, name="Court 1", sport="padel", slot_minutes=60)
    for d in range(7):
        await make_schedule(court, day_of_week=d, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000, advance_percentage=50)
    return owner, venue, court


async def booked_with_balance(client, court, owner_headers, player_headers):
    booking = await hold(client, court, player_headers, future_day(3))
    sub = await submit_proof(client, booking["id"], player_headers)
    assert sub.status_code == 201, sub.text
    pay_id = sub.json()["payment"]["id"]
    ok = await client.post(f"/api/v1/payments/{pay_id}/approve", headers=owner_headers, json={"amount_pkr": 500})
    assert ok.status_code == 200, ok.text
    return booking["id"]


# ---------------------------------------------------------------- items 1 + 2: balance screenshot, reject never cancels


async def submit_other_proof(client, booking_id, headers, color=(200, 30, 90)):
    """A DIFFERENT image than the advance receipt (the same one is caught as a duplicate on the same booking)."""
    import io

    from PIL import Image, ImageDraw

    img = Image.new("RGB", (64, 64), color=color)
    ImageDraw.Draw(img).rectangle([8, 8, 40, 30], fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return await client.post(
        f"/api/v1/bookings/{booking_id}/payment-proof", headers=headers,
        files={"image": ("balance.jpg", io.BytesIO(buf.getvalue()), "image/jpeg")},
    )


async def test_balance_proof_is_refused_while_the_flag_is_off(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923003010002")
    ph, oh = await make_auth_headers(player), await make_auth_headers(owner)
    bid = await booked_with_balance(client, court, oh, ph)
    assert (await submit_proof(client, bid, ph)).status_code == 400


async def test_a_balance_screenshot_is_reviewed_and_credited_without_touching_the_booking(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923003010012")
    ph, oh = await make_auth_headers(player), await make_auth_headers(owner)
    bid = await booked_with_balance(client, court, oh, ph)
    await set_flag(db_session_factory, "balance_proof")

    # re-sending the advance receipt as the balance is caught as a duplicate of THIS booking's earlier proof
    dup = await submit_proof(client, bid, ph)
    assert dup.status_code == 201 and dup.json()["payment"]["is_duplicate"] is True
    await client.post(f"/api/v1/payments/{dup.json()['payment']['id']}/reject", headers=oh, json={"reason": "Purana screenshot"})
    sub = await submit_other_proof(client, bid, ph)
    assert sub.status_code == 201, sub.text
    assert sub.json()["booking"]["status"] == "booked"  # stays booked while the owner checks it
    pay_id = sub.json()["payment"]["id"]
    assert sub.json()["payment"]["expected_amount"] == 500.0  # the balance, not the advance
    badges = (await client.get("/api/v1/owners/badges", headers=oh)).json()
    assert badges["approvals"] == 1
    ok = await client.post(f"/api/v1/payments/{pay_id}/approve", headers=oh, json={"amount_pkr": 500})
    assert ok.status_code == 200, ok.text
    async with db_session_factory() as s:
        b = await s.get(Booking, bid)
        assert b.status == BookingStatus.BOOKED and float(b.amount_paid) == 1000 and float(b.balance_due) == 0


async def test_rejecting_a_balance_screenshot_never_cancels_the_booked_booking(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, _v, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923003010022")
    ph, oh = await make_auth_headers(player), await make_auth_headers(owner)
    bid = await booked_with_balance(client, court, oh, ph)
    await set_flag(db_session_factory, "balance_proof")
    pay_id = (await submit_other_proof(client, bid, ph)).json()["payment"]["id"]
    resp = await client.post(f"/api/v1/payments/{pay_id}/reject", headers=oh, json={"reason": "Galat account"})
    assert resp.status_code == 200, resp.text
    async with db_session_factory() as s:
        b = await s.get(Booking, bid)
        assert b.status == BookingStatus.BOOKED and float(b.amount_paid) == 500  # still booked, the advance is kept


async def test_bank_check_lists_every_transfer_credited_today(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    mock_upload(monkeypatch)
    owner, venue, court = await half_advance_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923003010032", name="Bilal")
    ph, oh = await make_auth_headers(player), await make_auth_headers(owner)
    bid = await booked_with_balance(client, court, oh, ph)
    await set_flag(db_session_factory, "balance_proof")
    pay_id = (await submit_other_proof(client, bid, ph)).json()["payment"]["id"]
    assert (await client.post(f"/api/v1/payments/{pay_id}/approve", headers=oh, json={"amount_pkr": 500})).status_code == 200

    resp = await client.get("/api/v1/owners/bank-check", headers=oh, params={"venue_id": str(venue.id)})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_pkr"] == 1000
    assert sorted(i["kind"] for i in body["items"]) == ["advance", "balance"]
    assert all(i["booking_id"] == bid for i in body["items"])
    # another day is empty; another owner cannot read this venue's list
    assert (await client.get("/api/v1/owners/bank-check", headers=oh, params={"date": "2020-01-01"})).json()["items"] == []
    stranger = await make_auth_headers(await make_user("+923003010033", role=UserRole.OWNER))
    assert (await client.get("/api/v1/owners/bank-check", headers=stranger, params={"venue_id": str(venue.id)})).status_code == 404
