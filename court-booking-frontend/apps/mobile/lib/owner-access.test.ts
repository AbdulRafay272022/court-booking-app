import test from "node:test";
import assert from "node:assert/strict";
import type { StaffPermissionKey } from "@court-booking/types";

import { firstAllowedTabRoute, moreItemAllowed, tabAllowed, visibleOwnerTabs } from "./owner-access";

const staffWith = (...keys: StaffPermissionKey[]) => (k: StaffPermissionKey) => keys.includes(k);
const owner = () => true;

test("visibleOwnerTabs: owners see all five tabs", () => {
  assert.deepEqual(visibleOwnerTabs(owner), ["overview", "approvals", "refunds", "ledger", "more"]);
});

test("visibleOwnerTabs: staff only see tabs their permissions open", () => {
  assert.deepEqual(visibleOwnerTabs(staffWith("record_payments")), ["more"]);
  assert.deepEqual(visibleOwnerTabs(staffWith("view_ledger")), ["overview", "approvals", "ledger", "more"]);
  assert.deepEqual(visibleOwnerTabs(staffWith("mark_refunds")), ["refunds", "more"]);
  assert.deepEqual(visibleOwnerTabs(staffWith("view_ledger", "mark_refunds")), ["overview", "approvals", "refunds", "ledger", "more"]);
  // approve_payments alone cannot list the queue (it reads through view_ledger on the backend).
  assert.equal(tabAllowed("approvals", staffWith("approve_payments")), false);
});

test("firstAllowedTabRoute: staff land on the first tab they may open", () => {
  assert.equal(firstAllowedTabRoute(owner), "today");
  assert.equal(firstAllowedTabRoute(staffWith("view_ledger")), "today");
  assert.equal(firstAllowedTabRoute(staffWith("mark_refunds")), "refunds");
  assert.equal(firstAllowedTabRoute(staffWith("check_in")), "more");
});

test("moreItemAllowed: owners get everything; staff get what their keys allow; growth is owner-only", () => {
  for (const item of ["history", "walkin", "checkin", "growth", "reviews", "venueSettings"] as const) {
    assert.equal(moreItemAllowed(item, owner, false), true, item);
  }
  const s = staffWith("check_in", "manage_photos");
  assert.equal(moreItemAllowed("checkin", s, true), true);
  assert.equal(moreItemAllowed("venueSettings", s, true), true);
  assert.equal(moreItemAllowed("walkin", s, true), false);
  assert.equal(moreItemAllowed("history", s, true), false);
  assert.equal(moreItemAllowed("reviews", s, true), false);
  assert.equal(moreItemAllowed("growth", owner, true), false);
  // view_ledger staff may read venue settings (read-only timers), record_payments-only staff may not.
  assert.equal(moreItemAllowed("venueSettings", staffWith("view_ledger"), true), true);
  assert.equal(moreItemAllowed("venueSettings", staffWith("record_payments"), true), false);
});
