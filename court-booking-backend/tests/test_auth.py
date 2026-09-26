"""Section 26 auth: signup (form + OTP proof of phone) -> password login (8h
sessions, refreshable) -> 365-day phone re-verification -> password reset.

OTP delivery is mocked at `WhatsAppService.send_otp` unless a test is
specifically about the delivery path itself.
"""

import re
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models.user import LoginAttempt, OtpPurpose, OtpRequest, Session as SessionModel, User
from app.utils.security import hash_otp, hash_password, verify_password


def client_from(app, ip: str) -> httpx.AsyncClient:
    """A test client whose requests appear to come from `ip` (for the per-IP QA tests)."""
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=(ip, 12345)), base_url="http://test"
    )

PASSWORD = "correct-horse-battery"


class OtpBox:
    """Captures every OTP `send_otp` was asked to deliver."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []
        # (old_phone, new_phone) for every "your number was changed" notice
        self.notices: list[tuple[str, str]] = []

    @property
    def code(self) -> str:
        return self.sent[-1][1]


@pytest.fixture
def otp_box(monkeypatch) -> OtpBox:
    box = OtpBox()

    async def fake_send_otp(self, phone, code):
        box.sent.append((phone, code))
        return {"messages": [{"id": "wamid.local"}]}

    async def fake_notice(self, old_phone, new_phone):
        box.notices.append((old_phone, new_phone))
        return {"messages": [{"id": "wamid.local"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_otp", fake_send_otp)
    # Also stubbed so no test can reach the real send if a local .env happens to hold a Meta token.
    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_phone_changed_notice", fake_notice)
    return box


def signup_body(phone: str, **over) -> dict:
    # Emails are unique now, so the default is derived from the phone (one per test user) instead of
    # a shared constant; tests that care about the email pass one explicitly.
    body = {
        "name": "Ayesha Khan",
        "email": f"user{phone.lstrip('+')}@example.com",
        "phone": phone,
        "city": "karachi",
        "gender": "female",
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        "role": "player",
    }
    body.update(over)
    return body


async def signup_and_verify(client, otp_box, phone: str, **over) -> dict:
    resp = await client.post("/api/v1/auth/signup", json=signup_body(phone, **over))
    assert resp.status_code == 201, resp.text
    verify = await client.post(
        "/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": otp_box.code, "platform": "web"}
    )
    assert verify.status_code == 200, verify.text
    return verify.json()


async def login(client, phone: str, password: str = PASSWORD, **extra):
    return await client.post("/api/v1/auth/login", json={"phone": phone, "password": password, **extra})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def set_phone_verified_at(db_session_factory, phone: str, when: datetime | None) -> None:
    async with db_session_factory() as session:
        user = await session.scalar(select(User).where(User.phone == phone))
        user.phone_verified_at = when
        await session.commit()


# ------------------------------------------------------------------- signup


async def test_signup_creates_unverified_account_hashes_password_and_sends_otp(
    client, db_session, otp_box
):
    phone = "+923001110001"
    resp = await client.post("/api/v1/auth/signup", json=signup_body(phone, email="Ayesha@Example.com"))
    assert resp.status_code == 201
    assert resp.json()["expires_in"] == get_settings().OTP_EXPIRE_MINUTES * 60
    assert otp_box.sent == [(phone, otp_box.code)]

    user = await db_session.scalar(select(User).where(User.phone == phone))
    assert user.phone_verified_at is None
    assert user.name == "Ayesha Khan"
    assert user.email == "ayesha@example.com", "email is normalized to lowercase"
    assert user.city.value == "karachi" and user.gender.value == "female"
    assert user.role.value == "player"
    assert user.password_hash.startswith("$argon2id$"), "must be a real password hash, not the password"
    assert PASSWORD not in user.password_hash

    # Unusable until the phone is proven: no session, and login says "verify".
    denied = await login(client, phone)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "PHONE_REVERIFICATION_REQUIRED"


@pytest.mark.parametrize(
    "override",
    [
        {"confirm_password": "something-else-entirely"},
        {"password": "short7!", "confirm_password": "short7!"},
        {"email": "not-an-email"},
        {"city": "atlantis"},
        {"gender": "robot"},
        {"role": "admin"},
        {"name": " "},
        {"phone": "03001234567"},
    ],
)
async def test_signup_rejects_invalid_fields(client, otp_box, override):
    body = signup_body("+923001110002")
    body.update(override)  # may replace the phone itself, so not passed as a keyword
    resp = await client.post("/api/v1/auth/signup", json=body)
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert otp_box.sent == []


async def test_signup_accepts_every_fixed_city(client, otp_box):
    cities = ["karachi", "lahore", "islamabad", "rawalpindi", "faisalabad", "multan",
              "gujranwala", "peshawar", "kohat", "hyderabad"]
    for i, city in enumerate(cities):
        resp = await client.post(
            "/api/v1/auth/signup", json=signup_body(f"+92300111{3000 + i}", city=city)
        )
        assert resp.status_code == 201, (city, resp.text)


async def test_verify_signup_otp_issues_8_hour_session_and_activates_account(client, otp_box):
    phone = "+923001110003"
    body = await signup_and_verify(client, otp_box, phone, email="Ayesha@Example.com")

    assert body["user"]["phone"] == phone
    assert body["user"]["phone_verified_at"] is not None
    assert "password_hash" not in body["user"] and "password" not in body["user"]
    assert "is_new_user" not in body

    expires = datetime.fromisoformat(body["expires_at"])
    hours = (expires - datetime.now(timezone.utc)).total_seconds() / 3600
    assert 7.9 < hours <= 8.0, f"session must last 8h, got {hours:.2f}h"

    me = await client.get("/api/v1/auth/me", headers=bearer(body["token"]))
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "ayesha@example.com"


async def test_owner_signup_creates_owner_role(client, otp_box):
    body = await signup_and_verify(client, otp_box, "+923001110004", role="owner")
    assert body["user"]["role"] == "owner"


async def test_signup_for_verified_phone_is_refused_and_changes_nothing(client, db_session, otp_box):
    phone = "+923001110005"
    await signup_and_verify(client, otp_box, phone)
    before = await db_session.scalar(select(User.password_hash).where(User.phone == phone))
    otp_box.sent.clear()

    resp = await client.post(
        "/api/v1/auth/signup",
        json=signup_body(phone, name="Attacker", password="attacker-pass-1", confirm_password="attacker-pass-1"),
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "PHONE_ALREADY_REGISTERED"
    assert otp_box.sent == []

    db_session.expire_all()
    user = await db_session.scalar(select(User).where(User.phone == phone))
    assert user.password_hash == before and user.name == "Ayesha Khan"
    assert (await login(client, phone)).status_code == 200


async def test_pending_signup_is_not_overwritten_while_its_code_is_live_then_can_be_after_expiry(
    client, otp_box, db_session_factory
):
    """QA #1: while a signup's verification code is still live, a SECOND signup for the same
    number is rejected (no overwrite of the pending name/email/password). Once the code's TTL
    lapses without verification, a fresh signup is allowed again."""
    phone = "+923001110006"
    first = await client.post(
        "/api/v1/auth/signup",
        json=signup_body(phone, name="First", password="first-pass-1", confirm_password="first-pass-1"),
    )
    assert first.status_code == 201

    # A second signup while the first code is live is refused (this is the anti-hijack rule).
    second = await client.post(
        "/api/v1/auth/signup",
        json=signup_body(phone, name="Second", password="second-pass-1", confirm_password="second-pass-1"),
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "SIGNUP_ALREADY_PENDING"
    assert second.json()["error"]["details"]["retry_after_seconds"] > 0

    # Expire the pending code, then a fresh signup IS allowed and can be verified.
    async with db_session_factory() as s:
        otp = await s.scalar(select(OtpRequest).where(OtpRequest.phone == phone).order_by(OtpRequest.created_at.desc()))
        otp.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await s.commit()

    body = await signup_and_verify(client, otp_box, phone, name="Real Owner")
    assert body["user"]["name"] == "Real Owner"
    assert (await login(client, phone, "first-pass-1")).status_code == 401
    assert (await login(client, phone, PASSWORD)).status_code == 200


async def test_verify_signup_wrong_code_then_lockout(client, otp_box):
    phone = "+923001110007"
    await client.post("/api/v1/auth/signup", json=signup_body(phone))
    wrong = "000000" if otp_box.code != "000000" else "111111"

    for _ in range(5):
        r = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": wrong})
        assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_OTP"

    locked = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": otp_box.code})
    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "OTP_RATE_LIMITED"


async def test_verify_signup_for_unknown_phone_is_otp_expired(client):
    r = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": "+923001110008", "otp": "123456"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "OTP_EXPIRED"


async def test_a_reverify_otp_cannot_complete_signup_or_mint_a_session(client, otp_box):
    """OTPs are purpose-bound, and verify-signup-otp only ever completes a
    *pending* signup -- otherwise an OTP (which never checks a password) would
    be a way to get a session for any account."""
    phone = "+923001110009"
    await signup_and_verify(client, otp_box, phone)

    await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    r = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": otp_box.code})
    # Already verified -> ALREADY_VERIFIED (QA #2). Still no session minted, which is the point.
    assert r.status_code == 409 and r.json()["error"]["code"] == "ALREADY_VERIFIED"
    assert "token" not in r.json()


async def test_signup_otp_delivery_failure_returns_clean_error(client, db_session, monkeypatch):
    async def failing_send(self, payload):
        raise RuntimeError("simulated WhatsApp Cloud API outage")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", failing_send)
    phone = "+923001110010"

    resp = await client.post("/api/v1/auth/signup", json=signup_body(phone))
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "OTP_DELIVERY_FAILED"
    rows = (await db_session.execute(select(OtpRequest).where(OtpRequest.phone == phone))).scalars().all()
    assert rows == [], "a delivery failure must not leave an OTP row consuming a rate-limit slot"


# -------------------------------------------------------------------- login


async def test_login_success_issues_8_hour_session(client, otp_box):
    phone = "+923001120001"
    await signup_and_verify(client, otp_box, phone)

    resp = await login(client, phone, device_id="dev-1", device_name="Pixel", platform="android")
    assert resp.status_code == 200
    body = resp.json()
    hours = (datetime.fromisoformat(body["expires_at"]) - datetime.now(timezone.utc)).total_seconds() / 3600
    assert 7.9 < hours <= 8.0
    assert (await client.get("/api/v1/auth/me", headers=bearer(body["token"]))).status_code == 200


async def test_login_distinguishes_wrong_password_from_unknown_number(client, otp_box):
    """NEW BUG 2 / QA #12 deliberately REVERSES the old anti-enumeration behaviour on login:
    an unknown number gets USER_NOT_FOUND (so the UI can say 'sign up' and never start an OTP
    flow), while a wrong password on a real account stays INVALID_CREDENTIALS. The small
    enumeration tradeoff is the owner's explicit choice for fixing the account-bypass bug."""
    phone = "+923001120002"
    await signup_and_verify(client, otp_box, phone)

    wrong_pw = await login(client, phone, "not-the-password")
    assert wrong_pw.status_code == 401 and wrong_pw.json()["error"]["code"] == "INVALID_CREDENTIALS"

    unknown = await login(client, "+923001129999", "not-the-password")
    assert unknown.status_code == 404 and unknown.json()["error"]["code"] == "USER_NOT_FOUND"


