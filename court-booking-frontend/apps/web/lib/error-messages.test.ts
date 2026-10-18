import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "@court-booking/api-client";
import type { ErrorCode } from "@court-booking/types";

import { friendlyErrorMessage } from "./error-messages";
import { makeT } from "./i18n";

// Owner Round 2 codes + the staff permission code: each must have its own copy in BOTH languages (never the server's
// English message, never the generic "something went wrong").
const ROUND2_CODES: ErrorCode[] = [
  "HOLD_EXPIRED",
  "BOOKING_NO_LONGER_PENDING",
  "PAYMENT_STILL_PENDING",
  "PAYMENT_ALREADY_REVIEWED",
  "REASON_REQUIRED",
  "REFUND_EXCEEDS_OWED_AMOUNT",
  "COMPLETION_TOO_EARLY",
  "NOT_STAFF_PERMITTED",
];

test("every Round 2 error code is translated in Roman Urdu and English", () => {
  for (const lang of ["ru", "en"] as const) {
    const t = makeT(lang);
    const generic = friendlyErrorMessage(new ApiError("UNKNOWN_ERROR", "x", 500), t);
    for (const code of ROUND2_CODES) {
      const text = friendlyErrorMessage(new ApiError(code, "SERVER TEXT", 400), t);
      assert.notEqual(text, "SERVER TEXT", `${code} ${lang} falls back to the server message`);
      assert.notEqual(text, generic, `${code} ${lang} is the generic message`);
      assert.ok(!text.startsWith("errors."), `${code} ${lang} shows a raw key`);
    }
  }
});

test("staff permission refusal says so plainly (not 'not your booking')", () => {
  const ru = friendlyErrorMessage(new ApiError("NOT_STAFF_PERMITTED", "Your account isn't allowed to do this.", 403), makeT("ru"));
  assert.match(ru, /^Aap ke paas is kaam ki ijazat nahi/);
  const en = friendlyErrorMessage(new ApiError("NOT_STAFF_PERMITTED", "x", 403), makeT("en"));
  assert.match(en, /permission/);
});
