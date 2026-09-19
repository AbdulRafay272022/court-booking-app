/**
 * Keep in sync with app/errors.py's ErrorCode catalog (FRONTEND_INTEGRATION.md §7).
 * Any code not in this list still arrives in the same envelope with a generic
 * status-derived fallback (e.g. a plain 404 -> "NOT_FOUND").
 */
export type ErrorCode =
  | "INVALID_OTP"
  | "OTP_EXPIRED"
  | "OTP_RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "SLOT_ALREADY_TAKEN"
  | "INVALID_SLOT_TIME"
  | "SLOT_IN_PAST"
  | "SLOT_BLOCKED"
  | "BOOKING_NOT_FOUND"
  | "INVALID_BOOKING_STATE"
  | "NOT_YOUR_BOOKING"
  | "VENUE_NOT_APPROVED"
  | "VENUE_NOT_FOUND"
  | "NOT_VENUE_OWNER"
  | "DUPLICATE_PROOF"
  | "PROOF_TOO_LARGE"
  | "INVALID_IMAGE_FORMAT"
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
