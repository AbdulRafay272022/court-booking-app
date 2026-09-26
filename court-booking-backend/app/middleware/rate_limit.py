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


class WindowedCounter:
    """A rolling-window per-key event counter, in-process. Unlike FixedWindowCounter
    (minute buckets) this keeps timestamps so it can answer "how many hits in the last
    N seconds" and "how many seconds until the window frees up" -- used for the per-IP
    login-failure lockout (QA #4) and its `retry_after_seconds` (QA #5). Same
    single-worker caveat as everything else here (AUDIT #25)."""

    def __init__(self, window_seconds: int) -> None:
        self.window = window_seconds
        self._events: dict[str, list[float]] = {}

    def _prune(self, key: str, now: float) -> list[float]:
        cutoff = now - self.window
        events = [t for t in self._events.get(key, []) if t >= cutoff]
        if events:
            self._events[key] = events
        else:
            self._events.pop(key, None)
        return events

    def count(self, key: str) -> int:
        return len(self._prune(key, time.time()))

    def hit(self, key: str) -> int:
        now = time.time()
        events = self._prune(key, now)
        events.append(now)
        self._events[key] = events
        return len(events)

    def retry_after_seconds(self, key: str) -> int:
        """Seconds until the OLDEST event in the window ages out (i.e. the count drops)."""
        events = self._prune(key, time.time())
        if not events:
            return 0
        return max(1, int(events[0] + self.window - time.time()) + 1)

    def reset(self, key: str) -> None:
        self._events.pop(key, None)


class DistinctItemWindowCounter:
    """Per-key count of DISTINCT items seen in a rolling window, in-process. Used for
    QA #3: how many distinct phone numbers a single IP/device has had an OTP sent to
    within the window. Recording the same item again only refreshes its timestamp, so
    a legitimate 'resend to the same number' never inflates the count."""

    def __init__(self, window_seconds: int, limit: int) -> None:
        self.window = window_seconds
        # Carried on the instance (not read from settings at the call site) so a test can relax
        # or tighten it via app.state without touching the global settings object.
        self.limit = limit
        self._data: dict[str, dict[str, float]] = {}

    def record(self, key: str, item: str) -> int:
        now = time.time()
        cutoff = now - self.window
        bucket = {k: ts for k, ts in self._data.get(key, {}).items() if ts >= cutoff}
        bucket[item] = now
        self._data[key] = bucket
        return len(bucket)

    def would_exceed(self, key: str, item: str) -> bool:
        """True if sending to `item` from `key` would push distinct count past `self.limit`
        (without recording it). A new item when already at the limit is blocked; an
        already-seen item is always allowed (it's a resend)."""
        now = time.time()
        cutoff = now - self.window
        bucket = {k: ts for k, ts in self._data.get(key, {}).items() if ts >= cutoff}
        if item in bucket:
            return False
        return len(bucket) >= self.limit

    def retry_after_seconds(self, key: str) -> int:
        now = time.time()
        cutoff = now - self.window
        stamps = [ts for ts in self._data.get(key, {}).values() if ts >= cutoff]
        if not stamps:
            return 0
        return max(1, int(min(stamps) + self.window - now) + 1)


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
