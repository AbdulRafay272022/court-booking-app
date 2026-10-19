"""How many OTHER bookings a payment screenshot was already credited on (Round 2 Stage 2, spec B.a + findings 1).

One real transfer can only be money once. A screenshot belongs to an "image group": the payment itself, the payment
it was flagged a duplicate of (`duplicate_of`) and every payment flagged against that same original, every payment
with the identical `proof_hash`, and every payment with the same OCR transaction reference. The group spans ALL
players (the same image re-uploaded by another player counts too; `_find_duplicate` already flags across players).

`used_on_bookings` = distinct bookings, other than this payment's own booking, where a payment of the group was
APPROVED (credited). Read only: nothing here changes data.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payment import Payment


def _group_condition(payment: Payment):
    root = payment.duplicate_of or payment.id
    conds = [Payment.id == root, Payment.duplicate_of == root, Payment.id == payment.id]
    if payment.proof_hash:
        conds.append(Payment.proof_hash == payment.proof_hash)
    if payment.ocr_ref:
        conds.append(Payment.ocr_ref == payment.ocr_ref)
    return or_(*conds)


async def used_on_bookings(db: AsyncSession, payment: Payment) -> int:
    count = await db.scalar(
        select(func.count(func.distinct(Payment.booking_id))).where(
            _group_condition(payment),
            Payment.review_verdict == "approved",
            Payment.booking_id != payment.booking_id,
        )
    )
    return int(count or 0)


async def used_on_bookings_map(db: AsyncSession, payments: list[Payment]) -> dict[uuid.UUID, int]:
    """`used_on_bookings` for several payments (one query per payment; pages are small: <= 100 rows)."""
    out: dict[uuid.UUID, int] = {}
    for p in payments:
        if p is None or p.id in out:
            continue
        out[p.id] = await used_on_bookings(db, p)
    return out

