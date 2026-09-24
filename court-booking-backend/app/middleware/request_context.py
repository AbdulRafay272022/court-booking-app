import time
import uuid
from collections.abc import Awaitable, Callable

import sentry_sdk
import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

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
        try:
            response = await call_next(request)
        except Exception as exc:  # noqa: BLE001
            # Inner catch-all (Section 32 Part 8 / open items 2 & 8): without this an
            # unhandled 500 escapes to Starlette's outer ServerErrorMiddleware, which
            # returns a bare response that never passes back through CORSMiddleware --
            # so the browser sees a response with no CORS headers and reports it as a
            # network failure ("Can't reach the server"), which has misdiagnosed real
            # 500s before. Returning the standard error envelope HERE (CORS is now the
            # outermost middleware, so this response gets its headers) makes an
            # unexpected 500 show as a real "Something went wrong" instead.
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            sentry_sdk.capture_exception(exc)
            logger.error(
                "request.unhandled_error",
                request_id=request_id,
                user_id=str(request.state.user_id) if request.state.user_id else "anonymous",
                method=request.method,
                endpoint=request.url.path,
                duration_ms=duration_ms,
                exc_info=True,
            )
            response = JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "INTERNAL_ERROR",
                        "message": "Something went wrong. Please try again.",
                        "details": {},
                    }
                },
            )
            response.headers[REQUEST_ID_HEADER] = request_id
            return response
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
