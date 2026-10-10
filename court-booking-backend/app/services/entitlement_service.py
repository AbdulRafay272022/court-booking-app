"""Who may use which premium feature (owner billing: the rules every gate in the app asks).

The answer for one owner and one feature, in order:

1. The feature is not one of the six sellable ones, or an admin has not priced it yet (`premium_features.is_sellable` is false):
   not billed, always allowed.
2. `owner_billing_enforced` is OFF (the default, and also when the flag row is missing): allowed. Nothing changes for anyone.
3. The owner has switched the feature on (`owner_features.enabled_at`) and is inside that feature's free trial,
   OWNER_TRIAL_DAYS counted from the day THEY enabled it: allowed. A trial never starts by itself (not at sign-up, not when
   enforcement is switched on) and cannot be restarted: the row is kept when a feature is cancelled, so enabling it again
   later does not give a second trial.
4. The owner has the feature switched on and has paid through today: allowed. Up to OWNER_BILLING_GRACE_DAYS after that date
   it still works (grace). After that it is lapsed: off for this owner. Paying again brings it straight back.
5. Otherwise (never switched on, or the trial is over and nothing is paid): not allowed.

The global feature flag stays the master kill switch above all of this: `effective()` is "the flag is on AND the owner is
entitled". Dates are Pakistan calendar days. Nothing is ever deleted when a feature lapses.
"""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.errors import AppError, ErrorCode
from app.models.court import Court
from app.models.owner_billing import OwnerFeature, OwnerFeatureStatus, PremiumFeature, PremiumFeatureKey
from app.models.venue import Venue
from app.services.feature_flag_service import FeatureFlagService
from app.utils.timezone import pkt_today, utc_to_pkt_naive

ENFORCEMENT_FLAG = "owner_billing_enforced"
SELLABLE_KEYS = tuple(k.value for k in PremiumFeatureKey)
RENEWAL_NOTICE_DAYS = 7  # a banner / reminder starts this many days before a period ends


@dataclass(frozen=True)
class Entitlement:
    key: str
    entitled: bool
    # not_billed | not_enforced | trial | paid | grace | lapsed | unpaid | not_purchased
    reason: str
    until: date | None = None  # the last day the feature works (trial end, paid-through, or end of grace)


@dataclass(frozen=True)
class PremiumNotice:
    """One thing to tell an owner about a feature's payment: `info` (ends soon), `urgent` (overdue, still working) or
    `off` (switched off)."""

    level: str
    feature_key: str
    label: str
    message: str


def premium_required_error(label: str) -> AppError:
    """What an owner-facing endpoint answers when the owner does not have a premium feature."""
    return AppError(
        status.HTTP_403_FORBIDDEN,
        ErrorCode.PREMIUM_FEATURE_REQUIRED,
        f"{label} is a premium feature. Switch it on under Premium to use it.",
    )


def _fmt(d: date) -> str:
    return f"{d.day} {d.strftime('%b')}"


