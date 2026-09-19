import io

import imagehash
from PIL import Image

# A sane ceiling against "pixel bomb" uploads -- a crafted file with a
# spoofed image/* Content-Type and a huge declared pixel dimension, which
# otherwise passes the client-supplied-header check in app/api/payments.py
# and then consumes large memory/CPU synchronously the moment Pillow (here
# or in perceptual_hash) actually decodes it. ~40 megapixels is generous
# for any real phone screenshot. Set globally so it protects every Pillow
# call in this codebase, not just validate_image below -- see
# AUDIT_FINDINGS.md finding #12.
MAX_IMAGE_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class InvalidImageError(Exception):
    """The uploaded bytes can't be decoded as a real image at all -- a
    spoofed Content-Type over garbage/corrupt bytes, or one that exceeds
    MAX_IMAGE_PIXELS."""


def validate_image(image_bytes: bytes) -> None:
    """Raises InvalidImageError if `image_bytes` isn't a real, decodable
    image within MAX_IMAGE_PIXELS. Call this at the upload boundary
    (app/api/payments.py) so a bad file is rejected with a clean 400
    instead of silently proceeding to S3/OCR on garbage, or the size check
    alone letting a pixel-bomb through because the *byte count* was small
    even though the *declared pixel count* wasn't."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            width, height = img.size
        with Image.open(io.BytesIO(image_bytes)) as img:
            img.verify()
    except Exception as exc:
        raise InvalidImageError(f"Could not read file as an image: {exc}") from exc
    if width * height > MAX_IMAGE_PIXELS:
        raise InvalidImageError(f"Image dimensions too large: {width}x{height} pixels")


def perceptual_hash(image_bytes: bytes) -> str | None:
    """A hash that's stable under recompression/resizing, so a screenshot
    forwarded twice (e.g. to two different bookings) hashes the same even if
    it isn't byte-identical. Returns None for anything Pillow can't decode
    -- callers that need to reject an undecodable upload outright should
    call validate_image first; this stays permissive since a None hash just
    means it can't dedupe this one, not that the submission should be
    rejected."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            return str(imagehash.phash(img))
    except Exception:
        return None
