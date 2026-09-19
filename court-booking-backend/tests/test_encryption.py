import pytest

from app.config import get_settings
from app.utils.encryption import decrypt_json, encrypt_json


async def test_bank_encryption_key_required_in_production(monkeypatch):
    """A copy-pasted .env.example previously walked straight into a silent
    fallback that encrypts real venue bank details with the same secret
    that's load-bearing for session-token integrity -- see finding #9 in
    AUDIT_FINDINGS.md. Outside DEBUG, an unset key must fail loudly instead."""
    settings = get_settings()
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "")
    monkeypatch.setattr(settings, "DEBUG", False)

    with pytest.raises(RuntimeError, match="BANK_DETAILS_ENCRYPTION_KEY"):
        encrypt_json({"bank": "HBL", "account_number": "1234567890"}, settings)


async def test_bank_encryption_key_falls_back_with_warning_in_debug(monkeypatch, caplog):
    """Local-dev convenience only: DEBUG=true tolerates the fallback (a
    fresh clone with no key configured yet shouldn't hard-fail), but it
    must log a visible warning, not fail silently."""
    import structlog

    settings = get_settings()
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "")
    monkeypatch.setattr(settings, "DEBUG", True)

    logs: list[dict] = []

    def _capture(logger, method_name, event_dict):
        logs.append(event_dict)
        return event_dict

    structlog.configure(
        processors=[_capture],
        logger_factory=structlog.ReturnLoggerFactory(),
    )
    try:
        blob = encrypt_json({"bank": "HBL", "account_number": "1234567890"}, settings)
        restored = decrypt_json(blob, settings)
    finally:
        structlog.reset_defaults()

    assert restored == {"bank": "HBL", "account_number": "1234567890"}
    assert any(
        entry.get("event") == "encryption.bank_details_key_unset_falling_back_to_session_secret"
        for entry in logs
    )
