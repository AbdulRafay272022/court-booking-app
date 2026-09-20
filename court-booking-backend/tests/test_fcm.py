import base64
import json
import time

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt
from sqlalchemy import select

from app.config import get_settings
from app.models.fcm_token import FCMToken
from app.services import fcm
from app.services.fcm import PushOutcome, load_service_account, send_push
from app.services.notification_service import NotificationService

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIVATE_PEM = _KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
_PUBLIC_PEM = _KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()

_ACCOUNT = {
    "type": "service_account",
    "project_id": "maidan-test",
    "client_email": "firebase-adminsdk@maidan-test.iam.gserviceaccount.com",
    "private_key": _PRIVATE_PEM,
    "token_uri": "https://oauth2.googleapis.com/token",
}
_RAW = json.dumps(_ACCOUNT)
_B64 = base64.b64encode(_RAW.encode()).decode()


@pytest.fixture(autouse=True)
def _fresh_token_cache():
    fcm._token_cache.clear()


class _FakeGoogle:
    """Stands in for both Google endpoints: the OAuth token exchange and FCM's send."""

    def __init__(self, send_responses=None):
        self.token_calls: list[dict] = []
        self.send_calls: list[dict] = []
        self._send_responses = list(send_responses or [(200, {"name": "projects/maidan-test/messages/1"})])

    async def post(self, client, url, **kwargs):
        if url == _ACCOUNT["token_uri"]:
            self.token_calls.append(kwargs["data"])
            return httpx.Response(
                200, json={"access_token": f"access-{len(self.token_calls)}", "expires_in": 3600},
                request=httpx.Request("POST", url),
            )
        self.send_calls.append({"url": url, **kwargs})
        status, body = self._send_responses.pop(0) if len(self._send_responses) > 1 else self._send_responses[0]
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))


@pytest.fixture
def google(monkeypatch):
    fake = _FakeGoogle()
    monkeypatch.setattr(httpx.AsyncClient, "post", lambda self, url, **kw: fake.post(self, url, **kw))
    return fake


def test_load_service_account_accepts_raw_json_and_base64():
    for raw in (_RAW, _B64, f"  {_B64}\n"):
        account = load_service_account(raw)
        assert account is not None and account.project_id == "maidan-test"


@pytest.mark.parametrize("raw", ["", "   ", "not-json-and-not-base64!!", base64.b64encode(b"{}").decode(), "{}"])
def test_load_service_account_rejects_blank_or_invalid(raw):
    assert load_service_account(raw) is None


async def test_send_push_skipped_without_credentials(google):
    assert await send_push("", "tok", "T", "B") == PushOutcome.SKIPPED
    assert google.token_calls == [] and google.send_calls == []


