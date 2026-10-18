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
  /** The rule's saved advance_percentage (Venue Settings keeps it on save); unset for a new rule = 100. */
  advancePercentage?: number;
  /** The rule's saved floodlight_surcharge (kept on save); unset for a new rule = the backend default. */
  floodlightSurcharge?: number;
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
      // keep a saved rule's own percentage (saving Venue Settings used to reset every rule to 100)
      advance_percentage: r.advancePercentage ?? 100,
      // likewise keep a saved rule's floodlight surcharge (omitted for a new rule, so the backend default applies)
      ...(r.floodlightSurcharge !== undefined ? { floodlight_surcharge: r.floodlightSurcharge } : {}),
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
      // lowest priority first: buildPricingRules saves priority = list position, so this order must be the ranking
      court.pricing_rules.length > 0
        ? [...court.pricing_rules].sort((a, b) => a.priority - b.priority).map((r, i) => ({
            id: `existing-${i}`,
            name: r.name,
            pricePerSlot: String(r.price_per_slot),
            dayOfWeek: r.day_of_week,
            startTime: r.start_time ? shortTime(r.start_time) : null,
            endTime: r.end_time ? shortTime(r.end_time) : null,
            advancePercentage: Number(r.advance_percentage),
            floodlightSurcharge: Number(r.floodlight_surcharge ?? 0),
          }))
        : [makePricingRule("All day")],
  };
}

// ---- which rates can never be charged -----------------------------------------------------------------------

const DAY_MIN = 1440;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** +1 for naming specific days (all seven names none), +1 for a time window. Mirrors the backend's rule_specificity. */
function specificity(r: PricingRuleDraft): number {
  const namesDays = !!r.dayOfWeek && r.dayOfWeek.length > 0 && new Set(r.dayOfWeek).size < 7;
  return (namesDays ? 1 : 0) + (r.startTime || r.endTime ? 1 : 0);
}

/** Does the rate's time window contain the slot [s, e) (minutes from the schedule day's midnight)? Mirrors the backend's rule_matches_window. */
function windowContains(r: PricingRuleDraft, s: number, e: number): boolean {
  if (!r.startTime && !r.endTime) return true;
  const rs = r.startTime ? toMinutes(r.startTime) : 0;
  let windows: Array<[number, number]>;
  if (!r.endTime) {
    windows = [[rs, 3 * DAY_MIN], [rs + DAY_MIN, 3 * DAY_MIN]];
  } else {
    let re = toMinutes(r.endTime);
    if (!r.startTime) windows = [[0, re || DAY_MIN]];
    else {
      if (re <= rs) re += DAY_MIN;
      windows = [[rs, re], [rs + DAY_MIN, re + DAY_MIN]];
    }
  }
  return windows.some(([ws, we]) => ws <= s && e <= we);
}

export interface HiddenRate {
  /** The rate that is charged instead, everywhere this one would have applied. */
  byName: string;
  /** True when the hiding rate is narrower (more specific), so moving this one in the list would not help. */
  byNarrower: boolean;
  message: string;
}

/**
 * Rates an owner has entered that can NEVER be charged because another rate always takes their place (the backend picks the
 * most specific rate first -- days + a time window, then one of them, then all-day -- and among equally specific rates the
 * one lower in the list). Keyed by rate id; rates without a price are ignored, as they are not saved. Used for the
 * "this rate is hidden" warning in the wizard and Venue Settings.
 */
export function hiddenRates(setup: Pick<CourtSetup, "pricingRules">): Record<string, HiddenRate> {
  const priced = setup.pricingRules.filter((r) => Number(r.pricePerSlot) > 0).map((r, priority) => ({ r, priority }));
  const rank = (x: { r: PricingRuleDraft; priority: number }) => specificity(x.r) * 1000 + x.priority;
  const ordered = [...priced].sort((a, b) => rank(b) - rank(a));
  const everWins = new Set<string>();
  const coveredBy = new Map<string, string>(); // rate id -> the rate that won where it matched
  for (let dow = 0; dow < 7; dow++) {
    for (let s = 0; s < 2 * DAY_MIN; s += 30) {
      const matching = ordered.filter((x) => (!x.r.dayOfWeek || x.r.dayOfWeek.length === 0 || x.r.dayOfWeek.includes(dow)) && windowContains(x.r, s, s + 30));
      if (matching.length === 0) continue;
      const winner = matching[0];
      everWins.add(winner.r.id);
      for (const loser of matching.slice(1)) if (!coveredBy.has(loser.r.id)) coveredBy.set(loser.r.id, winner.r.id);
    }
  }
  const byId = new Map(priced.map((x) => [x.r.id, x]));
  const out: Record<string, HiddenRate> = {};
  for (const { r } of priced) {
    if (everWins.has(r.id) || !coveredBy.has(r.id)) continue;
    const hider = byId.get(coveredBy.get(r.id)!)!.r;
    const byNarrower = specificity(hider) > specificity(r);
    const hn = hider.name || "another rate";
    out[r.id] = {
      byName: hn,
      byNarrower,
      message: byNarrower
        ? `This rate is never used: "${hn}" is narrower and covers all of it. Change this rate's days or times.`
        : `This rate is hidden by "${hn}" below it, so players are never charged it. Move it below "${hn}", or change its days or times.`,
    };
  }
  return out;
}
