import asyncio
import uuid

import boto3
from botocore.client import Config as BotoConfig

from app.config import get_settings

settings = get_settings()

# boto3 is synchronous; every call below runs on a thread via
# asyncio.to_thread so it can't block the event loop for every other
# in-flight request (see AUDIT_FINDINGS.md finding #8 -- on a single-worker
# deployment, a slow/unreachable S3 used to freeze the entire server for up
# to the default ~60s connect/read timeout). Explicit timeouts here are
# still worth keeping short so a genuinely stuck call frees its thread
# reasonably quickly.
_BOTO_CONFIG = BotoConfig(signature_version="s3v4", connect_timeout=10, read_timeout=10)


def _client():
    kwargs = {"region_name": settings.AWS_REGION}
    if settings.AWS_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
    if settings.AWS_ACCESS_KEY_ID:
        kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
        kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
    return boto3.client("s3", config=_BOTO_CONFIG, **kwargs)


def build_key(prefix: str, filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"{prefix}/{uuid.uuid4()}.{ext}"


def _put_object_sync(
    data: bytes, key: str, bucket: str, content_type: str, *, private: bool
) -> str:
    client = _client()
    extra = {"ContentType": content_type}
    if private and settings.S3_KMS_KEY_ID:
        extra["ServerSideEncryption"] = "aws:kms"
        extra["SSEKMSKeyId"] = settings.S3_KMS_KEY_ID
    client.put_object(Bucket=bucket, Key=key, Body=data, **extra)
    return key


async def upload_bytes(
    data: bytes, key: str, bucket: str, content_type: str = "application/octet-stream", *, private: bool = False
) -> str:
    return await asyncio.to_thread(_put_object_sync, data, key, bucket, content_type, private=private)


async def upload_public_photo(data: bytes, filename: str, content_type: str) -> str:
    key = build_key("venues", filename)
    await upload_bytes(data, key, settings.S3_BUCKET_PUBLIC, content_type)
    return key


async def upload_private_proof(data: bytes, filename: str, content_type: str) -> str:
    key = build_key("payment-proofs", filename)
    await upload_bytes(data, key, settings.S3_BUCKET_PRIVATE, content_type, private=True)
    return key


def public_url(key: str) -> str:
    if settings.CLOUDFRONT_DOMAIN:
        return f"https://{settings.CLOUDFRONT_DOMAIN}/{key}"
    return f"https://{settings.S3_BUCKET_PUBLIC}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"


def signed_url(key: str, bucket: str, expires_in: int = 900) -> str:
    client = _client()
    return client.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires_in
    )


def signed_private_url(key: str, expires_in: int = 900) -> str:
    return signed_url(key, settings.S3_BUCKET_PRIVATE, expires_in)


def _head_bucket_sync(bucket: str) -> bool:
    try:
        _client().head_bucket(Bucket=bucket)
        return True
    except Exception:
        return False


async def bucket_reachable(bucket: str) -> bool:
    """Best-effort check for GET /health/ready -- a cheap head_bucket call,
    not a full read/write round trip."""
    return await asyncio.to_thread(_head_bucket_sync, bucket)
