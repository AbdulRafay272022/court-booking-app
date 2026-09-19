import { ApiError } from "@court-booking/api-client";

/** Maps every backend ErrorCode (FRONTEND_INTEGRATION.md §7) to a human-readable message. */
const MESSAGES: Record<string, string> = {
  INVALID_OTP: "That code isn't right. Check WhatsApp and try again.",
  OTP_EXPIRED: "This code has expired. Request a new one.",
  OTP_RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
  SESSION_EXPIRED: "Your session has expired. Please log in again.",
  SESSION_REVOKED: "You've been logged out on this device. Please log in again.",
  SLOT_ALREADY_TAKEN: "Someone just booked this slot. Pick another one.",
  INVALID_SLOT_TIME: "That time isn't available anymore — please pick a slot from the list.",
  SLOT_IN_PAST: "That time has already passed.",
  SLOT_BLOCKED: "This slot isn't available right now.",
  BOOKING_NOT_FOUND: "We couldn't find that booking.",
  INVALID_BOOKING_STATE: "That action can't be done on this booking anymore.",
  NOT_YOUR_BOOKING: "This isn't your booking.",
  VENUE_NOT_APPROVED: "This venue isn't live yet.",
  VENUE_NOT_FOUND: "We couldn't find that venue.",
  NOT_VENUE_OWNER: "You don't manage this venue.",
  DUPLICATE_PROOF: "This screenshot looks like it's already been used.",
  PROOF_TOO_LARGE: "That image is too large — please use one under 10MB.",
  INVALID_IMAGE_FORMAT: "Please upload a JPEG, PNG, or WebP image.",
  RATE_LIMITED: "You're doing that too much — please slow down a little.",
  FORBIDDEN: "You don't have permission to do that.",
  VALIDATION_ERROR: "Some of the details entered aren't valid.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
};

export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return MESSAGES[error.code] ?? error.message ?? MESSAGES.UNKNOWN_ERROR;
  }
  if (error instanceof Error && error.message.toLowerCase().includes("fetch")) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return MESSAGES.UNKNOWN_ERROR;
}
