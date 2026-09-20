"""Firebase Cloud Messaging (HTTP v1) sender.

Speaks FCM's REST API directly via `httpx`, like the WhatsApp adapter and the AI
providers -- no `firebase-admin` / `google-auth` dependency. The one thing FCM v1
needs beyond a plain bearer token is an OAuth2 access token minted from the
Firebase service-account JSON: sign a short-lived RS256 JWT with the account's
private key (python-jose, already a dependency) and trade it at Google's token
endpoint for a ~1h access token, which is cached per process.

`FCM_SERVICE_ACCOUNT_KEY` may be the raw service-account JSON or that same JSON
base64-encoded. Base64 is what production uses: it survives `.env` files and SSM
without any quoting trouble (the JSON's private key contains `\\n` escapes).

Push is best-effort everywhere in this app -- `send_push` never raises.
"""

import asyncio
import base64
import binascii
import json
import time
from enum import Enum

import httpx
import structlog
from jose import JOSEError, jwt

logger = structlog.get_logger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
FCM_SEND_URL = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"

# Must match the channel the mobile app creates (apps/mobile/lib/push-notifications.ts).
# On Android 8+ a notification naming a channel that doesn't exist is silently dropped
# on some OEMs, so the two sides have to agree on this id.
ANDROID_CHANNEL_ID = "default"

# Refresh the access token this many seconds before Google says it expires.
_TOKEN_EXPIRY_MARGIN = 60


class PushOutcome(str, Enum):
    SENT = "sent"
    # FCM says the device token is dead (app uninstalled, token rotated): the caller
    # should stop sending to it.
    UNREGISTERED = "unregistered"
    FAILED = "failed"
    SKIPPED = "skipped"  # no usable credentials configured


class _ServiceAccount:
    def __init__(self, info: dict) -> None:
        self.project_id: str = info["project_id"]
        self.client_email: str = info["client_email"]
        self.private_key: str = info["private_key"]
        self.token_uri: str = info.get("token_uri") or DEFAULT_TOKEN_URI


def load_service_account(raw: str) -> _ServiceAccount | None:
    """Parse FCM_SERVICE_ACCOUNT_KEY (raw JSON or base64 of it). None if blank or invalid."""
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        text = raw if raw.startswith("{") else base64.b64decode(raw, validate=True).decode()
        info = json.loads(text)
        return _ServiceAccount(info)
    except (ValueError, KeyError, TypeError, binascii.Error):
        # Never log the value -- it contains a private key.
        logger.error("push.bad_credentials", hint="FCM_SERVICE_ACCOUNT_KEY is not a valid service-account JSON")
        return None


# client_email -> (access_token, expires_at epoch seconds). Process-wide so the
# short-lived NotificationService instances (one per request/job) share one token.
_token_cache: dict[str, tuple[str, float]] = {}
_token_lock = asyncio.Lock()


async def _access_token(client: httpx.AsyncClient, account: _ServiceAccount, *, force: bool = False) -> str:
    async with _token_lock:
        cached = _token_cache.get(account.client_email)
        if cached and not force and cached[1] - _TOKEN_EXPIRY_MARGIN > time.time():
            return cached[0]

        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": account.client_email,
                "scope": FCM_SCOPE,
                "aud": account.token_uri,
                "iat": now,
                "exp": now + 3600,
            },
            account.private_key,
            algorithm="RS256",
        )
        resp = await client.post(
            account.token_uri,
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        )
        resp.raise_for_status()
        body = resp.json()
        token = body["access_token"]
        _token_cache[account.client_email] = (token, time.time() + int(body.get("expires_in", 3600)))
        return token


def _is_dead_token(resp: httpx.Response) -> bool:
    """FCM's 'this device token will never work again' responses.

    A plain 404 / UNREGISTERED is unambiguous. A malformed token comes back as 400
    INVALID_ARGUMENT, which is *also* what a bad payload looks like, so only treat
    that as dead when the message is about the registration token itself.
    """
    if resp.status_code == 404:
        return True
    try:
        error = resp.json().get("error", {})
    except ValueError:
        return False
    if any(d.get("errorCode") == "UNREGISTERED" for d in error.get("details", []) if isinstance(d, dict)):
        return True
    return resp.status_code == 400 and "registration token" in str(error.get("message", "")).lower()


async def send_push(
    service_account_key: str, token: str, title: str, body: str, data: dict[str, str] | None = None
) -> PushOutcome:
    account = load_service_account(service_account_key)
    if account is None:
        logger.info("push.skipped", reason="no_credentials")
        return PushOutcome.SKIPPED

    message = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            # FCM data values must all be strings.
            "data": {k: str(v) for k, v in (data or {}).items()},
            "android": {"priority": "HIGH", "notification": {"channel_id": ANDROID_CHANNEL_ID}},
        }
    }
    url = FCM_SEND_URL.format(project_id=account.project_id)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            for attempt in (1, 2):
                access_token = await _access_token(client, account, force=attempt == 2)
                resp = await client.post(url, headers={"Authorization": f"Bearer {access_token}"}, json=message)
                # A 401 means the cached access token went stale early -- mint a fresh one
                # and try exactly once more.
                if resp.status_code == 401 and attempt == 1:
                    continue
                break

        if resp.is_success:
            return PushOutcome.SENT
        if _is_dead_token(resp):
            logger.info("push.token_unregistered")
            return PushOutcome.UNREGISTERED
        # Body is FCM's own error object (no secrets); it's what tells you *why*, e.g.
        # SENDER_ID_MISMATCH (token belongs to a different Firebase project) or
        # PERMISSION_DENIED (Firebase Cloud Messaging API not enabled).
        logger.warning("push.rejected", status=resp.status_code, response=resp.text[:500])
        return PushOutcome.FAILED
    except (httpx.HTTPError, JOSEError, ValueError, KeyError):
        logger.warning("push.failed", exc_info=True)
        return PushOutcome.FAILED
