"""Web Push sender (Round 2 Stage 2, docs/web-push-plan.md section 5).

No pywebpush: RFC 8291 `aes128gcm` payload encryption and RFC 8292 VAPID (ES256 JWT) are done here with
`cryptography` and `httpx`, the same style as `fcm.py`. Best-effort like FCM: `send_web_push` never raises.

Encryption (RFC 8291 section 3.4 / RFC 8188):
    ecdh_secret = ECDH(as_private, ua_public)
    IKM   = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\\0" || ua_public || as_public, L=32)
    PRK   = HMAC-SHA256(salt, IKM)
    CEK   = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\\0", 16)
    NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce\\0", 12)
    body  = salt(16) || rs(4) || idlen(1)=65 || as_public(65) || AES-128-GCM(CEK, NONCE, plaintext || 0x02)
Verified against the RFC 8291 Appendix A test vector (tests/test_stage2_web_push.py).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlsplit

import httpx
import structlog
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = structlog.get_logger(__name__)

RECORD_SIZE = 4096
MAX_PAYLOAD_BYTES = 3993  # 4096 - 86 header - 16 tag - 1 delimiter
TTL_SECONDS = 3600
TIMEOUT_SECONDS = 5.0
MAX_RETRY_AFTER = 5.0
VAPID_EXP_SECONDS = 12 * 3600

# Allow-list of real push services (plan section 4): the SERVER later POSTs to the endpoint, so an open field would be
# a request-forgery hole.
ALLOWED_HOSTS = ("fcm.googleapis.com",)
ALLOWED_HOST_SUFFIXES = (".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com")

HIGH_URGENCY_EVENTS = {
    "payment_submitted",
    "refund_owed",
    "payment_reminder",
    "payment_final_warning",
    "owner_payment_auto_cancelled",
}

# event_type -> page (the same map the web bell uses).
EVENT_URLS: dict[str, str] = {
    "payment_submitted": "/dashboard/owner/approvals",
    "late_payment_proof": "/dashboard/owner/approvals",
    "owner_player_cancelled": "/dashboard/owner/approvals",
    "payment_final_warning": "/dashboard/owner/approvals",
    "owner_payment_auto_cancelled": "/dashboard/owner/approvals",
    "refund_owed": "/dashboard/owner/refunds",
    "booking_confirmed": "/bookings",
    "booking_cancelled": "/bookings",
    "booking_reminder": "/bookings",
    "hold_expiring": "/bookings",
    "payment_rejected": "/bookings",
    "refund_paid": "/bookings",
    "owner_new_booking": "/dashboard/owner/today",
    "venue_approved": "/dashboard/owner/today",
    "venue_rejected": "/dashboard/owner/today",
    "venue_changes_requested": "/dashboard/owner/today",
    "owner_daily_digest": "/dashboard/owner/today",
}


class WebPushOutcome(str, Enum):
    SENT = "sent"
    UNREGISTERED = "unregistered"  # 404 / 410: the subscription is gone, revoke it
    FAILED = "failed"
    SKIPPED = "skipped"  # keys not configured


@dataclass
class WebPushResult:
    outcome: WebPushOutcome
    status_code: int | None = None
    error: str | None = None


def b64url_decode(value: str) -> bytes:
    value = value.strip()
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def url_for_event(event_type: str) -> str:
    if event_type.startswith("payment_reminder"):
        return "/dashboard/owner/approvals"
    return EVENT_URLS.get(event_type, "/")


def endpoint_allowed(endpoint: str) -> bool:
    """https only, no credentials, default port, host in the push-service allow-list (no IP literals)."""
    try:
        parts = urlsplit(endpoint)
    except ValueError:
        return False
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return False
    try:
        if parts.port not in (None, 443):
            return False
    except ValueError:
        return False
    host = parts.hostname.lower().rstrip(".")
    return host in ALLOWED_HOSTS or any(host.endswith(s) and len(host) > len(s) for s in ALLOWED_HOST_SUFFIXES)


def _hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    # One HMAC block is enough for every length used here (<= 32).
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    return _hkdf_expand(prk, info, length)


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def private_key_from_b64(raw_b64: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(b64url_decode(raw_b64), "big"), ec.SECP256R1())


def encrypt_payload(
    plaintext: bytes,
    ua_public_b64: str,
    auth_secret_b64: str,
    *,
    as_private: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """RFC 8291 aes128gcm body for one push message (single record). `as_private`/`salt` are injectable only for the
    RFC test vector; production generates fresh ones per message."""
    ua_public = b64url_decode(ua_public_b64)
    auth_secret = b64url_decode(auth_secret_b64)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    as_private = as_private or ec.generate_private_key(ec.SECP256R1())
    as_public = _public_bytes(as_private.public_key())
    salt = salt or os.urandom(16)

    ecdh_secret = as_private.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, ecdh_secret, b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + ciphertext


def decrypt_payload(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth_secret_b64: str) -> bytes:
    """The browser side of encrypt_payload (tests only: round-trip check)."""
    salt, idlen = body[:16], body[20]
    as_public = body[21 : 21 + idlen]
    ciphertext = body[21 + idlen :]
    ua_public = _public_bytes(ua_private.public_key())
    as_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    ecdh_secret = ua_private.exchange(ec.ECDH(), as_key)
    ikm = _hkdf(b64url_decode(auth_secret_b64), ecdh_secret, b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    padded = AESGCM(cek).decrypt(nonce, ciphertext, None)
    return padded[: padded.rindex(b"\x02")]


def vapid_jwt(endpoint: str, private_b64: str, subject: str, now: int | None = None) -> str:
    """RFC 8292: ES256 JWT, aud = the endpoint's origin, exp <= 24 h (12 h here), sub = mailto:/https: contact."""
    parts = urlsplit(endpoint)
    claims = {"aud": f"{parts.scheme}://{parts.netloc}", "exp": int(now or time.time()) + VAPID_EXP_SECONDS, "sub": subject}
    header = {"typ": "JWT", "alg": "ES256"}
    signing_input = (
        b64url_encode(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64url_encode(json.dumps(claims, separators=(",", ":")).encode())
    )
    der = private_key_from_b64(private_b64).sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return signing_input + "." + b64url_encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def keys_configured(settings) -> bool:
    return bool(settings.WEB_PUSH_VAPID_PRIVATE_KEY and settings.WEB_PUSH_VAPID_PUBLIC_KEY and settings.WEB_PUSH_VAPID_SUBJECT)


def topic_for(event_type: str, reference_id: str | None) -> str:
    """Topic header (<= 32 url-safe chars): a repeat of the same event + reference replaces instead of stacking."""
    return b64url_encode(hashlib.sha256(f"{event_type}:{reference_id or ''}".encode()).digest())[:32]


def build_payload(event_type: str, title: str, body: str, reference_id: str | None) -> bytes:
    data = {
        "title": title,
        "body": body,
        "url": url_for_event(event_type),
        "tag": f"{event_type}:{reference_id}" if reference_id else event_type,
        "event_type": event_type,
    }
    raw = json.dumps(data, ensure_ascii=False).encode()
    if len(raw) > MAX_PAYLOAD_BYTES:
        data["body"] = body[: max(0, len(body) - (len(raw) - MAX_PAYLOAD_BYTES) - 3)] + "..."
        raw = json.dumps(data, ensure_ascii=False).encode()
    return raw


async def send_web_push(
    settings,
    *,
    endpoint: str,
    p256dh: str,
    auth: str,
    payload: bytes,
    urgency: str = "normal",
    topic: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> WebPushResult:
    """POST one encrypted message. 201 -> SENT; 404/410 -> UNREGISTERED; 400/401/403/413 -> FAILED (no retry);
    429/5xx/timeout -> ONE retry (Retry-After honoured up to 5 s), then FAILED. Missing keys -> SKIPPED."""
    if not keys_configured(settings):
        return WebPushResult(WebPushOutcome.SKIPPED, error="web_push keys not configured")
    try:
        body = encrypt_payload(payload, p256dh, auth)
        token = vapid_jwt(endpoint, settings.WEB_PUSH_VAPID_PRIVATE_KEY, settings.WEB_PUSH_VAPID_SUBJECT)
    except Exception as exc:  # noqa: BLE001 -- bad subscription keys must never raise
        logger.warning("web_push.encrypt_failed", error=type(exc).__name__)
        return WebPushResult(WebPushOutcome.FAILED, error=f"web_push encrypt failed ({type(exc).__name__})")
    headers = {
        "Authorization": f"vapid t={token}, k={settings.WEB_PUSH_VAPID_PUBLIC_KEY}",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(TTL_SECONDS),
        "Urgency": urgency,
    }
    if topic:
        headers["Topic"] = topic

    own_client = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
    try:
        for attempt in (1, 2):
            try:
                resp = await client.post(endpoint, content=body, headers=headers)
            except httpx.HTTPError as exc:
                if attempt == 1:
                    continue
                return WebPushResult(WebPushOutcome.FAILED, error=f"web_push failed ({type(exc).__name__})")
            code = resp.status_code
            if code in (200, 201, 202):
                return WebPushResult(WebPushOutcome.SENT, code)
            if code in (404, 410):
                return WebPushResult(WebPushOutcome.UNREGISTERED, code, f"web_push gone ({code})")
            if code == 429 or code >= 500:
                if attempt == 1:
                    try:
                        wait = min(float(resp.headers.get("Retry-After", "0") or 0), MAX_RETRY_AFTER)
                    except ValueError:
                        wait = 0.0
                    if wait > 0:
                        await asyncio.sleep(wait)
                    continue
                return WebPushResult(WebPushOutcome.FAILED, code, f"web_push failed ({code})")
            if code in (400, 401, 403):
                logger.error("web_push.rejected", status=code)
            return WebPushResult(WebPushOutcome.FAILED, code, f"web_push failed ({code})")
        return WebPushResult(WebPushOutcome.FAILED, error="web_push failed")
    finally:
        if own_client:
            await client.aclose()
