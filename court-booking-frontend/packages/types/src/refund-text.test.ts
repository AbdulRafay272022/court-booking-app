import test from "node:test";
import assert from "node:assert/strict";
import { refundSummary } from "./refund-text";

test("partial refund shows what was sent and what is still owed, never the whole amount as owed", () => {
  assert.deepEqual(refundSummary({ amount: 2000, status: "owed", sent: 1000, remaining: 1000 }, "ru"), { text: "Refund bheja: PKR 1,000 · Baqi: PKR 1,000", tone: "partial" });
  assert.deepEqual(refundSummary({ amount: 2000, status: "owed", sent: 0, remaining: 2000 }, "ru"), { text: "Refund baqi: PKR 2,000", tone: "owed" });
  assert.deepEqual(refundSummary({ amount: 2000, status: "paid", sent: 2000, remaining: 0 }, "ru"), { text: "Refund bhej diya gaya: PKR 2,000", tone: "done" });
  assert.equal(refundSummary({ amount: 2000, status: "owed", sent: 1000, remaining: 1000 }, "en").text, "Refund sent: PKR 1,000 · Still owed: PKR 1,000");
  // an older server without sent/remaining
  assert.equal(refundSummary({ amount: 2000, status: "paid" }, "ru").text, "Refund bhej diya gaya: PKR 2,000");
  assert.equal(refundSummary({ amount: 2000, status: "owed" }, "ru").text, "Refund baqi: PKR 2,000");
});
