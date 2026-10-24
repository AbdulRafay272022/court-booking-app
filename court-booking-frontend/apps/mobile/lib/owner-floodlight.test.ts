import test from "node:test";
import assert from "node:assert/strict";
import type { ApprovalQueueItem, OwnerBookingRow, StaffPermissionKey } from "@court-booking/types";

import {
  activeBarKey,
  bulkApprovable,
  bulkApproveAmount,
  flagOn,
  heroCollected,
  oldestWaitMinutes,
  ownerBarTabs,
  paisaSegments,
  settleAction,
  showWalkinFab,
  spanLabel,
  timelineKind,
  timelineModel,
  waitLabel,
} from "./owner-floodlight";

const staffWith = (...keys: StaffPermissionKey[]) => (k: StaffPermissionKey) => keys.includes(k);
const owner = () => true;

test("ownerBarTabs: owner gets Aaj, Approvals, Paisa (ledger), Aur", () => {
  assert.deepEqual(
    ownerBarTabs(owner).map((t) => `${t.key}:${t.route}`),
    ["aaj:today", "approvals:approvals", "paisa:ledger", "aur:more"],
  );
});

test("ownerBarTabs: staff only see permitted cells; Paisa falls back to Refunds; Aur always", () => {
  assert.deepEqual(ownerBarTabs(staffWith("check_in", "walkin")).map((t) => t.key), ["aur"]);
  assert.deepEqual(ownerBarTabs(staffWith("mark_refunds")).map((t) => `${t.key}:${t.route}`), ["paisa:refunds", "aur:more"]);
  assert.deepEqual(ownerBarTabs(staffWith("view_ledger")).map((t) => t.key), ["aaj", "approvals", "paisa", "aur"]);
  assert.deepEqual(ownerBarTabs(staffWith("approve_payments")).map((t) => t.key), ["aur"]);
});

test("activeBarKey: ledger and refunds both light Paisa", () => {
  assert.equal(activeBarKey("today"), "aaj");
  assert.equal(activeBarKey("approvals"), "approvals");
  assert.equal(activeBarKey("ledger"), "paisa");
  assert.equal(activeBarKey("refunds"), "paisa");
  assert.equal(activeBarKey("more"), "aur");
  assert.equal(activeBarKey("walkin"), null);
});

test("showWalkinFab / paisaSegments follow the permissions", () => {
  assert.equal(showWalkinFab(owner), true);
  assert.equal(showWalkinFab(staffWith("check_in")), false);
  assert.equal(showWalkinFab(staffWith("walkin")), true);
  assert.deepEqual(paisaSegments(owner), ["ledger", "refunds", "history"]);
  assert.deepEqual(paisaSegments(staffWith("mark_refunds")), ["refunds"]);
  assert.deepEqual(paisaSegments(staffWith("view_ledger")), ["ledger", "history"]);
});

test("heroCollected: same ledger number as Paisa (today = collected_today, other day = that day's range)", () => {
  const s = { collected_today: 7000, total_in_range: 1250 };
  assert.equal(heroCollected(s, "2026-10-24", "2026-10-24"), 7000);
  assert.equal(heroCollected(s, "2026-10-23", "2026-10-24"), 1250);
  assert.equal(heroCollected(undefined, "2026-10-24", "2026-10-24"), null);
});

const item = (id: string, extra: Partial<ApprovalQueueItem> = {}): ApprovalQueueItem =>
  ({
    payment_id: id, booking_id: "b" + id, court_name: "Court 1", starts_at: "2026-10-24T14:00:00Z", ends_at: "2026-10-24T15:00:00Z",
    player_name: "P", player_phone: null, ocr_verdict: "match", ocr_amount: 2000, expected_amount: 2000, proof_url: null,
    submitted_at: "2026-10-24T10:00:00Z", minutes_since_submission: 5, checks: null as never, state: "awaiting", cancelled_at: null,
    has_screenshot: true, overpayment: null, duplicate: null, ...extra,
  }) as ApprovalQueueItem;

