import assert from "node:assert/strict";
import test from "node:test";

import type { ScheduleTemplate } from "./court";
import { bookingHorizonText, scheduleHoursText, upcomingBlackouts, weeklyHoursLines } from "./court-hours";

const tpl = (day: number, open: string, close: string, next = false): ScheduleTemplate => ({
  id: `t${day}`,
  day_of_week: day,
  open_time: open,
  close_time: close,
  closes_next_day: next,
  is_active: true,
});

test("same hours Mon-Fri, a different Saturday, Sunday closed", () => {
  const lines = weeklyHoursLines([
    ...[0, 1, 2, 3, 4].map((d) => tpl(d, "06:00:00", "23:00:00")),
    tpl(5, "08:00:00", "20:30:00"),
  ]);
  assert.deepEqual(lines, [
    { days: "Mon–Fri", hours: "6:00 AM – 11:00 PM", closed: false },
    { days: "Sat", hours: "8:00 AM – 8:30 PM", closed: false },
    { days: "Sun", hours: "Closed", closed: true },
  ]);
});

test("every day the same collapses to Every day; overnight and 24-hour wording", () => {
  assert.deepEqual(weeklyHoursLines([0, 1, 2, 3, 4, 5, 6].map((d) => tpl(d, "18:00:00", "02:00:00", true))), [
    { days: "Every day", hours: "6:00 PM – 2:00 AM (next day)", closed: false },
  ]);
  assert.equal(scheduleHoursText(tpl(0, "00:00:00", "00:00:00", true)), "Open 24 hours");
  assert.equal(scheduleHoursText(tpl(0, "06:00:00", "00:00:00", true)), "6:00 AM – 12:00 AM (next day)");
});

test("a court with no schedule at all is closed every day", () => {
  assert.deepEqual(weeklyHoursLines([]), [{ days: "Every day", hours: "Closed", closed: true }]);
});

test("booking horizon text", () => {
  assert.equal(bookingHorizonText(90), "Bookable up to 90 days ahead");
  assert.equal(bookingHorizonText(1), "Bookable up to 1 day ahead");
  assert.equal(bookingHorizonText(0), null);
});

test("upcoming blackouts drop past ones, sort by start and read in 12-hour Pakistan time", () => {
  const now = new Date("2026-09-21T10:00:00Z"); // 3:00 PM PKT
  const lines = upcomingBlackouts(
    [
      { id: "old", title: null, starts_at: "2026-09-20T10:00:00Z", ends_at: "2026-09-20T12:00:00Z", reason: "other" },
      { id: "b", title: null, starts_at: "2026-09-25T13:00:00Z", ends_at: "2026-09-25T15:00:00Z", reason: "maintenance" },
      { id: "a", title: "Tournament", starts_at: "2026-09-23T13:00:00Z", ends_at: "2026-09-23T21:00:00Z", reason: "private_event" },
    ],
    now,
  );
  assert.deepEqual(
    lines.map((l) => [l.id, l.label, l.when]),
    [
      ["a", "Tournament", "Wed, 23 Sep, 6:00 PM to Thu 2:00 AM"],
      ["b", "Maintenance", "Fri, 25 Sep, 6:00 PM to 8:00 PM"],
    ],
  );
});
