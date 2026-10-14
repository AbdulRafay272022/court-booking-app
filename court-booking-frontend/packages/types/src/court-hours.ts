import type { Blackout, ScheduleTemplate } from "./court";
import { DAY_LABELS } from "./court-setup";
import { formatTime24As12, formatWhenRange, type Instant } from "./datetime";
import { WEEKDAY_SHORT, WORDS, type TextLang } from "./locale-text";

/** One line of a court's weekly booking hours, e.g. { days: "Mon–Fri", hours: "6:00 AM – 11:00 PM" }. */
export interface HoursLine {
  days: string;
  /** "6:00 AM – 11:00 PM", "6:00 PM – 2:00 AM (next day)", "Open 24 hours" or "Closed". */
  hours: string;
  closed: boolean;
}

/** The hours text for ONE schedule template (12-hour; an overnight day says "(next day)"; open == close is 24 hours). */
export function scheduleHoursText(t: Pick<ScheduleTemplate, "open_time" | "close_time" | "closes_next_day">, lang: TextLang = "en"): string {
  const open = t.open_time.slice(0, 5);
  const close = t.close_time.slice(0, 5);
  if (open === close) return WORDS[lang].open24;
  const overnight = t.closes_next_day || close < open;
  return `${formatTime24As12(open)} – ${formatTime24As12(close)}${overnight ? WORDS[lang].nextDay : ""}`;
}

/**
 * A court's weekly booking hours as short lines: consecutive days with identical hours are merged ("Mon–Fri"),
 * and days with no active schedule are listed as Closed ("Sun"). Weekdays are Monday-first (Mon = 0), like the API.
 */
export function weeklyHoursLines(templates: ScheduleTemplate[], lang: TextLang = "en"): HoursLine[] {
  const byDay: (string | null)[] = Array.from({ length: 7 }, () => null);
  for (const t of templates) {
    if (t.is_active === false) continue;
    if (t.day_of_week >= 0 && t.day_of_week < 7) byDay[t.day_of_week] = scheduleHoursText(t, lang);
  }
  const lines: HoursLine[] = [];
  let start = 0;
  for (let i = 1; i <= 7; i++) {
    if (i < 7 && byDay[i] === byDay[start]) continue;
    const hours = byDay[start];
    const label = (d: number) => (lang === "en" ? DAY_LABELS[d] : mondayFirstShort(d, lang));
    const days =
      start === 0 && i === 7 ? WORDS[lang].everyDay : i - 1 === start ? label(start) : `${label(start)}–${label(i - 1)}`;
    lines.push({ days, hours: hours ?? WORDS[lang].closed, closed: hours === null });
    start = i;
  }
  return lines;
}

/** "Bookable up to 90 days ahead". */
export function bookingHorizonText(days: number | null | undefined, lang: TextLang = "en"): string | null {
  if (!days || days < 1) return null;
  return WORDS[lang].horizon(days);
}

export interface BlackoutLine {
  id: string;
  /** "Wed, 23 Sep, 6:00 PM to Thu, 24 Sep, 2:00 AM" -- Pakistan time, 12-hour. */
  when: string;
  /** Why it is closed: the owner's title, else the reason ("Maintenance"), else "Closed". */
  label: string;
}

/** Monday-first weekday (Mon = 0) in the given language, short form. */
function mondayFirstShort(d: number, lang: TextLang): string {
  return WEEKDAY_SHORT[lang][(d + 1) % 7];
}

/** The closed/unavailable periods that have not ended yet, soonest first. Past ones are dropped. */
export function upcomingBlackouts(blackouts: Blackout[], now: Instant = new Date(), lang: TextLang = "en"): BlackoutLine[] {
  const nowMs = new Date(now).getTime();
  return blackouts
    .filter((b) => new Date(b.ends_at).getTime() > nowMs)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .map((b) => ({
      id: b.id,
      when: formatWhenRange(b.starts_at, b.ends_at, now, lang),
      label: b.title?.trim() || (b.reason ? WORDS[lang].reason[b.reason] ?? WORDS[lang].closed : WORDS[lang].closed),
    }));
}
