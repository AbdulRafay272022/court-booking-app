"""Round 2 Stage 2: Web Push (docs/web-push-plan.md section 9). Real Postgres; the push services are mocked."""
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select

from app.config import get_settings
from app.jobs.web_push_cleanup import clean_web_push_subscriptions
from app.models.feature_flag import FeatureFlag
from app.models.fcm_token import FCMToken
from app.models.notification import NotificationLog
from app.models.user import User, UserRole
from app.models.web_push_subscription import WebPushSubscription
from app.services import web_push
from app.services.notification_service import NotificationService
from app.services.web_push import (
    WebPushOutcome,
    WebPushResult,
    b64url_decode,
    b64url_encode,
    decrypt_payload,
    encrypt_payload,
    endpoint_allowed,
    private_key_from_b64,
    send_web_push,
    vapid_jwt,
)

URL = "/api/v1/users/me/web-push"
FCM_EP = "https://fcm.googleapis.com/fcm/send/abc123"


# -- RFC 8291 Appendix A test vector ------------------------------------------------------------------------------
RFC_PLAINTEXT = "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"
RFC_AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
RFC_UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
RFC_UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
RFC_AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw"
RFC_BODY = (
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_y"
    "l95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
)


def test_encryption_matches_the_rfc8291_test_vector():
    body = encrypt_payload(
        b64url_decode(RFC_PLAINTEXT), RFC_UA_PUBLIC, RFC_AUTH,
        as_private=private_key_from_b64(RFC_AS_PRIVATE), salt=b64url_decode(RFC_SALT),
    )
    assert b64url_encode(body) == RFC_BODY
    assert decrypt_payload(body, private_key_from_b64(RFC_UA_PRIVATE), RFC_AUTH) == b"When I grow up, I want to be a watermelon"


def _browser():
    ua = ec.generate_private_key(ec.SECP256R1())
    pub = b64url_encode(web_push._public_bytes(ua.public_key()))
    return ua, pub, b64url_encode(b"0123456789abcdef")


def test_encryption_round_trip_with_fresh_keys():
    ua, pub, auth = _browser()
    body = encrypt_payload(b'{"title":"x"}', pub, auth)
    assert decrypt_payload(body, ua, auth) == b'{"title":"x"}'


def test_vapid_jwt_is_a_valid_es256_token():
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    import json

    key = ec.generate_private_key(ec.SECP256R1())
    priv = b64url_encode(key.private_numbers().private_value.to_bytes(32, "big"))
    token = vapid_jwt("https://fcm.googleapis.com/fcm/send/x", priv, "mailto:ops@example.com", now=1_000_000)
    head, claims, sig = token.split(".")
    assert json.loads(b64url_decode(head)) == {"typ": "JWT", "alg": "ES256"}
    c = json.loads(b64url_decode(claims))
    assert c["aud"] == "https://fcm.googleapis.com" and c["sub"] == "mailto:ops@example.com" and c["exp"] == 1_000_000 + 12 * 3600
    raw = b64url_decode(sig)
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    key.public_key().verify(der, f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))


def test_endpoint_allow_list():
    assert endpoint_allowed(FCM_EP)
    assert endpoint_allowed("https://updates.push.services.mozilla.com/wpush/v2/x")
    assert endpoint_allowed("https://web.push.apple.com/abc")
    assert endpoint_allowed("https://wns2-par02p.notify.windows.com/w/?token=x")
    for bad in (
        "http://fcm.googleapis.com/fcm/send/x",
        "https://evil.example.com/x",
        "https://127.0.0.1/x",
        "https://[::1]/x",
        "https://fcm.googleapis.com.evil.com/x",
        "https://push.apple.com/x",
        "https://user:pw@fcm.googleapis.com/x",
        "https://fcm.googleapis.com:8443/x",
        "not a url",
    ):
        assert not endpoint_allowed(bad), bad