test("oldestWaitMinutes / waitLabel", () => {
  assert.equal(oldestWaitMinutes([item("a", { minutes_since_submission: 3 }), item("b", { minutes_since_submission: 12 }), item("c", { minutes_since_submission: 99, state: "expired" })]), 12);
  assert.equal(oldestWaitMinutes([]), null);
  assert.equal(waitLabel(12), "12 min");
  assert.equal(waitLabel(130), "2 ghante");
  assert.equal(waitLabel(60 * 50), "2 din");
});

test("bulkApprovable: only waiting + OCR match + equal amount + no duplicate + no overpayment, nothing when locked", () => {
  const list = [
    item("ok"),
    item("unread", { ocr_verdict: null, ocr_amount: null }),
    item("mismatch", { ocr_verdict: "mismatch", ocr_amount: 1500 }),
    item("dup", { duplicate: { used_on_bookings: 2 } }),
    item("dup0", { duplicate: { used_on_bookings: 0 } }),
    item("over", { overpayment: { expected: 2000, ocr_amount: 3000, excess: 1000 } }),
    item("grey", { state: "cancelled_by_player" }),
    item("matchButOff", { ocr_amount: 1999 }),
  ];
  assert.deepEqual(bulkApprovable(list, false).map((i) => i.payment_id), ["ok"]);
  assert.deepEqual(bulkApprovable(list, true), []);
  assert.equal(bulkApproveAmount(item("x")), undefined);
  assert.equal(bulkApproveAmount(item("y", { checks: { paid_amount: 2000 } as never })), 2000);
});

const row = (id: string, court: string, start: string, end: string, extra: Partial<OwnerBookingRow> = {}): OwnerBookingRow =>
  ({
    booking_id: id, short_code: "KH-" + id, kind: "booked", status_key: "booked", player_name: id, player_phone: null, court_id: court, court_name: court,
    starts_at: start, ends_at: end, duration_minutes: 60, slot_count: 2, total: 2000, advance: 1000, due: 0, total_paid: 2000, source: "app",
    checked_in: false, completion: null, slot_ended: false, original_booking_id: null, refund_amount: null, refund_status: null, ...extra,
  }) as OwnerBookingRow;

test("timelineKind: live bookings only, walk-in / pending / no-show told apart", () => {
  assert.equal(timelineKind(row("a", "c1", "", "")), "booked");
  assert.equal(timelineKind(row("a", "c1", "", "", { source: "walkin" })), "walkin");
  assert.equal(timelineKind(row("a", "c1", "", "", { status_key: "awaiting_approval" })), "pending");
  assert.equal(timelineKind(row("a", "c1", "", "", { status_key: "held" })), "pending");
  assert.equal(timelineKind(row("a", "c1", "", "", { status_key: "no_show" })), "noshow");
  assert.equal(timelineKind(row("a", "c1", "", "", { kind: "cancelled", status_key: "cancelled" })), null);
  assert.equal(timelineKind(row("a", "c1", "", "", { kind: "refund", status_key: "refund_owed" })), null);
});

test("timelineModel: operating-day window, per-court blocks and gaps, now line", () => {
  const courts = [{ id: "c1", name: "Court 1" }, { id: "c2", name: "Court 2" }];
  const rows = [
    row("a", "c1", "2026-10-24T12:00:00Z", "2026-10-24T13:00:00Z"),
    row("b", "c1", "2026-10-24T14:30:00Z", "2026-10-24T16:00:00Z", { status_key: "awaiting_approval" }),
    row("x", "c2", "2026-10-24T12:00:00Z", "2026-10-24T13:00:00Z", { kind: "cancelled", status_key: "cancelled" }),
  ];
  const now = Date.parse("2026-10-24T13:40:00Z");
  const m = timelineModel(rows, courts, { start_at: "2026-10-24T12:00:00Z", end_at: "2026-10-24T18:00:00Z" }, now)!;
  assert.equal(m.minutes, 360);
  assert.equal(m.hours.length, 7);
  assert.equal(m.now, 100);
  const [c1, c2] = m.columns;
  assert.deepEqual(c1.blocks.map((b) => [b.row.booking_id, b.kind, b.start, b.end]), [["a", "booked", 0, 60], ["b", "pending", 150, 240]]);
  assert.deepEqual(c1.gaps.map((g) => [g.start, g.end, g.future]), [[60, 150, true], [240, 360, true]]);
  // the cancelled row is not drawn: the whole column is one gap
  assert.deepEqual(c2.blocks, []);
  assert.deepEqual(c2.gaps.map((g) => [g.start, g.end]), [[0, 360]]);
});