async def test_login_rate_limit_after_five_failures_blocks_even_the_right_password(client, otp_box):
    phone = "+923001120003"
    await signup_and_verify(client, otp_box, phone)

    for _ in range(5):
        assert (await login(client, phone, "wrong-password")).status_code == 401
    blocked = await login(client, phone, PASSWORD)
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "LOGIN_RATE_LIMITED"


async def test_login_for_unknown_number_says_no_account(client):
    """NEW BUG 2 / QA #12: login for a number with no account returns USER_NOT_FOUND on the
    FIRST attempt (so the UI says 'sign up' and never starts an OTP/reset flow), instead of
    the old ambiguous rate-limited INVALID_CREDENTIALS."""
    phone = "+923001129998"
    resp = await login(client, phone, "whatever")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "USER_NOT_FOUND"


async def test_successful_login_clears_earlier_typos(client, db_session, otp_box):
    phone = "+923001120004"
    await signup_and_verify(client, otp_box, phone)
    for _ in range(4):
        await login(client, phone, "typo")
    assert (await login(client, phone, PASSWORD)).status_code == 200

    rows = (await db_session.execute(select(LoginAttempt).where(LoginAttempt.phone == phone))).scalars().all()
    assert rows == []
    for _ in range(4):
        assert (await login(client, phone, "typo")).status_code == 401  # a fresh allowance, not 1 left


