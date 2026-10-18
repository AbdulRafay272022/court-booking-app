import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalsHeaderCounts } from "./approvals-count";

const it = (payment_id: string, state: "awaiting" | "cancelled_by_player" | "expired" | "cancelled_by_owner" = "awaiting") => ({ payment_id, state });

test("badge total splits into awaiting + grey cards", () => {
  const loaded = [it("a"), it("b"), it("c", "cancelled_by_player"), it("d", "expired")];
  assert.deepEqual(approvalsHeaderCounts(4, loaded, new Set()), { left: 4, awaiting: 2, closed: 2 });
});

test("acting on a card lowers the right part; an override (409) turns an awaiting card grey", () => {
  const loaded = [it("a"), it("b"), it("c", "cancelled_by_player")];
  assert.deepEqual(approvalsHeaderCounts(3, loaded, new Set(["c"])), { left: 2, awaiting: 2, closed: 0 });
  assert.deepEqual(approvalsHeaderCounts(3, loaded, new Set(["a"]), { b: "expired" }), { left: 2, awaiting: 0, closed: 2 });
});

test("unloaded pages count as awaiting; never negative", () => {
  assert.deepEqual(approvalsHeaderCounts(60, [it("x", "expired")], new Set()), { left: 60, awaiting: 59, closed: 1 });
  assert.deepEqual(approvalsHeaderCounts(0, [], new Set()), { left: 0, awaiting: 0, closed: 0 });
  assert.deepEqual(approvalsHeaderCounts(1, [it("x", "expired"), it("y", "expired")], new Set()), { left: 1, awaiting: 0, closed: 1 });
});
