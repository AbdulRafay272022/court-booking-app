import uuid

from fastapi import APIRouter, status

from app.dependencies import AppSettings, CurrentUser, DbSession, OptionalCurrentUser, RequireOwner
from app.models.user import UserRole
from app.schemas.review import ReviewCreateIn, ReviewOut, ReviewReplyIn, ReviewUpdateIn
from app.services.review_service import ReviewService
from app.services.venue_service import VenueService

router = APIRouter(tags=["reviews"])


@router.post("/reviews", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
async def create_review(
    payload: ReviewCreateIn, db: DbSession, settings: AppSettings, user: CurrentUser
) -> ReviewOut:
    return await ReviewService(db, settings).create(user, payload)


@router.get("/reviews/mine", response_model=list[ReviewOut])
async def list_my_reviews(db: DbSession, settings: AppSettings, user: CurrentUser) -> list[ReviewOut]:
    """The player's own reviews, so My Bookings knows which completed bookings are already reviewed."""
    return await ReviewService(db, settings).list_for_player(user.id)


@router.patch("/reviews/{review_id}", response_model=ReviewOut)
async def edit_review(
    review_id: uuid.UUID, payload: ReviewUpdateIn, db: DbSession, settings: AppSettings, user: CurrentUser
) -> ReviewOut:
    """A player edits their own review within 7 days of posting (Section 32 Part 6)."""
    return await ReviewService(db, settings).edit(user, review_id, payload)


@router.get("/venues/{venue_id}/reviews", response_model=list[ReviewOut])
async def list_venue_reviews(
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, user: OptionalCurrentUser
) -> list[ReviewOut]:
    # Hidden (admin-moderated) reviews are excluded for everyone except an admin,
    # who needs to see them to unhide -- players/owners only ever see visible ones.
    include_hidden = user is not None and user.role == UserRole.ADMIN
    return await ReviewService(db, settings).list_for_venue(venue_id, include_hidden=include_hidden)


@router.post("/reviews/{review_id}/reply", response_model=ReviewOut)
async def reply_to_review(
    review_id: uuid.UUID, payload: ReviewReplyIn, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> ReviewOut:
    service = ReviewService(db, settings)
    review = await service.get(review_id)
    await VenueService(db, settings).require_owned_venue(review.venue_id, owner)
    return await service.reply(review, payload.owner_reply)
