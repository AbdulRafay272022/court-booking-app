import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.court import Court
from app.models.review import Review
from app.models.schedule import ScheduleTemplate
from app.models.user import User, UserRole
from app.models.venue import Venue, VenueStatus
from app.schemas.venue import VenueCreateIn, VenueUpdateIn
from app.services.notification_service import NotificationService
from app.utils.encryption import decrypt_json, encrypt_json
from app.utils.geo import distance_meters, within_radius
from app.utils.s3 import public_url, upload_public_photo
from app.utils.text import slugify


class VenueService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    async def _generate_unique_slug(self, name: str) -> str:
        base = slugify(name)
        candidate = base
        suffix = 1
        while await self.db.scalar(select(Venue.id).where(Venue.slug == candidate)) is not None:
            suffix += 1
            candidate = f"{base}-{suffix}"
        return candidate

    async def create_venue(self, owner: User, payload: VenueCreateIn) -> Venue:
        venue = Venue(
            owner_id=owner.id,
            name=payload.name,
            slug=await self._generate_unique_slug(payload.name),
            description=payload.description,
            address=payload.address,
            city=payload.city,
            area=payload.area,
            location=f"SRID=4326;POINT({payload.longitude} {payload.latitude})",
            phone=payload.phone,
            whatsapp=payload.whatsapp,
            sports=payload.sports,
            amenities=payload.amenities,
            bank_details=encrypt_json(payload.bank_details.model_dump(), self.settings)
            if payload.bank_details
            else None,
            # one policy per venue (Section 32 Part 4); a cutoff means nothing when cancelling is not allowed
            cancellation_allowed=payload.cancellation_allowed,
            cancellation_cutoff_hours=payload.cancellation_cutoff_hours if payload.cancellation_allowed else None,
        )
        self.db.add(venue)
        await self.db.commit()
        venue = await self.get_venue(venue.id)

        await self._notify_admins_new_venue(venue)
        return venue

    async def _notify_admins_new_venue(self, venue: Venue) -> None:
        notifications = NotificationService(self.db, self.settings)
        admins_result = await self.db.execute(select(User).where(User.role == UserRole.ADMIN))
        for admin in admins_result.scalars().all():
            await notifications.notify_venue_pending_review(user=admin, venue_name=venue.name)

    async def get_venue(self, venue_id: uuid.UUID) -> Venue:
        result = await self.db.execute(
            select(Venue)
            .where(Venue.id == venue_id)
            .options(
                selectinload(Venue.courts).selectinload(
                    Court.schedule_templates.and_(ScheduleTemplate.is_active.is_(True))
                ),
                selectinload(Venue.courts).selectinload(Court.pricing_rules),
            )
        )
        venue = result.scalar_one_or_none()
        if venue is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
        return venue

    async def get_venue_by_slug(self, slug: str) -> Venue:
        result = await self.db.execute(
            select(Venue)
            .where(Venue.slug == slug)
            .options(
                selectinload(Venue.courts).selectinload(
                    Court.schedule_templates.and_(ScheduleTemplate.is_active.is_(True))
                ),
                selectinload(Venue.courts).selectinload(Court.pricing_rules),
            )
        )
        venue = result.scalar_one_or_none()
        if venue is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
        return venue

    async def require_owned_venue(self, venue_id: uuid.UUID, user: User) -> Venue:
        venue = await self.get_venue(venue_id)
        if user.role != UserRole.ADMIN and venue.owner_id != user.id:
            raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
        return venue

    async def update_venue(self, venue: Venue, payload: VenueUpdateIn) -> Venue:
        data = payload.model_dump(exclude_unset=True)
        lat = data.pop("latitude", None)
        lon = data.pop("longitude", None)
        bank_details = data.pop("bank_details", "unset")
        for field, value in data.items():
            setattr(venue, field, value)
        if data.get("cancellation_allowed") is False:
            venue.cancellation_cutoff_hours = None  # a cutoff means nothing when cancelling is not allowed
        if bank_details != "unset":
            venue.bank_details = encrypt_json(bank_details, self.settings) if bank_details else None
        if lat is not None and lon is not None:
            venue.location = f"SRID=4326;POINT({lon} {lat})"
        await self.db.commit()
        return await self.get_venue(venue.id)

    async def add_photo(self, venue: Venue, data: bytes, filename: str, content_type: str) -> Venue:
        key = await upload_public_photo(data, filename, content_type)
        venue.photos = [*(venue.photos or []), key]
        await self.db.commit()
        return await self.get_venue(venue.id)

    async def set_status(
        self, venue: Venue, status_value: VenueStatus, rejection_reason: str | None = None
    ) -> Venue:
        venue.status = status_value
        venue.rejection_reason = rejection_reason if status_value != VenueStatus.APPROVED else None
        await self.db.commit()
        return await self.get_venue(venue.id)

    async def list_venues(
        self,
        *,
        city: str | None = None,
        sport: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        radius_meters: float = 15000,
        only_approved: bool = True,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[tuple[Venue, float | None]], int]:
        base_query = select(Venue)
        if only_approved:
            base_query = base_query.where(Venue.status == VenueStatus.APPROVED, Venue.is_active.is_(True))
        if city:
            base_query = base_query.where(func.lower(Venue.city) == city.lower())
        if sport:
            base_query = base_query.where(Venue.sports.any(sport))
        if latitude is not None and longitude is not None:
            base_query = base_query.where(within_radius(Venue.location, latitude, longitude, radius_meters))

        total = await self.db.scalar(select(func.count()).select_from(base_query.subquery()))

        query = base_query.options(selectinload(Venue.courts))
        distance_col = None
        if latitude is not None and longitude is not None:
            distance_col = distance_meters(Venue.location, latitude, longitude)
            query = query.add_columns(distance_col.label("distance_meters")).order_by(distance_col)
        else:
            query = query.order_by(Venue.created_at.desc())

        query = query.offset(offset).limit(limit)
        result = await self.db.execute(query)

        if distance_col is not None:
            rows = [(row[0], row[1]) for row in result.all()]
        else:
            rows = [(row[0], None) for row in result.all()]
        return rows, total or 0

    async def average_rating(self, venue_id: uuid.UUID) -> float | None:
        result = await self.db.execute(
            select(func.avg(Review.rating)).where(Review.venue_id == venue_id)
        )
        avg = result.scalar_one_or_none()
        return round(float(avg), 2) if avg is not None else None

    def decrypted_bank_details(self, venue: Venue) -> dict | None:
        return decrypt_json(venue.bank_details, self.settings)

    @staticmethod
    def photo_urls(venue: Venue) -> list[str]:
        return [public_url(key) for key in (venue.photos or [])]

    async def to_out(self, venue: Venue, *, requesting_user: User | None = None, distance: float | None = None):
        from app.schemas.venue import VenueOut

        out = VenueOut.model_validate(venue)
        out.photo_urls = self.photo_urls(venue)
        out.average_rating = await self.average_rating(venue.id)
        out.distance_meters = distance
        can_see_bank_details = requesting_user is not None and (
            requesting_user.role == UserRole.ADMIN or requesting_user.id == venue.owner_id
        )
        out.bank_details = self.decrypted_bank_details(venue) if can_see_bank_details else None
        # checkin_qr_token isn't encrypted like bank_details, so model_validate
        # above already populated it from the ORM object -- explicitly clear
        # it for anyone who isn't the owner/admin rather than relying on a
        # field that defaults to populated.
        if not can_see_bank_details:
            out.checkin_qr_token = None
        return out
