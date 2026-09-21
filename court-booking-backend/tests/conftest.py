import os
import uuid as uuid_module
from collections.abc import AsyncGenerator, Callable
from datetime import date, datetime, time, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5433/court_booking")
os.environ.setdefault("SESSION_TOKEN_SECRET", "test-secret")
os.environ.setdefault("S3_BUCKET_PUBLIC", "test-public")
os.environ.setdefault("S3_BUCKET_PRIVATE", "test-private")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test-key")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test-secret-key")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.database import Base, get_db
from app.main import create_app
from app.models.court import Court
from app.models.pricing import PricingRule
from app.models.schedule import ScheduleTemplate
from app.models.user import Session as SessionModel
from app.models.user import User, UserRole
from app.models.venue import Venue, VenueStatus
from app.utils.security import generate_session_token, hash_token, token_expiry
from app.utils.text import slugify

settings = get_settings()
BASE_ADMIN_URL = settings.DATABASE_URL.rsplit("/", 1)[0] + "/postgres"
TEST_DATABASE_URL = settings.DATABASE_URL.rsplit("/", 1)[0] + "/court_booking_test"


@pytest.fixture(scope="session")
async def test_engine():
    admin_engine = create_async_engine(BASE_ADMIN_URL, isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = 'court_booking_test'")
        )
        if not exists:
            await conn.execute(text("CREATE DATABASE court_booking_test"))
    await admin_engine.dispose()

    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))  # bookings' no-overlap constraint
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
def db_session_factory(test_engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(autouse=True)
async def _clean_tables(test_engine):
    yield
    async with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())


@pytest.fixture
async def db_session(db_session_factory) -> AsyncGenerator[AsyncSession, None]:
    async with db_session_factory() as session:
        yield session


@pytest.fixture
def app(db_session_factory):
    application = create_app()

    async def _get_db_override() -> AsyncGenerator[AsyncSession, None]:
        async with db_session_factory() as session:
            yield session

    application.dependency_overrides[get_db] = _get_db_override
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
async def client(app) -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def make_user(db_session_factory) -> Callable:
    async def _make(phone: str, role: UserRole = UserRole.PLAYER, **kwargs) -> User:
        async with db_session_factory() as session:
            # Test users are phone-verified by default (the Section 26 gate); pass
            # phone_verified_at=None to build a pending signup.
            kwargs.setdefault("phone_verified_at", datetime.now(timezone.utc))
            user = User(phone=phone, role=role, **kwargs)
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    return _make


@pytest.fixture
def make_auth_headers(db_session_factory) -> Callable:
    async def _make(user: User) -> dict[str, str]:
        token = generate_session_token()
        async with db_session_factory() as session:
            session.add(
                SessionModel(
                    user_id=user.id,
                    token_hash=hash_token(token, settings.SESSION_TOKEN_SECRET),
                    expires_at=token_expiry(hours=settings.SESSION_TOKEN_EXPIRE_HOURS),
                )
            )
            await session.commit()
        return {"Authorization": f"Bearer {token}"}

    return _make


@pytest.fixture
def make_venue(db_session_factory) -> Callable:
    async def _make(owner: User, **kwargs) -> Venue:
        defaults = dict(
            name="Test Arena",
            address="123 Main St",
            city="Karachi",
            location="SRID=4326;POINT(67.0 24.8)",
            sports=["padel"],
            status=VenueStatus.APPROVED,
            amenities=["parking"],
        )
        defaults.update(kwargs)
        if "slug" not in defaults:
            defaults["slug"] = f"{slugify(defaults['name'])}-{uuid_module.uuid4().hex[:6]}"
        async with db_session_factory() as session:
            venue = Venue(owner_id=owner.id, **defaults)
            session.add(venue)
            await session.commit()
            await session.refresh(venue)
            return venue

    return _make


@pytest.fixture
def make_court(db_session_factory) -> Callable:
    async def _make(venue: Venue, **kwargs) -> Court:
        defaults = dict(name="Court 1", sport="padel", slot_minutes=60)
        defaults.update(kwargs)
        async with db_session_factory() as session:
            court = Court(venue_id=venue.id, **defaults)
            session.add(court)
            await session.commit()
            await session.refresh(court)
            return court

    return _make


@pytest.fixture
def make_schedule(db_session_factory) -> Callable:
    async def _make(court: Court, day_of_week: int, open_time: time, close_time: time):
        async with db_session_factory() as session:
            template = ScheduleTemplate(
                court_id=court.id, day_of_week=day_of_week, open_time=open_time, close_time=close_time
            )
            session.add(template)
            await session.commit()
            await session.refresh(template)
            return template

    return _make


@pytest.fixture
def make_pricing_rule(db_session_factory) -> Callable:
    async def _make(court: Court, **kwargs) -> PricingRule:
        defaults = dict(name="Standard", price_per_slot=1000, advance_percentage=100.00)
        defaults.update(kwargs)
        async with db_session_factory() as session:
            rule = PricingRule(court_id=court.id, **defaults)
            session.add(rule)
            await session.commit()
            await session.refresh(rule)
            return rule

    return _make


@pytest.fixture
def next_weekday() -> Callable:
    def _next(target_weekday: int) -> date:
        today = date.today()
        days_ahead = (target_weekday - today.weekday()) % 7
        days_ahead = days_ahead or 7
        return today + timedelta(days=days_ahead)

    return _next
