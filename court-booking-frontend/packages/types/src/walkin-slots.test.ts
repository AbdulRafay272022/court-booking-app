import assert from "node:assert/strict";
import { test } from "node:test";

import type { Slot } from "./availability";
import { walkinSlots } from "./booking-duration";

// PKT = UTC+5. A helper for a 30-minute slot starting at the given PKT wall clock on 2026-10-10 (+ dayOffset days).
function slot(hh: number, mm: number, opts: { dayOffset?: number; after_midnight?: boolean } = {}): Slot {
  const start = Date.UTC(2026, 9, 10 + (opts.dayOffset ?? 0), hh - 5, mm);
  return {
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + 30 * 60000).toISOString(),
    status: "available",
    price: 500,
    advance_amount: 500,
    held_until: null,
    booking_id: null,
    is_mine: false,
    reason: null,
    after_midnight: opts.after_midnight ?? false,
  };
}
const at = (hh: number, mm: number, dayOffset = 0) => Date.UTC(2026, 9, 10 + dayOffset, hh - 5, mm);
const starts = (slots: Slot[]) => slots.map((s) => s.starts_at);

test("slots that have ended are not offered, the one in progress and later ones are", () => {
  const day = [slot(18, 0), slot(18, 30), slot(19, 0), slot(19, 30), slot(20, 0)];
  // 7:10 PM: 6:00 and 6:30 are over; 7:00-7:30 is in progress
  assert.deepEqual(starts(walkinSlots(day, undefined, true, at(19, 10))), starts(day.slice(2)));
  // exactly 7:00 PM: 6:30-7:00 ended this very minute
  assert.deepEqual(starts(walkinSlots(day, undefined, true, at(19, 0))), starts(day.slice(2)));
  // 6:59 PM: 6:30-7:00 is still in progress
  assert.deepEqual(starts(walkinSlots(day, undefined, true, at(18, 59))), starts(day.slice(1)));
  // a future day: everything is offered
  assert.equal(walkinSlots(day, undefined, false, at(9, 0, -3)).length, 5);
});

test("overnight court: the previous schedule day's after-midnight slots are offered on today's tab, judged by the real time", () => {
  // schedule day Oct 9 ran 3 PM to 3 AM, so its tail is Oct 10 12:30 AM, 1:00 AM, 1:30 AM, 2:00 AM, 2:30 AM (after_midnight)
  const yesterday = [slot(15, 0, { dayOffset: -1 }), slot(0, 30, { after_midnight: true }), slot(1, 0, { after_midnight: true }), slot(1, 30, { after_midnight: true })];
  // today's own schedule starts 3 PM
  const today = [slot(15, 0), slot(15, 30)];
  const offered = walkinSlots(today, yesterday, true, at(1, 10)); // 1:10 AM on Oct 10
  assert.deepEqual(starts(offered), starts([yesterday[2], yesterday[3], ...today])); // 12:30 AM over, 1:00 AM in progress, 1:30 AM ahead
  // yesterday's non-after-midnight slots are never pulled in, and on another tab nothing is added
  assert.equal(walkinSlots(today, yesterday, false, at(1, 10)).length, 2);
  // by 3 PM today the tail is gone
  assert.deepEqual(starts(walkinSlots(today, yesterday, true, at(15, 10))), starts(today));
});
