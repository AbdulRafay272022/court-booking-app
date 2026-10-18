import assert from "node:assert/strict";
import { test } from "node:test";

import { isPlausibleRefundReference, refundAmountError, refundBreakdown } from "./refund-breakdown";

const base = { refund_amount: 2000, refunded_amount: null, refund_status: "owed" as const };

test("new fields win", () => {
  assert.deepEqual(
    refundBreakdown({ ...base, player_sent: 10000, refund_due: 2000, already_refunded: 500, remaining_amount: 1500 }),
    { playerSent: 10000, refundDue: 2000, alreadyRefunded: 500, remaining: 1500, status: "partial" },
  );
});

test("falls back to the old fields", () => {
  assert.deepEqual(refundBreakdown(base), { playerSent: null, refundDue: 2000, alreadyRefunded: 0, remaining: 2000, status: "owed" });
  assert.deepEqual(refundBreakdown({ ...base, refunded_amount: 2000, remaining_amount: 0 }).status, "done");
  assert.equal(refundBreakdown({ ...base, refunded_amount: 800 }).remaining, 1200);
});

test("nothing owed / remaining 0 / refunded status", () => {
  assert.equal(refundBreakdown({ ...base, refund_amount: 0 }).status, "none");
  assert.equal(refundBreakdown({ ...base, remaining_amount: 0, already_refunded: 0 }).status, "done");
  assert.equal(refundBreakdown({ ...base, refund_status: "refunded", refunded_amount: 2000 }).status, "done");
  assert.equal(refundBreakdown({ ...base, remaining_amount: -5 }).remaining, 0);
});

test("amount and reference checks", () => {
  assert.equal(refundAmountError(10000, 2000), "exceeds");
  assert.equal(refundAmountError(2000, 2000), null);
  assert.equal(refundAmountError(0, 2000), "not_positive");
  assert.equal(refundAmountError(NaN, 2000), "empty");
  assert.equal(isPlausibleRefundReference("TX12"), true);
  assert.equal(isPlausibleRefundReference("ab"), false);
  assert.equal(isPlausibleRefundReference("----"), false);
});
