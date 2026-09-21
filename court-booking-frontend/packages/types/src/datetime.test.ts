// Run under several device timezones to prove the results do not depend on the device:
//   TZ=UTC npx tsx --test src/datetime.test.ts
//   TZ=Asia/Karachi npx tsx --test src/datetime.test.ts
//   TZ=America/Los_Angeles npx tsx --test src/datetime.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  formatDate,
  formatDateRelative,
  formatDateString,
  formatSlotLabel,
  formatTime,
  formatTime24As12,
  formatTimeRange,
  formatWhen,
  parseTime24,
  pktDateString,
  pktDayTabs,
  toTime24,
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