@pytest.fixture
def vapid(monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    s = get_settings()
    monkeypatch.setattr(s, "WEB_PUSH_VAPID_PRIVATE_KEY", b64url_encode(key.private_numbers().private_value.to_bytes(32, "big")))
    monkeypatch.setattr(s, "WEB_PUSH_VAPID_PUBLIC_KEY", b64url_encode(web_push._public_bytes(key.public_key())))
    monkeypatch.setattr(s, "WEB_PUSH_VAPID_SUBJECT", "mailto:ops@example.com")
    return s


async def _send_with(responses, settings, monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        calls.append(request)
        r = responses[min(len(calls) - 1, len(responses) - 1)]
        if isinstance(r, Exception):
            raise r
        return r

    async def no_sleep(_s):
        return None

    monkeypatch.setattr(web_push.asyncio, "sleep", no_sleep)
    _ua, pub, auth = _browser()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await send_web_push(
            settings, endpoint=FCM_EP, p256dh=pub, auth=auth, payload=b'{"title":"t"}', urgency="high", topic="abc",
            client=client,
        )
    return result, calls


async def test_sender_outcomes(vapid, monkeypatch):
    r, calls = await _send_with([httpx.Response(201)], vapid, monkeypatch)
    assert r.outcome == WebPushOutcome.SENT and len(calls) == 1
    h = calls[0].headers
    assert h["Content-Encoding"] == "aes128gcm" and h["TTL"] == "3600" and h["Urgency"] == "high" and h["Topic"] == "abc"
    assert h["Authorization"].startswith("vapid t=") and f"k={vapid.WEB_PUSH_VAPID_PUBLIC_KEY}" in h["Authorization"]

    for code in (404, 410):
        r, calls = await _send_with([httpx.Response(code)], vapid, monkeypatch)
        assert r.outcome == WebPushOutcome.UNREGISTERED and len(calls) == 1 and str(code) in r.error
    for code in (400, 403, 413):
        r, calls = await _send_with([httpx.Response(code)], vapid, monkeypatch)
        assert r.outcome == WebPushOutcome.FAILED and len(calls) == 1
    r, calls = await _send_with([httpx.Response(429, headers={"Retry-After": "2"}), httpx.Response(429)], vapid, monkeypatch)
    assert r.outcome == WebPushOutcome.FAILED and len(calls) == 2 and "429" in r.error
    r, calls = await _send_with([httpx.Response(503), httpx.Response(201)], vapid, monkeypatch)
    assert r.outcome == WebPushOutcome.SENT and len(calls) == 2
    r, calls = await _send_with([httpx.ConnectTimeout("t"), httpx.ConnectTimeout("t")], vapid, monkeypatch)
    assert r.outcome == WebPushOutcome.FAILED and len(calls) == 2


async def test_sender_without_keys_is_skipped(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "WEB_PUSH_VAPID_PRIVATE_KEY", "")
    r = await send_web_push(s, endpoint=FCM_EP, p256dh="x", auth="y", payload=b"{}")
    assert r.outcome == WebPushOutcome.SKIPPED


def _sub_body(endpoint=FCM_EP, ua="Chrome"):
    _ua, pub, auth = _browser()
    return {"endpoint": endpoint, "keys": {"p256dh": pub, "auth": auth}, "user_agent": ua}


async def test_config_reflects_keys_and_flag(client, db_session_factory, make_user, make_auth_headers, vapid, monkeypatch):
    user = await make_user("+923023000001")
    h = await make_auth_headers(user)
    body = (await client.get(URL + "/config", headers=h)).json()
    assert body == {"enabled": True, "public_key": vapid.WEB_PUSH_VAPID_PUBLIC_KEY}
    async with db_session_factory() as s:
        s.add(FeatureFlag(key="push_notifications", enabled=False, label="push"))
        await s.commit()
    assert (await client.get(URL + "/config", headers=h)).json()["enabled"] is False
    monkeypatch.setattr(vapid, "WEB_PUSH_VAPID_PRIVATE_KEY", "")
    assert (await client.get(URL + "/config", headers=h)).json() == {"enabled": False, "public_key": None}


async def test_subscribe_upsert_reassign_unsubscribe_status(client, db_session_factory, make_user, make_auth_headers):
    a = await make_user("+923023000011")
    b = await make_user("+923023000012")
    ah, bh = await make_auth_headers(a), await make_auth_headers(b)
    assert (await client.post(URL, headers=ah, json=_sub_body())).status_code == 201
    assert (await client.post(URL, headers=ah, json=_sub_body())).status_code == 201  # upsert, not a second row
    assert (await client.get(URL, headers=ah, params={"endpoint": FCM_EP})).json() == {"subscribed": True}
    # the same browser signs in as b: the row moves to b
    assert (await client.post(URL, headers=bh, json=_sub_body())).status_code == 201
    async with db_session_factory() as s:
        rows = (await s.execute(select(WebPushSubscription))).scalars().all()
        assert len(rows) == 1 and rows[0].user_id == b.id and rows[0].revoked_at is None
    assert (await client.get(URL, headers=ah, params={"endpoint": FCM_EP})).json() == {"subscribed": False}
    # a cannot revoke b's row (204 anyway); b can
    assert (await client.request("DELETE", URL, headers=ah, json={"endpoint": FCM_EP})).status_code == 204
    assert (await client.get(URL, headers=bh, params={"endpoint": FCM_EP})).json() == {"subscribed": True}
    assert (await client.request("DELETE", URL, headers=bh, json={"endpoint": FCM_EP})).status_code == 204
    assert (await client.get(URL, headers=bh, params={"endpoint": FCM_EP})).json() == {"subscribed": False}
    assert (await client.request("DELETE", URL, headers=bh, json={"endpoint": "https://fcm.googleapis.com/unknown"})).status_code == 204
    # re-subscribing clears revoked_at
    assert (await client.post(URL, headers=bh, json=_sub_body())).status_code == 201
    assert (await client.get(URL, headers=bh, params={"endpoint": FCM_EP})).json() == {"subscribed": True}


async def test_subscribe_rejects_bad_endpoints(client, make_user, make_auth_headers):
    h = await make_auth_headers(await make_user("+923023000021"))
    for bad in ("http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://10.0.0.1/x"):
        resp = await client.post(URL, headers=h, json=_sub_body(endpoint=bad))
        assert resp.status_code == 422 and resp.json()["error"]["code"] == "WEB_PUSH_ENDPOINT_NOT_ALLOWED"


async def test_at_most_ten_active_per_user(client, db_session_factory, make_user, make_auth_headers):
    user = await make_user("+923023000031")
    h = await make_auth_headers(user)
    for i in range(12):
        assert (await client.post(URL, headers=h, json=_sub_body(endpoint=f"{FCM_EP}{i}"))).status_code == 201
    async with db_session_factory() as s:
        active = (
            await s.execute(select(WebPushSubscription).where(WebPushSubscription.revoked_at.is_(None)))
        ).scalars().all()
        assert len(active) == 10
        assert f"{FCM_EP}11" in {r.endpoint for r in active}


async def test_push_tier_sends_web_push_logs_truthfully_and_revokes_gone(db_session_factory, make_user, vapid, monkeypatch):
    user = await make_user("+923023000041", role=UserRole.OWNER)
    async with db_session_factory() as s:
        s.add(FCMToken(user_id=user.id, token="android-token", platform="android"))
        for ep in ("ok", "gone", "down"):
            s.add(WebPushSubscription(user_id=user.id, endpoint=f"{FCM_EP}-{ep}", p256dh="k", auth="a"))
        await s.commit()

    fcm_calls = []

    async def fake_push(self, token, title, body, data=None):
        fcm_calls.append(token)

    async def fake_web_push(settings, *, endpoint, p256dh, auth, payload, urgency, topic, client=None):
        if endpoint.endswith("gone"):
            return WebPushResult(WebPushOutcome.UNREGISTERED, 410, "web_push gone (410)")
        if endpoint.endswith("down"):
            return WebPushResult(WebPushOutcome.FAILED, 503, "web_push failed (503)")
        assert urgency == "high" and b"/dashboard/owner/approvals" in payload
        return WebPushResult(WebPushOutcome.SENT, 201)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)
    monkeypatch.setattr("app.services.notification_service.send_web_push", fake_web_push)
    import uuid

    ref = uuid.uuid4()
    async with db_session_factory() as s:
        u = await s.get(User, user.id)
        await NotificationService(s, get_settings()).notify_payment_submitted(
            owner=u, court_name="Futsal 1", amount=2000, booking_id=ref
        )
    assert fcm_calls == ["android-token"]  # the FCM path is untouched
    async with db_session_factory() as s:
        rows = (await s.execute(select(NotificationLog).where(NotificationLog.reference_id == ref))).scalars().all()
        web = sorted((r.status, r.error_message or "") for r in rows if r.channel == "web_push")
        assert web == [("failed", "web_push failed (503)"), ("failed", "web_push gone (410)"), ("sent", "")]
        assert [r.channel for r in rows if r.channel == "push"] == ["push"]
        subs = {r.endpoint.rsplit("-", 1)[1]: r for r in (await s.execute(select(WebPushSubscription))).scalars().all()}
        assert subs["gone"].revoked_at is not None and subs["ok"].revoked_at is None and subs["ok"].last_seen_at is not None
        assert subs["down"].revoked_at is None


async def test_bell_row_only_when_no_device_and_no_web_push(db_session_factory, make_user, vapid, monkeypatch):
    import uuid

    user = await make_user("+923023000042", role=UserRole.OWNER)

    async def fake_web_push(settings, **kw):
        return WebPushResult(WebPushOutcome.SENT, 201)

    monkeypatch.setattr("app.services.notification_service.send_web_push", fake_web_push)
    ref = uuid.uuid4()
    async with db_session_factory() as s:
        u = await s.get(User, user.id)
        await NotificationService(s, get_settings()).notify_payment_submitted(owner=u, court_name="F", amount=1, booking_id=ref)
        rows = (await s.execute(select(NotificationLog).where(NotificationLog.reference_id == ref))).scalars().all()
        assert [r.channel for r in rows] == ["in_app"]
        s.add(WebPushSubscription(user_id=user.id, endpoint=FCM_EP, p256dh="k", auth="a"))
        await s.commit()
        ref2 = uuid.uuid4()
        await NotificationService(s, get_settings()).notify_payment_submitted(owner=u, court_name="F", amount=1, booking_id=ref2)
        rows = (await s.execute(select(NotificationLog).where(NotificationLog.reference_id == ref2))).scalars().all()
        assert [r.channel for r in rows] == ["web_push"]


async def test_cleanup_job(db_session_factory, make_user):
    user = await make_user("+923023000051")
    now = datetime.now(timezone.utc)
    async with db_session_factory() as s:
        s.add_all([
            WebPushSubscription(user_id=user.id, endpoint=FCM_EP + "old-revoked", p256dh="k", auth="a", revoked_at=now - timedelta(days=31)),
            WebPushSubscription(user_id=user.id, endpoint=FCM_EP + "new-revoked", p256dh="k", auth="a", revoked_at=now - timedelta(days=5)),
            WebPushSubscription(user_id=user.id, endpoint=FCM_EP + "stale", p256dh="k", auth="a", last_seen_at=now - timedelta(days=91)),
            WebPushSubscription(user_id=user.id, endpoint=FCM_EP + "fresh", p256dh="k", auth="a", last_seen_at=now - timedelta(days=1)),
        ])
        await s.commit()
        never = WebPushSubscription(user_id=user.id, endpoint=FCM_EP + "never-seen", p256dh="k", auth="a")
        s.add(never)
        await s.flush()
        never.created_at = now - timedelta(days=100)
        await s.commit()

    assert await clean_web_push_subscriptions(session_factory=db_session_factory) == {"deleted": 1, "revoked": 2}
    assert await clean_web_push_subscriptions(session_factory=db_session_factory) == {"deleted": 0, "revoked": 0}
    async with db_session_factory() as s:
        rows = {r.endpoint.removeprefix(FCM_EP): r for r in (await s.execute(select(WebPushSubscription))).scalars().all()}
    assert set(rows) == {"new-revoked", "stale", "fresh", "never-seen"}
    assert rows["stale"].revoked_at and rows["never-seen"].revoked_at and rows["fresh"].revoked_at is None


def test_make_vapid_keys_script_prints_a_usable_pair(capsys):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "make_vapid_keys.py"
    spec = importlib.util.spec_from_file_location("make_vapid_keys", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.main()
    out = dict(line.split("=", 1) for line in capsys.readouterr().out.strip().splitlines())
    priv = private_key_from_b64(out["WEB_PUSH_VAPID_PRIVATE_KEY"])
    assert b64url_encode(web_push._public_bytes(priv.public_key())) == out["WEB_PUSH_VAPID_PUBLIC_KEY"]