async def test_login_checks_phone_verification_before_the_password(client, db_session_factory, otp_box):
    """After 365 days the client must be told to re-verify -- even if the
    password it sent is wrong -- instead of showing 'wrong password'."""
    phone = "+923001120005"
    await signup_and_verify(client, otp_box, phone)

    await set_phone_verified_at(db_session_factory, phone, datetime.now(timezone.utc) - timedelta(days=366))
    stale_wrong = await login(client, phone, "totally-wrong")
    stale_right = await login(client, phone, PASSWORD)
    for r in (stale_wrong, stale_right):
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "PHONE_REVERIFICATION_REQUIRED"

    await set_phone_verified_at(db_session_factory, phone, datetime.now(timezone.utc) - timedelta(days=364))
    assert (await login(client, phone, PASSWORD)).status_code == 200


async def test_reverification_restores_password_login_without_issuing_a_session(
    client, db_session_factory, otp_box
):
    phone = "+923001120006"
    await signup_and_verify(client, otp_box, phone)
    await set_phone_verified_at(db_session_factory, phone, datetime.now(timezone.utc) - timedelta(days=400))
    assert (await login(client, phone)).json()["error"]["code"] == "PHONE_REVERIFICATION_REQUIRED"

    otp_box.sent.clear()
    req = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    assert req.status_code == 200 and len(otp_box.sent) == 1

    done = await client.post("/api/v1/auth/reverify-phone", json={"phone": phone, "otp": otp_box.code})
    assert done.status_code == 200
    assert "token" not in done.json(), "an OTP proves the phone, not the password -- no session yet"

    assert (await login(client, phone)).status_code == 200


