"""Admin side of owner premium billing: the screenshots waiting to be checked, invoices waiting to be paid, and corrections."""

import uuid

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.dependencies import AppSettings, DbSession, RequireAdmin
from app.models.owner_billing import OwnerInvoice, OwnerInvoiceLine, OwnerPayment
from app.models.user import User
from app.schemas.admin_billing_report import BillingSummaryOut, OwnerBillingDetailOut, OwnerBillingRowOut
from app.schemas.owner_billing import (
    AdminOwnerInvoiceOut,
    AdminOwnerPaymentOut,
    InvoiceLineOut,
    RecordPaymentIn,
    RejectPaymentIn,
    ReversePaymentIn,
)
from app.services.admin_billing_report_service import AdminBillingReportService
from app.services.owner_payment_service import OwnerPaymentService
from app.utils.s3 import signed_private_url

router = APIRouter(prefix="/admin", tags=["admin-owner-billing"])


async def _lines_by_invoice(db, invoice_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[InvoiceLineOut]]:
    out: dict[uuid.UUID, list[InvoiceLineOut]] = {i: [] for i in invoice_ids}
    if not invoice_ids:
        return out
    rows = (
        await db.execute(
            select(OwnerInvoiceLine).where(OwnerInvoiceLine.invoice_id.in_(invoice_ids)).order_by(OwnerInvoiceLine.feature_key)
        )
    ).scalars()
    for line in rows:
        out[line.invoice_id].append(InvoiceLineOut.model_validate(line))
    return out


async def _payment_out(db, payments: list[OwnerPayment]) -> list[AdminOwnerPaymentOut]:
    if not payments:
        return []
    invoices = {
        i.id: i
        for i in (await db.execute(select(OwnerInvoice).where(OwnerInvoice.id.in_({p.invoice_id for p in payments})))).scalars()
    }
    owners = {u.id: u for u in (await db.execute(select(User).where(User.id.in_({p.owner_id for p in payments})))).scalars()}
    lines = await _lines_by_invoice(db, list(invoices))
    reversed_ids = set(
        (
            await db.execute(
                select(OwnerPayment.reverses_payment_id).where(OwnerPayment.reverses_payment_id.in_([p.id for p in payments]))
            )
        ).scalars()
    )
    out = []
    for p in payments:
        inv, owner = invoices[p.invoice_id], owners[p.owner_id]
        out.append(
            AdminOwnerPaymentOut(
                id=p.id,
                invoice_id=p.invoice_id,
                owner_id=p.owner_id,
                owner_name=owner.name,
                owner_phone=owner.phone,
                amount_pkr=p.amount_pkr,
                method=p.method,
                status=p.status,
                note=p.note,
                reference=p.reference,
                rejection_reason=p.rejection_reason,
                created_at=p.created_at,
                reviewed_at=p.reviewed_at,
                proof_url=signed_private_url(p.proof_key, expires_in=900) if p.proof_key else None,
                invoice_period_start=inv.period_start,
                invoice_period_end=inv.period_end,
                invoice_total_pkr=inv.total_pkr,
                lines=lines[inv.id],
                reversed=p.id in reversed_ids,
            )
        )
    return out


@router.get("/owner-payments", response_model=list[AdminOwnerPaymentOut])
async def list_owner_payments(
    db: DbSession,
    admin: RequireAdmin,
    status: str = Query("submitted", pattern="^(submitted|approved|rejected|reversal)$"),
    limit: int = Query(50, ge=1, le=200),
) -> list[AdminOwnerPaymentOut]:
    """Owner premium payments by status. `submitted` is the queue to review (oldest first); the others are history."""
    query = select(OwnerPayment).where(OwnerPayment.status == status)
    query = query.order_by(OwnerPayment.created_at.asc() if status == "submitted" else OwnerPayment.created_at.desc()).limit(limit)
    return await _payment_out(db, list((await db.execute(query)).scalars()))


