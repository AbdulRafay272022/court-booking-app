"""Raast QR payload for a payment to the venue's IBAN with the amount filled in (audit 2026-10-28 item 20, flag `iban_qr`).

The payload is an EMVCo "merchant-presented" QR string (the format Pakistan's Raast QR builds on): ID-length-value fields,
ending with a CRC16-CCITT (poly 0x1021, init 0xFFFF) checksum over everything before it including "6304".

ASSUMPTION, NOT VERIFIED (docs/decisions-made.md #10): the merchant-account template (tag 26) uses the globally unique
identifier `RAAST_GUID` with the IBAN in sub-tag 01. SBP's published Raast QR specification is the authority; before turning the
flag on, scan a generated code with Meezan, HBL, Easypaisa and JazzCash (docs/device-test-checklist.md). If an app does not
recognise it, only `RAAST_GUID` / the sub-tags below should need to change. Nothing here is shown while the flag is off.
"""

from __future__ import annotations

import re

RAAST_GUID = "PK.RAAST"  # assumption, see the module docstring
IBAN_RE = re.compile(r"^PK\d{2}[A-Z0-9]{20}$")


def _field(tag: str, value: str) -> str:
    if len(value) > 99:
        raise ValueError(f"QR field {tag} is too long")
    return f"{tag}{len(value):02d}{value}"


def crc16_ccitt(data: str) -> str:
    crc = 0xFFFF
    for byte in data.encode("utf-8"):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def iban_checksum_ok(iban: str) -> bool:
    """ISO 13616 mod-97 check (audit G2: the backend only checked the shape)."""
    s = iban.replace(" ", "").upper()
    if not IBAN_RE.match(s):
        return False
    moved = s[4:] + s[:4]
    digits = "".join(str(int(ch, 36)) for ch in moved)
    return int(digits) % 97 == 1


def _clean(text: str, limit: int) -> str:
    return re.sub(r"[^A-Za-z0-9 .&-]", "", text or "").strip()[:limit] or "Khelo venue"


def raast_qr_payload(*, iban: str, amount_pkr: int, account_title: str, city: str | None, reference: str) -> str:
    """The QR text for one payment of `amount_pkr` to `iban`. Raises ValueError for a malformed IBAN."""
    iban = iban.replace(" ", "").upper()
    if not iban_checksum_ok(iban):
        raise ValueError("not a valid Pakistani IBAN")
    if amount_pkr <= 0:
        raise ValueError("amount must be positive")
    merchant = _field("00", RAAST_GUID) + _field("01", iban)
    body = (
        _field("00", "01")  # payload format indicator
        + _field("01", "12")  # point of initiation: dynamic (one payment, amount fixed)
        + _field("26", merchant)
        + _field("52", "7941")  # MCC: sports clubs / fields
        + _field("53", "586")  # PKR
        + _field("54", f"{amount_pkr}.00")
        + _field("58", "PK")
        + _field("59", _clean(account_title, 25))
        + _field("60", _clean(city or "Karachi", 15))
        + _field("62", _field("05", _clean(reference, 25)))  # reference label: the booking code
    )
    to_sign = body + "6304"
    return to_sign + crc16_ccitt(to_sign)
