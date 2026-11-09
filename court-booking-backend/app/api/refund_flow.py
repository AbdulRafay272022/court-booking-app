"""fix/nov-9 items 9-12 (app/services/refund_flow_service.py).

Player:  GET  /bookings/{id}/disputes                  the refund (payout, each transfer + check) and "Khelo se shikayat" state
         PUT  /bookings/{id}/refund-payout             "Refund kahan bhejein?" (JazzCash / Easypaisa / bank IBAN + title)
         POST /refund-transfers/{id}/answer            "Mil gaya" / "Nahi mila"
         POST /bookings/{id}/escalate                  "Khelo se shikayat karein" (no_show | short_payment | refund)
Owner:   GET  /owners/refunds/{dispute_id}/payout      the FULL number: only the venue that owes it, only while owed; audited
         POST /owners/refund-transfers/{id}/reply      answer a "Nahi mila"
Admin:   GET  /admin/escalations?status=open|decided
         POST /admin/escalations/{id}/decide           player | venue + a note both sides see
"""

import uuid
from typing import Literal

from fastapi import APIRouter

from app.dependencies import AppSettings, CurrentUser, DbSession, RequireAdmin, RequireStaffCapable
from app.schemas.refund_flow import (
    AdminEscalationOut,
    BookingDisputesOut,
    EscalateIn,
    EscalationDecideIn,
    EscalationOut,
    OwnerTransferReplyIn,
    PayoutIn,
    PayoutOut,
    PlayerRefundStateOut,
    RefundTransferOut,
    TransferAnswerIn,
)
from app.services import refund_flow_service as rf

router = APIRouter(tags=["refund-disputes"])


async def _refund_state(db, player, booking) -> PlayerRefundStateOut | None:
    dispute = await rf.open_dispute_for(db, booking.id)
    if dispute is None:
        return None
    transfers = (await rf.transfers_for(db, [dispute.id])).get(dispute.id, [])
    owed = rf.is_owed(dispute)
    payout = rf.payout_out(dispute)
    return PlayerRefundStateOut(
        dispute_id=dispute.id,
        amount=float(dispute.refund_amount or 0),
        sent=round(float(dispute.refunded_amount or 0), 2),
        remaining=rf.remaining_of(dispute),
        status="owed" if owed else "refunded",
        needs_payout=owed and payout is None,
        payout=payout,
        previous_payout=await rf.previous_payout(db, player) if owed and payout is None else None,
        transfers=[RefundTransferOut(**rf.transfer_out(t)) for t in transfers],
    )


@router.get("/bookings/{booking_id}/disputes", response_model=BookingDisputesOut)
async def booking_disputes(booking_id: uuid.UUID, db: DbSession, player: CurrentUser) -> BookingDisputesOut:
    booking = await rf._player_booking(db, player, booking_id)
    return BookingDisputesOut(refund=await _refund_state(db, player, booking), escalations=await rf.player_escalations(db, player, booking))


@router.put("/bookings/{booking_id}/refund-payout", response_model=PlayerRefundStateOut)
async def set_refund_payout(
    booking_id: uuid.UUID, payload: PayoutIn, db: DbSession, settings: AppSettings, player: CurrentUser
) -> PlayerRefundStateOut:
    await rf.set_payout(
        db, settings, player, booking_id, method=payload.method, account=payload.account, title=payload.title,
        bank=payload.bank, use_previous=payload.use_previous,
    )
    booking = await rf._player_booking(db, player, booking_id)
    state = await _refund_state(db, player, booking)
    assert state is not None
    return state


@router.post("/refund-transfers/{transfer_id}/answer", response_model=RefundTransferOut)
async def answer_refund_transfer(
    transfer_id: uuid.UUID, payload: TransferAnswerIn, db: DbSession, settings: AppSettings, player: CurrentUser
) -> RefundTransferOut:
    t = await rf.answer_transfer(db, settings, player, transfer_id, payload.answer, payload.note)
    return RefundTransferOut(**rf.transfer_out(t))


@router.post("/bookings/{booking_id}/escalate", response_model=EscalationOut, status_code=201)
async def escalate_to_khelo(
    booking_id: uuid.UUID, payload: EscalateIn, db: DbSession, settings: AppSettings, player: CurrentUser
) -> EscalationOut:
    e = await rf.escalate(db, settings, player, booking_id, payload.kind, payload.reason)
    return EscalationOut(**rf.escalation_out(e))


@router.get("/owners/refunds/{dispute_id}/payout", response_model=PayoutOut)
async def reveal_refund_payout(dispute_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable) -> PayoutOut:
    return PayoutOut(**await rf.reveal_payout(db, settings, owner, dispute_id))


@router.post("/owners/refund-transfers/{transfer_id}/reply", response_model=RefundTransferOut)
async def reply_refund_transfer(
    transfer_id: uuid.UUID, payload: OwnerTransferReplyIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> RefundTransferOut:
    t = await rf.owner_reply_transfer(db, settings, owner, transfer_id, payload.note)
    return RefundTransferOut(**rf.transfer_out(t))


@router.get("/admin/escalations", response_model=list[AdminEscalationOut])
async def admin_escalations(
    db: DbSession, settings: AppSettings, admin: RequireAdmin, status: Literal["open", "decided"] | None = None
) -> list[AdminEscalationOut]:
    return [AdminEscalationOut(**row) for row in await rf.list_escalations(db, settings, status)]


@router.post("/admin/escalations/{escalation_id}/decide", response_model=EscalationOut)
async def admin_decide_escalation(
    escalation_id: uuid.UUID, payload: EscalationDecideIn, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> EscalationOut:
    e = await rf.decide_escalation(db, settings, admin, escalation_id, payload.decision, payload.note)
    return EscalationOut(**rf.escalation_out(e))
