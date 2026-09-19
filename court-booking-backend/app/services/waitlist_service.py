import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.court import Court
from app.models.user import User
from app.models.venue import Venue
from app.models.waitlist import WaitlistEntry
from app.services.notification_service import NotificationService


class WaitlistService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.notifications = NotificationService(db, settings)

    async def _position(self, court_id: uuid.UUID, slot_starts_at: datetime, created_at: datetime) -> int:
        """1-indexed FIFO position among active entries for this court+slot,
        as of `created_at` (entries that joined earlier are ahead)."""
        ahead = await self.db.scalar(
            select(func.count(WaitlistEntry.id)).where(
                WaitlistEntry.court_id == court_id,
                WaitlistEntry.slot_starts_at == slot_starts_at,
                WaitlistEntry.is_active.is_(True),
                WaitlistEntry.created_at < created_at,
            )
        )
        return (ahead or 0) + 1

    async def join(self, user: User, court_id: uuid.UUID, slot_starts_at: datetime) -> tuple[WaitlistEntry, int]:
        court = await self.db.get(Court, court_id)
        if court is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Court not found")

        entry = WaitlistEntry(court_id=court_id, player_id=user.id, slot_starts_at=slot_starts_at)
        self.db.add(entry)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            if "unique_active_waitlist" in str(exc.orig):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Already on the waitlist for this slot",
                ) from exc
            raise
        await self.db.refresh(entry)
        position = await self._position(court_id, slot_starts_at, entry.created_at)
        return entry, position

    async def list_for_player(self, player_id: uuid.UUID) -> list[dict]:
        """Active entries with slot details (Section 11.2), FIFO order."""
        result = await self.db.execute(
            select(WaitlistEntry, Court, Venue)
            .join(Court, Court.id == WaitlistEntry.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .where(WaitlistEntry.player_id == player_id, WaitlistEntry.is_active.is_(True))
            .order_by(WaitlistEntry.created_at.asc())
        )
        rows = result.all()
        enriched = []
        for entry, court, venue in rows:
            position = await self._position(entry.court_id, entry.slot_starts_at, entry.created_at)
            enriched.append(
                {
                    "id": entry.id,
                    "court_id": entry.court_id,
                    "court_name": court.name,
                    "venue_id": venue.id,
                    "venue_name": venue.name,
                    "player_id": entry.player_id,
                    "slot_starts_at": entry.slot_starts_at,
                    "position": position,
                    "notified_at": entry.notified_at,
                    "is_active": entry.is_active,
                    "created_at": entry.created_at,
                }
            )
        return enriched

    async def require_owned_entry(self, entry_id: uuid.UUID, player_id: uuid.UUID) -> WaitlistEntry:
        entry = await self.db.get(WaitlistEntry, entry_id)
        if entry is None or entry.player_id != player_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Waitlist entry not found")
        return entry

    async def cancel(self, entry: WaitlistEntry) -> WaitlistEntry:
        entry.is_active = False
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def _matching_entries(self, court_id: uuid.UUID, slot_starts_at: datetime) -> list[WaitlistEntry]:
        result = await self.db.execute(
            select(WaitlistEntry)
            .where(
                WaitlistEntry.court_id == court_id,
                WaitlistEntry.slot_starts_at == slot_starts_at,
                WaitlistEntry.is_active.is_(True),
                WaitlistEntry.notified_at.is_(None),
            )
            .order_by(WaitlistEntry.created_at.asc())  # FIFO join order, not notification order
        )
        return list(result.scalars().all())

    async def notify_matching_entries(self, court: Court, freed_slot_starts_at: datetime) -> int:
        """Called when a booking on `court` is cancelled/expired, freeing a
        slot. Every active, not-yet-notified entry for this court+slot is
        notified at once -- a deliberate departure from strict FIFO
        exclusivity (AUDIT_FINDINGS.md finding #15): "waitlist" means
        "you'll hear about it first," not "your place in line reserves the
        slot." No hold is created for anyone; whoever actually completes a
        POST /bookings/hold first gets the slot via the normal
        one_live_booking_per_slot race, same as any two players racing for
        the same slot -- create_hold is unchanged. Returns the number of
        entries notified."""
        entries = await self._matching_entries(court.id, freed_slot_starts_at)
        if not entries:
            return 0

        now = datetime.now(timezone.utc)
        notified = 0
        for entry in entries:
            entry.notified_at = now
            player = await self.db.get(User, entry.player_id)
            if player is not None:
                await self.notifications.notify_waitlist_slot_available(
                    user=player, court_name=court.name, starts_at=freed_slot_starts_at.isoformat()
                )
                notified += 1
        await self.db.commit()
        return notified

    async def advance_stale_notifications(self) -> int:
        """A notified waitlister gets WAITLIST_RENOTIFY_GRACE_MINUTES to
        actually hold the slot. Once that window passes, their entry is
        deactivated regardless (no reservation to hold open for them
        anyway -- see finding #15). If the slot is still unclaimed at that
        point, this also sweeps up any entry that joined the waitlist
        *after* the initial notify_matching_entries wave (so they weren't
        included in it) and notifies them now."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=self.settings.WAITLIST_RENOTIFY_GRACE_MINUTES)
        result = await self.db.execute(
            select(WaitlistEntry).where(
                WaitlistEntry.is_active.is_(True),
                WaitlistEntry.notified_at.is_not(None),
                WaitlistEntry.notified_at < cutoff,
            )
        )
        stale_entries = list(result.scalars().all())
        advanced = 0
        for stale in stale_entries:
            still_free = await self.db.scalar(
                select(Booking.id).where(
                    Booking.court_id == stale.court_id,
                    Booking.starts_at == stale.slot_starts_at,
                    Booking.status.in_(LIVE_BOOKING_STATUSES),
                )
            )
            stale.is_active = False
            if still_free is None:
                court = await self.db.get(Court, stale.court_id)
                if court is not None:
                    advanced += await self.notify_matching_entries(court, stale.slot_starts_at)
        if stale_entries:
            await self.db.commit()
        return advanced

    async def deactivate_past_entries(self) -> int:
        """Slot time has come and gone -- these entries are no longer useful,
        whether or not anyone ever claimed the slot."""
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            update(WaitlistEntry)
            .where(WaitlistEntry.is_active.is_(True), WaitlistEntry.slot_starts_at < now)
            .values(is_active=False)
            .returning(WaitlistEntry.id)
        )
        ids = result.scalars().all()
        if ids:
            await self.db.commit()
        return len(ids)
