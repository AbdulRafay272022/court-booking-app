"""Who may use which premium feature (owner billing, step 1: read-only rules, nothing calls this yet).

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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models.owner_billing import OwnerFeature, OwnerFeatureStatus, PremiumFeature, PremiumFeatureKey
from app.models.venue import Venue
from app.services.feature_flag_service import FeatureFlagService
from app.utils.timezone import pkt_today, utc_to_pkt_naive

ENFORCEMENT_FLAG = "owner_billing_enforced"
SELLABLE_KEYS = tuple(k.value for k in PremiumFeatureKey)


@dataclass(frozen=True)
class Entitlement:
    key: str
    entitled: bool
    # not_billed | not_enforced | trial | paid | grace | lapsed | unpaid | not_purchased
    reason: str
    until: date | None = None  # the last day the feature works (trial end, paid-through, or end of grace)


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

        grace = timedelta(days=self.settings.OWNER_BILLING_GRACE_DAYS)
        row = await self.db.scalar(
            select(OwnerFeature).where(OwnerFeature.owner_id == owner_id, OwnerFeature.feature_key == key)
        )
        if row is None:
            return Entitlement(key, False, "not_purchased")
        paid_through = row.paid_through
        trial_end = self.trial_last_day(row)

        # the day-by-day picture, best case first
        if today <= trial_end:
            return Entitlement(key, True, "trial", max(d for d in (trial_end, paid_through) if d is not None))
        if paid_through is None:
            return Entitlement(key, False, "unpaid")
        if today <= paid_through:
            return Entitlement(key, True, "paid", paid_through)
        if today <= paid_through + grace:
            return Entitlement(key, True, "grace", paid_through + grace)
        return Entitlement(key, False, "lapsed", paid_through + grace)

    async def owner_entitled(self, owner_id: uuid.UUID, key: str, *, today: date | None = None) -> bool:
        return (await self.state(owner_id, key, today=today)).entitled

    async def venue_entitled(self, venue_id: uuid.UUID, key: str, *, today: date | None = None) -> bool:
        owner_id = await self.db.scalar(select(Venue.owner_id).where(Venue.id == venue_id))
        if owner_id is None:
            return True  # an unknown venue is somebody else's problem; never block on it
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
        grace = timedelta(days=self.settings.OWNER_BILLING_GRACE_DAYS)
        rows = (await self.db.execute(select(OwnerFeature).where(OwnerFeature.owner_id == owner_id))).scalars().all()
        total = 0
        for r in rows:
            if r.status == OwnerFeatureStatus.CANCELLED.value or not r.auto_renew:
                continue
            if r.paid_through is not None and today > r.paid_through + grace:
                continue  # lapsed
            total += r.price_pkr
        return total