class EntitlementService:
    def __init__(self, db: AsyncSession, settings: Settings | None = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    async def enforced(self) -> bool:
        """Fails CLOSED, unlike every other flag: a missing `owner_billing_enforced` row means billing is not enforced."""
        return (await FeatureFlagService(self.db).as_map()).get(ENFORCEMENT_FLAG, False)

    def trial_last_day(self, row: OwnerFeature) -> date:
        """The last day of this feature's free trial for this owner: the day they enabled it plus OWNER_TRIAL_DAYS - 1
        (the day they enabled it is day 1)."""
        return utc_to_pkt_naive(row.enabled_at).date() + timedelta(days=max(self.settings.OWNER_TRIAL_DAYS, 0) - 1)

    def covered_until(self, row: OwnerFeature) -> date:
        """The last day this feature is covered without a grace period: the later of the trial end and what is paid."""
        return max(d for d in (row.paid_through, self.trial_last_day(row)) if d is not None)

    def grace(self) -> timedelta:
        return timedelta(days=self.settings.OWNER_BILLING_GRACE_DAYS)

    async def catalog(self) -> dict[str, PremiumFeature]:
        rows = (await self.db.execute(select(PremiumFeature))).scalars().all()
        return {r.key: r for r in rows}

    async def state(self, owner_id: uuid.UUID, key: str, *, today: date | None = None) -> Entitlement:
        today = today or pkt_today()
        feature = (await self.catalog()).get(key)
        if key not in SELLABLE_KEYS or feature is None or not feature.is_sellable:
            return Entitlement(key, True, "not_billed")
        if not await self.enforced():
            return Entitlement(key, True, "not_enforced")

        row = await self.db.scalar(
            select(OwnerFeature).where(OwnerFeature.owner_id == owner_id, OwnerFeature.feature_key == key)
        )
        if row is None:
            return Entitlement(key, False, "not_purchased")
        return self.row_state(row, today)

    def row_state(self, row: OwnerFeature, today: date) -> Entitlement:
        """The day-by-day picture for one switched-on feature, best case first. Pure (no queries), so the admin billing
        reports classify an owner exactly the way the gates do."""
        key, paid_through, trial_end = row.feature_key, row.paid_through, self.trial_last_day(row)
        if today <= trial_end:
            return Entitlement(key, True, "trial", max(d for d in (trial_end, paid_through) if d is not None))
        if paid_through is None:
            return Entitlement(key, False, "unpaid")
        if today <= paid_through:
            return Entitlement(key, True, "paid", paid_through)
        if today <= paid_through + self.grace():
            return Entitlement(key, True, "grace", paid_through + self.grace())
        return Entitlement(key, False, "lapsed", paid_through + self.grace())

    async def owner_entitled(self, owner_id: uuid.UUID, key: str, *, today: date | None = None) -> bool:
        return (await self.state(owner_id, key, today=today)).entitled

    async def venue_entitled(self, venue_id: uuid.UUID, key: str, *, today: date | None = None) -> bool:
        owner_id = await self.db.scalar(select(Venue.owner_id).where(Venue.id == venue_id))
        if owner_id is None:
            return True  # an unknown venue is somebody else's problem; never block on it
        return await self.owner_entitled(owner_id, key, today=today)

    async def court_entitled(self, court_id: uuid.UUID, key: str, *, today: date | None = None) -> bool:
        """Is the owner of the venue this court belongs to entitled to `key`? (What a player-facing gate asks.)"""
        owner_id = await self.db.scalar(
            select(Venue.owner_id).join(Court, Court.venue_id == Venue.id).where(Court.id == court_id)
        )
        if owner_id is None:
            return True
        return await self.owner_entitled(owner_id, key, today=today)

    async def effective(self, owner_id: uuid.UUID, key: str, *, today: date | None = None) -> bool:
        """The global flag is the master switch; the owner's entitlement sits under it."""
        flags = await FeatureFlagService(self.db).as_map()
        if not flags.get(key, True):
            return False
        return await self.owner_entitled(owner_id, key, today=today)

    async def owner_overview(self, owner_id: uuid.UUID, *, today: date | None = None) -> list[Entitlement]:
        return [await self.state(owner_id, key, today=today) for key in SELLABLE_KEYS]

    async def monthly_total_pkr(self, owner_id: uuid.UUID, *, today: date | None = None) -> int:
        """What this owner is billed per month right now: the signed-up price of every feature they have switched on and
        have not cancelled or let lapse (a cancelled one stays out of the total even while it still works)."""
        today = today or pkt_today()
        rows = (await self.db.execute(select(OwnerFeature).where(OwnerFeature.owner_id == owner_id))).scalars().all()
        total = 0
        for r in rows:
            if r.status == OwnerFeatureStatus.CANCELLED.value or not r.auto_renew:
                continue
            if r.paid_through is not None and today > r.paid_through + self.grace():
                continue  # lapsed
            total += r.price_pkr
        return total

    # ---- what to tell the owner -------------------------------------------------------------------------------------------

    async def billable_rows(self, owner_id: uuid.UUID | None = None) -> list[tuple[OwnerFeature, PremiumFeature]]:
        """The features that are being billed right now: switched on, renewing, and still on sale."""
        catalog = await self.catalog()
        query = select(OwnerFeature).where(
            OwnerFeature.auto_renew.is_(True), OwnerFeature.status != OwnerFeatureStatus.CANCELLED.value
        )
        if owner_id is not None:
            query = query.where(OwnerFeature.owner_id == owner_id)
        rows = (await self.db.execute(query.order_by(OwnerFeature.feature_key))).scalars().all()
        return [(r, catalog[r.feature_key]) for r in rows if r.feature_key in catalog and catalog[r.feature_key].is_sellable]

    def notice_for(self, row: OwnerFeature, label: str, today: date) -> PremiumNotice | None:
        """The banner for one feature today, or None when there is nothing to say yet."""
        end = self.covered_until(row)
        grace_end = end + self.grace()
        if today > grace_end:
            return PremiumNotice("off", row.feature_key, label, f"{label} is switched off because payment is overdue. Pay your invoice to turn it back on straight away.")
        if today > end:
            return PremiumNotice("urgent", row.feature_key, label, f"{label}: payment is overdue. It keeps working until {_fmt(grace_end)}, then switches off. Pay your invoice now.")
        if (end - today).days <= RENEWAL_NOTICE_DAYS:
            ending = "free trial ends" if row.paid_through is None or row.paid_through < self.trial_last_day(row) else "paid period ends"
            return PremiumNotice("info", row.feature_key, label, f"{label}: your {ending} on {_fmt(end)}. Pay your invoice to keep it.")
        return None

    async def notices(self, owner_id: uuid.UUID, *, today: date | None = None) -> list[PremiumNotice]:
        """Banners for the owner dashboard. Empty while billing is not enforced. A feature the owner cancelled gets none
        (they chose to leave). Wording is ready-made here so both apps say the same thing."""
        today = today or pkt_today()
        if not await self.enforced():
            return []
        out = []
        for row, feature in await self.billable_rows(owner_id):
            notice = self.notice_for(row, feature.label, today)
            if notice is not None:
                out.append(notice)
        return out
