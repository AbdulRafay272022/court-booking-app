import test from "node:test";
import assert from "node:assert/strict";
import type { OwnerBookingRow } from "@court-booking/types";

import { PERM, STATUS_FILTERS, canOfferNoShow, isStatusPending, permissionAllows, rowStatusLabel, statusPendingLine } from "./overview";

const staff = { role: "staff", venue_permissions: [{ venue_id: "v1", permissions: ["approve_payments"] }, { venue_id: "v2", permissions: ["check_in"] }] };

test("permissionAllows: staff only gets the keys granted for that venue", () => {
  assert.equal(permissionAllows(staff, "v1", PERM.approve), true);
  assert.equal(permissionAllows(staff, "v1", PERM.checkIn), false);
  assert.equal(permissionAllows(staff, "v2", PERM.checkIn), true);
  assert.equal(permissionAllows(staff, "v3", PERM.approve), false);
  assert.equal(permissionAllows(staff, undefined, PERM.checkIn), true);
  assert.equal(permissionAllows(staff, undefined, PERM.refunds), false);
});

test("permissionAllows: owner/admin and unknown data allow (403 stays the fallback)", () => {
  assert.equal(permissionAllows({ role: "owner", venue_permissions: [] }, "v1", PERM.refunds), true);
  assert.equal(permissionAllows({ role: "admin", venue_permissions: [] }, "v1", PERM.refunds), true);
  assert.equal(permissionAllows(undefined, "v1", PERM.refunds), true);
  assert.equal(permissionAllows([], "v1", PERM.refunds), true);
  assert.equal(permissionAllows({ role: "staff" }, "v1", PERM.refunds), true);
});

const row = (extra: Partial<OwnerBookingRow> = {}) =>
  ({ kind: "booked", status_key: "booked", slot_ended: true, checked_in: false, completion: null, status_pending: true, ...extra }) as OwnerBookingRow;
const done = { result: "yes" as const, received_pkr: 0, reason: null, marked_at: "2026-10-20T10:00:00Z", marked_by_name: null };

test("canOfferNoShow: only a still-booked, ended, unmarked row", () => {
  assert.equal(canOfferNoShow(row()), true);
  assert.equal(canOfferNoShow(row({ slot_ended: false })), false);
  assert.equal(canOfferNoShow(row({ checked_in: true })), false);
  assert.equal(canOfferNoShow(row({ completion: done })), false);
  assert.equal(canOfferNoShow(row({ status_key: "no_show" })), false);
  assert.equal(canOfferNoShow(row({ kind: "cancelled", status_key: "cancelled" })), false);
  assert.equal(canOfferNoShow(row(), done), false);
});

test("status labels and the Overview line", () => {
  assert.equal(rowStatusLabel(row()), "Booked");
  assert.equal(rowStatusLabel(row({ completion: done })), "Completed");
  assert.equal(rowStatusLabel(row({ status_key: "no_show" })), "No-show");
  assert.equal(isStatusPending(row()), true);
  assert.equal(isStatusPending(row({ status_pending: undefined })), false);
  assert.equal(statusPendingLine(1), "1 booking ka status baqi");
  assert.equal(statusPendingLine(4), "4 bookings ka status baqi");
  assert.ok(STATUS_FILTERS.some((f) => f.key === "status_pending" && f.label === "Status baqi"));
});
