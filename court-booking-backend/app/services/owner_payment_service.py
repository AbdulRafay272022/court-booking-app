"""Owner premium billing, step 3: an owner pays an invoice by screenshot and an admin approves it.

The flow mirrors the player-side payment proof, with the platform as the payee and an admin as the reviewer:

    invoice `issued` --owner uploads proof--> `proof_submitted` --admin approves--> `paid`  (paid_through moves forward)
                                                   |--admin rejects--> back to `issued` (the owner may upload again)

An admin can also record a payment received outside the app (cash / bank transfer / other) straight onto an `issued`
invoice, and can reverse an approved payment (a negative `reversal` row, never an edit or delete). Every state change is a
single conditional UPDATE, so a double tap or two admins at once cannot settle an invoice twice. The vision model reads the
screenshot for the admin's benefit only: nothing is auto-approved, because this is the platform's own money.

Only this module (and its reversal) ever moves `owner_features.paid_through`.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import structlog
from fastapi import status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.owner_billing import (
    InvoiceStatus,
    OwnerFeature,
    OwnerFeatureStatus,
    OwnerInvoice,
    OwnerInvoiceLine,
    OwnerPayment,
    OwnerPaymentStatus,
)
from app.models.user import User
from app.services.audit_service import AuditService
from app.services.entitlement_service import EntitlementService
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
from app.utils.image import perceptual_hash
from app.utils.s3 import upload_private_proof
from app.utils.timezone import format_pkr

logger = structlog.get_logger(__name__)

RECORDABLE_METHODS = ("bank_transfer", "cash", "other")


def platform_payment_details(settings: Settings) -> dict | None:
    """Where an owner pays the platform. None when the operator has not configured an account yet."""
    details = {
        "bank": settings.PLATFORM_BANK_NAME,
        "account_title": settings.PLATFORM_ACCOUNT_TITLE,
        "account_number": settings.PLATFORM_ACCOUNT_NUMBER,
        "iban": settings.PLATFORM_IBAN,
    }
    return details if details["account_number"] or details["iban"] else None


def ocr_summary(amount: float | None, expected: int, tolerance_percent: float) -> str:
    """One plain line for the admin: what the screenshot showed against the invoice total."""
    if amount is None:
        return "Screenshot amount could not be read: check it by eye."
    shown = int(round(amount))
    if abs(shown - expected) <= expected * tolerance_percent / 100:
        return f"Screenshot shows {format_pkr(shown)}: matches the invoice ({format_pkr(expected)})."
    diff = shown - expected
    return f"Screenshot shows {format_pkr(shown)}: {format_pkr(abs(diff))} {'more' if diff > 0 else 'less'} than the invoice ({format_pkr(expected)})."


class OwnerPaymentService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditService(db)
        self.entitlements = EntitlementService(db, settings)

    # ---- lookups ----------------------------------------------------------------------------------------------------------

    async def _invoice(self, invoice_id: uuid.UUID) -> OwnerInvoice:
        invoice = await self.db.get(OwnerInvoice, invoice_id)
        if invoice is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.INVOICE_NOT_FOUND, "Invoice not found.")
        return invoice

    async def _payment(self, payment_id: uuid.UUID) -> OwnerPayment:
        payment = await self.db.get(OwnerPayment, payment_id)
        if payment is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Payment not found.")
        return payment

    async def _lines(self, invoice_id: uuid.UUID) -> list[OwnerInvoiceLine]:
        return list((await self.db.execute(select(OwnerInvoiceLine).where(OwnerInvoiceLine.invoice_id == invoice_id))).scalars())

    # ---- owner: upload the screenshot ------------------------------------------------------------------------------------

    async def submit_proof(
        self, owner: User, invoice_id: uuid.UUID, *, proof_bytes: bytes, filename: str, content_type: str
    ) -> OwnerPayment:
        invoice = await self._invoice(invoice_id)
        if invoice.owner_id != owner.id:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.INVOICE_NOT_FOUND, "Invoice not found.")
        if invoice.status != InvoiceStatus.ISSUED.value:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.INVOICE_NOT_PAYABLE,
                "This invoice is not waiting for a payment.",
                details={"status": invoice.status},
            )

        proof_hash = perceptual_hash(proof_bytes)
        reused = await self._reused_proof(proof_hash, exclude_invoice_id=invoice.id)
        extraction = await PaymentService(self.db, self.settings)._extract_payment_proof(
            proof_bytes, content_type, float(invoice.total_pkr)
        )
        note = ocr_summary(extraction.amount, invoice.total_pkr, self.settings.OCR_MATCH_TOLERANCE_PERCENT)
        if reused:
            note += " This screenshot looks the same as one already used for another invoice."
        proof_key = await upload_private_proof(proof_bytes, filename, content_type)

        payment = OwnerPayment(
            invoice_id=invoice.id,
            owner_id=owner.id,
            amount_pkr=invoice.total_pkr,
            method="bank_transfer_proof",
            status=OwnerPaymentStatus.SUBMITTED.value,
            proof_key=proof_key,
            proof_hash=proof_hash,
            reference=(extraction.reference or None),
            note=note,
            recorded_by_user_id=owner.id,
        )
        self.db.add(payment)
        try:
            await self.db.flush()  # the partial unique index allows ONE unreviewed proof per invoice
        except IntegrityError:
            await self.db.rollback()
            raise AppError(
                status.HTTP_409_CONFLICT, ErrorCode.PAYMENT_ALREADY_SUBMITTED, "A payment screenshot for this invoice is already being checked."
            ) from None
        moved = await self._move_invoice(invoice.id, InvoiceStatus.ISSUED, InvoiceStatus.PROOF_SUBMITTED)
        if not moved:  # the invoice changed under us (voided, paid by an admin): do not leave a dangling proof
            await self.db.rollback()
            raise AppError(status.HTTP_409_CONFLICT, ErrorCode.INVOICE_NOT_PAYABLE, "This invoice is not waiting for a payment.")
        await self.audit.log(
            actor_user_id=owner.id, actor_type="owner", action="owner_payment.submitted", entity_type="owner_payment",
            entity_id=payment.id, new_value={"invoice_id": str(invoice.id), "amount_pkr": invoice.total_pkr},
        )
        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    async def _reused_proof(self, proof_hash: str | None, *, exclude_invoice_id: uuid.UUID) -> bool:
        """Has the same screenshot (by perceptual hash) already been used for a DIFFERENT invoice's live payment?"""
        if not proof_hash:
            return False
        found = await self.db.scalar(
            select(OwnerPayment.id)
            .where(
                OwnerPayment.proof_hash == proof_hash,
                OwnerPayment.invoice_id != exclude_invoice_id,
                OwnerPayment.status.in_((OwnerPaymentStatus.SUBMITTED.value, OwnerPaymentStatus.APPROVED.value)),
            )
            .limit(1)
        )
        return found is not None

    async def _move_invoice(self, invoice_id: uuid.UUID, expect: InvoiceStatus, to: InvoiceStatus, **extra) -> bool:
        """`UPDATE ... WHERE status = expect`: true when this call is the one that moved it."""
        result = await self.db.execute(
            update(OwnerInvoice)
            .where(OwnerInvoice.id == invoice_id, OwnerInvoice.status == expect.value)
            .values(status=to.value, **extra)
            .returning(OwnerInvoice.id)
        )
        return result.first() is not None

    # ---- admin: decide ------------------------------------------------------------------------------------------------------

    async def approve(self, payment_id: uuid.UUID, admin: User) -> OwnerPayment:
        payment = await self._payment(payment_id)
        claimed = await self._claim(payment.id, OwnerPaymentStatus.APPROVED, admin)
        invoice = await self._invoice(claimed.invoice_id)
        now = datetime.now(timezone.utc)
        settled = await self._move_invoice(
            invoice.id, InvoiceStatus.PROOF_SUBMITTED, InvoiceStatus.PAID, paid_at=now, approved_by_user_id=admin.id
        )
        if not settled:  # e.g. the invoice was voided while the proof waited: undo the approval, change nothing else
            await self.db.rollback()
            raise AppError(status.HTTP_409_CONFLICT, ErrorCode.INVOICE_NOT_PAYABLE, "This invoice can no longer be paid.")
        await self._extend_coverage(invoice)
        await self.audit.log(
            actor_user_id=admin.id, actor_type="admin", action="owner_payment.approved", entity_type="owner_payment",
            entity_id=payment.id, new_value={"invoice_id": str(invoice.id), "amount_pkr": claimed.amount_pkr},
        )
        await self.db.commit()
        await self._notify(invoice.owner_id, approved=True, invoice=invoice)
        await self.db.refresh(claimed)
        return claimed

    async def reject(self, payment_id: uuid.UUID, admin: User, reason: str) -> OwnerPayment:
        payment = await self._payment(payment_id)
        claimed = await self._claim(payment.id, OwnerPaymentStatus.REJECTED, admin, rejection_reason=reason)
        invoice = await self._invoice(claimed.invoice_id)
        await self._move_invoice(invoice.id, InvoiceStatus.PROOF_SUBMITTED, InvoiceStatus.ISSUED)  # the owner may upload again
        await self.audit.log(
            actor_user_id=admin.id, actor_type="admin", action="owner_payment.rejected", entity_type="owner_payment",
            entity_id=payment.id, new_value={"invoice_id": str(invoice.id), "reason": reason},
        )
        await self.db.commit()
        await self._notify(invoice.owner_id, approved=False, invoice=invoice, reason=reason)
        await self.db.refresh(claimed)
        return claimed

    async def _claim(self, payment_id: uuid.UUID, to: OwnerPaymentStatus, admin: User, **extra) -> OwnerPayment:
        """The atomic guard: only the call that finds the payment still `submitted` gets to decide it."""
        result = await self.db.execute(
            update(OwnerPayment)
            .where(OwnerPayment.id == payment_id, OwnerPayment.status == OwnerPaymentStatus.SUBMITTED.value)
            .values(status=to.value, reviewed_by_user_id=admin.id, reviewed_at=datetime.now(timezone.utc), **extra)
            .returning(OwnerPayment)
            .execution_options(populate_existing=True)
        )
        row = result.scalar_one_or_none()
        if row is None:
            await self.db.rollback()
            raise AppError(status.HTTP_409_CONFLICT, ErrorCode.PAYMENT_ALREADY_REVIEWED, "This payment was already reviewed.")
        return row

    async def record_payment(self, invoice_id: uuid.UUID, admin: User, *, method: str, note: str | None) -> OwnerPayment:
        """A payment received outside the app (cash, a bank transfer the owner never screenshotted), recorded by an admin."""
        if method not in RECORDABLE_METHODS:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "Method must be bank_transfer, cash or other.")
        invoice = await self._invoice(invoice_id)
        now = datetime.now(timezone.utc)
        if not await self._move_invoice(invoice.id, InvoiceStatus.ISSUED, InvoiceStatus.PAID, paid_at=now, approved_by_user_id=admin.id):
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.INVOICE_NOT_PAYABLE,
                "Only an invoice that is waiting for payment can be recorded as paid. If a screenshot is waiting, approve it instead.",
                details={"status": invoice.status},
            )
        payment = OwnerPayment(
            invoice_id=invoice.id, owner_id=invoice.owner_id, amount_pkr=invoice.total_pkr, method=method,
            status=OwnerPaymentStatus.APPROVED.value, recorded_by_user_id=admin.id, reviewed_by_user_id=admin.id,
            reviewed_at=now, note=note,
        )
        self.db.add(payment)
        await self.db.flush()
        await self._extend_coverage(invoice)
        await self.audit.log(
            actor_user_id=admin.id, actor_type="admin", action="owner_payment.recorded", entity_type="owner_payment",
            entity_id=payment.id, new_value={"invoice_id": str(invoice.id), "amount_pkr": invoice.total_pkr, "method": method, "note": note},
        )
        await self.db.commit()
        await self._notify(invoice.owner_id, approved=True, invoice=invoice)
        await self.db.refresh(payment)
        return payment

    async def reverse(self, payment_id: uuid.UUID, admin: User, reason: str) -> OwnerPayment:
        """Correct a mistake: a negative `reversal` row pointing at the approved payment, the invoice goes back to `issued`, and
        the paid-through dates that payment moved are put back. Nothing is edited or deleted."""
        locked = (
            await self.db.execute(select(OwnerPayment).where(OwnerPayment.id == payment_id).with_for_update())
        ).scalar_one_or_none()
        if locked is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Payment not found.")
        already = await self.db.scalar(select(OwnerPayment.id).where(OwnerPayment.reverses_payment_id == locked.id).limit(1))
        if locked.status != OwnerPaymentStatus.APPROVED.value or already is not None:
            await self.db.rollback()
            raise AppError(status.HTTP_409_CONFLICT, ErrorCode.PAYMENT_ALREADY_REVIEWED, "Only an approved payment that has not been reversed can be reversed.")
        invoice = await self._invoice(locked.invoice_id)
        reversal = OwnerPayment(
            invoice_id=locked.invoice_id, owner_id=locked.owner_id, amount_pkr=-locked.amount_pkr, method=locked.method,
            status=OwnerPaymentStatus.REVERSAL.value, recorded_by_user_id=admin.id, reviewed_by_user_id=admin.id,
            reviewed_at=datetime.now(timezone.utc), reverses_payment_id=locked.id, note=reason,
        )
        self.db.add(reversal)
        await self.db.flush()
        await self._move_invoice(invoice.id, InvoiceStatus.PAID, InvoiceStatus.ISSUED)
        await self._roll_back_coverage(invoice)
        await self.audit.log(
            actor_user_id=admin.id, actor_type="admin", action="owner_payment.reversed", entity_type="owner_payment",
            entity_id=locked.id, old_value={"status": "approved", "amount_pkr": locked.amount_pkr}, new_value={"reason": reason},
        )
        await self.db.commit()
        await self.db.refresh(reversal)
        return reversal

    # ---- moving paid_through ------------------------------------------------------------------------------------------------

    async def _owner_rows(self, owner_id: uuid.UUID) -> dict[str, OwnerFeature]:
        return {
            r.feature_key: r
            for r in (await self.db.execute(select(OwnerFeature).where(OwnerFeature.owner_id == owner_id).with_for_update())).scalars()
        }

    async def _extend_coverage(self, invoice: OwnerInvoice) -> None:
        """Paying an invoice pays each of its features through the end of that line's period. A feature that had slipped into
        past_due or lapsed is active again at once (nothing was ever deleted)."""
        rows = await self._owner_rows(invoice.owner_id)
        for line in await self._lines(invoice.id):
            row = rows.get(line.feature_key)
            if row is None:
                continue
            if row.paid_through is None or line.period_end > row.paid_through:
                row.paid_through = line.period_end
            if row.status in (OwnerFeatureStatus.PAST_DUE.value, OwnerFeatureStatus.LAPSED.value):
                row.status = OwnerFeatureStatus.ACTIVE.value

    async def _roll_back_coverage(self, invoice: OwnerInvoice) -> None:
        """Undo exactly what paying this invoice did: a feature whose paid-through is still this line's period end goes back to
        the day before the line began (or to no payment at all when that day is inside its free trial)."""
        rows = await self._owner_rows(invoice.owner_id)
        for line in await self._lines(invoice.id):
            row = rows.get(line.feature_key)
            if row is None or row.paid_through != line.period_end:
                continue
            before: date = line.period_start - timedelta(days=1)
            row.paid_through = None if before <= self.entitlements.trial_last_day(row) else before

    # ---- tell the owner -------------------------------------------------------------------------------------------------------

    async def _notify(self, owner_id: uuid.UUID, *, approved: bool, invoice: OwnerInvoice, reason: str | None = None) -> None:
        try:
            owner = await self.db.get(User, owner_id)
            if owner is None:
                return
            notifier = NotificationService(self.db, self.settings)
            if approved:
                await notifier._send_push_and_whatsapp(
                    owner, "premium_payment_approved", "Payment received",
                    f"Thank you! Your premium payment of {format_pkr(invoice.total_pkr)} is confirmed.",
                    reference_id=invoice.id,
                    payload={"amount": invoice.total_pkr},
                )
            else:
                await notifier._send_push_and_whatsapp(
                    owner, "premium_payment_rejected", "Payment not accepted",
                    f"Your premium payment screenshot was not accepted: {reason}. Please upload it again.",
                    reference_id=invoice.id,
                    payload={"amount": invoice.total_pkr, "reason": reason} if reason else {"amount": invoice.total_pkr},
                )
            await self.db.commit()
        except Exception:  # noqa: BLE001 -- a failed notification never undoes the decision
            logger.warning("owner_payment.notify_failed", owner_id=str(owner_id), exc_info=True)
            await self.db.rollback()
