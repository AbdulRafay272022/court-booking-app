"""Creates a small set of demo data for local dev (Section 17's `make seed`):
one admin, one owner with an approved venue/court/schedule/pricing, and one
player -- enough to poke around the API by hand without configuring
WhatsApp/OTP delivery. The three accounts are already phone-verified and
share DEMO_PASSWORD, so `POST /auth/login` works immediately (Section 26).
(With no WHATSAPP_API_TOKEN configured, OTP sends no-op locally.)

Safe to run more than once: each row is looked up by its natural key
(phone, slug) first and only created if missing, rather than relying on a
unique-constraint failure -- this is an idempotent one-shot admin script,
not a concurrent user-facing path, so there's no race to design around here.
"""

import asyncio
from datetime import datetime, time, timezone

import structlog
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.court import Court
from app.models.pricing import PricingRule
from app.models.schedule import ScheduleTemplate
from app.models.user import User, UserRole
from app.utils.security import hash_password
from app.models.venue import Venue, VenueStatus

logger = structlog.get_logger(__name__)

ADMIN_PHONE = "+923000000001"
OWNER_PHONE = "+923000000002"
PLAYER_PHONE = "+923000000003"
VENUE_SLUG = "demo-arena"


# Local-dev-only password for the three demo accounts (Section 26 login is
# phone + password). Never a real credential: seed.py is for a throwaway local DB.
DEMO_PASSWORD = "demo-password-123"


async def _get_or_create_user(db, phone: str, role: UserRole, name: str) -> User:
    user = await db.scalar(select(User).where(User.phone == phone))
    if user is None:
        user = User(
            phone=phone,
            role=role,
            name=name,
            email=f"{name.lower().replace(' ', '.')}@example.com",
            password_hash=await hash_password(DEMO_PASSWORD),
            phone_verified_at=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.flush()
    return user


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        admin = await _get_or_create_user(db, ADMIN_PHONE, UserRole.ADMIN, "Demo Admin")
        owner = await _get_or_create_user(db, OWNER_PHONE, UserRole.OWNER, "Demo Owner")
        await _get_or_create_user(db, PLAYER_PHONE, UserRole.PLAYER, "Demo Player")

        venue = await db.scalar(select(Venue).where(Venue.slug == VENUE_SLUG))
        if venue is None:
            venue = Venue(
                owner_id=owner.id,
                name="Demo Arena",
                slug=VENUE_SLUG,
                address="123 Demo Street",
                city="Karachi",
                location="SRID=4326;POINT(67.0 24.8)",
                sports=["padel"],
                status=VenueStatus.APPROVED,
                amenities=["parking", "washrooms"],
                auto_approve_enabled=True,
            )
            db.add(venue)
            await db.flush()

        court = await db.scalar(select(Court).where(Court.venue_id == venue.id))
        if court is None:
            court = Court(venue_id=venue.id, name="Court 1", sport="padel", slot_minutes=60)
            db.add(court)
            await db.flush()

            for day_of_week in range(7):
                db.add(
                    ScheduleTemplate(
                        court_id=court.id, day_of_week=day_of_week, open_time=time(8, 0), close_time=time(23, 0)
                    )
                )
            db.add(PricingRule(court_id=court.id, name="Standard", price_per_slot=2000, advance_percentage=100))

        await db.commit()
        logger.info(
            "seed.completed",
            admin_phone=ADMIN_PHONE,
            owner_phone=OWNER_PHONE,
            player_phone=PLAYER_PHONE,
            venue_slug=VENUE_SLUG,
        )


if __name__ == "__main__":
    asyncio.run(seed())
