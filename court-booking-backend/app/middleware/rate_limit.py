import time
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import Settings
from app.errors import ErrorCode

EXEMPT_PREFIXES = ("/health",)


class FixedWindowCounter:
    """A minute-granularity per-key hit counter, in-process. Shared by the
    global per-IP middleware below and any per-user limiter (e.g. chat,
    see app/api/chat.py) that needs the same fixed-window bucket logic
    keyed differently. In-process means no shared store across workers --
    see AUDIT_FINDINGS.md finding #25 for why that matters if/when this
    deployment goes multi-worker; each instance should be created once per
    `create_app()` call (an attribute on the middleware, or on `app.state`)
    so a fresh app -- every test's `app` fixture included -- starts with an
    empty counter instead of accumulating across the whole process."""

    def __init__(self) -> None:
        self._buckets: dict[str, tuple[int, int]] = {}

    def hit(self, key: str) -> int:
        """Records one hit for `key` in the current one-minute window and
        returns the count so far in that window (including this hit)."""
        window = int(time.time() // 60)
        bucket_window, count = self._buckets.get(key, (window, 0))
        if bucket_window != window:
            bucket_window, count = window, 0
        count += 1
        self._buckets[key] = (bucket_window, count)
        return count


class RateLimitMiddleware(BaseHTTPMiddleware):
    """A simple global per-IP fixed-window limiter (Section 16.2:
    "global (1000 req/min per IP)"). Per-endpoint OTP limiting is a separate,
    tighter rule already enforced at the service layer (AuthService.request_otp,
    keyed by phone rather than IP -- an IP-based limiter can't see the phone
    number in the request body without parsing it, and phone is the identity
    that actually matters there).

    State lives on the middleware instance, which Starlette constructs once
    per `add_middleware` call -- i.e. once per `create_app()` call, so a
    fresh app (as every test's `app` fixture creates) starts with an empty
    counter rather than accumulating across the whole test session.
    """

    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self.limit = settings.RATE_LIMIT_PER_MINUTE
        self._counter = FixedWindowCounter()

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.url.path.startswith(EXEMPT_PREFIXES):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        count = self._counter.hit(client_ip)

        if count > self.limit:
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": ErrorCode.RATE_LIMITED,
                        "message": "Too many requests. Please slow down.",
                        "details": {"limit_per_minute": self.limit},
                    }
                },
            )

        return await call_next(request)
