import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalQueueItem } from "@court-booking/types";
import {
  amountChip,
  approveArgs,
  defaultApproveAmount,
  hasMore,
  mergePages,
  overpaymentChoice,
  parseAmount,
  rejectReasonText,
  remainingCount,
  stateFrom409,
  visibleIds,
} from "./queue-helpers";

const item = (id: string, over: Partial<ApprovalQueueItem> = {}): ApprovalQueueItem =>
  ({
    payment_id: id,
    booking_id: `b-${id}`,
    court_name: "Court 1",
    starts_at: "2026-10-18T16:00:00Z",
    ends_at: "2026-10-18T17:00:00Z",
    player_name: "Ali",
    player_phone: null,
    ocr_verdict: "match",
    ocr_amount: 2000,
    expected_amount: 2000,
    proof_url: null,
    submitted_at: "2026-10-18T10:00:00Z",
    minutes_since_submission: 3,
    checks: null,
    state: "awaiting",
    cancelled_at: null,
    has_screenshot: true,
    overpayment: null,
    ...over,
  }) as unknown as ApprovalQueueItem;

test("mergePages keeps order and drops repeats", () => {
  const out = mergePages([{ items: [item("a"), item("b")] }, { items: [item("b"), item("c")] }]);
  assert.deepEqual(
    out.map((i) => i.payment_id),
    ["a", "b", "c"],
  );
  assert.deepEqual(mergePages(undefined), []);
});

test("visibleIds: server order, hidden removed, snapshot freezes order and holds back new cards", () => {
  const hidden = new Set(["b"]);
  assert.deepEqual(visibleIds(["a", "b", "c"], null, hidden), ["a", "c"]);
  // a new card "n" arrived on top while a dialog was open: it waits; "c" left the server: it leaves
  assert.deepEqual(visibleIds(["n", "a", "b"], ["a", "b", "c"], new Set()), ["a", "b"]);
  // snapshot released: the new card shows on top
  assert.deepEqual(visibleIds(["n", "a", "b"], null, new Set()), ["n", "a", "b"]);
});

test("remainingCount subtracts only hidden cards the server still lists", () => {
  assert.equal(remainingCount(5, ["a", "b", "c"], new Set(["a", "zzz"])), 4);
  assert.equal(remainingCount(0, [], new Set(["a"])), 0);
  assert.equal(hasMore(50, 51), true);
  assert.equal(hasMore(51, 51), false);
});

test("amountChip compares the screenshot amount with the expected advance", () => {
  assert.deepEqual(amountChip(item("a")), { kind: "match", amount: 2000 });
  assert.deepEqual(amountChip(item("a", { ocr_amount: 10000 })), { kind: "mismatch", read: 10000, expected: 2000 });
  assert.deepEqual(amountChip(item("a", { ocr_amount: null })), { kind: "unread", expected: 2000 });
});

test("amount parsing and defaults", () => {
  assert.equal(parseAmount(" 2,500 "), 2500);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("12a"), null);
  assert.equal(defaultApproveAmount(item("a", { ocr_amount: 900 })), 900);
  assert.equal(defaultApproveAmount(item("a", { ocr_amount: null })), 2000);
});

test("overpayment choice and approve body", () => {
  const over = item("a", { ocr_amount: 10000, overpayment: { expected: 2000, ocr_amount: 10000, excess: 8000 } });
  assert.deepEqual(overpaymentChoice(over, 10000), { expected: 2000, paid: 10000, excess: 8000 });
  assert.equal(overpaymentChoice(over, 2000), null, "owner typed the advance: nothing to choose");
  assert.equal(overpaymentChoice(item("a"), 10000), null, "no server flag: no choice");
  assert.deepEqual(approveArgs(over, 10000, "advance_only"), { amountPkr: 10000, acceptMode: "advance_only" });
  assert.deepEqual(approveArgs(over, 10000, "full"), { amountPkr: 10000, acceptMode: "full" });
  assert.deepEqual(approveArgs(item("a"), 2000, "advance_only"), { amountPkr: undefined, acceptMode: undefined });
});

test("409 state and reject reason", () => {
  assert.equal(stateFrom409({ state: "expired" }), "expired");
  assert.equal(stateFrom409(undefined), "cancelled_by_player");
  assert.equal(rejectReasonText("Screenshot unreadable", ""), "Screenshot unreadable");
  assert.equal(rejectReasonText("Screenshot unreadable", " blur "), "Screenshot unreadable - blur");
  assert.equal(rejectReasonText("Other", "  "), null);
  assert.equal(rejectReasonText(null, "kuch"), "kuch");
});
