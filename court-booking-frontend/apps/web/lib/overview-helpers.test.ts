import test from "node:test";
import assert from "node:assert/strict";
import type { OwnerBookingRow } from "@court-booking/types";
import {
  applyCompletion,
  approvalsHref,
  courtsParam,
  filterRows,
  findOriginalRow,
  historyHref,
  initialOf,
  isDateString,
  overviewHref,
  parseCourtIds,
  rowCounts,
  rowTone,
  slotSegments,
  topCourts,
  allDatesHistoryHref,
  pendingAllOf,
  slotFilterMatches,
} from "./overview-helpers";

function row(over: Partial<OwnerBookingRow>): OwnerBookingRow {
  return {
    booking_id: "b1", short_code: "KH-B1", kind: "booked", status_key: "booked", player_name: "Ayesha", player_phone: null,
    court_id: "c1", court_name: "Court 1", starts_at: "2026-10-16T15:00:00Z", ends_at: "2026-10-16T16:30:00Z", duration_minutes: 90, slot_count: 3,
    total: 4500, advance: 2000, due: 2500, total_paid: 2000, source: "app", checked_in: false, completion: null, slot_ended: true,
    original_booking_id: null, refund_amount: null, refund_status: null, ...over,
  };
}

test("date and court URL values", () => {
  assert.equal(isDateString("2026-10-16"), true);
  assert.equal(isDateString("2026-02-30"), false);
  assert.equal(isDateString("tomorrow"), false);
  assert.deepEqual(parseCourtIds("a,x,c", ["a", "b", "c"]), ["a", "c"]);
  assert.deepEqual(parseCourtIds(null, ["a"]), []);
  assert.equal(courtsParam([], ["a", "b"]), undefined);
  assert.equal(courtsParam(["a", "b"], ["a", "b"]), undefined);
  assert.equal(courtsParam(["b", "a"], ["a", "b", "c"]), "a,b");
});

test("links to other pages carry the day and courts", () => {
  assert.equal(overviewHref("2026-10-16", "2026-10-16", undefined), "/dashboard/owner/today");
  assert.equal(overviewHref("2026-10-17", "2026-10-16", "a,b"), "/dashboard/owner/today?date=2026-10-17&courts=a,b");
  assert.equal(historyHref({ date: "2026-10-16", courts: "a", status: "refund" }), "/dashboard/bookings?from=2026-10-16&to=2026-10-16&courts=a&status=refund");
  assert.equal(historyHref({ date: "2026-10-16" }), "/dashboard/bookings?from=2026-10-16&to=2026-10-16");
  assert.equal(approvalsHref("2026-10-16", undefined), "/dashboard/owner/approvals?date=2026-10-16");
  assert.equal(approvalsHref(undefined, undefined), "/dashboard/owner/approvals");
  assert.equal(approvalsHref(undefined, "a,b"), "/dashboard/owner/approvals?courts=a,b");
  assert.equal(
    allDatesHistoryHref("2026-10-16", { status: "held" }),
    "/dashboard/bookings?from=2025-10-16&to=2027-10-16&status=held",
  );
  assert.equal(
    allDatesHistoryHref("2026-10-16", { status: "held", courts: "c1" }),
    "/dashboard/bookings?from=2025-10-16&to=2027-10-16&courts=c1&status=held",
  );
});

test("any-date pending numbers are read, never invented", () => {
  assert.deepEqual(pendingAllOf({ pending_all: { count: 7, awaiting_approval: 4, awaiting_payment: 3 } }), { count: 7, approval: 4, payment: 3 });
  assert.equal(pendingAllOf({}), null);
  assert.equal(pendingAllOf({ pending_all: undefined }), null);
});

test("slots popup filter", () => {
  assert.equal(slotFilterMatches("past", "free"), true);
  assert.equal(slotFilterMatches("free", "free"), true);
  assert.equal(slotFilterMatches("booked", "free"), false);
  assert.equal(slotFilterMatches("blocked", "blocked"), true);
  assert.equal(slotFilterMatches("pending", "all"), true);
});

test("filter pills and counts", () => {
  const rows = [row({}), row({ booking_id: "b2", kind: "cancelled" }), row({ booking_id: "b2", kind: "refund" }), row({ booking_id: "b3" })];
  assert.deepEqual(rowCounts(rows), { all: 4, booked: 2, cancelled: 1, refund: 1 });
  assert.equal(filterRows(rows, "booked").length, 2);
  assert.equal(filterRows(rows, "all").length, 4);
});

test("slot bar adds up to 100 and Total = Booked + Pending + Blocked + Free", () => {
  const segs = slotSegments({ total: 96, booked: 38, pending: 6, blocked: 4, free: 48 });
  assert.deepEqual(segs.map((x) => x.key), ["booked", "pending", "blocked", "free"]);
  assert.equal(segs.reduce((s, x) => s + x.count, 0), 96);
  assert.ok(Math.abs(segs.reduce((s, x) => s + x.percent, 0) - 100) < 1e-9);
  assert.deepEqual(slotSegments({ total: 0, booked: 0, pending: 0, blocked: 0, free: 0 }).map((s) => s.percent), [0, 0, 0, 0]);
});

test("top courts and the +N aur remainder", () => {
  const items = [
    { court_name: "Court 3", n: 0 }, { court_name: "Court 2", n: 8 }, { court_name: "Court 1", n: 9 },
    { court_name: "Court 4", n: 2 }, { court_name: "Court 5", n: 8 },
  ];
  const { top, rest } = topCourts(items, (i) => i.n, 2);
  assert.deepEqual(top.map((t) => t.court_name), ["Court 1", "Court 2"]);
  assert.equal(rest, 2);
});

test("completion changes the row", () => {
  const yes = applyCompletion(row({}), "yes");
  assert.equal(yes.due, 0);
  assert.equal(yes.total_paid, 4500);
  assert.equal(rowTone(yes), "green");
  const no = applyCompletion(row({}), "no", 2000);
  assert.equal(no.due, 2500);
  assert.equal(no.total_paid, 2000);
  assert.equal(rowTone(no), "red");
  assert.equal(applyCompletion(row({}), "no", 99999).total_paid, 4500);
  assert.equal(rowTone(row({ kind: "refund" })), "refund");
  assert.equal(rowTone(row({ kind: "cancelled" })), "cancelled");
  assert.equal(rowTone(row({})), "none");
});

test("original row lookup", () => {
  const booked = row({ booking_id: "b9" });
  const cancelled = row({ booking_id: "b2", kind: "cancelled", original_booking_id: "b2" });
  const refund = row({ booking_id: "b2", kind: "refund", original_booking_id: "b2" });
  assert.equal(findOriginalRow([booked, cancelled, refund], refund), cancelled);
  assert.equal(findOriginalRow([booked, cancelled], cancelled), null);
  const bookedSame = row({ booking_id: "b2" });
  assert.equal(findOriginalRow([bookedSame, cancelled], cancelled), bookedSame);
});

test("avatar initial", () => {
  assert.equal(initialOf("usman Tariq"), "U");
  assert.equal(initialOf(null), "?");
  assert.equal(initialOf("  "), "?");
});
