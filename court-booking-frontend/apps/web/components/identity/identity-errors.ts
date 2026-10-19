import { ApiError } from "@court-booking/api-client";
import type { MessageKey, TFunction } from "@/lib/i18n";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** The CNIC endpoints' own error codes (docs/stage2-contract.md section 3) -> cnic.* copy. */
export function identityErrorKey(code: string): MessageKey | null {
  switch (code) {
    case "CNIC_INVALID":
      return "cnic.err.invalid";
    case "CNIC_NOT_CONFIGURED":
      return "cnic.err.notConfigured";
    default:
      return null;
  }
}

export function identityErrorMessage(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    const key = identityErrorKey(e.code);
    if (key) return t(key);
  }
  return friendlyErrorMessage(e, t);
}