async def test_send_push_posts_a_v1_message_with_a_signed_oauth_assertion(google):
    outcome = await send_push(_B64, "device-1", "Hello", "World", {"event_type": "payment_submitted", "n": 7})
    assert outcome == PushOutcome.SENT

    # The OAuth assertion is a real RS256 JWT signed with the account's private key.
    assertion = google.token_calls[0]["assertion"]
    claims = jwt.decode(assertion, _PUBLIC_PEM, algorithms=["RS256"], audience=_ACCOUNT["token_uri"])
    assert claims["iss"] == _ACCOUNT["client_email"]
    assert claims["scope"] == fcm.FCM_SCOPE
    assert google.token_calls[0]["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"

    sent = google.send_calls[0]
    assert sent["url"] == "https://fcm.googleapis.com/v1/projects/maidan-test/messages:send"
    assert sent["headers"]["Authorization"] == "Bearer access-1"
    message = sent["json"]["message"]
    assert message["token"] == "device-1"
    assert message["notification"] == {"title": "Hello", "body": "World"}
    assert message["data"] == {"event_type": "payment_submitted", "n": "7"}  # FCM wants strings
    assert message["android"]["notification"]["channel_id"] == fcm.ANDROID_CHANNEL_ID


async def test_access_token_is_cached_across_sends(google):
    await send_push(_RAW, "a", "T", "B")
    await send_push(_RAW, "b", "T", "B")
    assert len(google.token_calls) == 1 and len(google.send_calls) == 2


async def test_expired_cached_token_is_reminted(google):
    await send_push(_RAW, "a", "T", "B")
    fcm._token_cache[_ACCOUNT["client_email"]] = ("stale", time.time() + 5)  # inside the margin
    await send_push(_RAW, "b", "T", "B")
    assert len(google.token_calls) == 2
    assert google.send_calls[1]["headers"]["Authorization"] == "Bearer access-2"


async def test_a_401_from_fcm_mints_a_fresh_token_and_retries_once(monkeypatch):
    fake = _FakeGoogle(send_responses=[(401, {"error": {"status": "UNAUTHENTICATED"}}), (200, {})])
    monkeypatch.setattr(httpx.AsyncClient, "post", lambda self, url, **kw: fake.post(self, url, **kw))
    assert await send_push(_RAW, "a", "T", "B") == PushOutcome.SENT
    assert len(fake.token_calls) == 2
    assert [c["headers"]["Authorization"] for c in fake.send_calls] == ["Bearer access-1", "Bearer access-2"]


@pytest.mark.parametrize(
    "status, body, expected",
    [
        (404, {"error": {"status": "NOT_FOUND", "details": [{"errorCode": "UNREGISTERED"}]}}, PushOutcome.UNREGISTERED),
        (400, {"error": {"status": "INVALID_ARGUMENT", "message": "The registration token is not a valid FCM registration token"}}, PushOutcome.UNREGISTERED),
        # A bad payload is also INVALID_ARGUMENT -- must NOT kill the device's token.
        (400, {"error": {"status": "INVALID_ARGUMENT", "message": "Invalid value at 'message.data'"}}, PushOutcome.FAILED),
        (403, {"error": {"status": "PERMISSION_DENIED"}}, PushOutcome.FAILED),
        (500, {"error": {"status": "INTERNAL"}}, PushOutcome.FAILED),
    ],
)
async def test_error_responses_are_classified(monkeypatch, status, body, expected):
    fake = _FakeGoogle(send_responses=[(status, body)])
    monkeypatch.setattr(httpx.AsyncClient, "post", lambda self, url, **kw: fake.post(self, url, **kw))
    assert await send_push(_RAW, "a", "T", "B") == expected


async def test_network_failure_never_raises(monkeypatch):
    async def boom(self, url, **kw):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx.AsyncClient, "post", boom)
    assert await send_push(_RAW, "a", "T", "B") == PushOutcome.FAILED


async def test_bad_private_key_never_raises(google):
    broken = json.dumps({**_ACCOUNT, "private_key": "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n"})
    assert await send_push(broken, "a", "T", "B") == PushOutcome.FAILED


# -- NotificationService integration (needs the test Postgres) ---------------


async def test_push_tier_sends_event_data_and_deactivates_dead_tokens(
    db_session, db_session_factory, make_user, monkeypatch
):
    calls = []

    async def fake_push(self, token, title, body, data=None):
        calls.append((token, data))
        return PushOutcome.UNREGISTERED if token == "dead-token" else PushOutcome.SENT

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923010000101")
    async with db_session_factory() as session:
        session.add(FCMToken(user_id=owner.id, token="dead-token"))
        session.add(FCMToken(user_id=owner.id, token="live-token"))
        await session.commit()

    import uuid

    booking_id = uuid.uuid4()
    service = NotificationService(db_session, get_settings())
    await service.notify_payment_submitted(owner=owner, court_name="Court A", amount=1000, booking_id=booking_id)

    assert {c[0] for c in calls} == {"dead-token", "live-token"}
    assert all(c[1] == {"event_type": "payment_submitted", "reference_id": str(booking_id)} for c in calls)

    async with db_session_factory() as session:
        rows = {t.token: t.is_active for t in (await session.execute(select(FCMToken))).scalars()}
    assert rows == {"dead-token": False, "live-token": True}
