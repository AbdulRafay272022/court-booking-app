"""What a venue still needs before it can go live (audit 2026-10-28 item 9).

An admin used to be able to approve a venue with no courts, no schedule, no prices and no bank details: it then appeared in
search with nothing bookable, or with a pay screen that had no account to send money to. `missing_for_approval` lists every
gap; the admin approve endpoint refuses while it is non-empty, and the owner/admin venue views show the same list so the
owner can fix it (web + app).

Codes (the UI writes the words): court, schedule, pricing (per court, with its name), bank_details, photo, address,
location, sports.
"""

from __future__ import annotations

from app.models.venue import Venue


def missing_for_approval(venue: Venue, bank_details: dict | None) -> list[dict]:
    missing: list[dict] = []
    if not (venue.address or "").strip():
        missing.append({"code": "address", "court": None})
    if venue.location is None:
        missing.append({"code": "location", "court": None})
    if not venue.sports:
        missing.append({"code": "sports", "court": None})
    if not venue.photos:
        missing.append({"code": "photo", "court": None})
    details = bank_details or {}
    if not all(str(details.get(k) or "").strip() for k in ("bank", "account_title", "account_number")):
        missing.append({"code": "bank_details", "court": None})
    courts = [c for c in (venue.courts or []) if c.is_active]
    if not courts:
        missing.append({"code": "court", "court": None})
    for court in courts:
        if not [t for t in (court.schedule_templates or []) if t.is_active]:
            missing.append({"code": "schedule", "court": court.name})
        if not [r for r in (court.pricing_rules or []) if getattr(r, "is_active", True) and float(r.price_per_slot or 0) > 0]:
            missing.append({"code": "pricing", "court": court.name})
    return missing
