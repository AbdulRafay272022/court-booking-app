import hashlib
import hmac
import secrets
import string
from datetime import datetime, timedelta, timezone


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


def token_expiry(days: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