async def test_resend_for_a_pending_signup_yields_a_code_that_completes_it(client, otp_box):
    """The "Resend code" button on the signup verification screen calls
    request-otp; the code it produces must finish the signup."""
    phone = "+923001120008"
    await client.post("/api/v1/auth/signup", json=signup_body(phone))
    first = otp_box.code
    otp_box.sent.clear()

    assert (await client.post("/api/v1/auth/request-otp", json={"phone": phone})).status_code == 200
    assert len(otp_box.sent) == 1
    done = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": otp_box.code})
    assert done.status_code == 200, done.text
    assert first is not None


async def test_abandoned_signup_can_finish_through_the_login_reverify_path(client, otp_box):
    """signup (never verified) -> login says PHONE_REVERIFICATION_REQUIRED ->
    request-otp -> reverify-phone -> login works."""
    phone = "+923001120009"
    await client.post("/api/v1/auth/signup", json=signup_body(phone))
    assert (await login(client, phone)).json()["error"]["code"] == "PHONE_REVERIFICATION_REQUIRED"

    otp_box.sent.clear()
    await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    done = await client.post("/api/v1/auth/reverify-phone", json={"phone": phone, "otp": otp_box.code})
    assert done.status_code == 200
    assert (await login(client, phone)).status_code == 200


async def test_reverify_request_for_unknown_phone_is_silent(client, otp_box):
    resp = await client.post("/api/v1/auth/request-otp", json={"phone": "+923001129997"})
    assert resp.status_code == 200
    assert otp_box.sent == [], "must not send, and must not reveal that no account exists"


async def test_suspended_account_cannot_log_in(client, db_session_factory, otp_box):
    phone = "+923001120007"
    await signup_and_verify(client, otp_box, phone)
    async with db_session_factory() as session:
        user = await session.scalar(select(User).where(User.phone == phone))
        user.is_active = False
        await session.commit()
    resp = await login(client, phone)
    assert resp.status_code == 403


# --------------------------------------------------- pre-Section-26 accounts


async def test_legacy_account_without_password_is_told_to_set_one_and_can(
    client, make_user, otp_box
):
    phone = "+923001130001"
    await make_user(phone)  # created under the old OTP-only model: no password_hash

    denied = await login(client, phone, "anything")
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "PASSWORD_NOT_SET"

    # The reset flow doubles as "set your first password".
    req = await client.post("/api/v1/auth/request-password-reset", json={"phone": phone})
    assert req.status_code == 200
    done = await client.post(
        "/api/v1/auth/verify-password-reset",
        json={"phone": phone, "otp": otp_box.code, "new_password": PASSWORD, "confirm_password": PASSWORD},
    )
    assert done.status_code == 200
    assert (await login(client, phone)).status_code == 200


# ----------------------------------------------------------- password reset


async def test_password_reset_changes_password_and_logs_out_every_device(
    client, db_session, otp_box
):
    phone = "+923001140001"
    first = await signup_and_verify(client, otp_box, phone)
    second = (await login(client, phone, device_id="tablet")).json()
    for token in (first["token"], second["token"]):
        assert (await client.get("/api/v1/auth/me", headers=bearer(token))).status_code == 200

    otp_box.sent.clear()
    await client.post("/api/v1/auth/request-password-reset", json={"phone": phone})
    new_pw = "brand-new-password-9"
    done = await client.post(
        "/api/v1/auth/verify-password-reset",
        json={"phone": phone, "otp": otp_box.code, "new_password": new_pw, "confirm_password": new_pw},
    )
    assert done.status_code == 200
    assert "token" not in done.json()

    for token in (first["token"], second["token"]):
        assert (await client.get("/api/v1/auth/me", headers=bearer(token))).status_code == 401
    assert (await login(client, phone, PASSWORD)).status_code == 401
    assert (await login(client, phone, new_pw)).status_code == 200

    sessions = (await db_session.execute(select(SessionModel).where(SessionModel.revoked_reason == "password_reset"))).scalars().all()
    assert len(sessions) == 2