test("timelineModel: no operating day -> span of bookings rounded to hours; nothing -> null; past gaps marked", () => {
  const m = timelineModel([row("a", "c1", "2026-10-24T12:30:00Z", "2026-10-24T13:00:00Z"), row("b", "c1", "2026-10-24T14:00:00Z", "2026-10-24T14:30:00Z")], [{ id: "c1", name: "Court 1" }], null, Date.parse("2026-10-24T20:00:00Z"))!;
  assert.equal(m.startMs, Date.parse("2026-10-24T12:00:00Z"));
  assert.equal(m.minutes, 180);
  assert.equal(m.now, null);
  assert.ok(m.columns[0].gaps.every((g) => !g.future));
  assert.equal(timelineModel([], [{ id: "c1", name: "Court 1" }], null, 0), null);
});

test("spanLabel", () => {
  assert.equal(spanLabel(30), "30 min");
  assert.equal(spanLabel(60), "1 ghanta");
  assert.equal(spanLabel(90), "1.5 ghante");
  assert.equal(spanLabel(120), "2 ghante");
});

test("flagOn: unknown counts as on, only an explicit false hides", () => {
  assert.equal(flagOn(undefined, "reviews"), true);
  assert.equal(flagOn({}, "reviews"), true);
  assert.equal(flagOn({ reviews: false }, "reviews"), false);
  assert.equal(flagOn({ reviews: true }, "reviews"), true);
});

test("settleAction: completion only after the slot ended; before that a payment entry behind split_payments", () => {
  const base = { kind: "booked" as const, status_key: "booked" as const, due: 1500, slot_ended: false, completion: null };
  assert.equal(settleAction(base, { canRecord: true, splitPayments: true }), "record");
  assert.equal(settleAction(base, { canRecord: true, splitPayments: false }), "wait");
  assert.equal(settleAction({ ...base, slot_ended: true }, { canRecord: true, splitPayments: false }), "completion");
  assert.equal(settleAction({ ...base, slot_ended: true }, { canRecord: false, splitPayments: true }), "none");
  assert.equal(settleAction({ ...base, due: 0 }, { canRecord: true, splitPayments: true }), "none");
  assert.equal(settleAction({ ...base, kind: "cancelled" as never }, { canRecord: true, splitPayments: true }), "none");
  assert.equal(
    settleAction({ ...base, slot_ended: true, completion: { result: "no", received_pkr: 0, reason: "x", marked_at: "", marked_by_name: null } }, { canRecord: true, splitPayments: false }),
    "none",
  );
});

test("timelineModel: clipFromMs starts the window an hour before now and says how many hours are hidden", () => {
  const rows = [row("a", "c1", "2026-10-24T12:00:00Z", "2026-10-24T13:00:00Z"), row("b", "c1", "2026-10-24T16:00:00Z", "2026-10-24T17:00:00Z")];
  const day = { start_at: "2026-10-24T08:00:00Z", end_at: "2026-10-24T18:00:00Z" };
  const now = Date.parse("2026-10-24T15:20:00Z");
  const m = timelineModel(rows, [{ id: "c1", name: "Court 1" }], day, now, 30, now - 3600_000)!;
  assert.equal(m.startMs, Date.parse("2026-10-24T14:00:00Z"));
  assert.equal(m.hiddenHours, 6);
  assert.deepEqual(m.columns[0].blocks.map((b) => b.row.booking_id), ["b"]);
  assert.equal(timelineModel(rows, [{ id: "c1", name: "Court 1" }], day, now)!.hiddenHours, 0);
  // a clip outside the window is ignored
  assert.equal(timelineModel(rows, [{ id: "c1", name: "Court 1" }], day, now, 30, Date.parse("2026-10-25T01:00:00Z"))!.hiddenHours, 0);
});
