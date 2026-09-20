import asyncio
import hashlib
import hmac
import secrets
import string
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


def generate_otp(length: int = 6) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))


def hash_otp(code: str) -> str:
    """Plain SHA-256, not a slow password hash: a 6-digit OTP has ~20 bits of
    entropy regardless of the hash function, and it's already dead in 5
    minutes. The real protection is the 5-minute expiry, the 5-attempt cap,
    and the 5-request/15-minute rate limit -- not hash cost."""
    return hashlib.sha256(code.encode()).hexdigest()


def verify_otp(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(code), code_hash)


def generate_session_token() -> str:
    """Opaque, high-entropy bearer token. Only its hash is persisted."""
    return secrets.token_urlsafe(32)


def hash_token(token: str, secret: str) -> str:
    """HMAC-SHA256 so a stolen DB row can't be replayed to derive a valid token."""
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()


def token_expiry(*, hours: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --- Passwords -------------------------------------------------------------
# argon2id, a real password hash. Deliberately NOT app/utils/encryption.py's
# Fernet (that is reversible encryption for data we must read back, e.g. bank
# details) and NOT the plain SHA-256 used for OTPs above (fine for a 5-minute,
# attempt-capped 6-digit code; catastrophic for a password someone reuses).
_hasher = PasswordHasher()

# Verified against when the phone doesn't exist, so "unknown phone" and "wrong
# password" cost the same time and can't be told apart by latency.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


async def hash_password(password: str) -> str:
    # argon2 is deliberately CPU-heavy (tens of ms); off the event loop, same
    # lesson as the boto3 finding (#8) -- one slow login must not stall everyone.
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password: str, password_hash: str | None) -> bool:
    """False (never raises) for a wrong password, a malformed hash, or None
    (in which case a dummy hash is still checked, purely to spend the time)."""

    def _check() -> bool:
        try:
            return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
        except (VerificationError, InvalidHashError):
            return False

    return await asyncio.to_thread(_check)
