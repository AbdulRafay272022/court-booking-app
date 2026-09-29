// Time and date formatting is Pakistan time, 12-hour, human dates -- ONE shared implementation
// (packages/types/src/datetime.ts). Do not build time or date strings by hand in a screen
// (no toLocaleTimeString / getHours / toISOString().slice / hour12): they depend on the device's
// timezone or on UTC, and produced 24-hour times and one-day-off dates.
export {
  addDays,
  formatDate,
  formatDateRelative,
  formatDateString,
  formatSlotLabel,
  formatSlotTimes,
  formatTime,
  formatTime24As12,
  formatTimeRange,
  formatWhen,
  formatWhenRange,
  pktDateString,
  pktDayTabs,
  weekdayOf,
} from "@court-booking/types";
import { SPORT_OPTIONS, formatDate, formatDateString } from "@court-booking/types";

/** "Wed, 23 Sep" for an instant. */
export function formatShortDate(iso: string): string {
  return formatDate(iso);
}

/** "Tue, 22 Sep" for a "YYYY-MM-DD" calendar date. */
export function formatDayHeader(dateStr: string): string {
  return formatDateString(dateStr);
}

export function formatPKR(amount: number): string {
  return Math.round(amount).toLocaleString("en-US");
}

export function formatDistance(meters: number | null): string | null {
  if (meters == null) return null;
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Canonical spelling of a sport from a free-typed / URL value ("football (full-field)" -> "Football (full-field)").
 * Matches case-insensitively against the shared SPORT_OPTIONS; unknown values are returned unchanged. */
export function canonicalSport(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return SPORT_OPTIONS.find((s) => s.toLowerCase() === v) ?? value.trim();
}

/** Case-insensitive sport equality (Court.sport / Venue.sports are free strings). */
export function sameSport(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}
