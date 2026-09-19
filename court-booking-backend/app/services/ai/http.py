"""Shared HTTP call helper for every AIProvider (Section 21 Part B.3).

All three providers made their own `httpx.AsyncClient(...).post(...)` calls
with no retry at all -- a single dropped connection or a transient 5xx/429
from the vendor would surface straight to the user-facing chat/OCR request
as a hard failure. Retrying on those makes sense; retrying a 400 (bad
request shape) or 401 (bad API key) does not, since neither will ever
succeed on a second attempt -- it would just add latency for nothing.
Centralized here (rather than duplicated per provider, the way the
now-superseded per-provider `httpx.AsyncClient` blocks were) so retry
behavior can't drift between claude/gemini/openai_provider.py.
"""

import httpx
import structlog
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

logger = structlog.get_logger(__name__)


def is_retryable_error(exc: BaseException) -> bool:
    """Timeouts, network errors, 429 (rate limit), and 5xx are worth a
    retry. Any other HTTPStatusError (400, 401, 403, 404, ...) is a client
    error that will fail identically on retry."""
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        return status_code == 429 or status_code >= 500
    return isinstance(exc, (httpx.TimeoutException, httpx.NetworkError))


def _log_before_sleep(retry_state) -> None:
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    logger.warning(
        "ai_provider.http_retry",
        attempt=retry_state.attempt_number,
        error=repr(exc),
    )


@retry(
    retry=retry_if_exception(is_retryable_error),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    reraise=True,
    before_sleep=_log_before_sleep,
)
async def post_json(url: str, *, headers: dict | None = None, json: dict, timeout: float = 30) -> dict:
    """POST, raise_for_status, and parse JSON -- with the retry policy
    above. `reraise=True` so a caller sees the original httpx exception
    (e.g. can inspect `exc.response.status_code`) rather than tenacity's
    own `RetryError` wrapper once attempts are exhausted."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=json)
        response.raise_for_status()
        return response.json()
