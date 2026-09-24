"""Reviews (Section 32 Part 6). Extracted from the inline router logic so the flow
matches the rest of the codebase (service + router + schema + tests), and to add the
missing pieces: player edit within a 7-day window, admin hide/unhide, hidden reviews
excluded from the public list, and the average+count aggregate."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.booking import BookingStatus
from app.models.court import Court
from app.models.review import Review
from app.models.user import User
from app.schemas.review import ReviewCreateIn, ReviewOut, ReviewSummaryOut, ReviewUpdateIn
from app.services.booking_service import BookingService

# A player may fix a rating/comment for a week after posting; after that it's locked
# so an owner's reply can't be silently invalidated by a later edit.
REVIEW_EDIT_WINDOW = timedelta(days=7)


def _first_name(name: str | None) -> str | None:
    if not name:
        return None
    return name.strip().split(" ", 1)[0] or None


class ReviewService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    def to_out(self, review: Review) -> ReviewOut:
        out = ReviewOut.model_validate(review)
        # `review.player` is eager-loaded by the queries below; guard anyway.
        player = review.__dict__.get("player")
        out.player_first_name = _first_name(player.name) if player is not None else None
        return out

    async def create(self, user: User, payload: ReviewCreateIn) -> ReviewOut:
        booking = await BookingService(self.db, self.settings).require_accessible_booking(
            payload.booking_id, user
        )
        if booking.player_id != user.id:
            raise AppError(403, ErrorCode.REVIEW_NOT_ALLOWED, "You can only review your own bookings.")
        if booking.status != BookingStatus.COMPLETED:
            raise AppError(
                400, ErrorCode.REVIEW_NOT_ALLOWED, "You can review a game only after it's completed."
            )
        existing = await self.db.scalar(select(Review).where(Review.booking_id == booking.id))
        if existing is not None:
            raise AppError(409, ErrorCode.ALREADY_REVIEWED, "You've already reviewed this booking.")

        court = await self.db.get(Court, booking.court_id)
        review = Review(
            booking_id=booking.id,
            venue_id=court.venue_id,
            player_id=user.id,
            rating=payload.rating,
            comment=payload.comment,
        )
        self.db.add(review)
        await self.db.commit()
        return await self._reload_out(review.id)

    async def edit(self, user: User, review_id: uuid.UUID, payload: ReviewUpdateIn) -> ReviewOut:
        review = await self.db.get(Review, review_id)
        if review is None:
            raise AppError(404, ErrorCode.REVIEW_NOT_FOUND, "Review not found.")
        if review.player_id != user.id:
            raise AppError(403, ErrorCode.NOT_YOUR_REVIEW, "You can only edit your own review.")
        if datetime.now(timezone.utc) - review.created_at > REVIEW_EDIT_WINDOW:
            raise AppError(
                403, ErrorCode.REVIEW_EDIT_WINDOW_CLOSED, "Reviews can only be edited within 7 days of posting."
            )
        review.rating = payload.rating
        review.comment = payload.comment
        review.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        return await self._reload_out(review.id)

    async def reply(self, review: Review, owner_reply: str) -> ReviewOut:
        review.owner_reply = owner_reply
        review.owner_replied_at = datetime.now(timezone.utc)
        await self.db.commit()
        return await self._reload_out(review.id)

    async def set_hidden(self, review: Review, hidden: bool) -> ReviewOut:
        review.is_hidden = hidden
        await self.db.commit()
        return await self._reload_out(review.id)

    async def get(self, review_id: uuid.UUID) -> Review:
        review = await self.db.get(Review, review_id)
        if review is None:
            raise AppError(404, ErrorCode.REVIEW_NOT_FOUND, "Review not found.")
        return review

    async def list_for_venue(self, venue_id: uuid.UUID, *, include_hidden: bool = False) -> list[ReviewOut]:
        query = (
            select(Review)
            .where(Review.venue_id == venue_id)
            .options(selectinload(Review.player))
            .order_by(Review.created_at.desc())
        )
        if not include_hidden:
            query = query.where(Review.is_hidden.is_(False))
        rows = (await self.db.execute(query)).scalars().all()
        return [self.to_out(r) for r in rows]

    async def list_for_player(self, player_id: uuid.UUID) -> list[ReviewOut]:
        """The player's own reviews (Section 32 Part 6) -- lets My Bookings show
        'Rate your game' vs 'Edit your review' per completed booking after a reload."""
        rows = (
            await self.db.execute(
                select(Review)
                .where(Review.player_id == player_id)
                .options(selectinload(Review.player))
                .order_by(Review.created_at.desc())
            )
        ).scalars().all()
        return [self.to_out(r) for r in rows]

    async def summary(self, venue_id: uuid.UUID) -> ReviewSummaryOut:
        """Average rating + count over VISIBLE reviews (hidden ones don't count)."""
        row = (
            await self.db.execute(
                select(func.avg(Review.rating), func.count(Review.id)).where(
                    Review.venue_id == venue_id, Review.is_hidden.is_(False)
                )
            )
        ).one()
        avg, count = row
        return ReviewSummaryOut(
            average_rating=round(float(avg), 2) if avg is not None else None, review_count=int(count or 0)
        )

    async def _reload_out(self, review_id: uuid.UUID) -> ReviewOut:
        review = (
            await self.db.execute(
                select(Review).where(Review.id == review_id).options(selectinload(Review.player))
            )
        ).scalar_one()
        return self.to_out(review)
