import assert from "node:assert/strict";
import test from "node:test";

import type { Slot } from "./availability";
import {
  DAY_LABELS,
  backendWeekdayOf,
  buildPricingRules,
  buildSchedules,
  cloneCourtSetup,
  courtSetupFromCourt,
  courtSetupProblem,
  defaultCourtSetup,
} from "./court-setup";
import {
  cancellationPolicyText,
  durationChoices,
  formatDuration,
  slotPreview,
  slotPreviewText,
} from "./booking-duration";

// ---- weekdays: the owner screens must number the week the way the backend does (Mon = 0) --------------------

test("the weekday index an owner picks is the one the backend uses (Monday = 0)", () => {
  assert.equal(DAY_LABELS[0], "Mon");
  assert.equal(DAY_LABELS[6], "Sun");
  // 2026-09-21 is a Monday and 2026-09-20 a Sunday; the backend's date.weekday() gives 0 and 6.
  assert.equal(backendWeekdayOf("2026-09-21"), 0);
  assert.equal(backendWeekdayOf("2026-09-20"), 6);
  assert.equal(backendWeekdayOf("2026-09-26"), 5); // Saturday
  for (const [date, label] of [["2026-09-23", "Wed"], ["2026-09-24", "Thu"], ["2026-09-25", "Fri"]] as const) {
    assert.equal(DAY_LABELS[backendWeekdayOf(date)], label);
  }
});

test("hours an owner sets for Saturday are sent as day 5, not day 6 (the old Sunday-first screens sent 6)", () => {
  const setup = defaultCourtSetup();
  setup.sameHoursEveryDay = false;
  setup.perDayOverrides = { [DAY_LABELS.indexOf("Sat")]: { open: "08:00", close: "22:00" } };
  const rows = buildSchedules(setup);
  const sat = rows.find((r) => r.day_of_week === 5)!;
  assert.equal(sat.open_time, "08:00:00");
  assert.equal(sat.close_time, "22:00:00");
  assert.equal(rows.find((r) => r.day_of_week === 6)!.open_time, "06:00:00"); // Sunday keeps the shared hours
});

test("a weekend price rule uses Sat = 5 and Sun = 6", () => {
  const setup = defaultCourtSetup();
  setup.pricingRules[0].pricePerSlot = "3000";
  setup.pricingRules.push({ id: "w", name: "Weekend", pricePerSlot: "4000", dayOfWeek: [5, 6], startTime: null, endTime: null });
  const rules = buildPricingRules(setup);
  assert.deepEqual(rules[1].day_of_week, [5, 6]);
  assert.equal(rules[1].priority, 1);
  assert.equal(rules[0].day_of_week, null);
});

// ---- per-court setup --------------------------------------------------------------------------------------

test("a court needs a price and usable hours before it can be saved", () => {
  const setup = defaultCourtSetup();
  assert.match(courtSetupProblem(setup)!, /price/i);
  setup.pricingRules[0].pricePerSlot = "3500";
  assert.equal(courtSetupProblem(setup), null);
  setup.closeTime = "05:00";
  assert.ok(courtSetupProblem(setup));
});

test("a copied court setup shares nothing with the original", () => {
  const a = defaultCourtSetup();
  a.pricingRules[0].pricePerSlot = "3000";
  a.perDayOverrides = { 0: { open: "07:00", close: "20:00" } };
  const b = cloneCourtSetup(a);
  b.pricingRules[0].pricePerSlot = "9999";
  b.perDayOverrides[0]!.open = "10:00";
  assert.equal(a.pricingRules[0].pricePerSlot, "3000");
  assert.equal(a.perDayOverrides[0]!.open, "07:00");
  assert.notEqual(a.pricingRules[0].id, b.pricingRules[0].id);
});