async def test_password_reset_clears_login_lockout_and_refreshes_phone_trust(
    client, db_session_factory, otp_box
):
    phone = "+923001140002"
    await signup_and_verify(client, otp_box, phone)
    for _ in range(5):
        await login(client, phone, "wrong")
    assert (await login(client, phone, PASSWORD)).status_code == 429

    await set_phone_verified_at(db_session_factory, phone, datetime.now(timezone.utc) - timedelta(days=500))
    await client.post("/api/v1/auth/request-password-reset", json={"phone": phone})
    new_pw = "another-new-password-1"
    done = await client.post(
        "/api/v1/auth/verify-password-reset",
        json={"phone": phone, "otp": otp_box.code, "new_password": new_pw, "confirm_password": new_pw},
    )
    assert done.status_code == 200
    # Lockout gone AND no second OTP demanded despite the 500-day-old verification.
    assert (await login(client, phone, new_pw)).status_code == 200


async def test_password_reset_validation_and_wrong_code(client, otp_box):
    phone = "+923001140003"
    await signup_and_verify(client, otp_box, phone)
    otp_box.sent.clear()
    await client.post("/api/v1/auth/request-password-reset", json={"phone": phone})

    mismatch = await client.post(
        "/api/v1/auth/verify-password-reset",
        json={"phone": phone, "otp": otp_box.code, "new_password": "longenough-1", "confirm_password": "different-1"},
    )
    assert mismatch.status_code == 422
    short = await client.post(
        "/api/v1/auth/verify-password-reset",
        json={"phone": phone, "otp": otp_box.code, "new_password": "short", "confirm_password": "short"},
    )
    assert short.status_code == 422

    wrong = "000000" if otp_box.code != "000000" else "111111"
    bad = await client.post(
        "/api/v1/auth/verify-password-reset",
        json={"phone": phone, "otp": wrong, "new_password": "longenough-1", "confirm_password": "longenough-1"},
    )
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "INVALID_OTP"
    assert (await login(client, phone)).status_code == 200, "a failed reset must not change the password"


async def test_password_reset_request_for_unknown_phone_is_rejected(client, otp_box):
    """NEW BUG 1: forgot-password for a number with no account returns USER_NOT_FOUND and sends
    no OTP (was a silent no-op that still claimed 'code sent')."""
    resp = await client.post("/api/v1/auth/request-password-reset", json={"phone": "+923001149999"})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "USER_NOT_FOUND"
    assert otp_box.sent == []


