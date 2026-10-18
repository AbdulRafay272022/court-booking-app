import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@court-booking/api-client";

import { friendlyErrorMessage } from "./error-messages";

const CODES = [
  "HOLD_EXPIRED",
  "BOOKING_NO_LONGER_PENDING",
  "PAYMENT_STILL_PENDING",
  "PAYMENT_ALREADY_REVIEWED",
  "REASON_REQUIRED",
  "REFUND_EXCEEDS_OWED_AMOUNT",
  "COMPLETION_TOO_EARLY",
  "NOT_STAFF_PERMITTED",
];

test("Round 2 error codes have their own message (never the server's text or the generic one)", () => {
  const generic = friendlyErrorMessage(new ApiError("UNKNOWN_ERROR", "x", 500));
  for (const code of CODES) {
    const text = friendlyErrorMessage(new ApiError(code, "SERVER TEXT", 400));
    assert.notEqual(text, "SERVER TEXT", code);
    assert.notEqual(text, generic, code);
  }
  assert.match(friendlyErrorMessage(new ApiError("NOT_STAFF_PERMITTED", "x", 403)), /^Aap ke paas is kaam ki ijazat nahi/);
});
