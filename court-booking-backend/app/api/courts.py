import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import selectinload

from app.dependencies import AppSettings, DbSession, RequireStaffCapable, require_feature
from app.errors import AppError, ErrorCode
from app.utils.s3 import upload_public_photo
from app.utils.schedule import overlap_error
from app.models.blackout import Blackout
from app.models.court import Court
from app.models.pricing import PricingRule
from app.models.schedule import ScheduleTemplate
from app.schemas.court import (
    BlackoutIn,
    BlackoutOut,
    CourtCreateIn,
    CourtDetailResponse,
    CourtOut,
    CourtUpdateIn,
    PricingRuleOut,
    PricingRulesIn,
    ScheduleTemplateOut,
    SchedulesIn,
)
from app.schemas.venue import PhotoOrderIn
from app.models.user import User
from app.services.audit_service import AuditService
from app.services.booking_service import BookingService
from app.services.notification_service import NotificationService
from app.services.venue_service import MAX_COURT_PHOTOS, VenueService

router = APIRouter(tags=["courts"])

# Weekday names for messages, in the backend's numbering (Monday = 0).
_DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

# Section 32 Part 6 -- same limits/validation as venue photos.
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PHOTO_BYTES = 5 * 1024 * 1024


async def _get_court(db: DbSession, court_id: uuid.UUID) -> Court:
    result = await db.execute(
        select(Court)
        .where(Court.id == court_id)
        .options(
            selectinload(Court.schedule_templates.and_(ScheduleTemplate.is_active.is_(True))),
            selectinload(Court.pricing_rules),
        )
    )
    court = result.scalar_one_or_none()
    if court is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Court not found")
    return court


