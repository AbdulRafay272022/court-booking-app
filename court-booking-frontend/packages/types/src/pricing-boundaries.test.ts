/** fix/nov-7 item 3: price rule windows are half-open [start, end) and a 30-minute cell takes a rate only when the cell
 * STARTS inside; the order overlapping rates win in; the "takra rahe hain" warning; the open-row label of the day popup.
 * Mirrors court-booking-backend/tests/test_pricing_boundaries.py. */
import assert from "node:assert/strict";
import test from "node:test";

import type { Slot } from "./availability";
import { durationChoices, minimumBookingSpan } from "./booking-duration";
import { rateClashes, rateClashText, rateForCell, windowStartsInside, type PricingRuleDraft } from "./court-setup";
import { formatBookingSpan } from "./datetime";

const m = (h: number, mm = 0) => h * 60 + mm;
const rule = (id: string, name: string, price: string, start: string | null = null, end: string | null = null, days: number[] | null = null): PricingRuleDraft =>
  ({ id, name, pricePerSlot: price, dayOfWeek: days, startTime: start, endTime: end });

test("peak 3 PM-6 PM: 2:30 not peak, 3:00 peak, 5:30 peak, 6:00 not", () => {
  const peak = { startTime: "15:00", endTime: "18:00" };
  assert.equal(windowStartsInside(peak, m(14, 30)), false);
  assert.equal(windowStartsInside(peak, m(15)), true);
  assert.equal(windowStartsInside(peak, m(17, 30)), true);
  assert.equal(windowStartsInside(peak, m(18)), false);
});

test("6 PM-12 AM: 11:30 PM inside, 12:00 AM not; 10 PM-2 AM crosses midnight", () => {
  const late = { startTime: "18:00", endTime: "00:00" };
  assert.equal(windowStartsInside(late, m(23, 30)), true);
  assert.equal(windowStartsInside(late, m(24)), false);
  assert.equal(windowStartsInside(late, m(17, 30)), false);
  const night = { startTime: "22:00", endTime: "02:00" };
  assert.deepEqual([m(21, 30), m(22), m(24), m(25, 30), m(26)].map((s) => windowStartsInside(night, s)), [false, true, true, true, false]);
});

test("a booking crossing a boundary is priced cell by cell", () => {
  const rules = [rule("b", "Base", "2000"), rule("p", "Peak", "3000", "15:00", "18:00"), rule("l", "Late", "4000", "18:00", "00:00")];
  const priceOf = (start: number, cells: number) =>
    Array.from({ length: cells }, (_, i) => Number(rateForCell(rules, 0, start + i * 30)!.pricePerSlot) / 2).reduce((a, b) => a + b, 0);
  assert.equal(priceOf(m(14, 30), 2), 1000 + 1500);
  assert.equal(priceOf(m(17, 30), 2), 1500 + 2000);
  assert.equal(rateForCell(rules, 0, m(23, 30))!.name, "Late");
  assert.equal(rateForCell(rules, 0, m(24))!.name, "Base");
});

test("the order overlapping rates win in: specific, narrower, peak price, then list order", () => {
  const rules = [
    rule("base", "Base", "2000"),
    rule("we", "Weekend", "2500", null, null, [5, 6]),
    rule("ev", "Evening", "2800", "15:00", "21:00"),
    rule("pk", "Peak", "3000", "15:00", "18:00"),
    rule("wp", "Weekend peak", "2600", "16:00", "17:00", [5, 6]),
  ];
  assert.equal(rateForCell(rules, 0, m(10))!.name, "Base");
  assert.equal(rateForCell(rules, 5, m(10))!.name, "Weekend");
  assert.equal(rateForCell(rules, 5, m(16))!.name, "Weekend peak"); // days + window beats a window, even cheaper
  assert.equal(rateForCell(rules, 0, m(16))!.name, "Peak"); // narrower
  assert.equal(rateForCell(rules, 0, m(18))!.name, "Evening");
  assert.equal(rateForCell([rule("a", "A", "2000", "18:00", "21:00"), rule("b", "B", "3500", "19:00", "22:00")], 0, m(19, 30))!.name, "B"); // peak price
  assert.equal(rateForCell([rule("d", "D", "3000", "18:00", "21:00"), rule("c", "C", "3000", "18:00", "21:00")], 0, m(19))!.name, "C"); // lower in the list
});

test("the rule form warns 'Ye do rule takra rahe hain, <name> lagega.' on the rate that loses", () => {
  const clashes = rateClashes({ pricingRules: [rule("base", "Aam", "2000"), rule("ev", "Shaam", "2800", "15:00", "21:00"), rule("pk", "Peak", "3000", "15:00", "18:00")] });
  assert.deepEqual(Object.keys(clashes), ["ev"]); // the all-day base rate is the "baqi sab waqt" rate, never warned
  assert.equal(clashes.ev[0].message, 'Ye do rule takra rahe hain, "Peak" lagega.');
  assert.equal(rateClashText(" "), "Ye do rule takra rahe hain, doosra rule lagega.");
  // touching windows do not clash: 3-6 PM and 6-9 PM share no cell
  assert.deepEqual(rateClashes({ pricingRules: [rule("a", "Din", "2000", "15:00", "18:00"), rule("b", "Raat", "3000", "18:00", "21:00")] }), {});
});

test("a 1-hour booking from 5:30 PM reads 5:30 se 6:30 PM, not the 30-minute cell's 5:30 se 6:00 PM", () => {
  // 5:00-7:30 PM PKT, 30-minute cells, a 60-minute minimum
  const start = Date.UTC(2026, 10, 9, 12, 0); // 5:00 PM PKT
  const slots = Array.from({ length: 5 }, (_, i) => ({
    starts_at: new Date(start + i * 30 * 60_000).toISOString(),
    ends_at: new Date(start + (i + 1) * 30 * 60_000).toISOString(),
    status: "available",
    price: 1000,
  })) as unknown as Slot[];
  const span = minimumBookingSpan(slots, 1, 2)!; // the 5:30 cell
  assert.equal(formatBookingSpan(span.starts_at, span.ends_at, "ru"), "5:30 se 6:30 PM");
  assert.equal(formatBookingSpan(span.starts_at, span.ends_at, "en"), "5:30 to 6:30 PM");
  // different halves of the day keep both; ending at midnight stays short
  const iso = (h: number, mm = 0) => new Date(Date.UTC(2026, 10, 9, h - 5, mm)).toISOString();
  assert.equal(formatBookingSpan(iso(11, 30), iso(12, 30), "ru"), "11:30 AM se 12:30 PM");
  assert.equal(formatBookingSpan(iso(23, 0), iso(24, 0), "ru"), "11:00 PM se 12:00 AM");
  assert.equal(span.ends_at, durationChoices(slots, 1, 2)[0].endsAt);
  assert.equal(minimumBookingSpan(slots, 4, 2), null); // 7:00 PM: a 1-hour booking does not fit before closing
});
