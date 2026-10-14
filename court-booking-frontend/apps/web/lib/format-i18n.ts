import {
  DAY_LABELS,
  amenityLabel,
  bookingHorizonText,
  cancellationPolicyText,
  formatDate,
  formatDateRelative,
  formatDateString,
  formatDuration,
  formatMonth,
  formatSlotLabel,
  formatSlotTimes,
  formatTime,
  formatTime24As12,
  formatTimeRange,
  formatWhen,
  formatWhenRange,
  scheduleHoursText,
  slotPreviewText,
  startsInText,
  upcomingBlackouts,
  weeklyHoursLines,
} from "@court-booking/types";
import { formatDistance, formatRelativeTime } from "./format";
import type { Lang } from "./i18n";

type Instant = Parameters<typeof formatDate>[0];

/**
 * THE language-aware formatter bundle for the web app (Phase 4 contract). Every date, weekday, month, duration, status or label that a
 * screen shows must come from here (`useFmt()` in client components, `await getFmt()` in server components, `makeFmt(lang)` anywhere), NOT
 * from `@court-booking/types` / `lib/format.ts` directly, so that Roman Urdu mode changes them too. English output is exactly what the
 * shared package functions return today. Money stays "PKR 3,500" in both languages (formatPKR is language-free).
 *
 * The implementation below is the English baseline; the localisation work replaces the bodies (tables live in messages/*/fmt.ts) without
 * changing any signature.
 */
export interface Fmt {
  lang: Lang;
  /** "Wed, 23 Sep" / "Today" / "Tomorrow" for an instant. */
  date(instant: Instant): string;
  /** "Tue, 22 Sep" for a "YYYY-MM-DD" calendar date. */
  dateString(dateStr: string): string;
  dateRelative(instant: Instant): string;
  /** "Wed 23 Sep, 7:00 PM". */
  when(instant: Instant): string;
  whenRange(start: Instant, end: Instant): string;
  /** "7:30 PM to 9:00 PM, Wed 23 Sep". */
  slotLabel(start: Instant, end: Instant): string;
  slotTimes(slot: { starts_at: Instant; ends_at: Instant; after_midnight?: boolean }): string;
  timeRange(start: Instant, end: Instant): string;
  /** "7:00 PM" for an instant (digits and AM/PM are the same in both languages). */
  time(instant: Instant): string;
  /** "3:00 AM" for an "HH:MM" string. */
  time24(value: string): string;
  /** "October 2026" for "YYYY-MM". */
  month(monthStr: string): string;
  /** Weekday name for Monday-first index 0..6; "short" = Mon / Peer, "long" = Monday / Peer. */
  weekday(index: number, style?: "short" | "long"): string;
  /** "1 hour", "90 minutes" / "1 ghanta", "90 minute". */
  duration(minutes: number): string;
  /** "just now", "5 min ago". */
  relative(iso: string): string;
  /** "850 m", "1.2 km". */
  distance(meters: number | null): string | null;
  /** "in 2 days", "happening now". */
  startsIn(startsAt: string, endsAt: string): string;
  /** "6:00 AM - 11:00 PM", "Open 24 hours" for one schedule template. */
  hoursText(t: Parameters<typeof scheduleHoursText>[0]): string;
  weeklyHoursLines(templates: Parameters<typeof weeklyHoursLines>[0]): ReturnType<typeof weeklyHoursLines>;
  /** "Bookable up to 90 days ahead" or null. */
  bookingHorizon(days: number | null | undefined): string | null;
  upcomingBlackouts(blackouts: Parameters<typeof upcomingBlackouts>[0]): ReturnType<typeof upcomingBlackouts>;
  slotPreviewText(open24: string, close24: string, gridMinutes: number): string;
  cancellationPolicy(venue: Parameters<typeof cancellationPolicyText>[0]): string;
  /** Booking status label: Pending, Booked, Cancelled, Held, Payment waiting... Accepts any backend status string. */
  bookingStatus(status: string): string;
  /** Amenity label by key ("floodlights" -> "Floodlights" / "Floodlights"), unknown keys prettified. */
  amenity(key: string): string;
  /** Court setting. */
  setting(kind: "indoor" | "outdoor" | "both"): string;
  /** Sport names are NOT translated (Futsal, Padel, Cricket); this exists so call sites are uniform. */
  sport(name: string): string;
  /** City and gender option labels from the shared option lists. */
  city(value: string): string;
  gender(value: string): string;
  /** A validator message from `packages/types` (English text) mapped to the current language; unknown texts pass through unchanged. */
  validation(message: string): string;
}

export function makeFmt(lang: Lang): Fmt {
  return {
    lang,
    date: (i) => formatDate(i),
    dateString: (s) => formatDateString(s),
    dateRelative: (i) => formatDateRelative(i),
    when: (i) => formatWhen(i),
    whenRange: (a, b) => formatWhenRange(a, b),
    slotLabel: (a, b) => formatSlotLabel(a, b),
    slotTimes: (s) => formatSlotTimes(s),
    timeRange: (a, b) => formatTimeRange(a, b),
    time: (i) => formatTime(i),
    time24: (v) => formatTime24As12(v),
    month: (m) => formatMonth(m),
    weekday: (i, style = "short") => {
      const short = DAY_LABELS[((i % 7) + 7) % 7];
      return style === "short" ? short : { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" }[short];
    },
    duration: (m) => formatDuration(m),
    relative: (iso) => formatRelativeTime(iso),
    distance: (m) => formatDistance(m),
    startsIn: (a, b) => startsInText(a, b),
    hoursText: (t) => scheduleHoursText(t),
    weeklyHoursLines: (t) => weeklyHoursLines(t),
    bookingHorizon: (d) => bookingHorizonText(d),
    upcomingBlackouts: (b) => upcomingBlackouts(b),
    slotPreviewText: (o, c, g) => slotPreviewText(o, c, g),
    cancellationPolicy: (v) => cancellationPolicyText(v),
    bookingStatus: (s) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    amenity: (k) => amenityLabel(k),
    setting: (k) => (k === "indoor" ? "Indoor" : k === "outdoor" ? "Outdoor" : "Indoor + Outdoor"),
    sport: (n) => n,
    city: (v) => v,
    gender: (v) => v.replace(/^./, (c) => c.toUpperCase()),
    validation: (m) => m,
  };
}