async def test_a_signup_otp_cannot_reset_a_password(client, otp_box):
    """Purpose isolation the other way round."""
    phone = "+923001140004"
    await client.post("/api/v1/auth/signup", json=signup_body(phone))
    r = await client.post(
        "/api/v1/auth/verify-password-reset",
        json={"phone": phone, "otp": otp_box.code, "new_password": "longenough-1", "confirm_password": "longenough-1"},
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "OTP_EXPIRED"


# =================================================================== QA FIXES


async def test_qa1_attacker_cannot_hijack_a_pending_signup(client, otp_box, db_session_factory):
    """QA #1 canonical repro: victim starts a signup; attacker re-signs-up on the same number
    while the code is live; the attacker's call is rejected and the victim's ORIGINAL code still
    verifies into the VICTIM's account with the VICTIM's password."""
    phone = "+923001160001"
    victim = await client.post(
        "/api/v1/auth/signup",
        json=signup_body(phone, name="Victim", email="victim@example.com", password="victim-pass-1", confirm_password="victim-pass-1"),
    )
    assert victim.status_code == 201
    victim_code = otp_box.code

    attack = await client.post(
        "/api/v1/auth/signup",
        json=signup_body(phone, name="Attacker", email="attacker@example.com", password="attacker-pass-1", confirm_password="attacker-pass-1"),
    )
    assert attack.status_code == 409 and attack.json()["error"]["code"] == "SIGNUP_ALREADY_PENDING"

    verify = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": victim_code})
    assert verify.status_code == 200
    assert verify.json()["user"]["name"] == "Victim"
    assert (await login(client, phone, "attacker-pass-1")).status_code == 401
    assert (await login(client, phone, "victim-pass-1")).status_code == 200


async def test_qa2_verify_signup_for_already_verified_number_says_log_in(client, otp_box):
    """QA #2: a retry of verify-signup after it already succeeded (dropped response) returns
    ALREADY_VERIFIED so the UI shows 'Log in', not a dead-end expired-code error."""
    phone = "+923001160002"
    await signup_and_verify(client, otp_box, phone)
    retry = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": otp_box.code})
    assert retry.status_code == 409 and retry.json()["error"]["code"] == "ALREADY_VERIFIED"


async def test_qa3_otp_capped_per_ip_across_distinct_numbers(app, otp_box):
    """QA #3: beyond N distinct numbers from one IP/device, further OTP sends are blocked
    regardless of the per-number limit."""
    app.state.otp_ip_limiter.limit = 3
    async with client_from(app, "203.0.113.7") as c:
        for i in range(3):
            r = await c.post("/api/v1/auth/signup", json=signup_body(f"+92300116100{i}"))
            assert r.status_code == 201, r.text
        blocked = await c.post("/api/v1/auth/signup", json=signup_body("+923001161009"))
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "OTP_IP_RATE_LIMITED"
    assert blocked.json()["error"]["details"]["retry_after_seconds"] > 0


async def test_qa4_lockout_is_per_ip_so_a_victim_is_not_locked_from_their_own_device(app, otp_box):
    """QA #4: an attacker failing logins on a victim's number only locks the ATTACKER's IP; the
    victim can still log in from their own device."""
    phone = "+923001160004"
    async with client_from(app, "198.51.100.1") as setup:
        await signup_and_verify(setup, otp_box, phone)

    async with client_from(app, "9.9.9.9") as attacker:
        for _ in range(5):
            assert (await login(attacker, phone, "wrong")).status_code == 401
        locked = await login(attacker, phone, "wrong")
        assert locked.status_code == 429 and locked.json()["error"]["code"] == "LOGIN_RATE_LIMITED"
        assert locked.json()["error"]["details"]["retry_after_seconds"] > 0

    async with client_from(app, "1.1.1.1") as victim:
        assert (await login(victim, phone, PASSWORD)).status_code == 200


async def test_qa5_otp_request_rate_limit_carries_retry_after(client, otp_box, make_user):
    """QA #5: the per-phone OTP 429 carries retry_after_seconds too."""
    user = await make_user("+923001160005", phone_verified_at=None, password_hash=await hash_password(PASSWORD))
    for _ in range(get_settings().OTP_MAX_ATTEMPTS):
        await client.post("/api/v1/auth/request-otp", json={"phone": user.phone})
    blocked = await client.post("/api/v1/auth/request-otp", json={"phone": user.phone})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "OTP_RATE_LIMITED"
    assert blocked.json()["error"]["details"]["retry_after_seconds"] > 0


async def test_qa10_superseded_code_is_reported_and_does_not_burn_the_active_attempt(
    client, db_session_factory
):
    """QA #10: submitting an OLDER code once a newer one was sent returns OTP_SUPERSEDED and does
    NOT count against the current active code's attempts."""
    phone = "+923001160010"
    async with db_session_factory() as s:
        s.add(User(phone=phone, password_hash=await hash_password(PASSWORD), phone_verified_at=None))
        await s.flush()
        now = datetime.now(timezone.utc)
        s.add(OtpRequest(phone=phone, purpose=OtpPurpose.SIGNUP, otp_hash=hash_otp("222222"),
                         expires_at=now + timedelta(minutes=5), created_at=now - timedelta(minutes=1)))
        s.add(OtpRequest(phone=phone, purpose=OtpPurpose.SIGNUP, otp_hash=hash_otp("333333"),
                         expires_at=now + timedelta(minutes=5), created_at=now))
        await s.commit()

    old = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": "222222"})
    assert old.status_code == 400 and old.json()["error"]["code"] == "OTP_SUPERSEDED"

    async with db_session_factory() as s:
        active = await s.scalar(
            select(OtpRequest).where(OtpRequest.phone == phone).order_by(OtpRequest.created_at.desc())
        )
        assert active.attempts == 0, "a superseded-code submission must not burn the active code's attempt"

    good = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": "333333"})
    assert good.status_code == 200


async def test_qa10_otp_status_endpoint_reports_remaining_time(client, otp_box):
    """QA #10: a cold Verify screen can read the live code's remaining time server-side."""
    phone = "+923001160011"
    await client.post("/api/v1/auth/signup", json=signup_body(phone))
    status_resp = await client.get("/api/v1/auth/otp-status", params={"phone": phone})
    assert status_resp.status_code == 200
    body = status_resp.json()
    assert body["expires_at"] is not None and body["expires_in"] > 0
    none_resp = await client.get("/api/v1/auth/otp-status", params={"phone": "+923001169999"})
    assert none_resp.json()["expires_in"] == 0


async def test_qa11_missing_token_is_not_authenticated_bad_token_is_session_expired(client):
    """QA #11: no Authorization header -> NOT_AUTHENTICATED; a present-but-invalid token ->
    SESSION_EXPIRED."""
    none = await client.get("/api/v1/auth/me")
    assert none.status_code == 401 and none.json()["error"]["code"] == "NOT_AUTHENTICATED"
    bad = await client.get("/api/v1/auth/me", headers=bearer("not-a-real-token"))
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "SESSION_EXPIRED"


async def test_qa9_signup_and_request_otp_require_pakistani_mobile_format(client, otp_box):
    """QA #9: request-otp and signup reject numbers that aren't valid PK mobiles (correct
    prefix/length), not just any E.164 shape."""
    for bad_phone in ("+14155551234", "+92300123", "+9231234567890"):
        s = await client.post("/api/v1/auth/signup", json=signup_body(bad_phone))
        assert s.status_code == 422, (bad_phone, s.text)
        r = await client.post("/api/v1/auth/request-otp", json={"phone": bad_phone})
        assert r.status_code == 422, (bad_phone, r.text)
    # a valid PK mobile still works
    ok = await client.post("/api/v1/auth/signup", json=signup_body("+923001160009"))
    assert ok.status_code == 201


# ------------------------------------------------------- session lifecycle


async def test_expired_session_is_rejected(client, db_session_factory, otp_box):
    body = await signup_and_verify(client, otp_box, "+923001150001")
    async with db_session_factory() as session:
        row = await session.scalar(select(SessionModel))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()
    assert (await client.get("/api/v1/auth/me", headers=bearer(body["token"]))).status_code == 401


async def test_refresh_rotates_token_and_extends_the_window(client, db_session_factory, otp_box):
    body = await signup_and_verify(client, otp_box, "+923001150002")
    old = body["token"]
    # Pretend 7h have passed: the session has ~1h left.
    async with db_session_factory() as session:
        row = await session.scalar(select(SessionModel))
        row.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        await session.commit()

    refreshed = await client.post("/api/v1/auth/refresh", headers=bearer(old))
    assert refreshed.status_code == 200
    new = refreshed.json()
    assert new["token"] != old
    hours = (datetime.fromisoformat(new["expires_at"]) - datetime.now(timezone.utc)).total_seconds() / 3600
    assert 7.9 < hours <= 8.0, "refresh must grant a fresh full window"

    assert (await client.get("/api/v1/auth/me", headers=bearer(old))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=bearer(new["token"]))).status_code == 200