@router.post("/venues/{venue_id}/courts", response_model=CourtDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_court(
    venue_id: uuid.UUID, payload: CourtCreateIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> CourtDetailResponse:
    venue_service = VenueService(db, settings)
    venue = await venue_service.require_owned_venue(venue_id, owner, permission="edit_court_settings")

    court = Court(
        venue_id=venue_id,
        name=payload.name,
        sport=payload.sport,
        slot_minutes=payload.slot_minutes,
        surface_type=payload.surface_type,
        is_indoor=payload.is_indoor,
        has_floodlights=payload.has_floodlights,
        capacity=payload.capacity,
    )
    db.add(court)

    if payload.sport not in venue.sports:
        venue.sports = [*venue.sports, payload.sport]

    await db.commit()
    return CourtDetailResponse(court=CourtOut.model_validate(await _get_court(db, court.id)))


@router.get("/venues/{venue_id}/courts", response_model=list[CourtOut])
async def list_courts(venue_id: uuid.UUID, db: DbSession) -> list[CourtOut]:
    result = await db.execute(
        select(Court)
        .where(Court.venue_id == venue_id)
        .options(
            selectinload(Court.schedule_templates.and_(ScheduleTemplate.is_active.is_(True))),
            selectinload(Court.pricing_rules),
        )
    )
    return [CourtOut.model_validate(c) for c in result.scalars().all()]


@router.get("/courts/{court_id}", response_model=CourtOut)
async def get_court(court_id: uuid.UUID, db: DbSession) -> CourtOut:
    return CourtOut.model_validate(await _get_court(db, court_id))


@router.patch("/courts/{court_id}", response_model=CourtOut)
async def update_court(
    court_id: uuid.UUID, payload: CourtUpdateIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> CourtOut:
    court = await _get_court(db, court_id)
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(court.venue_id, owner, permission="edit_court_settings")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(court, field, value)
    await db.commit()
    return CourtOut.model_validate(await _get_court(db, court_id))


@router.delete("/courts/{court_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_court(court_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable) -> None:
    court = await _get_court(db, court_id)
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(court.venue_id, owner, permission="edit_court_settings")

    # Deactivating a court doesn't touch any of its existing live bookings
    # or waitlist entries on its own -- deliberately NOT auto-cancelling
    # them (a deactivation might be temporary, and auto-cancelling a paid
    # booking has the same refund-tracking gap as finding #5/#13); instead,
    # affected players are notified and the venue is expected to follow up
    # directly (they can still see these via the existing owner-bookings
    # listing, court_id intact). See AUDIT_FINDINGS.md finding #27.
    booking_service = BookingService(db, settings)
    affected = await booking_service.list_live_future_bookings_for_court(court_id)

    court.is_active = False
    await db.commit()

    if affected:
        notifications = NotificationService(db, settings)
        audit = AuditService(db)
        for booking in affected:
            if booking.player_id is not None:
                player = await db.get(User, booking.player_id)
                if player is not None:
                    await notifications.notify_court_deactivated(
                        user=player, court_name=court.name, starts_at=booking.starts_at, ends_at=booking.ends_at
                    )
            await audit.log(
                actor_user_id=owner.id,
                actor_type="owner",
                action="court.deactivated_with_live_booking",
                entity_type="booking",
                entity_id=booking.id,
                new_value={"court_id": str(court_id), "booking_status": booking.status.value},
            )
        await db.commit()


@router.post(
    "/courts/{court_id}/photos",
    response_model=CourtOut,
    dependencies=[Depends(require_feature("photos"))],
)
async def upload_court_photo(
    court_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable, file: UploadFile = File(...)
) -> CourtOut:
    """Add one photo to a court's gallery (Section 32 Part 6), max MAX_COURT_PHOTOS."""
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise AppError(400, ErrorCode.INVALID_PHOTO, "Unsupported image type.")
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise AppError(400, ErrorCode.INVALID_PHOTO, "Image too large.")
    court = await _get_court(db, court_id)
    await VenueService(db, settings).require_owned_venue(court.venue_id, owner, permission="manage_photos")
    if len(court.photos or []) >= MAX_COURT_PHOTOS:
        raise AppError(400, ErrorCode.PHOTO_LIMIT_REACHED, f"A court can have at most {MAX_COURT_PHOTOS} photos.")
    key = await upload_public_photo(data, file.filename or "photo.jpg", file.content_type, prefix="courts")
    court.photos = [*(court.photos or []), key]
    await db.commit()
    return CourtOut.model_validate(await _get_court(db, court_id))


@router.put(
    "/courts/{court_id}/photos",
    response_model=CourtOut,
    dependencies=[Depends(require_feature("photos"))],
)
async def reorder_court_photos(
    court_id: uuid.UUID, payload: PhotoOrderIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> CourtOut:
    """Reorder / delete / set-cover: send the desired ordered list of this court's own
    photo keys (index 0 is the cover; an omitted key is deleted) -- Section 32 Part 6."""
    court = await _get_court(db, court_id)
    await VenueService(db, settings).require_owned_venue(court.venue_id, owner, permission="manage_photos")
    current = set(court.photos or [])
    keys = payload.photos
    if len(keys) != len(set(keys)) or not set(keys).issubset(current):
        raise AppError(400, ErrorCode.INVALID_PHOTO, "Photo list must be a reordering of this court's own photos.")
    court.photos = list(keys)
    await db.commit()
    return CourtOut.model_validate(await _get_court(db, court_id))


@router.post("/courts/{court_id}/schedule", response_model=list[ScheduleTemplateOut])
async def set_schedule(
    court_id: uuid.UUID, payload: SchedulesIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> list[ScheduleTemplateOut]:
    """Upserts schedule_templates: only the days included in the request are
    touched -- any existing active template for those days is deactivated
    before the replacement is inserted (the partial unique index allows only
    one active template per court+day), and every other day is left alone."""
    court = await _get_court(db, court_id)
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(court.venue_id, owner, permission="edit_court_settings")

    days = {s.day_of_week for s in payload.schedules}

    # An overnight day must not run into the next day's opening (Thursday until 3 AM, Friday opens 2 AM). Check the
    # WHOLE resulting week: the days in this request plus the days already stored that the request does not touch.
    existing = await db.execute(
        select(ScheduleTemplate).where(ScheduleTemplate.court_id == court_id, ScheduleTemplate.is_active.is_(True))
    )
    week = {t.day_of_week: t for t in existing.scalars().all() if t.day_of_week not in days}
    week.update({s.day_of_week: s for s in payload.schedules})
    problem = overlap_error(week, _DAY_NAMES)
    if problem:
        raise AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, problem)

    if days:
        await db.execute(
            update(ScheduleTemplate)
            .where(
                ScheduleTemplate.court_id == court_id,
                ScheduleTemplate.day_of_week.in_(days),
                ScheduleTemplate.is_active.is_(True),
            )
            .values(is_active=False)
        )
    for schedule in payload.schedules:
        db.add(ScheduleTemplate(court_id=court_id, **schedule.model_dump()))
    await db.commit()

    result = await db.execute(
        select(ScheduleTemplate).where(
            ScheduleTemplate.court_id == court_id, ScheduleTemplate.is_active.is_(True)
        )
    )
    return [ScheduleTemplateOut.model_validate(t) for t in result.scalars().all()]


@router.post("/courts/{court_id}/pricing", response_model=list[PricingRuleOut])
async def set_pricing_rules(
    court_id: uuid.UUID, payload: PricingRulesIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> list[PricingRuleOut]:
    court = await _get_court(db, court_id)
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(court.venue_id, owner, permission="edit_court_settings")

    await db.execute(delete(PricingRule).where(PricingRule.court_id == court_id))
    for rule in payload.rules:
        db.add(PricingRule(court_id=court_id, **rule.model_dump()))
    await db.commit()

    result = await db.execute(select(PricingRule).where(PricingRule.court_id == court_id))
    return [PricingRuleOut.model_validate(r) for r in result.scalars().all()]


@router.post("/courts/{court_id}/blackouts", response_model=BlackoutOut, status_code=status.HTTP_201_CREATED)
async def add_blackout(
    court_id: uuid.UUID, payload: BlackoutIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> BlackoutOut:
    court = await _get_court(db, court_id)
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(court.venue_id, owner, permission="edit_court_settings")

    blackout = Blackout(court_id=court_id, created_by=owner.id, **payload.model_dump())
    db.add(blackout)
    await db.commit()
    await db.refresh(blackout)
    return BlackoutOut.model_validate(blackout)


@router.get("/courts/{court_id}/blackouts", response_model=list[BlackoutOut])
async def list_blackouts(court_id: uuid.UUID, db: DbSession) -> list[BlackoutOut]:
    result = await db.execute(select(Blackout).where(Blackout.court_id == court_id))
    return [BlackoutOut.model_validate(b) for b in result.scalars().all()]
