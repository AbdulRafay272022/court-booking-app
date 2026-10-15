// Roman Urdu output of the shared formatters, and proof that English is unchanged when no language is given.
//   TZ=UTC npx tsx --test src/locale-text.test.ts   (also Asia/Karachi and America/Los_Angeles)
import assert from "node:assert/strict";
import { test } from "node:test";
import { amenityLabel } from "./sports";
import { bookingHorizonText, scheduleHoursText, upcomingBlackouts, weeklyHoursLines } from "./court-hours";
import { cancellationPolicyText, formatDuration, slotPreviewText } from "./booking-duration";
import { startsInText } from "./booking-dashboard";
import {
  formatDate,
  formatDateRelative,
  formatMonth,
  formatSlotLabel,
  formatSlotTimes,
  formatTimeRange,
  formatWhen,
  pktDayTabs,
  selfCheckinWindow,
} from "./datetime";
import type { ScheduleTemplate } from "./court";

const NOW = new Date("2026-09-21T10:00:00+05:00"); // Monday 21 Sep 2026, 10:00 AM in Karachi
const at = (iso: string) => new Date(iso);

test("dates and times in Roman Urdu", () => {
  const wed = at("2026-09-23T14:30:00Z"); // Wed 23 Sep, 7:30 PM PKT
  assert.equal(formatDate(wed, NOW), "Wed, 23 Sep");
  assert.equal(formatDate(wed, NOW, "ru"), "Budh, 23 Sep");
  assert.equal(formatDateRelative(NOW, NOW, "ru"), "Aaj");
  assert.equal(formatDateRelative(at("2026-09-22T05:00:00Z"), NOW, "ru"), "Kal · 22 Sep");
  assert.equal(formatWhen(wed, NOW, "ru"), "Budh, 23 Sep, 7:30 PM");
  assert.equal(formatTimeRange(wed, at("2026-09-23T16:00:00Z"), "ru"), "7:30 PM se 9:00 PM");
  assert.equal(formatSlotLabel(wed, at("2026-09-23T16:00:00Z"), NOW, "ru"), "7:30 PM se 9:00 PM, Budh 23 Sep");
  assert.equal(formatMonth("2026-10"), "Oct 2026");
  assert.equal(formatMonth("2026-10", "ru"), "Aktoobar 2026");
  assert.equal(formatMonth("2026-09", "ru"), "Sitambar 2026");
  assert.equal(
    formatSlotTimes({ starts_at: "2026-09-24T20:00:00Z", ends_at: "2026-09-24T21:00:00Z", after_midnight: true }, "ru"),
    "Jumma 1:00 AM se 2:00 AM",
  );
  assert.equal(pktDayTabs(2, NOW, "ru")[1].weekday, "Mangal");
  assert.equal(pktDayTabs(2, NOW)[1].weekday, "Tue");
});

test("durations, countdowns, check-in", () => {
  assert.deepEqual([30, 60, 90, 120].map((m) => formatDuration(m, "ru")), ["30 minute", "1 ghanta", "1.5 ghante", "2 ghante"]);
  assert.equal(formatDuration(90), "1.5 hours");
  const now = Date.parse("2026-09-21T10:00:00+05:00");
  assert.equal(startsInText("2026-09-23T10:00:00+05:00", "2026-09-23T11:00:00+05:00", now, "ru"), "2 din mein");
  assert.equal(startsInText("2026-09-23T10:00:00+05:00", "2026-09-23T11:00:00+05:00", now), "in 2 days");
  assert.equal(startsInText("2026-09-21T09:00:00+05:00", "2026-09-21T11:00:00+05:00", now, "ru"), "abhi chal raha hai");
  assert.equal(startsInText("2026-09-21T08:00:00+05:00", "2026-09-21T09:00:00+05:00", now, "ru"), "khatam");
  assert.equal(selfCheckinWindow("2026-09-21T19:30:00+05:00", NOW, "ru").message, "Aap 7:15 PM se check in kar sakte hain.");
});

test("hours, horizon, blackouts, policy, preview, amenities", () => {
  const t = { open_time: "06:00:00", close_time: "23:00:00", closes_next_day: false };
  assert.equal(scheduleHoursText(t, "ru"), "6:00 AM – 11:00 PM");
  assert.equal(scheduleHoursText({ open_time: "00:00:00", close_time: "00:00:00", closes_next_day: false }, "ru"), "24 ghante khula");
  assert.equal(scheduleHoursText({ open_time: "18:00:00", close_time: "02:00:00", closes_next_day: true }, "ru"), "6:00 PM – 2:00 AM (agle din)");
  const templates = [0, 1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, ...t, is_active: true })) as unknown as ScheduleTemplate[];
  assert.deepEqual(weeklyHoursLines(templates, "ru").map((l) => [l.days, l.hours]), [
    ["Peer–Hafta", "6:00 AM – 11:00 PM"],
    ["Itwar", "Band"],
  ]);
  assert.equal(bookingHorizonText(90, "ru"), "90 din pehle tak booking ho sakti hai");
  assert.equal(bookingHorizonText(90), "Bookable up to 90 days ahead");
  const bo = upcomingBlackouts(
    [{ id: "1", starts_at: "2026-09-23T14:00:00Z", ends_at: "2026-09-23T15:00:00Z", reason: "weather", title: null }] as never,
    NOW,
    "ru",
  );
  assert.equal(bo[0].label, "Mausam");
  assert.equal(cancellationPolicyText({ cancellation_allowed: false, cancellation_cutoff_hours: null }, "ru"), "Is venue par booking ke baad cancel nahi ho sakti.");
  assert.equal(cancellationPolicyText({ cancellation_allowed: true, cancellation_cutoff_hours: 6 }, "ru"), "Booking se 6 ghante pehle tak free cancel kar sakte hain.");
  assert.equal(slotPreviewText("06:00", "23:00", 60, "ru"), "Roz 17 slot, 6:00 AM se 11:00 PM tak");
  assert.equal(amenityLabel("floodlights", "ru"), "Roshni (floodlights)");
  assert.equal(amenityLabel("changing_room", "ru"), "Kapray badalne ka kamra");
  assert.equal(amenityLabel("floodlights"), "Floodlights");
  assert.equal(amenityLabel("lounge"), "Lounge");
});