test("a court from the API becomes the editable setup and back without changing", () => {
  const court = {
    slot_minutes: 90,
    schedule_templates: Array.from({ length: 7 }, (_, d) => ({ id: String(d), day_of_week: d, open_time: "06:00:00", close_time: "23:00:00", is_active: true })),
    pricing_rules: [
      { id: "1", name: "All day", priority: 0, day_of_week: null, start_time: null, end_time: null, price_per_slot: 3500, floodlight_surcharge: 0, advance_percentage: 100, is_active: true },
      { id: "2", name: "Weekend", priority: 1, day_of_week: [5, 6], start_time: "18:00:00", end_time: "23:00:00", price_per_slot: 4500, floodlight_surcharge: 0, advance_percentage: 100, is_active: true },
    ],
  };
  const setup = courtSetupFromCourt(court);
  assert.equal(setup.sameHoursEveryDay, true);
  assert.equal(setup.slotMinutes, 90);
  const back = buildPricingRules(setup);
  assert.deepEqual(back.map((r) => [r.price_per_slot, r.day_of_week, r.start_time]), [[3500, null, undefined], [4500, [5, 6], "18:00:00"]]);
  assert.equal(buildSchedules(setup).length, 7);
});

// ---- the live slot-count preview ---------------------------------------------------------------------------

test("slot preview matches the backend grid", () => {
  // 6 AM to 11 PM: 17 hours
  assert.equal(slotPreview("06:00", "23:00", 60)!.count, 17);
  assert.equal(slotPreview("06:00", "23:00", 30)!.count, 34);
  assert.equal(slotPreview("06:00", "23:00", 120)!.count, 8);
  const p = slotPreview("06:00", "23:00", 90)!; // 1020 / 90 = 11.33 -> 11 slots, the last 30 min can't fit one
  assert.equal(p.count, 11);
  assert.equal(p.lastStart, "21:00");
  assert.equal(p.lastEnd, "22:30");
  assert.equal(slotPreviewText("06:00", "23:00", 90), "11 slots a day, 6:00 AM to 10:30 PM");
  assert.equal(slotPreview("06:00", "06:30", 60), null);
  assert.equal(slotPreview("10:00", "09:00", 60), null);
});

// ---- duration choices --------------------------------------------------------------------------------------

function slot(startHour: number, minutes: number, status: Slot["status"] = "available"): Slot {
  const start = Date.UTC(2026, 8, 23, startHour, 0);
  return {
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + minutes * 60_000).toISOString(),
    status,
    price: 1000,
    advance_amount: 1000,
    held_until: null,
    booking_id: null,
    is_mine: false,
    reason: null,
  };
}

test("duration choices stop at the first taken slot and at four hours", () => {
  const day = [slot(10, 60), slot(11, 60), slot(12, 60), slot(13, 60, "booked"), slot(14, 60)];
  assert.deepEqual(durationChoices(day, 0, 60).map((c) => c.minutes), [60, 120, 180]);
  assert.deepEqual(durationChoices(day, 2, 60).map((c) => c.minutes), [60]);
  const open = Array.from({ length: 8 }, (_, i) => slot(6 + i, 60));
  assert.deepEqual(durationChoices(open, 0, 60).map((c) => c.minutes), [60, 120, 180, 240]); // capped at 4 h
  // a 30-minute court: eight consecutive 30-minute slots make 4 hours, so up to 8 slots (30 min ... 4 h)
  const half = Array.from({ length: 12 }, (_, i) => {
    const s = slot(6, 30);
    const start = Date.parse(s.starts_at) + i * 30 * 60_000;
    return { ...s, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 30 * 60_000).toISOString() };
  });
  assert.deepEqual(durationChoices(half, 0, 30).map((c) => c.minutes), [30, 60, 90, 120, 150, 180, 210, 240]);
});

test("duration choices need slots that follow each other with no gap", () => {
  const gap = [slot(10, 60), slot(12, 60)]; // 11:00-12:00 missing (closed)
  assert.equal(durationChoices(gap, 0, 60).length, 1);
});

test("durations read in plain words", () => {
  assert.deepEqual([30, 60, 90, 120, 150, 180, 240].map(formatDuration), [
    "30 minutes", "1 hour", "1.5 hours", "2 hours", "2.5 hours", "3 hours", "4 hours",
  ]);
});

test("cancellation policy text is about the venue", () => {
  assert.match(cancellationPolicyText({ cancellation_allowed: false, cancellation_cutoff_hours: null }), /venue does not allow/);
  assert.match(cancellationPolicyText({ cancellation_allowed: true, cancellation_cutoff_hours: 6 }), /up to 6h before/);
  assert.match(cancellationPolicyText({ cancellation_allowed: true, cancellation_cutoff_hours: null }), /any time/);
});
