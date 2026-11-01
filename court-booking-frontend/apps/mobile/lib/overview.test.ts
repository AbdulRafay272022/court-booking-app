import test from "node:test";
import assert from "node:assert/strict";
import type { OwnerBookingRow } from "@court-booking/types";

import { PERM, STATUS_FILTERS, canOfferNoShow, duplicateCreditText, isStatusPending, permissionAllows, rowStatusLabel, statusPendingLine } from "./overview";

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

test("edit_court_settings: staff without it cannot edit the timers card; owners can", () => {
  const s = { role: "staff", venue_permissions: [{ venue_id: "v1", permissions: ["view_ledger"] }, { venue_id: "v2", permissions: ["edit_court_settings"] }] };
  assert.equal(PERM.editSettings, "edit_court_settings");
  assert.equal(permissionAllows(s, "v1", PERM.editSettings), false);
  assert.equal(permissionAllows(s, "v2", PERM.editSettings), true);
  assert.equal(permissionAllows({ role: "owner", venue_permissions: [] }, "v1", PERM.editSettings), true);
});

test("duplicateCreditText: singular / plural", () => {
  assert.equal(duplicateCreditText(1), "Ye screenshot 1 aur booking par bhi credit hua");
  assert.equal(duplicateCreditText(3), "Ye screenshot 3 aur bookings par bhi credit hua");
});

import { compactTimeRange, historyDateTile, historyStatus } from "./overview";

test("compactTimeRange: board style short ranges in Pakistan time", () => {
  assert.equal(compactTimeRange("2026-10-24T13:00:00Z", "2026-10-24T14:00:00Z"), "6–7 PM");
  assert.equal(compactTimeRange("2026-10-24T15:00:00Z", "2026-10-24T16:30:00Z"), "8–9:30 PM");
  assert.equal(compactTimeRange("2026-10-24T18:00:00Z", "2026-10-24T19:00:00Z"), "11 PM–12 AM");
});

test("historyDateTile: weekday + day of the Pakistan date", () => {
  assert.deepEqual(historyDateTile("2026-10-24T13:00:00Z"), { weekday: "SAT", day: "24" });
  assert.deepEqual(historyDateTile("2026-10-24T20:00:00Z"), { weekday: "SUN", day: "25" });
});

test("historyStatus: board pills", () => {
  const base = { kind: "booked", status_key: "booked", completion: null, refund_status: null, status_pending: false } as unknown as Parameters<typeof historyStatus>[0];
  assert.equal(historyStatus({ ...base, completion: { result: "yes" } } as typeof base).label, "Mukammal");
  assert.equal(historyStatus({ ...base, completion: { result: "no" } } as typeof base).label, "Baqi");
  assert.equal(historyStatus({ ...base, kind: "cancelled", status_key: "cancelled" } as typeof base).label, "Cancelled");
  assert.equal(historyStatus({ ...base, status_key: "no_show" } as typeof base).label, "No-show");
  assert.equal(historyStatus({ ...base, status_pending: true } as typeof base).label, "Status baqi");
});

test("arrivalRow: time tile, court + range, status without money", async () => {
  const { arrivalRow } = await import("./overview");
  const a = { court_name: "Court 1", starts_at: "2026-11-01T14:00:00Z", ends_at: "2026-11-01T15:00:00Z", checked_in: false };
  const before = Date.parse("2026-11-01T12:00:00Z");
  assert.deepEqual(arrivalRow(a, before), { time: "7 PM", meta: "Court 1 · 7–8 PM", status: "Aane wala", tone: "neutral" });
  assert.equal(arrivalRow({ ...a, checked_in: true }, before).status, "✓ Aa gaya");
  assert.equal(arrivalRow(a, Date.parse("2026-11-01T14:30:00Z")).status, "Check-in baqi");
  assert.equal(arrivalRow(a, Date.parse("2026-11-01T16:00:00Z")).status, "Check-in nahi hua");
  assert.equal(arrivalRow({ ...a, starts_at: "2026-11-01T13:30:00Z" }, before).time, "6:30 PM");
});
