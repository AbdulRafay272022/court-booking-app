"""Resolve the real client IP for the per-IP throttles (QA re-test C).

In production the app sits behind the host nginx, which terminates TLS and proxies to the
container. nginx sets `X-Real-IP` to the actual connecting client (`$remote_addr`) and OVERWRITES
any client-supplied value, so it is not spoofable; `X-Forwarded-For` gets the real IP appended as
its LAST hop by `$proxy_add_x_forwarded_for`. We prefer `X-Real-IP`, then the last `X-Forwarded-For`
hop, and finally `request.client.host` (local dev, or the ASGI test client). Relying on this header
directly means the throttles don't depend on uvicorn's version-specific X-Forwarded-For parsing.
"""

from starlette.requests import Request


def client_ip(request: Request) -> str | None:
    real = request.headers.get("x-real-ip")
    if real and real.strip():
        return real.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # The last hop is the one nginx appended (the true peer it saw); earlier hops are
        # client-supplied and untrusted.
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return request.client.host if request.client else None
