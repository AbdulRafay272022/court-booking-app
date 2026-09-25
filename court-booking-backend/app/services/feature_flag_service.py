"""Admin global feature flags (Section 32 Part 12, Layer 1).

Flags live in the `feature_flags` table and are read at the point of use so an
admin can flip one with no redeploy. Two read paths:

- Endpoints gate with the `require_feature(key)` dependency (app/dependencies.py),
  which reads through a short-TTL cache on `app.state` so a gated endpoint isn't a
  DB hit every request. An admin toggle busts that cache, so the change is
  effectively immediate app-wide (single-worker deployment -- same assumption as
  the rate limiter; see CLAUDE.md finding #25).
- Services (AI chat, auto-approve, notifications, jobs...) construct
  `FeatureFlagService(self.db)` with NO cache and read fresh from the DB. Those
  aren't hot loops and correctness-over-a-few-ms matters more there.

A missing row is treated as ON (fail-open) so adding a new flag key in code before
its seed row exists can never silently disable a live feature.
"""
import time

from sqlalchemy import select

from app.errors import AppError, ErrorCode
from app.models.feature_flag import FeatureFlag


async def flag_on(db, key: str) -> bool:
    """Convenience for service-layer points of use: read a flag fresh from the DB
    (no cache -- correctness over a millisecond, these aren't hot loops)."""
    return await FeatureFlagService(db).is_on(key)


class FeatureFlagCache:
    """In-process TTL cache of {key: enabled}. Lives on app.state; a write busts
    it so an admin toggle takes effect on the next request. Per-process only
    (single-worker deployment)."""

    def __init__(self, ttl_seconds: float = 10.0) -> None:
        self._ttl = ttl_seconds
        self._data: dict[str, bool] | None = None
        self._fetched_at: float = 0.0

    def get(self) -> dict[str, bool] | None:
        if self._data is None or (time.monotonic() - self._fetched_at) > self._ttl:
            return None
        return self._data

    def set(self, data: dict[str, bool]) -> None:
        self._data = data
        self._fetched_at = time.monotonic()

    def invalidate(self) -> None:
        self._data = None


class FeatureFlagService:
    def __init__(self, db, cache: FeatureFlagCache | None = None) -> None:
        self.db = db
        self.cache = cache

    async def _load(self) -> dict[str, bool]:
        if self.cache is not None:
            cached = self.cache.get()
            if cached is not None:
                return cached
        rows = (await self.db.execute(select(FeatureFlag.key, FeatureFlag.enabled))).all()
        data = {key: enabled for key, enabled in rows}
        if self.cache is not None:
            self.cache.set(data)
        return data

    async def is_on(self, key: str) -> bool:
        data = await self._load()
        return data.get(key, True)  # fail-open

    async def all_on(self) -> set[str]:
        """The set of currently-enabled flag keys (used to filter which staff
        permissions an owner may grant)."""
        data = await self._load()
        return {k for k, enabled in data.items() if enabled}

    async def as_map(self) -> dict[str, bool]:
        return await self._load()

    async def list_flags(self) -> list[FeatureFlag]:
        rows = (await self.db.execute(select(FeatureFlag).order_by(FeatureFlag.key))).scalars().all()
        return list(rows)

    async def set_flag(self, key: str, enabled: bool, admin_user_id) -> FeatureFlag:
        flag = await self.db.get(FeatureFlag, key)
        if flag is None:
            raise AppError(404, ErrorCode.FEATURE_FLAG_NOT_FOUND, f"Unknown feature flag: {key}")
        flag.enabled = enabled
        flag.updated_by_user_id = admin_user_id
        await self.db.commit()
        await self.db.refresh(flag)
        if self.cache is not None:
            self.cache.invalidate()
        return flag
