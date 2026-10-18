import {
  DEFAULT_ADVANCE_PERCENTAGE,
  advanceExample,
  formatPkrAmount,
  type AdvanceExplain,
  type AdvanceRule,
  type CourtAdvanceType,
} from "@court-booking/types";

/**
 * Owner Round 2 (A11): the pure half of the advance-payment editor (no React Native, so node tests can load it). The
 * math is the shared `advanceExample` / `advanceFor` (packages/types, mirrors the backend's `compute_advance`); this
 * file only maps form fields <-> court fields and builds the Roman Urdu sentences around the shared result.
 */

export type AdvanceTypeDraft = "" | "fixed" | "percent";

export interface AdvanceDraft {
  advanceType: AdvanceTypeDraft;
  advanceValue: string;
  advanceMinimum: string;
}

/** A court the owner never touched: Default (from pricing), no value, no minimum. Wizard and Settings both start here. */
export const ADVANCE_DRAFT_DEFAULTS: AdvanceDraft = { advanceType: "", advanceValue: "", advanceMinimum: "" };

export function advanceDraftFromCourt(
  court: { advance_type?: CourtAdvanceType | null; advance_value?: number | null; advance_minimum?: number | null } | null | undefined,
): AdvanceDraft {
  if (!court) return { ...ADVANCE_DRAFT_DEFAULTS };
  return {
    advanceType: court.advance_type ?? "",
    advanceValue: court.advance_value != null ? String(court.advance_value) : "",
    advanceMinimum: court.advance_minimum != null ? String(court.advance_minimum) : "",
  };
}

/** The court fields to send (create or update), same mapping as before Round 2. Default clears the value; the minimum
 * applies in every mode (the backend floors the advance with it whatever the mode), so it is always sent. */
export function advanceDraftToInput(d: AdvanceDraft): { advance_type: CourtAdvanceType | null; advance_value: number | null; advance_minimum: number | null } {
  return {
    advance_type: d.advanceType || null,
    advance_value: d.advanceType ? Number(d.advanceValue) : null,
    advance_minimum: d.advanceMinimum.trim() ? Number(d.advanceMinimum) : null,
  };
}

/** Roman Urdu problem that blocks saving, or null. */
export function advanceDraftProblem(d: AdvanceDraft): string | null {
  if (d.advanceType === "") return null;
  if (!d.advanceValue.trim()) {
    return d.advanceType === "fixed" ? "Advance ki raqam likhein, ya Default chunein." : "Percentage likhein, ya Default chunein.";
  }
  const v = Number(d.advanceValue);
  if (d.advanceType === "percent" && (v < 1 || v > 100)) return "Percentage 1 se 100 ke beech rakhein.";
  if (d.advanceType === "fixed" && v < 1) return "Advance ki raqam 1 ya us se zyada rakhein.";
  return null;
}

function durationLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} ghante`;
  return `${minutes} minute`;
}

export interface AdvancePrice {
  /** Price of ONE priced unit of the court (its minimum booking, `unitMinutes` long), or null when no price is set yet. */
  unitPrice: number | null;
  unitMinutes: number;
}

/** The court's everyday price from the setup form: the first rate is the everyday price (see CourtSetupFields). */
export function advancePriceFromSetup(setup: { slotMinutes: number; pricingRules: { pricePerSlot: string }[] }): AdvancePrice {
  const first = setup.pricingRules.find((r) => Number(r.pricePerSlot) > 0);
  return { unitPrice: first ? Number(first.pricePerSlot) : null, unitMinutes: setup.slotMinutes };
}

function ruleFor(d: AdvanceDraft, defaultPercentage: number): AdvanceRule {
  return {
    mode: d.advanceType === "" ? "default" : d.advanceType,
    value: d.advanceType && d.advanceValue.trim() ? Number(d.advanceValue) : null,
    minimum: d.advanceMinimum.trim() ? Number(d.advanceMinimum) : null,
    defaultPercentage,
  };
}

/** "Court ka 1 ghante ka rate PKR 4,000 - 50% -> player abhi PKR 2,000 dega". Null without a price. */
export function advanceExampleLine(d: AdvanceDraft, price: AdvancePrice, defaultPercentage: number): string | null {
  if (!price.unitPrice || price.unitPrice <= 0) return null;
  if (d.advanceType !== "" && !d.advanceValue.trim()) return null;
  const minutes = Math.max(60, price.unitMinutes);
  const ex = advanceExample(price.unitPrice, ruleFor(d, defaultPercentage), { unitMinutes: price.unitMinutes, minutes });
  const how =
    d.advanceType === "fixed"
      ? `fixed ${formatPkrAmount(Number(d.advanceValue))}`
      : d.advanceType === "percent"
        ? `${Number(d.advanceValue)}%`
        : `default ${defaultPercentage}%`;
  const min = d.advanceMinimum.trim() ? ` (kam az kam ${formatPkrAmount(Number(d.advanceMinimum))})` : "";
  const rest = ex.total - ex.advance;
  const venue = rest > 0 ? `, baqi ${formatPkrAmount(rest)} venue par` : "";
  return `Court ka ${durationLabel(minutes)} ka rate ${formatPkrAmount(ex.total)} - ${how}${min} -> player abhi ${formatPkrAmount(ex.advance)} dega${venue}`;
}

/** "Agar aap kuch set na karein: ..." with the REAL default: the backend's answer when the court exists (advanceExplain),
 * otherwise computed with the same function from the price typed in this form. */
export function advanceDefaultLine(price: AdvancePrice, defaultPercentage: number, explain: AdvanceExplain | null | undefined): string {
  if (explain) {
    if (explain.default_rule.source === "none" && !explain.hourly_price) {
      return `Agar aap kuch set na karein: is court ka koi price abhi set nahi, is liye advance ${formatPkrAmount(explain.default_rule.value_if_nothing_set)} hai. Price set karte hi player poori raqam (${DEFAULT_ADVANCE_PERCENTAGE}%) abhi dega.`;
    }
    const pct = explain.default_rule.percentage ?? DEFAULT_ADVANCE_PERCENTAGE;
    const who = pct >= 100 ? `player poori raqam (${pct}%) abhi dega` : `player total ka ${pct}% abhi dega`;
    return `Agar aap kuch set na karein: ${who} - ${durationLabel(explain.example_minutes)} ki booking (${formatPkrAmount(explain.example_total)}) par ${formatPkrAmount(explain.default_rule.value_if_nothing_set)}.`;
  }
  const who = defaultPercentage >= 100 ? `player poori raqam (${defaultPercentage}%) abhi dega` : `player total ka ${defaultPercentage}% abhi dega`;
  if (!price.unitPrice || price.unitPrice <= 0) return `Agar aap kuch set na karein: ${who} (pehle neeche price set karein).`;
  const minutes = Math.max(60, price.unitMinutes);
  const ex = advanceExample(price.unitPrice, ruleFor(ADVANCE_DRAFT_DEFAULTS, defaultPercentage), { unitMinutes: price.unitMinutes, minutes });
  return `Agar aap kuch set na karein: ${who} - ${durationLabel(minutes)} ki booking (${formatPkrAmount(ex.total)}) par ${formatPkrAmount(ex.advance)}.`;
}
