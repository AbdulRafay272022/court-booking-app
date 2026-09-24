// Run under several device timezones to prove the results do not depend on the device:
//   TZ=UTC npx tsx --test src/datetime.test.ts
//   TZ=Asia/Karachi npx tsx --test src/datetime.test.ts
//   TZ=America/Los_Angeles npx tsx --test src/datetime.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  addMonths,
  daysOfMonth,
  formatDate,
  formatDateRelative,
  formatDateString,
  formatMonth,
  formatSlotLabel,
  formatTime,
  formatTime24As12,
  formatTimeRange,
  formatWhen,
  monthOf,
  parseTime24,
  pktDateString,
  pktDayTabs,
  selfCheckinWindow,
  toTime24,
  weekOf,
} from "./datetime";

const NOW = new Date("2026-09-21T10:00:00+05:00"); // Monday 21 Sep, 10:00 AM in Karachi
const at = (iso: string) => new Date(iso);

test("times are 12-hour Pakistan time, including the midnight boundary", () => {
  assert.equal(formatTime(at("2026-09-23T01:00:00Z")), "6:00 AM");
  assert.equal(formatTime(at("2026-09-23T14:30:00Z")), "7:30 PM");
  assert.equal(formatTime(at("2026-09-23T18:30:00Z")), "11:30 PM");
  assert.equal(formatTime(at("2026-09-23T19:00:00Z")), "12:00 AM");
  assert.equal(formatTime(at("2026-09-23T19:30:00Z")), "12:30 AM");
  assert.equal(formatTime(at("2026-09-23T07:00:00Z")), "12:00 PM");
  assert.equal(formatTimeRange(at("2026-09-23T14:30:00Z"), at("2026-09-23T16:00:00Z")), "7:30 PM to 9:00 PM");
});

test("self-check-in window is 15 minutes before to 15 minutes after the booking's start (Section 32 Part 9)", () => {
  const startsAt = at("2026-09-21T14:00:00Z"); // 7:00 PM PKT
  const tooEarly = selfCheckinWindow(startsAt, at("2026-09-21T13:30:00Z")); // 6:30 PM, 30 min before
  assert.equal(tooEarly.isOpen, false);
  assert.equal(tooEarly.message, "You can check in starting at 6:45 PM.");

  const justOpened = selfCheckinWindow(startsAt, at("2026-09-21T13:45:00Z")); // 6:45 PM, exactly 15 min before
  assert.equal(justOpened.isOpen, true);

  const onTime = selfCheckinWindow(startsAt, at("2026-09-21T14:05:00Z")); // 7:05 PM
  assert.equal(onTime.isOpen, true);
  assert.equal(onTime.message, "");

  const justClosed = selfCheckinWindow(startsAt, at("2026-09-21T14:16:00Z")); // 7:16 PM, 1 min after it closed
  assert.equal(justClosed.isOpen, false);
  assert.equal(justClosed.message, "Check-in for this booking closed at 7:15 PM.");
});

test("the date is the PAKISTAN date: 12:30 AM on the 24th is the 24th although UTC says the 23rd", () => {
  assert.equal(pktDateString(at("2026-09-23T19:30:00Z")), "2026-09-24");
  assert.equal(pktDateString(at("2026-09-23T18:59:00Z")), "2026-09-23");
  assert.equal(formatDate(at("2026-09-23T19:30:00Z"), NOW), "Thu, 24 Sep");
});

test("date tabs at 3:14 AM Monday 21 Sep Karachi (UTC is still Sunday 20 Sep) start on the 21st", () => {
  const tabs = pktDayTabs(4, new Date("2026-09-21T03:14:00+05:00"));
  assert.deepEqual(
    tabs.map((t) => [t.weekday, t.day, t.date]),
    [
      ["Mon", 21, "2026-09-21"],
      ["Tue", 22, "2026-09-22"],
      ["Wed", 23, "2026-09-23"],
      ["Thu", 24, "2026-09-24"],
    ],
  );
  // The old code sent `toISOString().slice(0,10)` here, which is the previous day for every tab.
  assert.notEqual(new Date("2026-09-21T03:14:00+05:00").toISOString().slice(0, 10), tabs[0].date);
  assert.equal(tabs[0].isToday, true);
  assert.equal(tabs[1].isToday, false);
});

