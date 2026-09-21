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
import { formatSlotTimes, formatTimeRange } from "./datetime";
import { hoursKind, scheduleHoursError, weeklyHoursError } from "./validation";
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
  setup.closeTime = "05:00"; // 6 AM to 5 AM is overnight hours now (Section 32 Part 3), not a problem
  assert.equal(courtSetupProblem(setup), null);
  setup.closeTime = "";
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
    schedule_templates: Array.from({ length: 7 }, (_, d) => ({ id: String(d), day_of_week: d, open_time: "06:00:00", close_time: "23:00:00", closes_next_day: false, is_active: true })),
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
  assert.equal(slotPreview("10:00", "10:30", 60), null); // too short for one slot
  assert.equal(slotPreview("10:00", "09:00", 60)!.count, 23); // 10 AM to 9 AM next morning is overnight hours
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
    after_midnight: false,
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


// ---- Section 32 Part 3: overnight courts ---------------------------------------------------------------------

test("hours that close before they open are overnight hours, not an error", () => {
  assert.equal(scheduleHoursError("15:00", "03:00"), null); // 3 PM to 3 AM
  assert.equal(scheduleHoursError("18:00", "06:00"), null);
  assert.equal(scheduleHoursError("06:00", "06:00"), null); // open 24 hours
  assert.equal(scheduleHoursError("06:00", "00:00"), null); // closes at midnight
  assert.match(scheduleHoursError("", "03:00")!, /Choose/);
  assert.deepEqual([hoursKind("06:00", "23:00"), hoursKind("15:00", "03:00"), hoursKind("06:00", "06:00"), hoursKind("06:00", "00:00")], [
    "same-day", "next-day", "24-hours", "next-day",
  ]);
});

test("an overnight day may not run into the next day's opening (the week wraps)", () => {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const same = { open: "15:00", close: "03:00" };
  assert.equal(weeklyHoursError(true, "15:00", "03:00", {}, days), null); // 3 PM opens after 3 AM closes: fine
  const overlap = weeklyHoursError(false, "15:00", "03:00", { 4: { open: "02:00", close: "23:00" } }, days);
  assert.match(overlap!, /Thu runs until the next morning, past the time Fri opens/);
  const wrap = weeklyHoursError(false, "15:00", "03:00", { 0: { open: "02:00", close: "10:00" } }, days);
  assert.match(wrap!, /Sun runs until the next morning, past the time Mon opens/);
  assert.equal(weeklyHoursError(false, "15:00", "03:00", { 4: { open: "03:00", close: "23:00" } }, days), null); // closes exactly as it opens
  assert.ok(same);
});

test("the live preview counts slots across midnight", () => {
  assert.equal(slotPreview("15:00", "03:00", 60)!.count, 12);
  assert.equal(slotPreviewText("15:00", "03:00", 60), "12 slots a day, 3:00 PM to 3:00 AM the next morning");
  assert.equal(slotPreview("06:00", "06:00", 60)!.count, 24); // open 24 hours
  assert.equal(slotPreview("06:00", "00:00", 60)!.count, 18); // closes at midnight: 6 AM ... 11 PM
  assert.equal(slotPreviewText("06:00", "00:00", 60), "18 slots a day, 6:00 AM to 12:00 AM the next morning".replace(" the next morning", ""));
  assert.equal(slotPreviewText("06:00", "23:00", 90), "11 slots a day, 6:00 AM to 10:30 PM"); // an ordinary court is unchanged
});

test("a range that ends the next day names the day; a slot after midnight says which day it is on", () => {
  const thu2300 = "2026-09-24T18:00:00Z"; // 11:00 PM Thu 24 Sep PKT
  const fri0100 = "2026-09-24T20:00:00Z"; // 1:00 AM Fri 25 Sep PKT
  const fri0200 = "2026-09-24T21:00:00Z";
  const midnight = "2026-09-24T19:00:00Z"; // 12:00 AM Fri
  assert.equal(formatTimeRange(thu2300, fri0100), "11:00 PM to Fri 1:00 AM");
  assert.equal(formatTimeRange(thu2300, midnight), "11:00 PM to 12:00 AM"); // ending at midnight is not named
  assert.equal(formatTimeRange("2026-09-24T14:30:00Z", "2026-09-24T16:00:00Z"), "7:30 PM to 9:00 PM"); // ordinary ranges unchanged
  assert.equal(formatSlotTimes({ starts_at: fri0100, ends_at: fri0200, after_midnight: true }), "Fri 1:00 AM to 2:00 AM");
  assert.equal(formatSlotTimes({ starts_at: thu2300, ends_at: midnight, after_midnight: false }), "11:00 PM to 12:00 AM");
});
