import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = structlog.get_logger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Stamps every request/response with a request ID (client-supplied or
    generated) and logs one structured line per request with request_id,
    user_id (set by the auth dependency onto request.state if the caller is
    authenticated, "anonymous" otherwise), endpoint, duration, and status --
    Section 16.2."""

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        request.state.request_id = request_id
        request.state.user_id = None

        start = time.monotonic()
        response = await call_next(request)
        duration_ms = round((time.monotonic() - start) * 1000, 2)

        response.headers[REQUEST_ID_HEADER] = request_id
        logger.info(
            "request.completed",
            request_id=request_id,
            user_id=str(request.state.user_id) if request.state.user_id else "anonymous",
            method=request.method,
            endpoint=request.url.path,
            duration_ms=duration_ms,
            status=response.status_code,
        )
        return response
