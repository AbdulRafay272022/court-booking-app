import uuid

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError, ErrorCode
from app.models.booking import Booking
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import User, UserRole
from app.services.audit_service import AuditService


async def recompute_payment_totals(db: AsyncSession, booking: Booking) -> None:
    """The one place `bookings.amount_paid`/`balance_due` are ever written (Section 32 Part 5's own rule:
    "always computed from the payment rows, never a hand-edited number"). Re-sums `payment_entries` from
    scratch rather than incrementing in place, so it's correct even after a correction/reversal touches an
    entry recorded earlier. Callers that need this to be race-safe against a concurrent recording on the
    same booking must hold the booking row locked first (see `PaymentLedgerService.record_entry`)."""
    total = await db.scalar(
        select(func.coalesce(func.sum(PaymentEntry.amount_pkr), 0)).where(PaymentEntry.booking_id == booking.id)
    )
    total = int(total or 0)
    booking.amount_paid = total
    booking.balance_due = max(round(float(booking.price) - total, 2), 0.0)


class PaymentLedgerService:
    """The append-only `payment_entries` ledger: owners recording a balance payment (or a walk-in's amount,
    or the system recording an approved advance), and admin corrections. Distinct from `PaymentService`,
    which reviews OCR payment-PROOF screenshots -- this is about money actually received, however it
    arrived (bank transfer, cash at the venue, or otherwise)."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.audit = AuditService(db)

    async def record_entry(
        self,
        booking_id: uuid.UUID,
        *,
        amount_pkr: int,
        method: PaymentMethod,
        recorded_by: User | None,
        note: str | None = None,
    ) -> PaymentEntry:
        """Records a real payment against a booking. Refuses to push the booking's total paid past its
        price (over-payment is rejected, not silently clamped). Row-locks the booking first -- the same
        concurrency concern `payment_service._claim_review` guards against for approve/reject, just solved
        differently here: the invariant is a running SUM across child rows, not a single column's value, so
        this holds `SELECT ... FOR UPDATE` on the booking for the duration of the check + insert +
        recompute, which serializes two owners racing to record a payment on the same booking rather than
        letting both read a stale balance and together overpay it."""
        if amount_pkr <= 0:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Amount must be greater than zero")

        booking = await self.db.get(Booking, booking_id, with_for_update=True)
        if booking is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND, "Booking not found")

        current_paid = await self.db.scalar(
            select(func.coalesce(func.sum(PaymentEntry.amount_pkr), 0)).where(PaymentEntry.booking_id == booking.id)
        )
        current_paid = int(current_paid or 0)
        balance = round(float(booking.price) - current_paid, 2)
        if amount_pkr > balance:
            raise AppError(
                status.HTTP_400_BAD_REQUEST,
                ErrorCode.PAYMENT_EXCEEDS_BALANCE,
                f"That's more than the PKR {balance:.0f} still owed on this booking",
                details={"balance_due": balance},
            )

        entry = PaymentEntry(
            booking_id=booking.id,
            amount_pkr=amount_pkr,
            method=method,
            recorded_by=recorded_by.id if recorded_by else None,
            note=note,
        )
        self.db.add(entry)
        await self.db.flush()

        await recompute_payment_totals(self.db, booking)

        await self.audit.log(
            actor_user_id=recorded_by.id if recorded_by else None,
            actor_type="owner" if recorded_by else "system",
            action="payment_entry.recorded",
            entity_type="booking",
            entity_id=booking.id,
            new_value={"amount_pkr": amount_pkr, "method": method.value, "amount_paid": float(booking.amount_paid)},
        )
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def reverse_entry(self, entry_id: uuid.UUID, *, actor: User, reason: str) -> PaymentEntry:
        """A correction (Section 32 Part 5): never edits or deletes the original row -- inserts a new entry
        with the opposite amount, linked back via `reverses_entry_id`, and recomputes the booking's totals
        from the (now-corrected) sum. The audit log entry carries the booking's balance before and after,
        per the spec's "audit-log entry for every change (who, what, before/after)". Callers must have
        already checked `actor` may act on this entry's booking (the API layer does this the same way
        `record_entry`'s caller does, via `BookingService.require_accessible_booking`) -- a venue owner can
        correct their own venue's entries, an admin can correct any."""
        original = await self.db.get(PaymentEntry, entry_id)
        if original is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Payment entry not found")

        booking = await self.db.get(Booking, original.booking_id, with_for_update=True)
        if booking is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND, "Booking not found")
        balance_before = float(booking.balance_due)

        reversal = PaymentEntry(
            booking_id=booking.id,
            amount_pkr=-original.amount_pkr,
            method=original.method,
            recorded_by=actor.id,
            note=reason,
            reverses_entry_id=original.id,
        )
        self.db.add(reversal)
        await self.db.flush()

        await recompute_payment_totals(self.db, booking)

        await self.audit.log(
            actor_user_id=actor.id,
            actor_type="admin" if actor.role == UserRole.ADMIN else "owner",
            action="payment_entry.reversed",
            entity_type="payment_entry",
            entity_id=original.id,
            old_value={"balance_due": balance_before},
            new_value={"balance_due": float(booking.balance_due), "reason": reason},
        )
        await self.db.commit()
        await self.db.refresh(reversal)
        return reversal

    async def list_for_booking(self, booking_id: uuid.UUID) -> list[PaymentEntry]:
        result = await self.db.execute(
            select(PaymentEntry).where(PaymentEntry.booking_id == booking_id).order_by(PaymentEntry.created_at.asc())
        )
        return list(result.scalars().all())
