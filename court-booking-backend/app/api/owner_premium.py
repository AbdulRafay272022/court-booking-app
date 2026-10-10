import uuid

from fastapi import APIRouter, File, UploadFile, status

from app.errors import AppError, ErrorCode
from app.models.owner_billing import OwnerPayment, OwnerPaymentStatus
from app.utils.image import InvalidImageError, validate_image
from app.dependencies import AppSettings, DbSession, RequireOwner
from app.models.owner_billing import OwnerFeature, OwnerFeatureStatus
from app.schemas.owner_billing import (
    InvoiceLineOut,
    InvoiceOut,
    OwnerFeatureOut,
    OwnerPremiumOut,
    PaymentInstructionsOut,
    SelectionIn,
)
from app.services.owner_payment_service import OwnerPaymentService, platform_payment_details
from app.services.entitlement_service import EntitlementService
from app.services.owner_billing_service import OwnerBillingService
from sqlalchemy import select

router = APIRouter(prefix="/owners/premium", tags=["owner-premium"])


async def build_owner_premium(db, settings, owner) -> OwnerPremiumOut:
    entitlements = EntitlementService(db, settings)
    billing = OwnerBillingService(db, settings)
    rows = {
        r.feature_key: r
        for r in (await db.execute(select(OwnerFeature).where(OwnerFeature.owner_id == owner.id))).scalars()
    }
    features = []
    for feature in await billing.list_features():
        if not feature.is_sellable and feature.key not in rows:
            continue  # not for sale and never taken: the owner doesn't need to see it
        state = await entitlements.state(owner.id, feature.key)
        row = rows.get(feature.key)
        cancelled = bool(row and (row.status == OwnerFeatureStatus.CANCELLED.value or not row.auto_renew))
        features.append(
            OwnerFeatureOut(
                key=feature.key,
                label=feature.label,
                description=feature.description,
                monthly_price_pkr=feature.monthly_price_pkr,
                enabled=row is not None and not cancelled,
                your_price_pkr=row.price_pkr if row else None,
                entitled=state.entitled,
                state=state.reason,
                trial_ends_on=entitlements.trial_last_day(row) if row else None,
                paid_through=row.paid_through if row else None,
                cancelled=cancelled,
            )
        )
    rejected = {}
    for pay in (
        await db.execute(
            select(OwnerPayment)
            .where(OwnerPayment.owner_id == owner.id, OwnerPayment.status == OwnerPaymentStatus.REJECTED.value)
            .order_by(OwnerPayment.reviewed_at.asc())
        )
    ).scalars():
        rejected[pay.invoice_id] = pay.rejection_reason  # the latest one wins
    invoices = [
        InvoiceOut(
            last_rejection_reason=rejected.get(inv.id) if inv.status == "issued" else None,
            id=inv.id,
            period_start=inv.period_start,
            period_end=inv.period_end,
            total_pkr=inv.total_pkr,
            status=inv.status,
            due_date=inv.due_date,
            created_at=inv.created_at,
            lines=[InvoiceLineOut.model_validate(line) for line in lines],
        )
        for inv, lines in await billing.invoices_for_owner(owner.id)
    ]
    instructions = platform_payment_details(settings)
    return OwnerPremiumOut(
        payment_instructions=PaymentInstructionsOut(**instructions) if instructions else None,
        enforced=await entitlements.enforced(),
        trial_days=settings.OWNER_TRIAL_DAYS,
        grace_days=settings.OWNER_BILLING_GRACE_DAYS,
        features=features,
        monthly_total_pkr=await entitlements.monthly_total_pkr(owner.id),
        invoices=invoices,
    )


@router.get("", response_model=OwnerPremiumOut)
async def my_premium(db: DbSession, settings: AppSettings, owner: RequireOwner) -> OwnerPremiumOut:
    """The premium features this owner can buy, what they have switched on, their monthly total and their invoices."""
    return await build_owner_premium(db, settings, owner)


@router.put("/selection", response_model=OwnerPremiumOut)
async def set_my_selection(payload: SelectionIn, db: DbSession, settings: AppSettings, owner: RequireOwner) -> OwnerPremiumOut:
    """Set the complete list of premium features the owner wants on. Enabling one starts its free trial; leaving one out cancels it."""
    await OwnerBillingService(db, settings).set_selection(owner, payload.feature_keys)
    return await build_owner_premium(db, settings, owner)


ALLOWED_PROOF_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PROOF_BYTES = 10 * 1024 * 1024


@router.post("/invoices/{invoice_id}/payment-proof", response_model=OwnerPremiumOut, status_code=status.HTTP_201_CREATED)
async def submit_invoice_payment_proof(
    invoice_id: uuid.UUID,
    db: DbSession,
    settings: AppSettings,
    owner: RequireOwner,
    image: UploadFile = File(...),
) -> OwnerPremiumOut:
    """Upload the screenshot of a payment for an invoice. An admin checks it and approves or rejects it."""
    if image.content_type not in ALLOWED_PROOF_TYPES:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, "Unsupported proof type")
    proof_bytes = await image.read()
    if len(proof_bytes) > MAX_PROOF_BYTES:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.PROOF_TOO_LARGE, "Proof image too large")
    try:
        validate_image(proof_bytes)
    except InvalidImageError as exc:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, str(exc)) from exc
    await OwnerPaymentService(db, settings).submit_proof(
        owner, invoice_id, proof_bytes=proof_bytes, filename=image.filename or "proof.jpg", content_type=image.content_type
    )
    return await build_owner_premium(db, settings, owner)
