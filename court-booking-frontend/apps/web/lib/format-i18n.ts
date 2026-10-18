import {
  bookingChannelKey,
  CITY_OPTIONS,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  amenityLabel,
  approvalSummary,
  pktDayTabs,
  premiumStateText,
  selfCheckinWindow,
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
import { formatDistance } from "./format";
import { translate, type Lang, type MessageKey } from "./i18n";
import { en } from "@/messages";

type Instant = Parameters<typeof formatDate>[0];

/**
 * THE language-aware formatter bundle for the web app (Phase 4 contract). Every date, weekday, month, duration, status or label that a
 * screen shows must come from here (`useFmt()` in client components, `await getFmt()` in server components, `makeFmt(lang)` anywhere), NOT
 * from `@court-booking/types` / `lib/format.ts` directly, so that Roman Urdu mode changes them too. English output is exactly what the
 * shared package functions return today. Money stays "PKR 3,500" in both languages (formatPKR is language-free).
 *
 * The implementation below is the English baseline; the localisation work replaces the bodies (the word tables live in the fmt message files) without
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
  /** Added in Phase 4 (shared). */
  /** Where a booking came from: App, WhatsApp, Walk-in, Phone (null for unknown). */
  /** The "Zariya" value: where a booking started; for a walk-in, who added it (`channelDetail` "owner" | "staff"). */
  bookingSource(source: string | null | undefined, channelDetail?: string | null): string | null;
  /** The self check-in window message for a booking start (see `selfCheckinWindow`). */
  checkinWindow(startsAt: Instant): ReturnType<typeof selfCheckinWindow>;
  /** `count` date tabs from today with weekday / month names in the current language. */
  dayTabs(count: number): ReturnType<typeof pktDayTabs>;
  /** One plain sentence about where a premium feature stands (owner billing). */
  premiumState(f: Parameters<typeof premiumStateText>[0], enforced: boolean, trialDays?: number): string;
  /** The approval card summary for an amount typed into "amount received". */
  approvalSummary(checks: Parameters<typeof approvalSummary>[0], amount: number): ReturnType<typeof approvalSummary>;
}


// ---- validator messages ------------------------------------------------------------------------------

/** English message text -> key, built from the English dictionary (only the messages without placeholders). */
const VALIDATION_EXACT: Record<string, MessageKey> = Object.fromEntries(
  (Object.keys(en) as MessageKey[])
    .filter((k) => k.startsWith("validation.") && !en[k].includes("{"))
    .map((k) => [en[k], k]),
);

const EN_DAYS: readonly string[] = WEEKDAY_SHORT.en;

// DAY_LABELS in packages/types are Monday-first ("Mon" = 0); WEEKDAY_SHORT is Sunday-first. Translate an English short day name.
function dayName(lang: Lang, name: string): string {
  const idx = EN_DAYS.indexOf(name);
  return idx >= 0 ? WEEKDAY_SHORT[lang][idx] : name;
}

function translateValidation(lang: Lang, message: string): string {
  if (lang === "en" || !message) return message;
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const exact = VALIDATION_EXACT[message];
  if (exact) return t(exact);
  const min = /^Use at least (\d+) characters$/.exec(message);
  if (min) return t("validation.passwordMin", { n: min[1] });
  // "Mon: Choose an opening time and a closing time." (the day name may already be in the visitor's language)
  const day = /^(.+?): (.+)$/.exec(message);
  if (day && VALIDATION_EXACT[day[2]]) return `${dayName(lang, day[1])}: ${t(VALIDATION_EXACT[day[2]])}`;
  const over = /^(.+?) runs until the next morning, past the time (.+?) opens\. Open .+? later, or close .+? earlier\.$/.exec(message);
  if (over) return t("validation.overnight", { a: dayName(lang, over[1]), b: dayName(lang, over[2]) });
  const narrower = /^This rate is never used: "(.*)" is narrower and covers all of it\. Change this rate's days or times\.$/.exec(message);
  if (narrower) return t("validation.rateNarrower", { name: narrower[1] });
  const hidden = /^This rate is hidden by "(.*)" below it, so players are never charged it\. Move it below ".*", or change its days or times\.$/.exec(message);
  if (hidden) return t("validation.rateHidden", { name: hidden[1] });
  return message;
}

function titleCase(status: string): string {
  return status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function makeFmt(lang: Lang): Fmt {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const has = (key: string): key is MessageKey => key in en;
  const now = () => new Date();
  return {
    lang,
    date: (i) => formatDate(i, now(), lang),
    dateString: (s) => formatDateString(s, now(), lang),
    dateRelative: (i) => formatDateRelative(i, now(), lang),
    when: (i) => formatWhen(i, now(), lang),
    whenRange: (a, b) => formatWhenRange(a, b, now(), lang),
    slotLabel: (a, b) => formatSlotLabel(a, b, now(), lang),
    slotTimes: (s) => formatSlotTimes(s, lang),
    timeRange: (a, b) => formatTimeRange(a, b, lang),
    time: (i) => formatTime(i),
    time24: (v) => formatTime24As12(v),
    month: (m) => formatMonth(m, lang),
    weekday: (i, style = "short") => {
      const sunFirst = ((((i % 7) + 7) % 7) + 1) % 7; // Monday-first index -> Sunday-first table index
      return (style === "short" ? WEEKDAY_SHORT : WEEKDAY_LONG)[lang][sunFirst];
    },
    duration: (m) => formatDuration(m, lang),
    relative: (iso) => {
      const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
      if (minutes < 1) return t("fmt.rel.now");
      if (minutes < 60) return t("fmt.rel.min", { n: minutes });
      const hours = Math.round(minutes / 60);
      if (hours < 24) return t("fmt.rel.hr", { n: hours });
      return t("fmt.rel.day", { n: Math.round(hours / 24) });
    },
    distance: (m) => formatDistance(m),
    startsIn: (a, b) => startsInText(a, b, Date.now(), lang),
    hoursText: (x) => scheduleHoursText(x, lang),
    weeklyHoursLines: (x) => weeklyHoursLines(x, lang),
    bookingHorizon: (d) => bookingHorizonText(d, lang),
    upcomingBlackouts: (b) => upcomingBlackouts(b, now(), lang),
    slotPreviewText: (o, c, g) => slotPreviewText(o, c, g, lang),
    cancellationPolicy: (v) => cancellationPolicyText(v, lang),
    bookingStatus: (s) => {
      const key = `fmt.status.${s}`;
      return has(key) ? t(key) : titleCase(s);
    },
    amenity: (k) => amenityLabel(k, lang),
    setting: (k) => t(`fmt.setting.${k}` as MessageKey),
    sport: (n) => n,
    city: (v) => CITY_OPTIONS.find((c) => c.value === v || c.label === v)?.label ?? v,
    gender: (v) => {
      const key = `fmt.gender.${v.toLowerCase()}`;
      return has(key) ? t(key) : v.replace(/^./, (c) => c.toUpperCase());
    },
    validation: (m) => translateValidation(lang, m),
    bookingSource: (s, channelDetail) => {
      const suffix = bookingChannelKey(s, channelDetail);
      const key = `fmt.source.${suffix}`;
      return suffix && has(key) ? t(key) : null;
    },
    checkinWindow: (startsAt) => selfCheckinWindow(startsAt, now(), lang),
    dayTabs: (count) => pktDayTabs(count, now(), lang),
    premiumState: (f, enforced, trialDays) => premiumStateText(f, enforced, trialDays, lang),
    approvalSummary: (checks, amount) => approvalSummary(checks, amount, lang),
  };
}
