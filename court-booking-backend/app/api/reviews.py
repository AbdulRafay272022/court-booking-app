import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import AppSettings, CurrentUser, DbSession, RequireOwner
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.review import Review
from app.schemas.review import ReviewCreateIn, ReviewOut, ReviewReplyIn
from app.services.booking_service import BookingService
from app.services.venue_service import VenueService

router = APIRouter(tags=["reviews"])


@router.post("/reviews", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
async def create_review(
    payload: ReviewCreateIn, db: DbSession, settings: AppSettings, user: CurrentUser
) -> ReviewOut:
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(payload.booking_id, user)
    if booking.player_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your booking")
    if booking.status != BookingStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Only completed bookings can be reviewed"
        )

    existing = await db.scalar(select(Review).where(Review.booking_id == booking.id))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Booking already reviewed")

    court = await db.get(Court, booking.court_id)
    review = Review(
        booking_id=booking.id,
        venue_id=court.venue_id,
        player_id=user.id,
        rating=payload.rating,
        comment=payload.comment,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return ReviewOut.model_validate(review)


@router.get("/venues/{venue_id}/reviews", response_model=list[ReviewOut])
async def list_venue_reviews(venue_id: uuid.UUID, db: DbSession) -> list[ReviewOut]:
    result = await db.execute(
        select(Review).where(Review.venue_id == venue_id).order_by(Review.created_at.desc())
    )
    return [ReviewOut.model_validate(r) for r in result.scalars().all()]


@router.post("/reviews/{review_id}/reply", response_model=ReviewOut)
async def reply_to_review(
    review_id: uuid.UUID, payload: ReviewReplyIn, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> ReviewOut:
    review = await db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")

    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(review.venue_id, owner)

    review.owner_reply = payload.owner_reply
    review.owner_replied_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(review)
    return ReviewOut.model_validate(review)
