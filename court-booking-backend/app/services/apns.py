"""Apple Push Notification service (APNs) sender, for iOS device tokens.

Why this exists next to fcm.py: on iOS the mobile app's `getDevicePushTokenAsync()`
returns a raw *APNs* token, which FCM's HTTP API rejects (FCM needs a registration
token from the Firebase iOS SDK). Rather than add that native SDK to the app, iOS
tokens are sent straight to Apple here, and Android tokens keep going through FCM.

Same style as fcm.py: plain `httpx` (APNs requires HTTP/2, hence `httpx[http2]`),
no vendor SDK. Auth is a provider JWT (ES256) signed with the `.p8` key from Apple
Developer -> Keys; Apple wants it refreshed no more than every 20 minutes and no
older than 60, so it is cached for 50.

`APNS_KEY` may be the raw `.p8` contents or that text base64-encoded (production
uses base64 in SSM, same reasoning as FCM_SERVICE_ACCOUNT_KEY). Best-effort like
all push here -- `send_apns` never raises.
"""

import base64
import binascii
import time

import httpx
import structlog
from jose import JOSEError, jwt

from app.config import Settings
from app.services.fcm import PushOutcome

logger = structlog.get_logger(__name__)

APNS_HOST = "https://api.push.apple.com"
APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com"

# Refresh the provider token this often (Apple: not more than every 20 min, not older than 60).
_PROVIDER_TOKEN_TTL = 50 * 60

# (team_id, key_id) -> (jwt, issued_at)
_provider_token_cache: dict[tuple[str, str], tuple[str, float]] = {}


def _load_key(raw: str) -> str | None:
    """The .p8 PEM text from APNS_KEY (raw PEM, PEM with literal `\\n`, or base64). None if blank/invalid."""
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        text = raw if raw.startswith("-----BEGIN") else base64.b64decode(raw, validate=True).decode()
    except (ValueError, binascii.Error):
        logger.error("push.apns_bad_credentials", hint="APNS_KEY is neither a PEM nor base64 of one")
        return None
    text = text.replace("\\n", "\n").strip()
    return text if text.startswith("-----BEGIN") else None


def _provider_token(pem: str, key_id: str, team_id: str, *, force: bool = False) -> str:
    cached = _provider_token_cache.get((team_id, key_id))
    if cached and not force and time.time() - cached[1] < _PROVIDER_TOKEN_TTL:
        return cached[0]
    now = time.time()
    token = jwt.encode({"iss": team_id, "iat": int(now)}, pem, algorithm="ES256", headers={"kid": key_id})
    _provider_token_cache[(team_id, key_id)] = (token, now)
    return token


def _reason(resp: httpx.Response) -> str:
    try:
        return str(resp.json().get("reason", ""))
    except ValueError:
        return ""


async def send_apns(
    settings: Settings, token: str, title: str, body: str, data: dict[str, str] | None = None
) -> PushOutcome:
    pem = _load_key(settings.APNS_KEY)
    if pem is None or not settings.APNS_KEY_ID or not settings.APNS_TEAM_ID:
        logger.info("push.skipped", reason="no_apns_credentials")
        return PushOutcome.SKIPPED

    payload: dict = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}}
    if data:
        # expo-notifications surfaces a natively-sent APNs payload's `body` key as
        # `notification.request.content.data` (the deep-link handler reads it there).
        payload["body"] = {k: str(v) for k, v in data.items()}

    host = APNS_SANDBOX_HOST if settings.APNS_USE_SANDBOX else APNS_HOST
    url = f"{host}/3/device/{token}"

    try:
        async with httpx.AsyncClient(http2=True, timeout=10) as client:
            for attempt in (1, 2):
                jwt_token = _provider_token(pem, settings.APNS_KEY_ID, settings.APNS_TEAM_ID, force=attempt == 2)
                resp = await client.post(
                    url,
                    headers={
                        "authorization": f"bearer {jwt_token}",
                        "apns-topic": settings.APNS_BUNDLE_ID,
                        "apns-push-type": "alert",
                        "apns-priority": "10",
                    },
                    json=payload,
                )
                # A provider token Apple considers expired: mint a fresh one, retry exactly once.
                if resp.status_code == 403 and _reason(resp) == "ExpiredProviderToken" and attempt == 1:
                    continue
                break

        if resp.is_success:
            return PushOutcome.SENT
        reason = _reason(resp)
        # 410 is Apple's unambiguous "this device token is gone" (app uninstalled). Deliberately
        # NOT treating 400 BadDeviceToken the same: it is also what a sandbox/production mix-up
        # returns for every token, and deactivating all iOS tokens over a config mistake would
        # be far worse than retrying a truly bad one.
        if resp.status_code == 410 or reason == "Unregistered":
            logger.info("push.apns_token_unregistered")
            return PushOutcome.UNREGISTERED
        hint = (
            "check APNS_USE_SANDBOX: development-client builds use sandbox, "
            "ad-hoc/TestFlight/App Store builds use production"
            if reason == "BadDeviceToken"
            else None
        )
        logger.warning("push.apns_rejected", status=resp.status_code, reason=reason, hint=hint)
        return PushOutcome.FAILED
    except (httpx.HTTPError, JOSEError, ValueError, KeyError):
        logger.warning("push.apns_failed", exc_info=True)
        return PushOutcome.FAILED
