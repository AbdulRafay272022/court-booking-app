import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from sqlalchemy import select

from app.dependencies import AppSettings, DbSession, OptionalCurrentUser, RequireOwner
from app.models.booking import Booking
from app.models.court import Court
from app.models.user import User
from app.schemas.marketing import AnnouncementIn, AnnouncementResultOut
from app.schemas.venue import (
    VenueCreateIn,
    VenueDetailResponse,
    VenueListItemOut,
    VenueListResponse,
    VenueOut,
    VenueUpdateIn,
)
from app.services.availability_service import AvailabilityService
from app.services.notification_service import MarketingSendLimitExceeded, NotificationService
from app.services.venue_service import VenueService
from app.utils.timezone import pkt_today

router = APIRouter(prefix="/venues", tags=["venues"])

MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("", response_model=VenueListResponse)
async def list_venues(
    db: DbSession,
    settings: AppSettings,
    city: str | None = None,
    sport: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float = 15,
    page: int = 1,
    per_page: int = 20,
) -> VenueListResponse:
    page = max(page, 1)
    per_page = min(max(per_page, 1), 100)
    service = VenueService(db, settings)
    rows, total = await service.list_venues(
        city=city,
        sport=sport,
        latitude=lat,
        longitude=lng,
        radius_meters=radius_km * 1000,
        offset=(page - 1) * per_page,
        limit=per_page,
    )
    venues = []
    for venue, distance in rows:
        venues.append(
            VenueListItemOut(
                id=venue.id,
                name=venue.name,
                slug=venue.slug,
                city=venue.city,
                area=venue.area,
                sports=venue.sports,
                photo_urls=VenueService.photo_urls(venue),
                status=venue.status,
                average_rating=await service.average_rating(venue.id),
                distance_meters=distance,
            )
        )
    return VenueListResponse(venues=venues, total=total, page=page)


@router.post("", response_model=VenueDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_venue(payload: VenueCreateIn, db: DbSession, settings: AppSettings, owner: RequireOwner) -> VenueDetailResponse:
    service = VenueService(db, settings)
    venue = await service.create_venue(owner, payload)
    return VenueDetailResponse(venue=await service.to_out(venue, requesting_user=owner))


@router.get("/{venue_id}", response_model=VenueOut)
async def get_venue(
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, user: OptionalCurrentUser
) -> VenueOut:
    service = VenueService(db, settings)
    venue = await service.get_venue(venue_id)
    return await service.to_out(venue, requesting_user=user)


@router.get("/by-slug/{slug}", response_model=VenueOut)
async def get_venue_by_slug(
    slug: str, db: DbSession, settings: AppSettings, user: OptionalCurrentUser
) -> VenueOut:
    service = VenueService(db, settings)
    venue = await service.get_venue_by_slug(slug)
    out = await service.to_out(venue, requesting_user=user)

    availability = AvailabilityService(db)
    today = pkt_today()
    available = 0
    for court in venue.courts:
        if not court.is_active:
            continue
        slots = await availability.get_slots_starting_on(court, today)
        available += sum(1 for s in slots if s.status == "available")
    out.available_slots_today = available
    return out


@router.patch("/{venue_id}", response_model=VenueOut)
async def update_venue(
    venue_id: uuid.UUID, payload: VenueUpdateIn, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> VenueOut:
    service = VenueService(db, settings)
    venue = await service.require_owned_venue(venue_id, owner)
    venue = await service.update_venue(venue, payload)
    return await service.to_out(venue, requesting_user=owner)


@router.post("/{venue_id}/photos", response_model=VenueOut)
async def upload_venue_photo(
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner, file: UploadFile = File(...)
) -> VenueOut:
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported image type")
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image too large")

    service = VenueService(db, settings)
    venue = await service.require_owned_venue(venue_id, owner)
    venue = await service.add_photo(venue, data, file.filename or "photo.jpg", file.content_type)
    return await service.to_out(venue, requesting_user=owner)


@router.delete("/{venue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_venue(venue_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner) -> None:
    service = VenueService(db, settings)
    venue = await service.require_owned_venue(venue_id, owner)
    venue.is_active = False
    await db.commit()


@router.post("/{venue_id}/announcements", response_model=AnnouncementResultOut)
async def send_announcement(
    venue_id: uuid.UUID, payload: AnnouncementIn, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> AnnouncementResultOut:
    """Tier 3 (paid marketing) broadcast to every player who has ever booked
    at this venue, gated by the venue's plan_tier monthly send cap."""
    service = VenueService(db, settings)
    venue = await service.require_owned_venue(venue_id, owner)

    court_ids_result = await db.execute(select(Court.id).where(Court.venue_id == venue_id))
    court_ids = [row[0] for row in court_ids_result.all()]
    recipients: list[User] = []
    if court_ids:
        players_result = await db.execute(
            select(User)
            .join(Booking, Booking.player_id == User.id)
            .where(Booking.court_id.in_(court_ids))
            .distinct()
        )
        recipients = list(players_result.scalars().all())

    notifications = NotificationService(db, settings)
    sent = 0
    skipped = 0
    for player in recipients:
        try:
            await notifications.send_marketing_announcement(
                venue=venue, user=player, title=payload.title, body=payload.body
            )
            sent += 1
        except MarketingSendLimitExceeded:
            skipped += 1
            break  # every further send would hit the same cap

    return AnnouncementResultOut(sent=sent, skipped_cap_reached=skipped)
