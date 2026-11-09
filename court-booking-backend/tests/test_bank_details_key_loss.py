"""Venue bank details when the encryption key is lost or rotated away (same safe behaviour as refund payouts).

The Fernet key (SSM BANK_DETAILS_ENCRYPTION_KEY) is replaced without keeping the old one in BANK_DETAILS_ENCRYPTION_KEYS_OLD:
saved venue bank details can no longer be decrypted. Nothing may 500. The owner sees a clear "enter them again" item, the
player's pay screen simply has no account (same as a venue with none), a payment proof goes to manual review, the admin
cannot approve the venue until the owner re-enters them, and re-entering stores them encrypted with the new key. With no key
at all the details are refused with a 503 and never stored in clear.
"""

import json
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.booking import BookingStatus
from app.models.user import UserRole
from app.models.venue import Venue, VenueStatus
from app.utils.encryption import ENCRYPTED_MARKER, encrypt_json
from tests.overview_helpers import add_booking

API = "/api/v1"
DETAILS = {"bank": "Meezan", "account_title": "KHA Sports", "account_number": "01234567890123"}


async def _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, phone, **kw):
    from app.config import get_settings

    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner, photos=["venues/a.jpg"], **kw)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    async with db_session_factory() as s:
        v = await s.get(Venue, venue.id)
        v.bank_details = encrypt_json(DETAILS, get_settings())
        await s.commit()
    return owner, venue, court


def _lose_key(monkeypatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "a-completely-new-key-old-one-lost")
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEYS_OLD", "")
    return settings


async def test_lost_key_owner_sees_re_enter_item_player_sees_no_account_and_re_entry_is_encrypted(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
    monkeypatch,
):
    owner, venue, court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                       db_session_factory, "+923001150001")
    player = await make_user("+923001150002")
    start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(days=2)
    booking = await add_booking(db_session_factory, court, start, status=BookingStatus.HELD, player=player, advance=1000)
    oh, ph = await make_auth_headers(owner), await make_auth_headers(player)
    settings = _lose_key(monkeypatch)

    # owner: 200, details hidden, a clear item asking for them again (not the plain "bank details missing")
    mine = await client.get(f"{API}/venues/{venue.id}", headers=oh)
    assert mine.status_code == 200
    body = mine.json()
    assert body["bank_details"] is None and body["bank_details_unreadable"] is True
    codes = [m["code"] for m in body["missing_for_approval"]]
    assert "bank_details_unreadable" in codes and "bank_details" not in codes
    owner_list = await client.get(f"{API}/owners/venues", headers=oh)
    assert owner_list.status_code == 200 and owner_list.json()[0]["bank_details_unreadable"] is True

    # player: the pay screen loads, there is just no account to show
    pay = await client.get(f"{API}/bookings/{booking.id}/payment-instructions", headers=ph)
    assert pay.status_code == 200
    assert pay.json()["account_number"] is None and pay.json()["bank"] is None
    # the public page never carries the flag or the details
    public = (await client.get(f"{API}/venues/{venue.id}", headers=ph)).json()
    assert "bank_details" not in public and "bank_details_unreadable" not in public

    # owner re-enters: works (no 500 reading the old value), audited, stored encrypted with the new key
    new = {"bank": "HBL", "account_title": "KHA Sports", "account_number": "99990000111122"}
    saved = await client.patch(f"{API}/venues/{venue.id}", headers=oh, json={"bank_details": new})
    assert saved.status_code == 200
    assert saved.json()["bank_details"]["account_number"] == "99990000111122"
    assert saved.json()["bank_details_unreadable"] is False
    assert not any(m["code"].startswith("bank_details") for m in saved.json()["missing_for_approval"])
    async with db_session_factory() as s:
        raw = (await s.get(Venue, venue.id)).bank_details
        audit = (await s.scalars(select(AuditLog).where(AuditLog.action == "venue.bank_details_changed"))).all()
    assert set(raw) == {ENCRYPTED_MARKER} and "99990000111122" not in json.dumps(raw)
    assert len(audit) == 1 and audit[0].old_value == {"unreadable": True}
    assert audit[0].new_value["account_number"].endswith("1122") and "9999" not in audit[0].new_value["account_number"]
    assert (await client.get(f"{API}/bookings/{booking.id}/payment-instructions", headers=ph)).json()["account_number"] == "99990000111122"
    assert settings.BANK_DETAILS_ENCRYPTION_KEY == "a-completely-new-key-old-one-lost"


