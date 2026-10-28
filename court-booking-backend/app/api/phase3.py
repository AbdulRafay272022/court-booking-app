"""audit 2026-10-28 Phase 3 items 3-6 endpoints (app/services/phase3_service.py; every one is behind a default-OFF flag).

Player:  GET  /users/me/points                       points balance, history, rule text
         GET  /bookings/{id}/extras                  points offer, short-payment question, arrival / no-show state
         POST /bookings/{id}/use-points              500 points -> the venue's discount on this booking
         POST /short-payments/{claim_id}/reply       "Sahi hai" / "Ghalat hai" (+ reason)
         POST /bookings/{id}/arrived                 "Pohanch gaya": ONE GPS reading
         POST /bookings/{id}/noshow-reply            "Main aaya tha"
Owner:   GET  /owners/dues?venue_id=                 open dues at a venue (short payments not settled)
         POST /owners/dues/{claim_id}/done           the rest was received (cash) -> settled
         POST /owners/short-payments/{id}/decide     collect | waive a "Ghalat hai"
         POST /owners/noshow-replies/{id}/decide     keep | reverse
"""

import uuid

from fastapi import APIRouter

from app.dependencies import AppSettings, CurrentUser, DbSession, RequireStaffCapable
from app.errors import AppError, ErrorCode
from app.schemas.phase3 import (
    ArrivalIn,
    ArrivalOut,
    BookingExtrasOut,
    DecideIn,
    DueOut,
    NoShowDecideIn,
    NoShowReplyIn,
    NoShowReplyOut,
    PointsOut,
    ShortReplyIn,
)
from app.services import phase3_service as p3
from app.services.booking_service import BookingService

router = APIRouter(tags=["audit-phase3"])


@router.get("/users/me/points", response_model=PointsOut)
async def my_points(db: DbSession, user: CurrentUser) -> PointsOut:
    return PointsOut(**await p3.points_summary(db, user))


@router.get("/bookings/{booking_id}/extras", response_model=BookingExtrasOut)
async def booking_extras(booking_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser) -> BookingExtrasOut:
    booking = await BookingService(db, settings).require_accessible_booking(booking_id, user)
    return BookingExtrasOut(
        points=await p3.points_offer(db, user, booking),
        short_payment=await p3.player_short_state(db, user, booking),
        arrival=await p3.arrival_state(db, user, booking),
    )


@router.post("/bookings/{booking_id}/use-points", response_model=BookingExtrasOut)
async def use_points(booking_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser) -> BookingExtrasOut:
    booking = await p3.redeem_points(db, settings, user, booking_id)
    return BookingExtrasOut(
        points=await p3.points_offer(db, user, booking),
        short_payment=await p3.player_short_state(db, user, booking),
        arrival=await p3.arrival_state(db, user, booking),
    )


@router.post("/short-payments/{claim_id}/reply", response_model=DueOut)
async def short_reply(claim_id: uuid.UUID, payload: ShortReplyIn, db: DbSession, settings: AppSettings, user: CurrentUser) -> DueOut:
    claim = await p3.reply_short(db, settings, user, claim_id, payload.answer, payload.reason)
    from app.models.booking import Booking

    return DueOut(**p3.claim_out(claim, await db.get(Booking, claim.booking_id)))


@router.post("/bookings/{booking_id}/arrived", response_model=ArrivalOut, status_code=201)
async def arrived(booking_id: uuid.UUID, payload: ArrivalIn, db: DbSession, user: CurrentUser) -> ArrivalOut:
    check = await p3.record_arrival(db, user, booking_id, payload.latitude, payload.longitude, payload.accuracy_m)
    return ArrivalOut(verdict=check.verdict, distance_m=check.distance_m, at=check.created_at)


@router.post("/bookings/{booking_id}/noshow-reply", response_model=NoShowReplyOut, status_code=201)
async def noshow_reply(booking_id: uuid.UUID, payload: NoShowReplyIn, db: DbSession, settings: AppSettings, user: CurrentUser) -> NoShowReplyOut:
    reply = await p3.reply_noshow(db, settings, user, booking_id, payload.note)
    return NoShowReplyOut(id=reply.id, booking_id=reply.booking_id, note=reply.note, owner_decision=reply.owner_decision, at=reply.created_at)


@router.get("/owners/dues", response_model=list[DueOut])
async def owner_dues(venue_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable) -> list[DueOut]:
    return [DueOut(**d) for d in await p3.list_dues(db, settings, owner, venue_id)]


@router.post("/owners/dues/{claim_id}/done", response_model=DueOut)
async def owner_due_done(claim_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable) -> DueOut:
    claim = await p3.mark_due_done(db, settings, owner, claim_id)
    from app.models.booking import Booking

    return DueOut(**p3.claim_out(claim, await db.get(Booking, claim.booking_id)))


@router.post("/owners/short-payments/{claim_id}/decide", response_model=DueOut)
async def owner_short_decide(claim_id: uuid.UUID, payload: DecideIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable) -> DueOut:
    claim = await p3.decide_short(db, settings, owner, claim_id, payload.decision)
    from app.models.booking import Booking

    return DueOut(**p3.claim_out(claim, await db.get(Booking, claim.booking_id)))


@router.post("/owners/noshow-replies/{reply_id}/decide", response_model=NoShowReplyOut)
async def owner_noshow_decide(reply_id: uuid.UUID, payload: NoShowDecideIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable) -> NoShowReplyOut:
    if owner.role.value == "admin":
        raise AppError(403, ErrorCode.FORBIDDEN, "Only the venue decides this.")
    reply = await p3.decide_noshow(db, settings, owner, reply_id, payload.decision)
    return NoShowReplyOut(id=reply.id, booking_id=reply.booking_id, note=reply.note, owner_decision=reply.owner_decision, at=reply.created_at)
