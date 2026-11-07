/** fix/nov-7 item 3 on web: the day popup's open row reads as the minimum booking it prices ("5:30 se 6:30 PM"). */
import assert from "node:assert/strict";
import test from "node:test";
import { minimumBookingSpan, rateClashes, type Slot } from "@court-booking/types";

import { makeFmt } from "./format-i18n";

const start = Date.UTC(2026, 10, 9, 12, 0); // 5:00 PM PKT
const slots = Array.from({ length: 5 }, (_, i) => ({
  starts_at: new Date(start + i * 30 * 60_000).toISOString(),
  ends_at: new Date(start + (i + 1) * 30 * 60_000).toISOString(),
  status: "available",
  price: 1000,
})) as unknown as Slot[];

test("the 5:30 PM row of a 1-hour-minimum court reads 5:30 se 6:30 PM (not 5:30 se 6:00 PM · 1 ghanta)", () => {
  const span = minimumBookingSpan(slots, 1, 2)!;
  assert.equal(makeFmt("ru").bookingSpan(span), "5:30 se 6:30 PM");
  assert.equal(makeFmt("en").bookingSpan(span), "5:30 to 6:30 PM");
  assert.equal(minimumBookingSpan(slots, 4, 2), null);
});

test("the rule form's clash warning (Roman Urdu in both languages)", () => {
  const r = (id: string, name: string, price: string, s: string | null, e: string | null) => ({ id, name, pricePerSlot: price, dayOfWeek: null, startTime: s, endTime: e });
  const c = rateClashes({ pricingRules: [r("a", "Base", "2000", null, null), r("b", "Shaam", "2500", "15:00", "21:00"), r("c", "Peak", "3000", "15:00", "18:00")] });
  assert.equal(c.b[0].message, 'Ye do rule takra rahe hain, "Peak" lagega.');
});