async def test_lost_key_owner_can_edit_other_fields_without_touching_bank_details(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
    monkeypatch,
):
    owner, venue, _court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                        db_session_factory, "+923001150011")
    oh = await make_auth_headers(owner)
    _lose_key(monkeypatch)
    resp = await client.patch(f"{API}/venues/{venue.id}", headers=oh, json={"description": "Floodlit courts"})
    assert resp.status_code == 200 and resp.json()["bank_details_unreadable"] is True
    async with db_session_factory() as s:
        assert (await s.get(Venue, venue.id)).bank_details is not None  # the old blob is kept (it may come back with the old key)


async def test_lost_key_admin_cannot_approve_until_re_entered(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
    monkeypatch,
):
    owner, venue, _court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                        db_session_factory, "+923001150021", status=VenueStatus.PENDING)
    admin = await make_user("+923001150022", role=UserRole.ADMIN)
    ah = await make_auth_headers(admin)
    _lose_key(monkeypatch)

    refused = await client.post(f"{API}/admin/venues/{venue.id}/approve", headers=ah)
    assert refused.status_code == 400 and refused.json()["error"]["code"] == "VENUE_INCOMPLETE"
    assert "bank_details_unreadable" in json.dumps(refused.json())
    admin_view = await client.get(f"{API}/venues/{venue.id}", headers=ah)
    assert admin_view.status_code == 200 and admin_view.json()["bank_details_unreadable"] is True

    oh = await make_auth_headers(owner)
    assert (await client.patch(f"{API}/venues/{venue.id}", headers=oh, json={"bank_details": DETAILS})).status_code == 200
    assert (await client.post(f"{API}/admin/venues/{venue.id}/approve", headers=ah)).status_code == 200


async def test_rotated_key_with_old_key_kept_still_reads_saved_details(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
    monkeypatch,
):
    from app.config import get_settings

    owner, venue, _court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                        db_session_factory, "+923001150031")
    settings = get_settings()
    old = settings.BANK_DETAILS_ENCRYPTION_KEY or settings.SESSION_TOKEN_SECRET
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "the-new-key-after-rotation")
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEYS_OLD", old)
    body = (await client.get(f"{API}/venues/{venue.id}", headers=await make_auth_headers(owner))).json()
    assert body["bank_details"]["account_number"] == DETAILS["account_number"] and body["bank_details_unreadable"] is False


async def test_no_key_on_the_server_refuses_with_503_and_stores_nothing(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers,
    monkeypatch,
):
    from app.config import get_settings

    owner, venue, _court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                        db_session_factory, "+923001150041")
    oh = await make_auth_headers(owner)
    async with db_session_factory() as s:
        before = (await s.get(Venue, venue.id)).bank_details
    settings = get_settings()
    monkeypatch.setattr(settings, "BANK_DETAILS_ENCRYPTION_KEY", "")
    monkeypatch.setattr(settings, "DEBUG", False)

    resp = await client.patch(f"{API}/venues/{venue.id}", headers=oh,
                              json={"description": "changed", "bank_details": {**DETAILS, "account_number": "55556666777788"}})
    assert resp.status_code == 503 and resp.json()["error"]["code"] == "BANK_DETAILS_STORAGE_UNAVAILABLE"
    async with db_session_factory() as s:
        v = await s.get(Venue, venue.id)
        assert v.bank_details == before and v.description != "changed"  # nothing half-saved, never in clear

    created = await client.post(f"{API}/venues", headers=oh, json={
        "name": "No Key Arena", "address": "1 Road", "city": "Karachi", "latitude": 24.8, "longitude": 67.0,
        "sports": ["padel"], "bank_details": DETAILS,
    })
    assert created.status_code == 503 and created.json()["error"]["code"] == "BANK_DETAILS_STORAGE_UNAVAILABLE"
    async with db_session_factory() as s:
        assert (await s.scalar(select(Venue).where(Venue.name == "No Key Arena"))) is None

    # reading with no key does not 500 either
    assert (await client.get(f"{API}/venues/{venue.id}", headers=oh)).status_code == 200


async def test_receiver_check_on_unreadable_details_is_manual_review_not_not_configured(
    db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch,
):
    from app.services.payment_service import compute_receiver_match

    _owner, venue, _court = await _venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         db_session_factory, "+923001150051")
    async with db_session_factory() as s:
        v = await s.get(Venue, venue.id)
    settings = _lose_key(monkeypatch)
    # "not_configured" would let auto-approve through; an unreadable account must not
    assert compute_receiver_match("KHA Sports", v, settings) == "unreadable"
