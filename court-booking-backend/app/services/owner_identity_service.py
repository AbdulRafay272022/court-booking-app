"""Owner CNIC (Round 2 Stage 2, docs/stage2-contract.md section 3 "Identity").

- The 13-digit number is normalised (dashes/spaces removed), stored ONLY Fernet-encrypted through the existing
  `app/utils/encryption.encrypt_json` helper, plus its last 4 digits (masked display) and an HMAC-SHA256 with
  `CNIC_HASH_KEY` (`cnic_hash`) so the same CNIC under another account is found without decrypting anything.
- A duplicate never blocks: both rows get the flag `duplicate_cnic`.
- Front/back photos go to the PRIVATE bucket under `owner-identity/{user_id}/front|back.<ext>` (fixed names, so a
  replacement overwrites the old photo).
- The number is never logged and never returned by an owner/list API; only the admin full view returns it, and that
  view writes an `owner_identity.viewed` audit row on every call.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import uuid
from datetime import datetime, timezone

import structlog
from fastapi import UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.owner_identity import OwnerIdentity
from app.models.user import User, UserRole
from app.services.audit_service import AuditService
from app.utils.encryption import decrypt_json, encrypt_json
from app.utils.image import InvalidImageError, validate_image
from app.utils.s3 import signed_private_url, upload_bytes

logger = structlog.get_logger(__name__)

DUPLICATE_FLAG = "duplicate_cnic"
MAX_PHOTO_BYTES = 10 * 1024 * 1024
ALLOWED_PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
PHOTO_URL_SECONDS = 300
ADMIN_PAGE_SIZE = 50
_DEV_HASH_KEY = "dev-only-cnic-hash-key"


def normalize_cnic(raw: str | None) -> str:
    digits = re.sub(r"[\s\-]", "", raw or "")
    # [0-9], not \d: \d also matches Arabic-Indic/other Unicode digits, which would store a non-ASCII "number" and
    # hash differently from the same CNIC typed in ASCII (dodging the duplicate flag).
    if not re.fullmatch(r"[0-9]{13}", digits):
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            ErrorCode.CNIC_INVALID,
            "CNIC must be 13 digits (dashes are optional).",
            details={"field": "number"},
        )
    return digits


def mask(last4: str | None) -> str | None:
    """`*****-*******-1`: only the check digit is shown (contract)."""
    if not last4:
        return None
    return f"*****-*******-{last4[-1]}"


def format_cnic(digits: str) -> str:
    return f"{digits[:5]}-{digits[5:12]}-{digits[12]}"


def hash_key(settings: Settings) -> str:
    """The HMAC key, or a 503 CNIC_NOT_CONFIGURED outside DEBUG when it is blank (never hash with an empty key)."""
    if settings.CNIC_HASH_KEY:
        return settings.CNIC_HASH_KEY
    if settings.DEBUG:
        logger.warning("owner_identity.cnic_hash_key_unset_using_dev_key")
        return _DEV_HASH_KEY
    raise AppError(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        ErrorCode.CNIC_NOT_CONFIGURED,
        "CNIC submission is not available yet. Please try again later.",
    )


def cnic_hash(digits: str, settings: Settings) -> str:
    return hmac.new(hash_key(settings).encode(), digits.encode(), hashlib.sha256).hexdigest()


def status_of(row: OwnerIdentity | None) -> str:
    """missing | submitted (waiting for the admin) | verified | rejected (audit 2026-10-28 Phase 2: stored cnic_status)."""
    if row is None:
        return "missing"
    if row.cnic_status == "rejected":
        return "rejected"
    if row.cnic_status == "approved" or row.verified_at is not None:
        return "verified"
    return "submitted"


def owner_view(row: OwnerIdentity | None) -> dict:
    return {
        "status": status_of(row),
        "masked": mask(row.cnic_last4) if row is not None else None,
        "flags": list(row.flags or []) if row is not None else [],
        # audit 2026-10-28 Phase 2 item 1: why it was not approved, so the owner can fix it and upload again
        "rejection_reason": row.rejection_reason if row is not None and row.cnic_status == "rejected" else None,
    }


# audit 2026-10-28 Phase 2 item 1: a cheap sanity check that the upload LOOKS like a card (a CNIC is an ID-1 card, 85.6 x 54 mm,
# ratio ~1.59). A phone screenshot (a test owner uploaded payment screenshots) is tall and narrow. It never blocks the upload; it
# only adds a flag the admin sees as a warning next to "Tasdeeq karein".
CARD_RATIO = (1.3, 1.95)
NOT_CARD_FLAG = "not_cnic_like"


def looks_like_card(data: bytes) -> bool:
    from io import BytesIO

    from PIL import Image

    try:
        with Image.open(BytesIO(data)) as img:
            w, h = img.size
    except Exception:  # noqa: BLE001 -- validate_image already accepted it; an unreadable size is just "not sure"
        return True
    if w < 300 or h < 180:
        return False
    ratio = max(w, h) / max(min(w, h), 1)
    return CARD_RATIO[0] <= ratio <= CARD_RATIO[1]


async def _read_photo(upload: UploadFile, field: str) -> tuple[bytes, str]:
    if upload is None or upload.content_type not in ALLOWED_PHOTO_TYPES:
        raise AppError(
            status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, "Unsupported image type", details={"field": field}
        )
    data = await upload.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.PROOF_TOO_LARGE, "Photo too large", details={"field": field})
    try:
        validate_image(data)
    except InvalidImageError as exc:
        raise AppError(
            status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, "Could not read the photo", details={"field": field}
        ) from exc
    return data, upload.content_type


class OwnerIdentityService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditService(db)

    async def get_for_user(self, user_id: uuid.UUID) -> OwnerIdentity | None:
        return await self.db.scalar(select(OwnerIdentity).where(OwnerIdentity.user_id == user_id))

    async def _refresh_duplicate_flags(self, hashes: set[str]) -> None:
        """For every row carrying one of `hashes`: flag `duplicate_cnic` iff another user's row has the same hash."""
        for h in hashes:
            rows = list((await self.db.execute(select(OwnerIdentity).where(OwnerIdentity.cnic_hash == h))).scalars().all())
            duplicated = len({r.user_id for r in rows}) > 1
            for r in rows:
                flags = [f for f in (r.flags or []) if f != DUPLICATE_FLAG]
                if duplicated:
                    flags.append(DUPLICATE_FLAG)
                if flags != list(r.flags or []):
                    r.flags = flags

    async def submit(self, user: User, number: str, front: UploadFile, back: UploadFile) -> OwnerIdentity:
        digits = normalize_cnic(number)
        digest = cnic_hash(digits, self.settings)  # 503 before any upload when the key is missing
        front_bytes, front_type = await _read_photo(front, "front")
        back_bytes, back_type = await _read_photo(back, "back")
        prefix = f"owner-identity/{user.id}"
        front_key = f"{prefix}/front.{ALLOWED_PHOTO_TYPES[front_type]}"
        back_key = f"{prefix}/back.{ALLOWED_PHOTO_TYPES[back_type]}"
        await upload_bytes(front_bytes, front_key, self.settings.S3_BUCKET_PRIVATE, front_type, private=True)
        await upload_bytes(back_bytes, back_key, self.settings.S3_BUCKET_PRIVATE, back_type, private=True)

        row = await self.get_for_user(user.id)
        old_hash = row.cnic_hash if row is not None else None
        replaced = row is not None
        if row is None:
            row = OwnerIdentity(user_id=user.id, flags=[])
            self.db.add(row)
        row.cnic_encrypted = encrypt_json({"number": digits}, self.settings)
        row.cnic_last4 = digits[-4:]
        row.cnic_hash = digest
        row.front_key = front_key
        row.back_key = back_key
        # A replacement must be checked again by an admin.
        row.verified_at = None
        row.verified_by = None
        row.cnic_status = "pending"
        row.rejection_reason = None
        row.reviewed_by = None
        row.reviewed_at = None
        card_like = looks_like_card(front_bytes) and looks_like_card(back_bytes)
        row.flags = [f for f in (row.flags or []) if f != NOT_CARD_FLAG] + ([] if card_like else [NOT_CARD_FLAG])
        await self.db.flush()
        await self._refresh_duplicate_flags({digest} | ({old_hash} if old_hash else set()))
        await self.audit.log(
            actor_user_id=user.id,
            actor_type=user.role.value,
            action="owner_identity.replaced" if replaced else "owner_identity.submitted",
            entity_type="owner_identity",
            entity_id=row.id,
            new_value={"last4": row.cnic_last4, "flags": list(row.flags or [])},
        )
        await self.db.commit()
        await self.db.refresh(row)
        logger.info("owner_identity.submitted", user_id=str(user.id), replaced=replaced, flags=list(row.flags or []))
        return row

    # -- admin --------------------------------------------------------------

    def _admin_row(self, user: User, row: OwnerIdentity | None) -> dict:
        return {
            "user_id": user.id,
            "owner_name": user.name,
            "phone_last4": (user.phone or "")[-4:] or None,
            "status": status_of(row),
            "masked": mask(row.cnic_last4) if row is not None else None,
            "flags": list(row.flags or []) if row is not None else [],
            "submitted_at": row.updated_at if row is not None else None,
            "rejection_reason": row.rejection_reason if row is not None else None,
            "reviewed_at": row.reviewed_at if row is not None else None,
        }

    async def admin_list(self, filter_: str, page: int) -> dict:
        page = max(1, page)
        q = select(User, OwnerIdentity).outerjoin(OwnerIdentity, OwnerIdentity.user_id == User.id)
        if filter_ == "missing":
            q = q.where(User.role == UserRole.OWNER, OwnerIdentity.id.is_(None))
        elif filter_ == "duplicates":
            q = q.where(OwnerIdentity.flags.contains([DUPLICATE_FLAG]))
        elif filter_ == "unverified":
            q = q.where(OwnerIdentity.id.is_not(None), OwnerIdentity.cnic_status == "pending")
        elif filter_ == "rejected":
            q = q.where(OwnerIdentity.cnic_status == "rejected")
        else:
            q = q.where((User.role == UserRole.OWNER) | OwnerIdentity.id.is_not(None))
        total = int(await self.db.scalar(select(func.count()).select_from(q.subquery())) or 0)
        rows = (
            await self.db.execute(
                q.order_by(OwnerIdentity.updated_at.desc().nulls_last(), User.created_at.desc())
                .limit(ADMIN_PAGE_SIZE)
                .offset((page - 1) * ADMIN_PAGE_SIZE)
            )
        ).all()
        return {
            "items": [self._admin_row(u, r) for u, r in rows],
            "total": total,
            "page": page,
            "page_size": ADMIN_PAGE_SIZE,
        }

    async def _require_row(self, user_id: uuid.UUID) -> tuple[User, OwnerIdentity]:
        user = await self.db.get(User, user_id)
        row = await self.get_for_user(user_id) if user is not None else None
        if user is None or row is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "No CNIC on file for this owner")
        return user, row

    async def admin_full(self, admin: User, user_id: uuid.UUID, *, action: str = "owner_identity.viewed") -> dict:
        """The FULL number and short-lived signed photo URLs. Writes an audit row every call (never the number)."""
        user, row = await self._require_row(user_id)
        digits = (decrypt_json(row.cnic_encrypted, self.settings) or {}).get("number", "")
        await self.audit.log(
            actor_user_id=admin.id,
            actor_type="admin",
            action=action,
            entity_type="owner_identity",
            entity_id=row.id,
            new_value={"owner_user_id": str(user_id)},
        )
        await self.db.commit()
        out = self._admin_row(user, row)
        out.update(
            number=format_cnic(digits) if len(digits) == 13 else digits,
            front_url=signed_private_url(row.front_key, PHOTO_URL_SECONDS),
            back_url=signed_private_url(row.back_key, PHOTO_URL_SECONDS),
            verified_at=row.verified_at,
        )
        return out

    async def verify(self, admin: User, user_id: uuid.UUID) -> dict:
        owner, row = await self._require_row(user_id)
        if row.cnic_status != "approved" or row.verified_at is None:
            now = datetime.now(timezone.utc)
            row.verified_at = now
            row.verified_by = admin.id
            row.cnic_status = "approved"
            row.rejection_reason = None
            row.reviewed_by = admin.id
            row.reviewed_at = now
            await self.audit.log(
                actor_user_id=admin.id,
                actor_type="admin",
                action="owner_identity.verified",
                entity_type="owner_identity",
                entity_id=row.id,
                new_value={"owner_user_id": str(user_id)},
            )
            await self.db.commit()
            await self._notify(owner, approved=True, reason=None)
        # The response carries the full number too, so it is audited as a view as well.
        return await self.admin_full(admin, user_id)

    async def reject(self, admin: User, user_id: uuid.UUID, reason: str) -> dict:
        """audit 2026-10-28 Phase 2 item 1: "Not approve" with a REQUIRED reason; the owner is told why and can upload again
        (a new upload puts it back to pending)."""
        reason = (reason or "").strip()
        if len(reason) < 3:
            raise AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, "Please write the reason.")
        owner, row = await self._require_row(user_id)
        now = datetime.now(timezone.utc)
        old = row.cnic_status
        row.cnic_status = "rejected"
        row.rejection_reason = reason[:500]
        row.reviewed_by = admin.id
        row.reviewed_at = now
        row.verified_at = None
        row.verified_by = None
        await self.audit.log(
            actor_user_id=admin.id,
            actor_type="admin",
            action="owner_identity.rejected",
            entity_type="owner_identity",
            entity_id=row.id,
            old_value={"cnic_status": old},
            new_value={"owner_user_id": str(user_id), "reason": row.rejection_reason},
        )
        await self.db.commit()
        await self._notify(owner, approved=False, reason=row.rejection_reason)
        return await self.admin_full(admin, user_id)

    async def _notify(self, owner: User, *, approved: bool, reason: str | None) -> None:
        """Push + web push + bell (WhatsApp only behind the whatsapp_templates flag). Best effort, never fails the review."""
        try:
            from app.services.notification_service import NotificationService

            await NotificationService(self.db, self.settings).notify_owner_cnic_result(owner=owner, approved=approved, reason=reason)
        except Exception as exc:  # noqa: BLE001
            logger.warning("owner_identity.notify_failed", error=type(exc).__name__)
