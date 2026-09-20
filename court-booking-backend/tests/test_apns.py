import base64
from types import SimpleNamespace

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from jose import jwt

from app.config import get_settings
from app.models.fcm_token import FCMToken
from app.services import apns
from app.services.apns import _load_key, send_apns
from app.services.fcm import PushOutcome
from app.services.notification_service import NotificationService

_KEY = ec.generate_private_key(ec.SECP256R1())
_P8 = _KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
_PUBLIC_PEM = _KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()


def _settings(**overrides):
    values = {
        "APNS_KEY": _P8,
        "APNS_KEY_ID": "ABC123DEFG",
        "APNS_TEAM_ID": "TEAM123456",
        "APNS_BUNDLE_ID": "com.maidan.app",
        "APNS_USE_SANDBOX": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture(autouse=True)
def _fresh_cache():
    apns._provider_token_cache.clear()


class _FakeApple:
    def __init__(self, responses=None):
        self.calls: list[dict] = []
        self._responses = list(responses or [(200, {})])

    async def post(self, client, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        status, body = self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))


def _install(monkeypatch, fake):
    monkeypatch.setattr(httpx.AsyncClient, "post", lambda self, url, **kw: fake.post(self, url, **kw))
    return fake


def test_load_key_accepts_pem_escaped_newlines_and_base64():
    escaped = _P8.strip().replace("\n", "\\n")
    for raw in (_P8, escaped, base64.b64encode(_P8.encode()).decode()):
        assert _load_key(raw).startswith("-----BEGIN PRIVATE KEY-----")


@pytest.mark.parametrize("raw", ["", "  ", "definitely not a key!!", base64.b64encode(b"hello").decode()])
def test_load_key_rejects_blank_or_invalid(raw):
    assert _load_key(raw) is None


@pytest.mark.parametrize("missing", ["APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID"])
async def test_skipped_unless_fully_configured(monkeypatch, missing):
    fake = _install(monkeypatch, _FakeApple())
    assert await send_apns(_settings(**{missing: ""}), "tok", "T", "B") == PushOutcome.SKIPPED
    assert fake.calls == []


async def test_sends_a_signed_alert_with_data_under_body(monkeypatch):
    fake = _install(monkeypatch, _FakeApple())
    outcome = await send_apns(_settings(), "abcd1234", "Hello", "World", {"event_type": "payment_submitted", "n": 5})
    assert outcome == PushOutcome.SENT

    call = fake.calls[0]
    assert call["url"] == "https://api.push.apple.com/3/device/abcd1234"
    assert call["headers"]["apns-topic"] == "com.maidan.app"
    assert call["headers"]["apns-push-type"] == "alert"
    assert call["headers"]["apns-priority"] == "10"
    assert call["json"]["aps"]["alert"] == {"title": "Hello", "body": "World"}
    # expo-notifications reads a native APNs payload's `body` key as content.data.
    assert call["json"]["body"] == {"event_type": "payment_submitted", "n": "5"}

    # The provider token is a real ES256 JWT: kid = key id, iss = team id, signed by the .p8.
    scheme, _, token = call["headers"]["authorization"].partition(" ")
    assert scheme == "bearer"
    assert jwt.get_unverified_header(token) == {"alg": "ES256", "kid": "ABC123DEFG", "typ": "JWT"}
    claims = jwt.decode(token, _PUBLIC_PEM, algorithms=["ES256"])
    assert claims["iss"] == "TEAM123456"


async def test_no_body_key_without_data(monkeypatch):
    fake = _install(monkeypatch, _FakeApple())
    await send_apns(_settings(), "tok", "T", "B")
    assert "body" not in fake.calls[0]["json"]


async def test_sandbox_flag_switches_host(monkeypatch):
    fake = _install(monkeypatch, _FakeApple())
    await send_apns(_settings(APNS_USE_SANDBOX=True), "tok", "T", "B")
    assert fake.calls[0]["url"].startswith("https://api.sandbox.push.apple.com/3/device/")


async def test_provider_token_is_reused_within_its_lifetime(monkeypatch):
    fake = _install(monkeypatch, _FakeApple())
    await send_apns(_settings(), "a", "T", "B")
    await send_apns(_settings(), "b", "T", "B")
    assert fake.calls[0]["headers"]["authorization"] == fake.calls[1]["headers"]["authorization"]


async def test_expired_provider_token_is_reminted_and_retried_once(monkeypatch):
    fake = _install(monkeypatch, _FakeApple([(403, {"reason": "ExpiredProviderToken"}), (200, {})]))
    assert await send_apns(_settings(), "a", "T", "B") == PushOutcome.SENT
    assert len(fake.calls) == 2
    # ES256 signatures are randomised, so a re-signed token differs from the rejected one.
    assert fake.calls[0]["headers"]["authorization"] != fake.calls[1]["headers"]["authorization"]


@pytest.mark.parametrize(
    "status, body, expected",
    [
        (410, {"reason": "Unregistered"}, PushOutcome.UNREGISTERED),
        # A sandbox/production mix-up makes EVERY token BadDeviceToken -- must not deactivate them.
        (400, {"reason": "BadDeviceToken"}, PushOutcome.FAILED),
        (400, {"reason": "DeviceTokenNotForTopic"}, PushOutcome.FAILED),
        (403, {"reason": "InvalidProviderToken"}, PushOutcome.FAILED),
        (429, {"reason": "TooManyRequests"}, PushOutcome.FAILED),
        (500, {"reason": "InternalServerError"}, PushOutcome.FAILED),
    ],
)
async def test_error_responses_are_classified(monkeypatch, status, body, expected):
    _install(monkeypatch, _FakeApple([(status, body)]))
    assert await send_apns(_settings(), "a", "T", "B") == expected


async def test_network_failure_and_bad_key_never_raise(monkeypatch):
    async def boom(self, url, **kw):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx.AsyncClient, "post", boom)
    assert await send_apns(_settings(), "a", "T", "B") == PushOutcome.FAILED

    # Valid PEM framing but garbage inside: signing fails, must be contained.
    bad = "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----"
    assert await send_apns(_settings(APNS_KEY=bad), "a", "T", "B") == PushOutcome.FAILED


# -- NotificationService routing (needs the test Postgres) ---------------------


async def test_ios_tokens_go_to_apns_and_android_tokens_to_fcm(db_session, db_session_factory, make_user, monkeypatch):
    sent = []

    async def fake_apns(settings, token, title, body, data=None):
        sent.append(("apns", token))
        return PushOutcome.SENT

    async def fake_fcm(key, token, title, body, data=None):
        sent.append(("fcm", token))
        return PushOutcome.SENT

    monkeypatch.setattr("app.services.notification_service.send_apns", fake_apns)
    monkeypatch.setattr("app.services.notification_service.send_push", fake_fcm)

    user = await make_user("+923010000201")
    async with db_session_factory() as session:
        session.add(FCMToken(user_id=user.id, token="ios-token", platform="ios"))
        session.add(FCMToken(user_id=user.id, token="android-token", platform="android"))
        session.add(FCMToken(user_id=user.id, token="legacy-token", platform=None))
        await session.commit()

    service = NotificationService(db_session, get_settings())
    await service.notify_waitlist_slot_available(user=user, court_name="Court A", starts_at="10:00")

    assert sorted(sent) == [("apns", "ios-token"), ("fcm", "android-token"), ("fcm", "legacy-token")]