@router.post("/owner-payments/{payment_id}/approve", response_model=AdminOwnerPaymentOut)
async def approve_owner_payment(
    payment_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> AdminOwnerPaymentOut:
    payment = await OwnerPaymentService(db, settings).approve(payment_id, admin)
    return (await _payment_out(db, [payment]))[0]


@router.post("/owner-payments/{payment_id}/reject", response_model=AdminOwnerPaymentOut)
async def reject_owner_payment(
    payment_id: uuid.UUID, payload: RejectPaymentIn, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> AdminOwnerPaymentOut:
    payment = await OwnerPaymentService(db, settings).reject(payment_id, admin, payload.reason.strip())
    return (await _payment_out(db, [payment]))[0]


@router.post("/owner-payments/{payment_id}/reverse", response_model=AdminOwnerPaymentOut)
async def reverse_owner_payment(
    payment_id: uuid.UUID, payload: ReversePaymentIn, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> AdminOwnerPaymentOut:
    """Correct a mistake: adds a negative reversal entry, reopens the invoice and puts the paid-through dates back."""
    reversal = await OwnerPaymentService(db, settings).reverse(payment_id, admin, payload.reason.strip())
    return (await _payment_out(db, [reversal]))[0]


@router.get("/owner-invoices", response_model=list[AdminOwnerInvoiceOut])
async def list_owner_invoices(
    db: DbSession,
    admin: RequireAdmin,
    status: str = Query("issued", pattern="^(issued|proof_submitted|paid|void|expired)$"),
    limit: int = Query(100, ge=1, le=300),
) -> list[AdminOwnerInvoiceOut]:
    invoices = list(
        (
            await db.execute(
                select(OwnerInvoice).where(OwnerInvoice.status == status).order_by(OwnerInvoice.due_date.asc()).limit(limit)
            )
        ).scalars()
    )
    owners = (
        {u.id: u for u in (await db.execute(select(User).where(User.id.in_({i.owner_id for i in invoices})))).scalars()}
        if invoices
        else {}
    )
    lines = await _lines_by_invoice(db, [i.id for i in invoices])
    return [
        AdminOwnerInvoiceOut(
            id=i.id,
            owner_id=i.owner_id,
            owner_name=owners[i.owner_id].name,
            owner_phone=owners[i.owner_id].phone,
            period_start=i.period_start,
            period_end=i.period_end,
            total_pkr=i.total_pkr,
            status=i.status,
            due_date=i.due_date,
            created_at=i.created_at,
            lines=lines[i.id],
        )
        for i in invoices
    ]


@router.post("/owner-invoices/{invoice_id}/record-payment", response_model=AdminOwnerPaymentOut)
async def record_owner_payment(
    invoice_id: uuid.UUID, payload: RecordPaymentIn, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> AdminOwnerPaymentOut:
    """A payment received outside the app (cash, a bank transfer), recorded onto an invoice that is waiting for payment."""
    payment = await OwnerPaymentService(db, settings).record_payment(invoice_id, admin, method=payload.method, note=payload.note)
    return (await _payment_out(db, [payment]))[0]


# ---- reports (read-only) -----------------------------------------------------------------------------------------------


@router.get("/owner-billing/summary", response_model=BillingSummaryOut)
async def owner_billing_summary(db: DbSession, settings: AppSettings, admin: RequireAdmin) -> BillingSummaryOut:
    """The revenue dashboard: money collected by month, recurring vs trial vs at-risk value, unpaid invoices, and a
    per-feature breakdown."""
    return await AdminBillingReportService(db, settings).summary()


@router.get("/owner-billing/owners", response_model=list[OwnerBillingRowOut])
async def owner_billing_owners(
    db: DbSession, settings: AppSettings, admin: RequireAdmin, search: str | None = Query(None, max_length=60)
) -> list[OwnerBillingRowOut]:
    """Every owner who has switched on a premium feature or been invoiced, worst standing first."""
    return await AdminBillingReportService(db, settings).owners(search=search)


@router.get("/owner-billing/owners/{owner_id}", response_model=OwnerBillingDetailOut)
async def owner_billing_detail(
    owner_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> OwnerBillingDetailOut:
    """One owner's features (with trial / paid-through dates), invoices and every payment against them."""
    return await AdminBillingReportService(db, settings).owner_detail(owner_id)
