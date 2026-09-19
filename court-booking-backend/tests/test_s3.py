import asyncio
import time

from app.config import get_settings
from app.utils import s3


class _FakeS3Client:
    def __init__(self):
        self.put_object_calls = []

    def put_object(self, **kwargs):
        self.put_object_calls.append(kwargs)


async def test_private_proof_upload_uses_kms_encryption(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "S3_KMS_KEY_ID", "test-kms-key-id")

    fake_client = _FakeS3Client()
    monkeypatch.setattr(s3, "_client", lambda: fake_client)

    key = await s3.upload_private_proof(b"fake-image-bytes", "proof.jpg", "image/jpeg")

    assert len(fake_client.put_object_calls) == 1
    call = fake_client.put_object_calls[0]
    assert call["Bucket"] == settings.S3_BUCKET_PRIVATE
    assert call["Key"] == key
    assert call["ServerSideEncryption"] == "aws:kms"
    assert call["SSEKMSKeyId"] == "test-kms-key-id"


async def test_private_proof_upload_skips_encryption_without_kms_key(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "S3_KMS_KEY_ID", "")

    fake_client = _FakeS3Client()
    monkeypatch.setattr(s3, "_client", lambda: fake_client)

    await s3.upload_private_proof(b"fake-image-bytes", "proof.jpg", "image/jpeg")

    call = fake_client.put_object_calls[0]
    assert "ServerSideEncryption" not in call


async def test_public_photo_upload_does_not_use_kms(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "S3_KMS_KEY_ID", "test-kms-key-id")

    fake_client = _FakeS3Client()
    monkeypatch.setattr(s3, "_client", lambda: fake_client)

    await s3.upload_public_photo(b"fake-image-bytes", "photo.jpg", "image/jpeg")

    call = fake_client.put_object_calls[0]
    assert call["Bucket"] == settings.S3_BUCKET_PUBLIC
    assert "ServerSideEncryption" not in call


async def test_s3_upload_does_not_block_event_loop(client, monkeypatch):
    """A slow S3 call must not freeze the whole server -- see finding #8 in
    AUDIT_FINDINGS.md. Races a deliberately-slow (synchronous, thread-
    blocking) upload against a cheap concurrent request; if upload_bytes
    still ran the boto3 call directly on the event loop instead of via
    asyncio.to_thread, the health check below would be stuck behind it
    instead of finishing first."""

    class _SlowS3Client:
        def put_object(self, **kwargs):
            time.sleep(1.5)  # a real blocking call, not asyncio.sleep

    monkeypatch.setattr(s3, "_client", lambda: _SlowS3Client())

    order: list[str] = []

    async def slow_upload() -> None:
        await s3.upload_private_proof(b"fake-image-bytes", "proof.jpg", "image/jpeg")
        order.append("upload")

    async def fast_health_check() -> None:
        resp = await client.get("/health")
        assert resp.status_code == 200
        order.append("health")

    await asyncio.gather(slow_upload(), fast_health_check())

    assert order == ["health", "upload"], (
        f"expected the health check to finish before the slow upload, got order={order} "
        "-- the S3 call is blocking the event loop"
    )
