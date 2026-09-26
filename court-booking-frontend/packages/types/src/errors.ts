/**
 * Keep in sync with app/errors.py's ErrorCode catalog (FRONTEND_INTEGRATION.md §7).
 * Any code not in this list still arrives in the same envelope with a generic
 * status-derived fallback (e.g. a plain 404 -> "NOT_FOUND").
 */
export type ErrorCode =
  | "INVALID_OTP"
  | "OTP_EXPIRED"
  | "OTP_RATE_LIMITED"
  | "OTP_DELIVERY_FAILED"
  | "INVALID_CREDENTIALS"
  | "LOGIN_RATE_LIMITED"
  | "PHONE_REVERIFICATION_REQUIRED"
  | "PASSWORD_NOT_SET"
  | "PHONE_ALREADY_REGISTERED"
  | "EMAIL_ALREADY_IN_USE"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "NOT_AUTHENTICATED"
  | "OTP_SUPERSEDED"
  | "OTP_IP_RATE_LIMITED"
  | "SIGNUP_ALREADY_PENDING"
  | "ALREADY_VERIFIED"
  | "USER_NOT_FOUND"
  | "SLOT_ALREADY_TAKEN"
  | "INVALID_SLOT_TIME"
  | "SLOT_IN_PAST"
  | "SLOT_BLOCKED"
  | "ALREADY_YOUR_SLOT"
  | "BOOKING_NOT_FOUND"
  | "INVALID_BOOKING_STATE"
  | "NOT_YOUR_BOOKING"
  | "CANCELLATION_NOT_ALLOWED"
  | "CANCELLATION_WINDOW_CLOSED"
  | "INVALID_CHECKIN_CODE"
  | "TOO_EARLY_FOR_NO_SHOW"
  | "VENUE_NOT_APPROVED"
  | "VENUE_NOT_FOUND"
  | "NOT_VENUE_OWNER"
  | "DUPLICATE_PROOF"
  | "PROOF_TOO_LARGE"
  | "INVALID_IMAGE_FORMAT"
  | "REFUND_ALREADY_MARKED"
  | "REFUND_EXCEEDS_OWED_AMOUNT"
  | "RATE_LIMITED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNKNOWN_ERROR";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
