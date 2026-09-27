from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.database import get_db
from app.errors import AppError, ErrorCode
from app.models.user import User, UserRole
from app.services.auth_service import AuthService
from app.services.feature_flag_service import FeatureFlagService

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def get_feature_flag_service(request: Request, db: DbSession) -> FeatureFlagService:
    """A FeatureFlagService bound to the app.state cache (endpoints read through
    the cache; services that hold their own db read uncached for freshness)."""
    cache = getattr(request.app.state, "feature_flag_cache", None)
    return FeatureFlagService(db, cache)


FeatureFlags = Annotated[FeatureFlagService, Depends(get_feature_flag_service)]


def require_feature(key: str) -> Callable[..., None]:
    """Endpoint gate: 403 FEATURE_DISABLED when the admin has globally turned the
    feature off. Applied to endpoints that only make sense when the feature is on;
    the matching UI must also hide the entry point so nobody dead-ends here."""

    async def dependency(flags: FeatureFlags) -> None:
        if not await flags.is_on(key):
            raise AppError(
                status.HTTP_403_FORBIDDEN,
                ErrorCode.FEATURE_DISABLED,
                "This feature is currently unavailable.",
            )

    return dependency


async def get_current_user(
    request: Request,
    db: DbSession,
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> User:
    if credentials is None:
        # QA #11: no Authorization header at all is NOT_AUTHENTICATED. SESSION_EXPIRED is
        # reserved for a token that existed and expired/was revoked (the branch below).
        raise AppError(
            status.HTTP_401_UNAUTHORIZED,
            ErrorCode.NOT_AUTHENTICATED,
            "Not authenticated",
        )
    auth_service = AuthService(db, settings)
    user = await auth_service.get_user_from_token(credentials.credentials)
    if user is None:
        raise AppError(
            status.HTTP_401_UNAUTHORIZED, ErrorCode.SESSION_EXPIRED, "Invalid or expired session"
        )
    # Picked up by RequestContextMiddleware's structured request log.
    request.state.user_id = user.id
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_optional_current_user(
    request: Request,
    db: DbSession,
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> User | None:
    """For public-but-role-aware endpoints: a venue's own owner or an admin
    sees more (e.g. bank_details) than an anonymous visitor, but a missing or
    invalid token isn't an error here -- it just means "anonymous"."""
    if credentials is None:
        return None
    auth_service = AuthService(db, settings)
    user = await auth_service.get_user_from_token(credentials.credentials)
    if user is not None:
        request.state.user_id = user.id
    return user


OptionalCurrentUser = Annotated[User | None, Depends(get_optional_current_user)]


def require_roles(*roles: UserRole) -> Callable[[CurrentUser], User]:
    def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise AppError(
                status.HTTP_403_FORBIDDEN,
                ErrorCode.FORBIDDEN,
                "You do not have permission to perform this action",
            )
        return user

    return dependency


RequireOwner = Annotated[User, Depends(require_roles(UserRole.OWNER, UserRole.ADMIN))]
RequireAdmin = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
# Section 32 Part 12: shared owner-action endpoints that a STAFF account may also
# reach. The role gate only lets STAFF past; the per-action permission is then
# enforced in the service layer (require_owned_venue / require_accessible_booking
# with a `permission=`). Owner-only endpoints keep RequireOwner so staff can never
# create venues, edit bank details, or manage other staff.
RequireStaffCapable = Annotated[User, Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF))]


async def enforce_chat_rate_limit(request: Request, user: CurrentUser, settings: AppSettings) -> None:
    """Per-user limit on POST /chat/message -- each turn is a real paid AI
    call, so the blanket per-IP RateLimitMiddleware isn't tight enough on
    its own (see AUDIT_FINDINGS.md finding #11). Keyed by user id, not IP,
    same reasoning as OTP's own per-phone limit."""
    limiter = request.app.state.chat_rate_limiter
    count = limiter.hit(str(user.id))
    if count > settings.CHAT_RATE_LIMIT_PER_MINUTE:
        raise AppError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            ErrorCode.RATE_LIMITED,
            "Too many chat messages. Please slow down.",
        )


ChatRateLimit = Annotated[None, Depends(enforce_chat_rate_limit)]


class Pagination:
    def __init__(self, page: int = 1, page_size: int = 20) -> None:
        self.page = max(page, 1)
        self.page_size = min(max(page_size, 1), 100)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


PageParams = Annotated[Pagination, Depends(Pagination)]
