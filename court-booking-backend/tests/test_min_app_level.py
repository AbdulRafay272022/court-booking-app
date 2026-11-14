"""Minimum app level for owner / staff (founder 14 Nov, ledger v2 rollout): app/services/client_version.py.

Old app (no X-App-Level) as owner/staff -> 426 UPGRADE_REQUIRED once MIN_STAFF_APP_LEVEL is set; a player with the same old app
-> normal; the new app -> normal; the web / a browser -> never blocked; setting OFF (default) -> nobody blocked."""

import pytest

from app.models.user import UserRole

API = "/api/v1"
OLD_ANDROID = {"User-Agent": "okhttp/4.12.0"}  # what an old React Native Android build sends (no platform, no level)
NEW_ANDROID = {"User-Agent": "okhttp/4.12.0", "X-Client-Platform": "android", "X-App-Level": "2"}


@pytest.fixture
def minimum(monkeypatch):
    from app.config import get_settings

    def _set(level: int):
        monkeypatch.setattr(get_settings(), "MIN_STAFF_APP_LEVEL", level)

    return _set


@pytest.fixture
async def people(make_user, make_venue, make_auth_headers):
    owner = await make_user("+923001119001", role=UserRole.OWNER)
    await make_venue(owner)
    staff = await make_user("+923001119002", role=UserRole.STAFF)
    player = await make_user("+923001119003")
    return {"owner": await make_auth_headers(owner), "staff": await make_auth_headers(staff), "player": await make_auth_headers(player)}


async def test_setting_off_blocks_nobody(client, people):
    for who in ("owner", "staff", "player"):
        r = await client.get(f"{API}/users/me/notifications", headers={**people[who], **OLD_ANDROID})
        assert r.status_code != 426, who
    assert (await client.get(f"{API}/owners/venues", headers={**people["owner"], **OLD_ANDROID})).status_code == 200


async def test_old_app_owner_and_staff_get_426_player_does_not(client, people, minimum):
    minimum(2)
    r = await client.get(f"{API}/owners/venues", headers={**people["owner"], **OLD_ANDROID})
    assert r.status_code == 426
    body = r.json()["error"]
    assert body["code"] == "UPGRADE_REQUIRED" and body["details"]["min_level"] == 2 and "update" in body["message"].lower()
    assert (await client.get(f"{API}/users/me/notifications", headers={**people["staff"], **OLD_ANDROID})).status_code == 426
    # a player on the same old app keeps working (book, pay, cancel all go through the same user check)
    assert (await client.get(f"{API}/bookings/mine", headers={**people["player"], **OLD_ANDROID})).status_code == 200
    # an old level below the minimum is still old
    r = await client.get(f"{API}/owners/venues", headers={**people["owner"], "X-Client-Platform": "android", "X-App-Level": "1"})
    assert r.status_code == 426


async def test_new_app_web_browser_and_auth_are_never_blocked(client, people, minimum):
    minimum(2)
    assert (await client.get(f"{API}/owners/venues", headers={**people["owner"], **NEW_ANDROID})).status_code == 200
    assert (await client.get(f"{API}/owners/venues", headers={**people["owner"], "X-Client-Platform": "web"})).status_code == 200
    # a browser tab opened before the deploy sends no platform header, but it is a browser
    browser = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130", "Origin": "https://khelo.example"}
    assert (await client.get(f"{API}/owners/venues", headers={**people["owner"], **browser})).status_code == 200
    # the old app can still read its session and sign out
    assert (await client.get(f"{API}/auth/me", headers={**people["owner"], **OLD_ANDROID})).status_code == 200
