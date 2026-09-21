"""Section 16.3's error-code catalog and the exception type that carries a
code through to the global handler in main.py. Plain `HTTPException` still
works everywhere (it falls back to a generic code derived from its status),
but any call site that maps cleanly onto one of these named codes should
raise `AppError` instead so API consumers get a stable machine-readable
`error.code`, not just an HTTP status + free-text message.
"""

from fastapi import HTTPException


class ErrorCode:
    # Auth
    INVALID_OTP = "INVALID_OTP"
    OTP_EXPIRED = "OTP_EXPIRED"
    OTP_RATE_LIMITED = "OTP_RATE_LIMITED"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    SESSION_REVOKED = "SESSION_REVOKED"
    OTP_DELIVERY_FAILED = "OTP_DELIVERY_FAILED"
    # Section 26 (password auth)
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"  # deliberately doesn't say which half was wrong
    LOGIN_RATE_LIMITED = "LOGIN_RATE_LIMITED"
    PHONE_REVERIFICATION_REQUIRED = "PHONE_REVERIFICATION_REQUIRED"  # unverified, or >365d since last OTP
    PASSWORD_NOT_SET = "PASSWORD_NOT_SET"  # pre-Section-26 account: use the reset flow to set one
    PHONE_ALREADY_REGISTERED = "PHONE_ALREADY_REGISTERED"
    EMAIL_ALREADY_IN_USE = "EMAIL_ALREADY_IN_USE"

    # Booking
    SLOT_ALREADY_TAKEN = "SLOT_ALREADY_TAKEN"
    BOOKING_NOT_FOUND = "BOOKING_NOT_FOUND"
    INVALID_BOOKING_STATE = "INVALID_BOOKING_STATE"
    NOT_YOUR_BOOKING = "NOT_YOUR_BOOKING"
    SLOT_IN_PAST = "SLOT_IN_PAST"
    SLOT_BLOCKED = "SLOT_BLOCKED"
    # Section 32 Part 2 -- e.g. joining the waitlist for a slot you already hold or have booked
    ALREADY_YOUR_SLOT = "ALREADY_YOUR_SLOT"
    # Section 29 Part C -- player cancelling an already-paid (booked) booking
    CANCELLATION_NOT_ALLOWED = "CANCELLATION_NOT_ALLOWED"
    CANCELLATION_WINDOW_CLOSED = "CANCELLATION_WINDOW_CLOSED"
    INVALID_SLOT_TIME = "INVALID_SLOT_TIME"
    INVALID_DURATION = "INVALID_DURATION"  # Section 32 Part 4: a booking length the court can't give
    BOOKING_ALREADY_CANCELLED = "BOOKING_ALREADY_CANCELLED"
    INVALID_CHECKIN_CODE = "INVALID_CHECKIN_CODE"

    # Venue
    VENUE_NOT_APPROVED = "VENUE_NOT_APPROVED"
    VENUE_NOT_FOUND = "VENUE_NOT_FOUND"
    NOT_VENUE_OWNER = "NOT_VENUE_OWNER"

    # Payment
    DUPLICATE_PROOF = "DUPLICATE_PROOF"
    PROOF_TOO_LARGE = "PROOF_TOO_LARGE"
    INVALID_IMAGE_FORMAT = "INVALID_IMAGE_FORMAT"
    PAYMENT_ALREADY_REVIEWED = "PAYMENT_ALREADY_REVIEWED"
    PAYMENT_ALREADY_SUBMITTED = "PAYMENT_ALREADY_SUBMITTED"

    # General
    RATE_LIMITED = "RATE_LIMITED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"


# Fallback mapping for plain HTTPException raises that don't carry an
# explicit ErrorCode -- keeps the response envelope consistent (Section
# 16.2) everywhere without requiring every one of the ~50 existing raise
# sites in the codebase to be rewritten.
_STATUS_FALLBACK = {
    400: ErrorCode.VALIDATION_ERROR,
    401: ErrorCode.SESSION_EXPIRED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    409: ErrorCode.SLOT_ALREADY_TAKEN,
    422: ErrorCode.VALIDATION_ERROR,
    429: ErrorCode.RATE_LIMITED,
}


def fallback_code_for_status(status_code: int) -> str:
    return _STATUS_FALLBACK.get(status_code, "ERROR")


class AppError(HTTPException):
    """Raise this instead of `HTTPException` when the error maps onto a
    named `ErrorCode` -- the message stays human-readable in `detail`
    (so anything that doesn't know about the envelope still works), and
    `code`/`details` are picked up by the handler in main.py."""

    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.details = details or {}
