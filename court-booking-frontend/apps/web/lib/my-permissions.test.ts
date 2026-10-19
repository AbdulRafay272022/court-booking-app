import assert from "node:assert/strict";
import test from "node:test";
import type { MyPermissions } from "@court-booking/types";
import { ACTION_PERMISSION, permissionAllows } from "./my-permissions";

const STAFF: MyPermissions = {
  role: "staff",
  venue_permissions: [
    { venue_id: "v1", permissions: ["view_ledger", "approve_payments"] },
    { venue_id: "v2", permissions: ["view_ledger", "record_payments", "check_in", "mark_refunds"] },
  ],
};

test("owners and admins can do everything, whatever the list says", () => {
  assert.equal(permissionAllows("owner", undefined, "pending", "v1", "mark_refunds"), true);
  assert.equal(permissionAllows("admin", undefined, "error", undefined, "check_in"), true);
  assert.equal(permissionAllows("owner", STAFF, "success", "v1", "mark_refunds"), true);
});

test("staff: only the keys of that venue", () => {
  assert.equal(permissionAllows("staff", STAFF, "success", "v1", "approve_payments"), true);
  assert.equal(permissionAllows("staff", STAFF, "success", "v1", "mark_refunds"), false);
  assert.equal(permissionAllows("staff", STAFF, "success", "v2", "mark_refunds"), true);
  assert.equal(permissionAllows("staff", STAFF, "success", "v2", "approve_payments"), false);
  assert.equal(permissionAllows("staff", STAFF, "success", "v9", "view_ledger"), false);
  assert.equal(permissionAllows("staff", STAFF, "success", undefined, "view_ledger"), false);
});

test("staff: hidden while loading, shown (403 fallback decides) when the endpoint is missing", () => {
  assert.equal(permissionAllows("staff", undefined, "pending", "v1", "approve_payments"), false);
  assert.equal(permissionAllows("staff", undefined, "error", "v1", "approve_payments"), true);
});

test("a staff session whose server answer says owner is treated as owner", () => {
  assert.equal(permissionAllows("staff", { role: "owner", venue_permissions: [] }, "success", "v1", "check_in"), true);
});

test("action map matches the backend permission of each endpoint", () => {
  assert.equal(ACTION_PERMISSION.approve, "approve_payments");
  assert.equal(ACTION_PERMISSION.acknowledge, "approve_payments");
  assert.equal(ACTION_PERMISSION.refunds, "mark_refunds");
  assert.equal(ACTION_PERMISSION.completion, "record_payments");
  assert.equal(ACTION_PERMISSION.noShow, "check_in");
});