async def test_refresh_of_an_already_expired_token_fails(client, db_session_factory, otp_box):
    """Why the client must refresh PROACTIVELY: once expired there's nothing left to refresh."""
    body = await signup_and_verify(client, otp_box, "+923001150003")
    async with db_session_factory() as session:
        row = await session.scalar(select(SessionModel))
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await session.commit()
    resp = await client.post("/api/v1/auth/refresh", headers=bearer(body["token"]))
    assert resp.status_code == 401


async def test_refresh_stops_at_the_365_day_phone_verification_limit(client, db_session_factory, otp_box):
    phone = "+923001150004"
    body = await signup_and_verify(client, otp_box, phone)
    await set_phone_verified_at(db_session_factory, phone, datetime.now(timezone.utc) - timedelta(days=366))

    resp = await client.post("/api/v1/auth/refresh", headers=bearer(body["token"]))
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "PHONE_REVERIFICATION_REQUIRED"
    assert (await client.get("/api/v1/auth/me", headers=bearer(body["token"]))).status_code == 401


async def test_logout_revokes_only_that_session(client, otp_box):
    phone = "+923001150005"
    first = await signup_and_verify(client, otp_box, phone)
    second = (await login(client, phone, device_id="other")).json()

    assert (await client.post("/api/v1/auth/logout", headers=bearer(first["token"]))).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=bearer(first["token"]))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=bearer(second["token"]))).status_code == 200


async def test_me_requires_auth(client):
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_patch_me_cannot_change_phone_or_password(client, otp_box):
    phone = "+923001150006"
    body = await signup_and_verify(client, otp_box, phone)
    resp = await client.patch(
        "/api/v1/auth/me",
        headers=bearer(body["token"]),
        json={"name": "New Name", "phone": "+923009999999", "password_hash": "x", "role": "admin"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"
    assert resp.json()["phone"] == phone and resp.json()["role"] == "player"


# ------------------------------------------------------- OTP infrastructure


async def test_otp_request_rate_limiting(client, otp_box, make_user):
    phone = "+923001160001"
    await make_user(phone)
    for _ in range(5):
        assert (await client.post("/api/v1/auth/request-otp", json={"phone": phone})).status_code == 200
    blocked = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "OTP_RATE_LIMITED"


async def test_otp_send_failure_does_not_consume_rate_limit(client, db_session, make_user, monkeypatch):
    """finding #6: a WhatsApp delivery failure must not burn a rate-limit
    attempt for an OTP that never arrived AND must not surface as a raw 500."""
    phone = "+923001160002"
    await make_user(phone)

    async def failing_send(self, payload):
        raise RuntimeError("simulated WhatsApp Cloud API outage")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", failing_send)
    resp = await client.post("/api/v1/auth/request-otp", json={"phone": phone})
    assert resp.status_code == 502 and resp.json()["error"]["code"] == "OTP_DELIVERY_FAILED"
    rows = (await db_session.execute(select(OtpRequest).where(OtpRequest.phone == phone))).scalars().all()
    assert rows == []


async def test_dev_fixed_otp_used_when_debug_and_set(client, monkeypatch, otp_box):
    settings = get_settings()
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "DEV_FIXED_OTP", "111111")
    await client.post("/api/v1/auth/signup", json=signup_body("+923001160003"))
    assert otp_box.code == "111111"


async def test_dev_fixed_otp_ignored_when_debug_is_false(client, monkeypatch, otp_box):
    settings = get_settings()
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "DEV_FIXED_OTP", "111111")
    monkeypatch.setattr("app.services.auth_service.generate_otp", lambda: "654321")
    await client.post("/api/v1/auth/signup", json=signup_body("+923001160004"))
    assert otp_box.code == "654321", "with DEBUG off the generated code is used, not DEV_FIXED_OTP"


