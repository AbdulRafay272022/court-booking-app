"""Shared builders for the Owner Round 2 tests (tests/test_round2_*.py). Real Postgres."""
import io
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from app.models.notification import NotificationLog
from app.models.user import UserRole


def mock_upload(monkeypatch):
    async def fake_upload(*a, **k):
        return "payment-proofs/fake.jpg"

    monkeypatch.setattr("app.services.payment_service.upload_private_proof", fake_upload)


def png_bytes() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(80, 160, 40)).save(buf, format="PNG")
    return buf.getvalue()


def future_day(days: int = 3) -> date:
    return (datetime.now(timezone.utc) + timedelta(days=days)).date()


async def open_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone: str, *, price=1000, **court_kwargs):
    owner = await make_user(phone, role=UserRole.OWNER, name="Owner R2")
    venue = await make_venue(owner, name="R2 Arena")
    court = await make_court(venue, name="Futsal 1", sport="futsal", slot_minutes=60, **court_kwargs)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=price)
    return owner, venue, court


async def hold(client, court, headers, day: date, hour_utc: int = 14) -> dict:
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": f"{day.isoformat()}T{hour_utc:02d}:00:00+00:00"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["booking"]


async def submit_proof(client, booking_id: str, headers):
    return await client.post(
        f"/api/v1/bookings/{booking_id}/payment-proof",
        headers=headers,
        files={"image": ("proof.jpg", io.BytesIO(png_bytes()), "image/jpeg")},
    )


async def held_and_submitted(client, court, headers, day: date, hour_utc: int = 14) -> tuple[str, str]:
    booking = await hold(client, court, headers, day, hour_utc)
    resp = await submit_proof(client, booking["id"], headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["booking"]["status"] == "payment_submitted"
    return booking["id"], resp.json()["payment"]["id"]


async def log_rows(sf, user_id=None, event_type=None) -> list[NotificationLog]:
    async with sf() as session:
        q = select(NotificationLog)
        if user_id is not None:
            q = q.where(NotificationLog.user_id == user_id)
        if event_type is not None:
            q = q.where(NotificationLog.event_type == event_type)
        return list((await session.execute(q.order_by(NotificationLog.created_at))).scalars().all())
