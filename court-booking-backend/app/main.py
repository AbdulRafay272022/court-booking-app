from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import sentry_sdk
import structlog
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health
from app.api.router import api_router
from app.config import get_settings
from app.database import engine
from app.errors import AppError, ErrorCode, fallback_code_for_status
from app.middleware.rate_limit import (
    DistinctItemWindowCounter,
    FixedWindowCounter,
    RateLimitMiddleware,
    WindowedCounter,
)
from app.middleware.request_context import RequestContextMiddleware
from app.services.feature_flag_service import FeatureFlagCache

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    app.state.started_at = datetime.now(timezone.utc)
    logger.info("app.startup")
    yield
    await engine.dispose()
    logger.info("app.shutdown")


def _error_envelope(code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def create_app() -> FastAPI:
    settings = get_settings()

    # A wildcard origin combined with allow_credentials=True is valid
    # (browsers just refuse to honor the wildcard for credentialed
    # requests), but it removes a layer of defense-in-depth other bugs
    # could otherwise be caught by, and nothing here previously stopped it
    # from shipping to production by accident -- see AUDIT_FINDINGS.md
    # finding #10. DEBUG=true (local/dev) is exempt.
    if not settings.DEBUG and settings.ALLOWED_ORIGINS == ["*"]:
        raise RuntimeError(
            "ALLOWED_ORIGINS is still the wildcard default ['*'] with DEBUG=false. "
            "Set an explicit list of allowed origins in the environment before deploying."
        )

    if settings.SENTRY_DSN:
        sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.1)

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        debug=settings.DEBUG,
        lifespan=lifespan,
    )
    app.state.chat_rate_limiter = FixedWindowCounter()
    # QA #4: per-IP/device failed-login lockout (fixes the phone-only lock that let
    # anyone lock a victim out). QA #3: per-IP/device cap on distinct phone numbers
    # an OTP is sent to. Both in-process, one instance per create_app() so every
    # test's app fixture starts empty.
    app.state.login_ip_limiter = WindowedCounter(settings.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60)
    app.state.otp_ip_limiter = DistinctItemWindowCounter(
        settings.OTP_IP_RATE_LIMIT_WINDOW_MINUTES * 60, settings.OTP_IP_MAX_DISTINCT_PHONES
    )
    # Section 32 Part 12: short-TTL cache of the admin feature flags, read by the
    # require_feature() dependency. An admin toggle busts it (single-worker).
    app.state.feature_flag_cache = FeatureFlagCache()

    # Order matters: add_middleware puts the LAST-added one OUTERMOST, so CORS must be
    # added last to wrap everything -- that way even a response produced by an inner
    # middleware's exception catch-all (RequestContextMiddleware, Section 32 Part 8)
    # still passes back out through CORS and gets its headers. An unhandled 500 that
    # skips CORS shows in the browser as a network failure, which has misled us before.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(RateLimitMiddleware, settings=settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        # A custom Pydantic field validator that raises a bare ValueError
        # (e.g. BookingHoldIn's naive-datetime check) has its `ctx.error`
        # populated with the actual exception *instance*, not a string --
        # plain json.dumps chokes on that. jsonable_encoder is what
        # FastAPI's own default handler uses to sanitize this; a raw
        # `exc.errors()` here previously 500'd on any validator like that
        # instead of returning the clean 422 this handler exists for. See
        # AUDIT_FINDINGS.md finding #26.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=_error_envelope(
                ErrorCode.VALIDATION_ERROR, "Request validation failed", {"errors": jsonable_encoder(exc.errors())}
            ),
        )

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content=_error_envelope(exc.code, exc.detail, exc.details)
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        code = fallback_code_for_status(exc.status_code)
        return JSONResponse(status_code=exc.status_code, content=_error_envelope(code, str(exc.detail)))

    app.include_router(health.router)
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    return app


app = create_app()
