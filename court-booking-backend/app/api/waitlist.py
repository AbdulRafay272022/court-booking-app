import uuid

from fastapi import APIRouter, status

from app.dependencies import AppSettings, CurrentUser, DbSession
from app.models.court import Court
from app.models.venue import Venue
from app.schemas.waitlist import WaitlistCreateIn, WaitlistJoinOut, WaitlistOut
from app.services.waitlist_service import WaitlistService

router = APIRouter(prefix="/waitlist", tags=["waitlist"])


@router.post("", response_model=WaitlistJoinOut, status_code=status.HTTP_201_CREATED)
async def join_waitlist(
    payload: WaitlistCreateIn, db: DbSession, settings: AppSettings, user: CurrentUser
) -> WaitlistJoinOut:
    service = WaitlistService(db, settings)
    _entry, position = await service.join(user, payload.court_id, payload.slot_starts_at)
    return WaitlistJoinOut(position=position)


@router.get("/mine", response_model=list[WaitlistOut])
async def list_my_waitlist(db: DbSession, settings: AppSettings, user: CurrentUser) -> list[WaitlistOut]:
    service = WaitlistService(db, settings)
    entries = await service.list_for_player(user.id)
    return [WaitlistOut.model_validate(e) for e in entries]


@router.delete("/{entry_id}", response_model=WaitlistOut)
async def cancel_waitlist_entry(
    entry_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser
) -> WaitlistOut:
    service = WaitlistService(db, settings)
    entry = await service.require_owned_entry(entry_id, user.id)
    entry = await service.cancel(entry)

    court = await db.get(Court, entry.court_id)
    venue = await db.get(Venue, court.venue_id) if court is not None else None
    return WaitlistOut(
        id=entry.id,
        court_id=entry.court_id,
        court_name=court.name if court else "",
        venue_id=venue.id if venue else entry.court_id,
        venue_name=venue.name if venue else "",
        player_id=entry.player_id,
        slot_starts_at=entry.slot_starts_at,
        position=0,  # no longer queued -- position is meaningless once cancelled
        notified_at=entry.notified_at,
        is_active=entry.is_active,
        created_at=entry.created_at,
    )
