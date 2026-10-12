import { ApiError } from "@court-booking/api-client";
import { DEFAULT_LANG, LANG_COOKIE, makeT, parseLang, type MessageKey, type TFunction } from "./i18n";

/**
 * Maps every backend ErrorCode (FRONTEND_INTEGRATION.md section 7) to a human-readable message in the visitor's language
 * (keys `errors.code.<CODE>` in messages/{ru,en}/errors.ts). Pass `t` (from useT()) when you have it. Without it, callers that
 * were written before i18n still work: in the browser the language is read from the `khelo_lang` cookie, elsewhere it is the default.
 */
function defaultT(): TFunction {
  if (typeof document === "undefined") return makeT(DEFAULT_LANG);
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return makeT(parseLang(m?.[1]));
}

export function friendlyErrorMessage(error: unknown, t: TFunction = defaultT()): string {
  const unknown = t("errors.code.UNKNOWN_ERROR" as MessageKey);
  if (error instanceof ApiError) {
    const key = `errors.code.${error.code}` as MessageKey;
    const translated = t(key);
    // t() returns the key itself for an unknown code: then fall back to the server's message, then the generic one
    return translated !== key ? translated : (error.message ?? unknown);
  }
  if (error instanceof Error && error.message.toLowerCase().includes("fetch")) {
    return t("errors.network");
  }
  return unknown;
}
