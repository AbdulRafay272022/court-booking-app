/**
 * Round 2 (A11): the advance a player pays now, mirroring the backend EXACTLY
 * (`AvailabilityService.compute_advance` in court-booking-backend/app/services/availability_service.py):
 *
 *   fixed   -> advance = value (PKR; null counts as 0)
 *   percent -> advance = total * value / 100 (null counts as 0)
 *   default -> advance = total * pricing_rule.advance_percentage / 100
 *   then: minimum set -> advance = max(advance, minimum)
 *   then: advance = round(min(advance, total), 2)   (Python round: half to even on the exact binary value)
 *
 * The backend applies this to ONE priced unit of the court (its minimum booking, `slot_minutes`) and scales it per
 * 30-minute cell, so a booking of N units pays N x the unit advance (also for a fixed amount and for the minimum).
 * `advanceExample` does that scaling when `unitMinutes` is given. Not modelled here: the global `split_payments`
 * kill switch (when it is off every booking pays the full price up front).
 */

export type AdvanceMode = "default" | "fixed" | "percent";

export interface AdvanceRule {
  mode: AdvanceMode;
  /** PKR for "fixed", 0-100 for "percent"; ignored for "default". */
  value: number | null;
  /** Optional floor in PKR. */
  minimum: number | null;
  /** The matched pricing rule's advance_percentage (backend default 100 when a rule is created without one). */
  defaultPercentage: number | null;
}

/** The backend's pricing_rules.advance_percentage default (PricingRuleIn). */
export const DEFAULT_ADVANCE_PERCENTAGE = 100;

/**
 * Python's `round(x, 2)`: rounds the EXACT binary value of `x` to 2 decimals, ties to even. JavaScript's `toFixed`
 * breaks exact ties upwards, so ties are detected from the exact decimal expansion and handled separately.
 */
export function pyRound2(x: number): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const abs = Math.abs(x);
  // toFixed(100) is the exact decimal expansion for any double in our range (money)
  const exact = abs.toFixed(100);
  const dot = exact.indexOf(".");
  const intPart = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  const kept = frac.slice(0, 2);
  const rest = frac.slice(2);
  // integer cents stay exact as a double far beyond any PKR amount
  let cents = Number(intPart + kept);
  const first = rest.charCodeAt(0) - 48;
  const tail = rest.slice(1);
  const tailZero = /^0*$/.test(tail);
  if (first > 5 || (first === 5 && !tailZero)) {
    cents += 1;
  } else if (first === 5 && tailZero) {
    // exact tie: round half to even
    if (cents % 2 === 1) cents += 1;
  }
  const value = cents / 100;
  return neg ? -value : value;
}

/** Un-rounded advance for one priced unit whose price is `total` (backend math before the final round). */
function rawAdvance(total: number, rule: AdvanceRule): number {
  let advance: number;
  if (rule.mode === "fixed") {
    advance = Number(rule.value ?? 0) || 0;
  } else if (rule.mode === "percent") {
    advance = (total * (Number(rule.value ?? 0) || 0)) / 100;
  } else {
    const pct = rule.defaultPercentage ?? DEFAULT_ADVANCE_PERCENTAGE;
    advance = (total * pct) / 100;
  }
  if (rule.minimum !== null && rule.minimum !== undefined) {
    advance = Math.max(advance, Number(rule.minimum));
  }
  return Math.min(advance, total);
}

/** The advance (PKR, 2 decimals) for one priced unit costing `total`. Never above `total`, never below the minimum
 * (unless the minimum is above the total, then the total). */
export function advanceFor(total: number, rule: AdvanceRule, units = 1): number {
  // `units` = how many priced court units (`slot_minutes`) the booking spans: the backend applies the rule to one
  // unit and multiplies, so a fixed amount and the minimum are charged per unit.
  if (!units || units <= 1) return pyRound2(rawAdvance(total, rule));
  return pyRound2(rawAdvance(total / units, rule) * units);
}

export interface AdvanceExampleResult {
  minutes: number;
  total: number;
  advance: number;
}

/**
 * "Court ka 1 ghante ka rate PKR 4,000 - 50% -> player abhi PKR 2,000 dega".
 * `hourlyPrice` is the price of the court's priced unit when `unitMinutes` is omitted (60). Pass the court's
 * `slot_minutes` and that unit's price as `hourlyPrice` to get an exact 60-minute example for a 90/120-minute court
 * (the backend scales the unit advance by minutes / unitMinutes).
 */
export function advanceExample(
  hourlyPrice: number,
  rule: AdvanceRule,
  opts: { unitMinutes?: number; minutes?: number } = {},
): AdvanceExampleResult {
  const unitMinutes = opts.unitMinutes ?? 60;
  const minutes = opts.minutes ?? 60;
  const factor = minutes / unitMinutes;
  const unitAdvance = advanceFor(hourlyPrice, rule);
  return {
    minutes,
    total: pyRound2(hourlyPrice * factor),
    advance: pyRound2(unitAdvance * factor),
  };
}

/** Thousands separators without Intl/toLocaleString (owner time/locale rules): 4000 -> "4,000", 2500.5 -> "2,500.5". */
export function groupDigits(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const neg = rounded < 0;
  const [intPart, frac] = Math.abs(rounded).toString().split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${frac ? `.${frac.padEnd(2, "0")}` : ""}`;
}

/** "PKR 4,000". */
export function formatPkrAmount(n: number): string {
  return `PKR ${groupDigits(n)}`;
}
