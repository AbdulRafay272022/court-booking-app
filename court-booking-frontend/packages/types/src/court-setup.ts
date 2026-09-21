import type { Court, PricingRuleInput, ScheduleTemplateInput } from "./court";
import { weekdayOf } from "./datetime";
import { weeklyHoursError } from "./validation";

/**
 * Weekdays as the BACKEND numbers them: Monday = 0 ... Sunday = 6 (Python's `date.weekday()`), which is what
 * `schedule_templates.day_of_week` and `pricing_rules.day_of_week` store and what the availability engine matches
 * against. The owner screens used to list the week Sunday-first (Sun = 0) while sending that index straight to
 * the API, so hours an owner set for "Sun" were applied to Monday, "Mon" to Tuesday, and so on. Every screen that
 * lists or sends a weekday must use THIS order.
 */
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Weekday numbers for the "Weekdays" / "Weekends" shortcuts on a price rule (Mon-Fri, Sat-Sun). */
export const WEEKDAY_NUMBERS = [0, 1, 2, 3, 4];
export const WEEKEND_NUMBERS = [5, 6];

/** Backend weekday (Mon = 0 ... Sun = 6) of a "YYYY-MM-DD" Pakistan calendar date. */
export function backendWeekdayOf(dateStr: string): number {
  return (weekdayOf(dateStr) + 6) % 7; // weekdayOf is Sunday-first (Sun = 0)
}

export interface DayOverride {
  open: string; // "HH:MM"
  close: string;
}

export interface PricingRuleDraft {
  id: string;
  name: string;
  pricePerSlot: string;
  /** null = every day; otherwise backend weekday numbers (Mon = 0). */
  dayOfWeek: number[] | null;
  startTime: string | null; // "HH:MM"
  endTime: string | null;
}

/** Everything an owner sets for ONE court: how long a slot is, when it is open, and what it costs. The wizard and
 * Venue Settings both edit exactly this, one per court, so no court ever silently takes another's hours or prices. */
export interface CourtSetup {
  slotMinutes: number;
  sameHoursEveryDay: boolean;
  openTime: string;
  closeTime: string;
  perDayOverrides: Partial<Record<number, DayOverride>>;
  pricingRules: PricingRuleDraft[];
}

export function makePricingRule(name = "All day"): PricingRuleDraft {
  return {
    id: Math.random().toString(36).slice(2),
    name,
    pricePerSlot: "",
    dayOfWeek: null,
    startTime: null,
    endTime: null,
  };
}

export function defaultCourtSetup(): CourtSetup {
  return {
    slotMinutes: 90,
    sameHoursEveryDay: true,
    openTime: "06:00",
    closeTime: "23:00",
    perDayOverrides: {},
    pricingRules: [makePricingRule("All day")],
  };
}

/** A copy of `setup` that shares no arrays/objects with it (used when a new court starts from an existing one). */
export function cloneCourtSetup(setup: CourtSetup): CourtSetup {
  return {
    ...setup,
    perDayOverrides: Object.fromEntries(Object.entries(setup.perDayOverrides).map(([d, o]) => [d, { ...o! }])),
    pricingRules: setup.pricingRules.map((r) => ({ ...r, id: Math.random().toString(36).slice(2), dayOfWeek: r.dayOfWeek ? [...r.dayOfWeek] : null })),
  };
}

/** "HH:MM" -> "HH:MM:00" for the API; falls back to the default opening time for anything else. */
export function toApiTime(hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : "06:00:00";
}

function shortTime(hhmmss: string): string {
  return hhmmss.slice(0, 5);
}

/** What is wrong with this court's setup right now (null = fine): unusable hours, or no priced rate. */
export function courtSetupProblem(setup: CourtSetup): string | null {
  const hours = weeklyHoursError(setup.sameHoursEveryDay, setup.openTime, setup.closeTime, setup.perDayOverrides, DAY_LABELS);
  if (hours) return hours;
  if (!setup.pricingRules.some((r) => Number(r.pricePerSlot) > 0)) return "Set a price for this court.";
  return null;
}

/** The 7 schedule rows the API wants, one per weekday (Mon = 0). */
export function buildSchedules(setup: CourtSetup): ScheduleTemplateInput[] {
  return Array.from({ length: 7 }, (_, day) => {
    const o = setup.sameHoursEveryDay ? undefined : setup.perDayOverrides[day];
    return {
      day_of_week: day,
      open_time: toApiTime(o?.open ?? setup.openTime),
      close_time: toApiTime(o?.close ?? setup.closeTime),
    };
  });
}

/** The price rules the API wants, in priority order (later rules win where they overlap). Unpriced rows are dropped. */
export function buildPricingRules(setup: CourtSetup): PricingRuleInput[] {
  return setup.pricingRules
    .filter((r) => Number(r.pricePerSlot) > 0)
    .map((r, i) => ({
      name: r.name || `Rule ${i + 1}`,
      priority: i,
      day_of_week: r.dayOfWeek && r.dayOfWeek.length > 0 ? r.dayOfWeek : null,
      start_time: r.startTime ? toApiTime(r.startTime) : undefined,
      end_time: r.endTime ? toApiTime(r.endTime) : undefined,
      price_per_slot: Number(r.pricePerSlot),
      advance_percentage: 100,
    }));
}

/** Rebuilds the editable setup from a court as the API returns it (Venue Settings). */
export function courtSetupFromCourt(court: Pick<Court, "slot_minutes" | "schedule_templates" | "pricing_rules">): CourtSetup {
  const byDay: Partial<Record<number, DayOverride>> = {};
  for (const t of court.schedule_templates) {
    byDay[t.day_of_week] = { open: shortTime(t.open_time), close: shortTime(t.close_time) };
  }
  const first = byDay[0];
  const allSame = !!first && [0, 1, 2, 3, 4, 5, 6].every((d) => byDay[d]?.open === first.open && byDay[d]?.close === first.close);
  const fallback = defaultCourtSetup();
  return {
    slotMinutes: court.slot_minutes,
    sameHoursEveryDay: allSame || Object.keys(byDay).length === 0,
    openTime: first?.open ?? fallback.openTime,
    closeTime: first?.close ?? fallback.closeTime,
    perDayOverrides: byDay,
    pricingRules:
      court.pricing_rules.length > 0
        ? court.pricing_rules.map((r, i) => ({
            id: `existing-${i}`,
            name: r.name,
            pricePerSlot: String(r.price_per_slot),
            dayOfWeek: r.day_of_week,
            startTime: r.start_time ? shortTime(r.start_time) : null,
            endTime: r.end_time ? shortTime(r.end_time) : null,
          }))
        : [makePricingRule("All day")],
  };
}
