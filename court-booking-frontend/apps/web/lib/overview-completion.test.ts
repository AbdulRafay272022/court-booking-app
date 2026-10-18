import test from "node:test";
import assert from "node:assert/strict";
import type { OwnerBookingRow } from "@court-booking/types";
import { applyReceivedNow, canSaveCompletion, completionBody, planCompletion, validateReceivedNow } from "./overview-completion";

// spec A8: total 4,500, advance 2,000 already paid -> due 2,500
function row(over: Partial<OwnerBookingRow> = {}): OwnerBookingRow {
  return {
    booking_id: "b1", short_code: "KH-B1", kind: "booked", status_key: "booked", player_name: "Ayesha", player_phone: null,
    court_id: "c1", court_name: "Court 1", starts_at: "2026-10-16T15:00:00Z", ends_at: "2026-10-16T16:30:00Z", duration_minutes: 90, slot_count: 3,
    total: 4500, advance: 2000, due: 2500, total_paid: 2000, source: "app", checked_in: false, completion: null, slot_ended: true,
    original_booking_id: null, refund_amount: null, refund_status: null, ...over,
  };
}

test("spec: 1,000 received -> paid 3,000, due 1,500, Adhoora, reason required", () => {
  const p = planCompletion(row(), 1000);
  assert.deepEqual(p, { receivedNow: 1000, paidAfter: 3000, dueAfter: 1500, outcome: "no", reasonRequired: true });
  const r = applyReceivedNow(row(), 1000, "kal dega");
  assert.equal(r.total_paid, 3000);
  assert.equal(r.due, 1500);
  assert.equal(r.completion?.result, "no");
  assert.equal(r.completion?.received_pkr, 3000);
  assert.equal(canSaveCompletion(p, ""), false);
  assert.equal(canSaveCompletion(p, "  kal dega "), true);
});

test("spec: 2,500 received (= due) -> paid 4,500, due 0, Mukammal, no reason needed", () => {
  const p = planCompletion(row(), 2500);
  assert.deepEqual(p, { receivedNow: 2500, paidAfter: 4500, dueAfter: 0, outcome: "yes", reasonRequired: false });
  const r = applyReceivedNow(row(), 2500, "");
  assert.equal(r.total_paid, 4500);
  assert.equal(r.due, 0);
  assert.equal(r.completion?.result, "yes");
  assert.equal(canSaveCompletion(p, ""), true);
});

test("spec: 0 + reason -> unchanged money, Adhoora", () => {
  const p = planCompletion(row(), 0);
  assert.equal(p.paidAfter, 2000);
  assert.equal(p.dueAfter, 2500);
  assert.equal(p.outcome, "no");
  const r = applyReceivedNow(row(), 0, "customer ne kaha kal dega");
  assert.equal(r.total_paid, 2000);
  assert.equal(r.due, 2500);
  assert.equal(r.completion?.reason, "customer ne kaha kal dega");
});

test("never lowers total paid; clamps to the due", () => {
  assert.equal(planCompletion(row(), -500).paidAfter, 2000);
  assert.equal(planCompletion(row(), 99999).paidAfter, 4500);
  assert.equal(planCompletion(row({ due: 0, total_paid: 4500 }), 0).outcome, "yes");
});

test("validateReceivedNow: 0..due whole PKR", () => {
  assert.deepEqual(validateReceivedNow("0", 2500), { ok: true, value: 0 });
  assert.deepEqual(validateReceivedNow("1,000", 2500), { ok: true, value: 1000 });
  assert.deepEqual(validateReceivedNow("2500", 2500), { ok: true, value: 2500 });
  assert.deepEqual(validateReceivedNow("2501", 2500), { ok: false, error: "range" });
  assert.deepEqual(validateReceivedNow("", 2500), { ok: false, error: "required" });
  assert.deepEqual(validateReceivedNow("-1", 2500), { ok: false, error: "range" });
  assert.deepEqual(validateReceivedNow("12.5", 2500), { ok: false, error: "range" });
});

test("request body carries received_now plus the old received_pkr total", () => {
  assert.deepEqual(completionBody(row(), 1000, " kal dega "), { result: "no", received_now: 1000, received_pkr: 3000, reason: "kal dega" });
  assert.deepEqual(completionBody(row(), 2500, ""), { result: "no", received_now: 2500, received_pkr: 4500, reason: undefined });
});
