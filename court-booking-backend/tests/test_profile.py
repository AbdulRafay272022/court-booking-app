"""Section 26 follow-up: profile editing, unique (case-insensitive) email, and the
authenticated phone-number change flow."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.models.audit import AuditLog
from app.models.user import LoginAttempt, OtpRequest, Session as SessionModel, User

# Shared helpers/fixtures from the auth tests (tests/ is on sys.path; `otp_box` is a fixture).
from test_auth import (  # noqa: F401
    PASSWORD,
    bearer,
    login,
    otp_box,
    set_phone_verified_at,
    signup_and_verify,
    signup_body,
)

# ------------------------------------------------------------ email uniqueness


async def test_signup_with_an_email_already_in_use_is_a_clean_409(client, otp_box):
    await signup_and_verify(client, otp_box, "+923002220001", email="taken@example.com")
    otp_box.sent.clear()

    resp = await client.post("/api/v1/auth/signup", json=signup_body("+923002220002", email="taken@example.com"))
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "EMAIL_ALREADY_IN_USE"
    assert otp_box.sent == [], "no OTP for a signup that was refused"


async def test_case_variant_emails_collide(client, otp_box):
    await signup_and_verify(client, otp_box, "+923002220003", email="Mixed.Case@Example.com")
    resp = await client.post("/api/v1/auth/signup", json=signup_body("+923002220004", email="MIXED.case@EXAMPLE.COM"))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "EMAIL_ALREADY_IN_USE"


async def test_the_database_itself_rejects_case_variant_duplicates(db_session, make_user):
    """The functional unique index on lower(email) is the real guarantee -- not just the service check."""
    from sqlalchemy.exc import IntegrityError

    await make_user("+923002220005", email="dbcheck@example.com")
    db_session.add(User(phone="+923002220006", email="DBCHECK@example.com"))
    with pytest.raises(IntegrityError) as exc:
        await db_session.commit()
    assert "uq_users_email_lower" in str(exc.value)
    await db_session.rollback()


async def test_abandoned_unverified_signup_does_not_hold_an_email_hostage(client, db_session, otp_box):
    """Someone signs up with your email but never verifies. You must still be able to use it."""
    await client.post("/api/v1/auth/signup", json=signup_body("+923002220007", email="victim@example.com"))
    pending = await db_session.scalar(select(User).where(User.phone == "+923002220007"))
    assert pending.phone_verified_at is None

    body = await signup_and_verify(client, otp_box, "+923002220008", email="victim@example.com")
    assert body["user"]["email"] == "victim@example.com"

    db_session.expire_all()
    pending = await db_session.scalar(select(User).where(User.phone == "+923002220007"))
    assert pending.email is None
    audit = (await db_session.execute(select(AuditLog).where(AuditLog.action == "email_released_abandoned_signup"))).scalars().all()
    assert len(audit) == 1 and audit[0].old_value == {"email": "victim@example.com"}


async def test_resubmitting_your_own_pending_signup_keeps_your_own_email(client, otp_box):
    phone = "+923002220009"
    await client.post("/api/v1/auth/signup", json=signup_body(phone, email="mine@example.com"))
    resp = await client.post("/api/v1/auth/signup", json=signup_body(phone, email="mine@example.com", name="Retry Name"))
    assert resp.status_code == 201


# ------------------------------------------------------------ profile editing


async def test_profile_edit_persists_name_email_city_gender(client, otp_box):
    body = await signup_and_verify(client, otp_box, "+923002230001")
    resp = await client.patch(
        "/api/v1/auth/me",
        headers=bearer(body["token"]),
        json={"name": "  New   Name ", "email": "New.Email@Example.com", "city": "multan", "gender": "other"},
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["name"] == "New Name" and out["email"] == "new.email@example.com"
    assert out["city"] == "multan" and out["gender"] == "other"

    me = (await client.get("/api/v1/auth/me", headers=bearer(body["token"]))).json()["user"]
    assert (me["name"], me["email"], me["city"], me["gender"]) == ("New Name", "new.email@example.com", "multan", "other")


async def test_profile_edit_is_partial(client, otp_box):
    body = await signup_and_verify(client, otp_box, "+923002230002")
    resp = await client.patch("/api/v1/auth/me", headers=bearer(body["token"]), json={"city": "kohat"})
    assert resp.status_code == 200
    assert resp.json()["city"] == "kohat" and resp.json()["name"] == "Ayesha Khan"


@pytest.mark.parametrize(
    "payload",
    [{"email": "not-an-email"}, {"city": "atlantis"}, {"gender": "robot"}, {"name": " "}, {"email": None}, {"name": None}],
)
async def test_profile_edit_rejects_invalid_values(client, otp_box, payload):
    body = await signup_and_verify(client, otp_box, "+923002230003")
    resp = await client.patch("/api/v1/auth/me", headers=bearer(body["token"]), json=payload)
    assert resp.status_code == 422, resp.text


async def test_profile_edit_cannot_change_phone_password_or_role(client, db_session, otp_box):
    phone = "+923002230004"
    body = await signup_and_verify(client, otp_box, phone)
    before = await db_session.scalar(select(User.password_hash).where(User.phone == phone))
    resp = await client.patch(
        "/api/v1/auth/me",
        headers=bearer(body["token"]),
        json={"name": "Still Me", "phone": "+923009999999", "password": "hacked-pass-1", "password_hash": "x", "role": "admin"},
    )
    assert resp.status_code == 200
    assert resp.json()["phone"] == phone and resp.json()["role"] == "player"
    db_session.expire_all()
    assert await db_session.scalar(select(User.password_hash).where(User.phone == phone)) == before
    assert (await login(client, phone)).status_code == 200


async def test_profile_email_edit_to_someone_elses_email_is_a_clean_409(client, db_session, otp_box):
    await signup_and_verify(client, otp_box, "+923002230005", email="first@example.com")
    body = await signup_and_verify(client, otp_box, "+923002230006", email="second@example.com")
    resp = await client.patch("/api/v1/auth/me", headers=bearer(body["token"]), json={"email": "FIRST@example.com"})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "EMAIL_ALREADY_IN_USE"
    db_session.expire_all()
    assert await db_session.scalar(select(User.email).where(User.phone == "+923002230006")) == "second@example.com"


async def test_profile_email_edit_to_your_own_email_(client, otp_box):
    body = await signup_and_verify(client, otp_box, "+923002230007", email="same@example.com")
    resp = await client.patch("/api/v1/auth/me", headers=bearer(body["token"]), json={"email": "SAME@example.com", "name": "Renamed"})
    assert resp.status_code == 200 and resp.json()["email"] == "same@example.com"


# ------------------------------------------------------------ phone change


NEW = "+923002240099"


async def _signed_in(client, otp_box, phone):
    body = await signup_and_verify(client, otp_box, phone)
    return body["token"], phone


async def test_phone_change_full_flow(client, db_session, otp_box):
    old = "+923002240001"
    token, _ = await _signed_in(client, otp_box, old)
    second = (await login(client, old)).json()["token"]  # a second device

    otp_box.sent.clear()
    req = await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    assert req.status_code == 200 and req.json()["expires_in"] == 300
    assert otp_box.sent == [(NEW, otp_box.code)], "the code goes to the NEW number"

    # Requesting alone changes nothing.
    db_session.expire_all()
    assert (await db_session.scalar(select(User.phone).where(User.email == f"user{old.lstrip('+')}@example.com"))) == old

    done = await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": otp_box.code})
    assert done.status_code == 200, done.text
    assert done.json()["phone"] == NEW and done.json()["sign_in_again"] is True

    # Every previously-valid token is dead, including the one that made the request.
    for t in (token, second):
        assert (await client.get("/api/v1/auth/me", headers=bearer(t))).status_code == 401

    # Old number no longer logs in; the new number + the SAME password does.
    assert (await login(client, old)).status_code == 401
    ok = await login(client, NEW)
    assert ok.status_code == 200 and ok.json()["user"]["phone"] == NEW
    assert ok.json()["user"]["phone_verified_at"] is not None

    db_session.expire_all()
    revoked = (await db_session.execute(select(SessionModel).where(SessionModel.revoked_reason == "phone_changed"))).scalars().all()
    assert len(revoked) == 2


async def test_phone_change_marks_the_new_number_verified_now(client, db_session, db_session_factory, otp_box):
    old = "+923002240002"
    token, _ = await _signed_in(client, otp_box, old)
    await set_phone_verified_at(db_session_factory, old, datetime.now(timezone.utc) - timedelta(days=300))
    await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": otp_box.code})
    db_session.expire_all()
    stamp = await db_session.scalar(select(User.phone_verified_at).where(User.phone == NEW))
    assert datetime.now(timezone.utc) - stamp < timedelta(minutes=1)


async def test_abandoned_phone_change_leaves_everything_untouched(client, db_session, otp_box):
    old = "+923002240003"
    token, _ = await _signed_in(client, otp_box, old)
    await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    # ...the user never verifies. Original number, session and login all still work.
    assert (await client.get("/api/v1/auth/me", headers=bearer(token))).json()["user"]["phone"] == old
    assert (await login(client, old)).status_code == 200
    db_session.expire_all()
    assert await db_session.scalar(select(User).where(User.phone == NEW)) is None


async def test_failed_verification_leaves_the_original_number_intact(client, db_session, otp_box):
    old = "+923002240004"
    token, _ = await _signed_in(client, otp_box, old)
    await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    real = otp_box.code
    wrong = "000000" if real != "000000" else "111111"

    bad = await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": wrong})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "INVALID_OTP"

    assert (await client.get("/api/v1/auth/me", headers=bearer(token))).json()["user"]["phone"] == old
    assert (await login(client, old)).status_code == 200
    db_session.expire_all()
    assert await db_session.scalar(select(User).where(User.phone == NEW)) is None

    # ...and the real code still works afterwards (a wrong guess didn't burn it).
    good = await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": real})
    assert good.status_code == 200


async def test_phone_change_wrong_attempts_lock_out(client, otp_box):
    token, _ = await _signed_in(client, otp_box, "+923002240005")
    await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    wrong = "000000" if otp_box.code != "000000" else "111111"
    for _ in range(5):
        await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": wrong})
    locked = await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": otp_box.code})
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "OTP_RATE_LIMITED"


async def test_phone_change_needs_the_current_password(client, otp_box):
    token, _ = await _signed_in(client, otp_box, "+923002240006")
    otp_box.sent.clear()
    resp = await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": "not-my-password"})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert otp_box.sent == []
    assert (await client.get("/api/v1/auth/me", headers=bearer(token))).status_code == 200, "a wrong password must not sign anyone out"


async def test_phone_change_password_guesses_share_the_login_lockout(client, otp_box):
    phone = "+923002240007"
    token, _ = await _signed_in(client, otp_box, phone)
    for _ in range(5):
        await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": "guess-guess-1"})
    blocked = await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "LOGIN_RATE_LIMITED"
    assert (await login(client, phone, PASSWORD)).status_code == 429, "same lockout as login"


async def test_phone_change_to_a_number_already_registered_is_refused(client, otp_box):
    await signup_and_verify(client, otp_box, "+923002240008")
    token, _ = await _signed_in(client, otp_box, "+923002240009")
    otp_box.sent.clear()
    resp = await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": "+923002240008", "password": PASSWORD})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "PHONE_ALREADY_REGISTERED"
    assert otp_box.sent == []


async def test_phone_change_to_your_current_number_is_refused(client, otp_box):
    token, phone = await _signed_in(client, otp_box, "+923002240010")
    resp = await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": phone, "password": PASSWORD})
    assert resp.status_code == 400


async def test_number_taken_between_request_and_verify_is_caught_and_rolls_back(client, db_session, make_user, otp_box):
    old = "+923002240011"
    token, _ = await _signed_in(client, otp_box, old)
    await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    await make_user(NEW)  # someone registers it in the meantime (verified)
    resp = await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": otp_box.code})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "PHONE_ALREADY_REGISTERED"
    assert (await client.get("/api/v1/auth/me", headers=bearer(token))).json()["user"]["phone"] == old


async def test_a_code_requested_by_one_user_cannot_be_redeemed_by_another(client, db_session, otp_box):
    a_token, _ = await _signed_in(client, otp_box, "+923002240012")
    b_token, _ = await _signed_in(client, otp_box, "+923002240013")
    await client.post("/api/v1/auth/request-phone-change", headers=bearer(a_token), json={"new_phone": NEW, "password": PASSWORD})
    stolen = await client.post("/api/v1/auth/verify-phone-change", headers=bearer(b_token), json={"new_phone": NEW, "otp": otp_box.code})
    assert stolen.status_code == 400 and stolen.json()["error"]["code"] == "OTP_EXPIRED"


async def test_other_otp_purposes_cannot_complete_a_phone_change(client, otp_box):
    phone = "+923002240014"
    token, _ = await _signed_in(client, otp_box, phone)
    await client.post("/api/v1/auth/request-otp", headers=bearer(token), json={"phone": phone})  # a reverify code, for the OLD number
    resp = await client.post("/api/v1/auth/verify-phone-change", headers=bearer(token), json={"new_phone": NEW, "otp": otp_box.code})
    assert resp.status_code == 400


async def test_phone_change_delivery_failure_is_clean(client, db_session, otp_box, monkeypatch):
    token, _ = await _signed_in(client, otp_box, "+923002240015")

    async def failing_send(self, payload):
        raise RuntimeError("simulated WhatsApp outage")

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", failing_send)
    from app.services.whatsapp_service import WhatsAppService

    async def real_send_otp(self, phone, code):
        return await self.send_text(phone, code)

    monkeypatch.setattr(WhatsAppService, "send_otp", real_send_otp)
    resp = await client.post("/api/v1/auth/request-phone-change", headers=bearer(token), json={"new_phone": NEW, "password": PASSWORD})
    assert resp.status_code == 502 and resp.json()["error"]["code"] == "OTP_DELIVERY_FAILED"
    rows = (await db_session.execute(select(OtpRequest).where(OtpRequest.phone == NEW))).scalars().all()
    assert rows == []


async def test_legacy_session_without_a_password_must_set_one_first(client, make_user, make_auth_headers):
    user = await make_user("+923002240016")  # pre-Section-26 account: no password_hash
    headers = await make_auth_headers(user)
    resp = await client.post("/api/v1/auth/request-phone-change", headers=headers, json={"new_phone": NEW, "password": "whatever-1"})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "PASSWORD_NOT_SET"


async def test_phone_change_requires_auth(client):
    r1 = await client.post("/api/v1/auth/request-phone-change", json={"new_phone": NEW, "password": "x"})
    r2 = await client.post("/api/v1/auth/verify-phone-change", json={"new_phone": NEW, "otp": "123456"})
    assert r1.status_code == 401 and r2.status_code == 401
