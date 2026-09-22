/**
 * The ONE place the apps turn an instant or a calendar date into text or into an API date parameter.
 *
 * Rules (Section 32), for every player and owner screen: 12-hour clock ("7:30 PM"), Pakistan time (PKT,
 * UTC+5), human dates ("Wed, 23 Sep"; "Today"/"Tomorrow" within a day), never 24-hour, never UTC, never ISO.
 *
 * Everything here works from a FIXED +5h offset, not from the device's timezone: `toLocaleTimeString`,
 * `getHours()`, `getDate()` and `toISOString().slice(0, 10)` all depend on the phone/laptop's zone (or, for
 * `toISOString`, on UTC), which is how the date tabs ended up querying the wrong day between midnight and
 * 5 AM in Karachi -- the tab said "Wed 23" and the request asked for the 22nd. Pakistan has no DST, so a
 * fixed offset is exact. Mirrors backend `app/utils/timezone.py`.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type Instant = Date | string | number;

export interface PktParts {
  year: number;
  /** 0-11 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

/** The wall-clock fields of an instant as they read in Pakistan. */
export function pktParts(instant: Instant): PktParts {
  const shifted = new Date(new Date(instant).getTime() + PKT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-09-23": the PAKISTAN calendar date of an instant (default: now). This is what every `?date=` API
 * parameter must be. Never use `toISOString().slice(0, 10)` for this: that is the UTC date. */
export function pktDateString(instant: Instant = new Date()): string {
  const p = pktParts(instant);
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`;
}

function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

/** `dateStr` shifted by `days` calendar days ("2026-09-23" + 1 = "2026-09-24"). Pure calendar arithmetic. */
export function addDays(dateStr: string, days: number): string {
  const { year, month, day } = parseDateString(dateStr);
  const t = new Date(Date.UTC(year, month, day) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Weekday (0 = Sunday) of a "YYYY-MM-DD" calendar date. */
export function weekdayOf(dateStr: string): number {
  const { year, month, day } = parseDateString(dateStr);
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

/** The first instant of a Pakistan calendar day, as a UTC instant (00:00 PKT = 19:00 UTC the day before). */
export function pktMidnightUtc(dateStr: string): Date {
  const { year, month, day } = parseDateString(dateStr);
  return new Date(Date.UTC(year, month, day) - PKT_OFFSET_MS);
}

export interface DayTab {
  /** "2026-09-23", the API date parameter */
  date: string;
  /** "Wed" */
  weekday: string;
  day: number;
  /** "Sep" */
  month: string;
  isToday: boolean;
}

/** `count` consecutive Pakistan calendar days starting today. */
export function pktDayTabs(count: number, now: Instant = new Date()): DayTab[] {
  const today = pktDateString(now);
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(today, i);
    const { month, day } = parseDateString(date);
    return { date, weekday: WEEKDAYS[weekdayOf(date)], day, month: MONTHS[month], isToday: i === 0 };
  });
}

/** "2026-09" from a "YYYY-MM-DD" calendar date. */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** "2026-09" + 1 = "2026-10"; "2026-12" + 1 = "2027-01". Pure calendar-month arithmetic, no Date timezone risk. */
export function addMonths(monthStr: string, n: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

/** "2026-09" -> "Sep 2026". */
export function formatMonth(monthStr: string): string {
  const [, m] = monthStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${monthStr.slice(0, 4)}`;
}

/** Every "YYYY-MM-DD" calendar date in a "YYYY-MM" month, in order. */
export function daysOfMonth(monthStr: string): string[] {
  const [y, m] = monthStr.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this month
  return Array.from({ length: count }, (_, i) => `${monthStr}-${pad2(i + 1)}`);
}

/** Monday-first weekday index (0 = Monday .. 6 = Sunday) of a "YYYY-MM-DD" calendar date. */
export function mondayFirstWeekdayOf(dateStr: string): number {
  return (weekdayOf(dateStr) + 6) % 7;
}

/** The 7 "YYYY-MM-DD" dates of the Monday-first week containing `dateStr`. */
export function weekOf(dateStr: string): string[] {
  const start = addDays(dateStr, -mondayFirstWeekdayOf(dateStr));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// ---- formatting -------------------------------------------------------------------------------------

function clock(p: Pick<PktParts, "hour" | "minute">): string {
  const hour12 = p.hour % 12 || 12;
  return `${hour12}:${pad2(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`;
}

/** "7:30 PM". */
export function formatTime(instant: Instant): string {
  return clock(pktParts(instant));
}

/** "7:30 PM to 9:00 PM". When the range ends on a LATER Pakistan calendar day (an overnight court, Section 32 Part 3) the
 * end names its day so nobody has to guess: "11:00 PM to Fri 1:00 AM". Ending exactly at midnight is not named
 * ("11:00 PM to 12:00 AM"): that reads unambiguously. */
export function formatTimeRange(start: Instant, end: Instant): string {
  const s = pktParts(start);
  const e = pktParts(end);
  const nextDay = e.day !== s.day || e.month !== s.month || e.year !== s.year;
  const atMidnight = e.hour === 0 && e.minute === 0;
  const endText = nextDay && !atMidnight ? `${WEEKDAYS[e.weekday]} ${formatTime(end)}` : formatTime(end);
  return `${formatTime(start)} to ${endText}`;
}

/** How a slot's times read in a schedule day's list. A slot AFTER MIDNIGHT (`after_midnight`) belongs to the day it
 * opened but sits on the next calendar day, so it says so: "Fri 1:00 AM to 2:00 AM". */
export function formatSlotTimes(slot: { starts_at: Instant; ends_at: Instant; after_midnight?: boolean }): string {
  const range = formatTimeRange(slot.starts_at, slot.ends_at);
  return slot.after_midnight ? `${WEEKDAYS[pktParts(slot.starts_at).weekday]} ${range}` : range;
}

/** "Wed, 23 Sep"; the year is added only when it is not the current (Pakistan) year: "Tue, 5 Jan 2027". */
export function formatDate(instant: Instant, now: Instant = new Date()): string {
  const p = pktParts(instant);
  const base = `${WEEKDAYS[p.weekday]}, ${p.day} ${MONTHS[p.month]}`;
  return p.year === pktParts(now).year ? base : `${base} ${p.year}`;
}

/** Same as `formatDate` for a "YYYY-MM-DD" calendar date (no time attached). */
export function formatDateString(dateStr: string, now: Instant = new Date()): string {
  return formatDate(pktMidnightUtc(dateStr), now);
}

/** "Today" / "Tomorrow" within a day of today (Pakistan calendar), otherwise `formatDate`. */
export function formatDateRelative(instant: Instant, now: Instant = new Date()): string {
  const diffDays = Math.round(
    (pktMidnightUtc(pktDateString(instant)).getTime() - pktMidnightUtc(pktDateString(now)).getTime()) / DAY_MS,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return formatDate(instant, now);
}

/** "Wed, 23 Sep, 7:30 PM" (or "Today, 7:30 PM"): a moment in time, e.g. a blackout start or a timestamp. */
export function formatWhen(instant: Instant, now: Instant = new Date()): string {
  return `${formatDateRelative(instant, now)}, ${formatTime(instant)}`;
}

/** "Wed, 23 Sep, 7:30 PM to 9:00 PM". */
export function formatWhenRange(start: Instant, end: Instant, now: Instant = new Date()): string {
  return `${formatDateRelative(start, now)}, ${formatTimeRange(start, end)}`;
}

/** The ready-made slot label the backend hands the chat assistant: "7:30 PM to 9:00 PM, Wed 23 Sep". */
export function formatSlotLabel(start: Instant, end: Instant, now: Instant = new Date()): string {
  return `${formatTimeRange(start, end)}, ${formatDate(start, now).replace(",", "")}`;
}

// ---- owner time inputs (stored as "HH:MM" 24-hour, shown as 12-hour) -----------------------------------

export type Meridiem = "AM" | "PM";

export interface Time12 {
  /** 1-12 */
  hour: number;
  /** 0-59 */
  minute: number;
  meridiem: Meridiem;
}

/** "18:30" -> { hour: 6, minute: 30, meridiem: "PM" }. Returns null for anything that is not "HH:MM[:SS]". */
export function parseTime24(value: string): Time12 | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const minute = Number(m[2]);
  if (h > 23 || minute > 59) return null;
  return { hour: h % 12 || 12, minute, meridiem: h < 12 ? "AM" : "PM" };
}

/** { hour: 6, minute: 30, meridiem: "PM" } -> "18:30" (the format the API stores). */
export function toTime24({ hour, minute, meridiem }: Time12): string {
  const h24 = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  return `${pad2(h24)}:${pad2(minute)}`;
}

/** "18:30" -> "6:30 PM" (what the owner reads). Falls back to the input if it isn't a time. */
export function formatTime24As12(value: string): string {
  const t = parseTime24(value);
  return t ? `${t.hour}:${pad2(t.minute)} ${t.meridiem}` : value;
}

/** The instant for a Pakistan calendar date plus a "HH:MM" wall-clock time: pktInstant("2026-09-23", "19:30")
 * is 7:30 PM in Karachi. Used where an owner picks a date and a time (blackouts). */
export function pktInstant(dateStr: string, time24: string): Date {
  const [h, m] = time24.split(":").map(Number);
  return new Date(pktMidnightUtc(dateStr).getTime() + (h * 60 + m) * 60_000);
}