async def test_the_old_otp_login_endpoint_is_gone(client):
    """OTP must never again be a way to log in: it would bypass the password."""
    resp = await client.post("/api/v1/auth/verify-otp", json={"phone": "+923001160005", "otp": "123456"})
    assert resp.status_code in (404, 405)


async def test_invalid_phone_number_rejected(client):
    resp = await client.post("/api/v1/auth/request-otp", json={"phone": "03001234567"})
    assert resp.status_code == 422


# --------------------------------------------------------- password hashing


async def test_password_hashing_roundtrip_and_failure_modes():
    hashed = await hash_password("a-decent-password")
    assert hashed.startswith("$argon2id$")
    assert await verify_password("a-decent-password", hashed) is True
    assert await verify_password("a-decent-passworD", hashed) is False
    assert await verify_password("anything", None) is False
    assert await verify_password("anything", "not-a-real-hash") is False
    assert await hash_password("a-decent-password") != hashed, "salted: same input, different hash"


# ------------------------------------------- TEMPORARY free-form OTP delivery
# WhatsAppService.send_otp sends type "text" instead of the `whatsapp_otp`
# template until Meta Business Verification / an Authentication template exist.
# Revert these two tests together with send_otp (see its docstring / CLAUDE.md).


async def test_otp_send_uses_freeform_text_not_template(client, monkeypatch):
    sent = []

    async def fake_send(self, payload):
        sent.append(payload)
        return {"messages": [{"id": "wamid.local"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)
    phone = "+923001170001"

    resp = await client.post("/api/v1/auth/signup", json=signup_body(phone))
    assert resp.status_code == 201

    assert len(sent) == 1
    payload = sent[0]
    assert payload["type"] == "text"
    assert "template" not in payload
    assert payload["to"] == phone.lstrip("+")
    body = payload["text"]["body"]
    assert "do not share this code" in body
    assert f"{get_settings().OTP_EXPIRE_MINUTES} minutes" in body

    # Generation/hashing is untouched: the code that went out over WhatsApp
    # is the one verify-signup-otp accepts.
    code = re.match(r"(\d{6}) is your verification code", body).group(1)
    verify = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": code})
    assert verify.status_code == 200, verify.text


async def test_otp_send_with_no_open_window_fails_cleanly(client, db_session, monkeypatch):
    """No open 24h window -> Meta answers HTTP 400 / error 131047. That must
    come out as OTP_DELIVERY_FAILED (finding #6's existing handling), not a
    raw 500, and must not leave an OTP row consuming a rate-limit slot. Mocked
    at the httpx layer (not `_send`) so the real raise_for_status + retry path
    is exercised."""
    from app.services.whatsapp_service import WhatsAppService

    monkeypatch.setattr(get_settings(), "WHATSAPP_API_TOKEN", "test-token")

    async def no_sleep(_seconds):
        return None

    # `_send` retries 3x with exponential backoff; skip the real waiting.
    monkeypatch.setattr(WhatsAppService._send.retry, "sleep", no_sleep)

    graph_calls = []
    real_post = httpx.AsyncClient.post

    async def fake_post(self, url, *args, **kwargs):
        if "graph.facebook.com" not in str(url):
            return await real_post(self, url, *args, **kwargs)  # the test client's own requests
        graph_calls.append(kwargs["json"])
        return httpx.Response(
            400,
            json={"error": {"message": "(#131047) Re-engagement message", "type": "OAuthException", "code": 131047}},
            request=httpx.Request("POST", str(url)),
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    phone = "+923001170002"

    resp = await client.post("/api/v1/auth/signup", json=signup_body(phone))

    assert graph_calls, "the free-form send should actually have been attempted"
    assert graph_calls[0]["type"] == "text"
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "OTP_DELIVERY_FAILED"
    rows = (await db_session.execute(select(OtpRequest).where(OtpRequest.phone == phone))).scalars().all()
    assert rows == []
