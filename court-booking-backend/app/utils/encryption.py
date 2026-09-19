import base64
import hashlib
import json

import structlog
from cryptography.fernet import Fernet

from app.config import Settings

ENCRYPTED_MARKER = "_encrypted"

logger = structlog.get_logger(__name__)


def _fernet(settings: Settings) -> Fernet:
    """Fernet needs a 32-byte url-safe base64 key; derive one from a plain
    secret so operators don't have to generate/manage a separate key by hand.

    In production this key should be envelope-encrypted at rest via KMS
    (i.e. BANK_DETAILS_ENCRYPTION_KEY itself comes from a KMS-decrypted data
    key, not a bare env var) -- that plumbing is infra-specific and out of
    scope here, but this is the seam where it plugs in.

    Falling back to SESSION_TOKEN_SECRET when BANK_DETAILS_ENCRYPTION_KEY is
    unset is local-dev convenience only, same convention as DEV_FIXED_OTP --
    real venue bank/IBAN/JazzCash details must never end up encrypted with
    the same secret that's load-bearing for session-token integrity outside
    a dev box. Fail loudly at the point of use instead (see finding #9 in
    AUDIT_FINDINGS.md: a copy-pasted .env.example previously walked straight
    into this fallback with zero signal it existed)."""
    if not settings.BANK_DETAILS_ENCRYPTION_KEY:
        if not settings.DEBUG:
            raise RuntimeError(
                "BANK_DETAILS_ENCRYPTION_KEY is not set. Generate one with "
                "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"` "
                "and set it as a distinct value from SESSION_TOKEN_SECRET -- refusing to encrypt/decrypt "
                "bank details with a fallback secret outside DEBUG."
            )
        logger.warning("encryption.bank_details_key_unset_falling_back_to_session_secret")
    key_material = settings.BANK_DETAILS_ENCRYPTION_KEY or settings.SESSION_TOKEN_SECRET
    key = base64.urlsafe_b64encode(hashlib.sha256(key_material.encode()).digest())
    return Fernet(key)


def encrypt_json(data: dict, settings: Settings) -> dict:
    """Returns a JSONB-storable wrapper so the column type doesn't change."""
    ciphertext = _fernet(settings).encrypt(json.dumps(data).encode()).decode()
    return {ENCRYPTED_MARKER: ciphertext}


def decrypt_json(blob: dict | None, settings: Settings) -> dict | None:
    if not blob or ENCRYPTED_MARKER not in blob:
        return blob
    plaintext = _fernet(settings).decrypt(blob[ENCRYPTED_MARKER].encode())
    return json.loads(plaintext)