test("human dates: no ISO, year only when it is not this year, Today/Tomorrow within a day", () => {
  assert.equal(formatDate(at("2026-09-23T14:30:00Z"), NOW), "Wed, 23 Sep");
  assert.equal(formatDate(at("2027-01-05T07:00:00Z"), NOW), "Tue, 5 Jan 2027");
  assert.equal(formatDateString("2026-09-23", NOW), "Wed, 23 Sep");
  assert.equal(formatDateRelative(at("2026-09-21T14:30:00Z"), NOW), "Today");
  assert.equal(formatDateRelative(at("2026-09-22T14:30:00Z"), NOW), "Tomorrow");
  assert.equal(formatDateRelative(at("2026-09-23T14:30:00Z"), NOW), "Wed, 23 Sep");
  assert.equal(formatWhen(at("2026-09-23T14:30:00Z"), NOW), "Wed, 23 Sep, 7:30 PM");
  assert.equal(formatSlotLabel(at("2026-09-23T14:30:00Z"), at("2026-09-23T16:00:00Z"), NOW), "7:30 PM to 9:00 PM, Wed 23 Sep");
});

test("calendar arithmetic", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("month-calendar arithmetic (Section 32 Part 4b)", () => {
  assert.equal(monthOf("2026-09-23"), "2026-09");
  assert.equal(addMonths("2026-09", 1), "2026-10");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-09", -1), "2026-08");
  assert.equal(formatMonth("2026-09"), "Sep 2026");
  assert.equal(formatMonth("2027-01"), "Jan 2027");
  assert.equal(daysOfMonth("2026-09").length, 30);
  assert.equal(daysOfMonth("2026-09")[0], "2026-09-01");
  assert.equal(daysOfMonth("2026-09")[29], "2026-09-30");
  assert.equal(daysOfMonth("2026-02").length, 28); // 2026 is not a leap year
  // Wed 23 Sep 2026's Monday-first week is Mon 21 -> Sun 27.
  assert.deepEqual(weekOf("2026-09-23"), [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
  ]);
  // Sunday's own week starts the Monday before it, not the same day.
  assert.equal(weekOf("2026-09-27")[0], "2026-09-21");
});

test("12-hour owner inputs round-trip to the stored 24-hour value", () => {
  assert.deepEqual(parseTime24("06:00"), { hour: 6, minute: 0, meridiem: "AM" });
  assert.deepEqual(parseTime24("23:00:00"), { hour: 11, minute: 0, meridiem: "PM" });
  assert.deepEqual(parseTime24("00:30"), { hour: 12, minute: 30, meridiem: "AM" });
  assert.deepEqual(parseTime24("12:00"), { hour: 12, minute: 0, meridiem: "PM" });
  assert.equal(parseTime24("25:00"), null);
  assert.equal(toTime24({ hour: 6, minute: 0, meridiem: "AM" }), "06:00");
  assert.equal(toTime24({ hour: 11, minute: 0, meridiem: "PM" }), "23:00");
  assert.equal(toTime24({ hour: 12, minute: 30, meridiem: "AM" }), "00:30");
  assert.equal(toTime24({ hour: 12, minute: 0, meridiem: "PM" }), "12:00");
  for (const value of ["00:00", "06:15", "12:00", "13:45", "23:59"]) {
    assert.equal(toTime24(parseTime24(value)!), value);
  }
  assert.equal(formatTime24As12("18:30"), "6:30 PM");
  assert.equal(formatTime24As12("00:00"), "12:00 AM");
});

test("pktInstant builds the real instant for a Pakistan date and wall-clock time", async () => {
  const { pktInstant } = await import("./datetime");
  assert.equal(pktInstant("2026-09-23", "19:30").toISOString(), "2026-09-23T14:30:00.000Z");
  assert.equal(pktInstant("2026-09-24", "00:30").toISOString(), "2026-09-23T19:30:00.000Z");
});
