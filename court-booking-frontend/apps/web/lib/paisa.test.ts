import assert from "node:assert/strict";
import test from "node:test";
import type { LedgerEntry } from "@court-booking/types";

import { correctionChange, dayLabel, entryKind, groupByDay, milaSplit, periodRange } from "./paisa";

const e = (over: Partial<LedgerEntry>): LedgerEntry => ({
  entry_id: Math.random().toString(36).slice(2), recorded_at: "2026-11-08T07:00:00Z", court: "Court 1", booking_id: "b", starts_at: "2026-11-08T12:00:00Z",
  player: "Ali", method: "cash_at_venue", entry_type: "payment", amount_pkr: 1000, running_total: 0, booking_status: "booked", ...over,
});

test("period chips: Aaj, Is hafta (Monday first), Is mahina", () => {
  assert.deepEqual(periodRange("aaj", "2026-11-08"), { start: "2026-11-08", end: "2026-11-08" });
  assert.deepEqual(periodRange("hafta", "2026-11-08"), { start: "2026-11-02", end: "2026-11-08" }); // Sun 8 Nov -> Mon 2 Nov
  assert.deepEqual(periodRange("hafta", "2026-11-02"), { start: "2026-11-02", end: "2026-11-02" });
  assert.deepEqual(periodRange("mahina", "2026-11-08"), { start: "2026-11-01", end: "2026-11-08" });
});

test("Mila splits cash and transfer, counts corrections, leaves refunds out", () => {
  const split = milaSplit([
    e({ amount_pkr: 1500 }),
    e({ method: "bank_transfer_proof", amount_pkr: 3000 }),
    e({ method: "bank_transfer_proof", entry_type: "correction", amount_pkr: -1000 }),
    e({ method: "other", entry_type: "refund", amount_pkr: -500 }),
  ]);
  assert.deepEqual(split, { total: 3500, cash: 1500, transfer: 2000, other: 0 });
});

test("rows are grouped by Pakistan day, newest first, with Roman Urdu headers", () => {
  const days = groupByDay([
    e({ recorded_at: "2026-11-07T18:30:00Z", amount_pkr: 700 }), // 11:30 PM PKT on the 7th
    e({ recorded_at: "2026-11-07T19:30:00Z", amount_pkr: 300 }), // 12:30 AM PKT on the 8th
    e({ recorded_at: "2026-11-08T09:00:00Z", amount_pkr: 200 }),
  ], "2026-11-08");
  assert.deepEqual(days.map((d) => [d.day, d.total, d.entries.length]), [["2026-11-08", 500, 2], ["2026-11-07", 700, 1]]);
  assert.match(days[0].label, /^Aaj · /);
  assert.match(days[1].label, /^Kal · /);
  assert.equal(days[0].entries[0].amount_pkr, 200); // newest row first
  assert.doesNotMatch(dayLabel("2026-11-01", "2026-11-08"), /Aaj|Kal/);
});

test("a correction reads 'Raqam theek ki gayi' with the old -> new amount", () => {
  const c = e({ entry_type: "correction", amount_pkr: -2000, paid_before_pkr: 3000, paid_after_pkr: 1000 });
  assert.equal(entryKind(c), "Raqam theek ki gayi");
  assert.equal(correctionChange(c, (n) => `PKR ${n}`), "PKR 3000 → PKR 1000");
  assert.equal(correctionChange(e({}), String), null);
  assert.equal(entryKind(e({ method: "bank_transfer_proof" })), "Transfer");
  assert.equal(entryKind(e({ entry_type: "refund" })), "Wapas diye");
});
