/** fix/nov-7 item 3 on the app: the picker's booking span label and the rule form's clash warning. */
import test from "node:test";
import assert from "node:assert/strict";
import { formatBookingSpan, rateClashes, rateForCell, type PricingRuleDraft, type Slot } from "@court-booking/types";

import { pickerModel } from "./player-flow";

const start = Date.parse("2026-11-09T12:00:00Z"); // 5:00 PM PKT
const slots: Slot[] = Array.from({ length: 5 }, (_, i) => ({
  starts_at: new Date(start + i * 30 * 60_000).toISOString(),
  ends_at: new Date(start + (i + 1) * 30 * 60_000).toISOString(),
  status: "available",
  price: 1000,
  advance_amount: 1000,
  held_until: null,
  booking_id: null,
  is_mine: false,
  reason: null,
  after_midnight: false,
}));
const rule = (id: string, name: string, price: string, startTime: string | null = null, endTime: string | null = null): PricingRuleDraft =>
  ({ id, name, pricePerSlot: price, dayOfWeek: null, startTime, endTime });

test("a 1-hour booking picked at 5:30 PM reads 5:30 se 6:30 PM", () => {
  const m = pickerModel(slots, 2, slots[1].starts_at, start - 3_600_000);
  assert.equal(formatBookingSpan(m.startsAt!, m.endsAt!, "ru"), "5:30 se 6:30 PM");
});

test("peak 3-6 PM and 6 PM-12 AM boundaries on the app's rule model", () => {
  const rules = [rule("b", "Aam", "2000"), rule("p", "Peak", "3000", "15:00", "18:00"), rule("l", "Raat", "4000", "18:00", "00:00")];
  const at = (h: number, mm = 0) => rateForCell(rules, 2, h * 60 + mm)!.name;
  assert.deepEqual([at(14, 30), at(15), at(17, 30), at(18), at(23, 30), at(24)], ["Aam", "Peak", "Peak", "Raat", "Raat", "Aam"]);
});

test("overlapping rules warn on the rule that loses", () => {
  const c = rateClashes({ pricingRules: [rule("b", "Aam", "2000"), rule("e", "Shaam", "2500", "15:00", "21:00"), rule("p", "Peak", "3000", "15:00", "18:00")] });
  assert.equal(c.e?.[0].message, 'Ye do rule takra rahe hain, "Peak" lagega.');
});
