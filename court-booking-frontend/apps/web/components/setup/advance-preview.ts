/** Pure helpers behind the advance card (Venue Settings + wizard share them). No React. */
import { advanceExample, DEFAULT_ADVANCE_PERCENTAGE, type AdvanceRule, type PricingRuleDraft } from "@court-booking/types";

export type AdvanceTypeDraft = "" | "fixed" | "percent";

export interface AdvanceDraft {
  advanceType: AdvanceTypeDraft;
  advanceValue: string;
  advanceMinimum: string;
}

export const EMPTY_ADVANCE_DRAFT: AdvanceDraft = { advanceType: "", advanceValue: "", advanceMinimum: "" };

/** The court's base price per priced unit: the all-day rule (no days, no time window) if priced, else the cheapest priced rule. */
export function basePriceFromDrafts(rules: readonly Pick<PricingRuleDraft, "pricePerSlot" | "dayOfWeek" | "startTime" | "endTime">[]): number | null {
  const priced = rules.map((r) => ({ r, p: Number(r.pricePerSlot) })).filter((x) => Number.isFinite(x.p) && x.p > 0);
  if (priced.length === 0) return null;
  const allDay = priced.find((x) => (!x.r.dayOfWeek || x.r.dayOfWeek.length === 0 || x.r.dayOfWeek.length === 7) && !x.r.startTime && !x.r.endTime);
  return allDay ? allDay.p : Math.min(...priced.map((x) => x.p));
}

const toNum = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export function advanceRuleFromDraft(d: AdvanceDraft, defaultPercentage: number | null): AdvanceRule {
  return {
    mode: d.advanceType === "" ? "default" : d.advanceType,
    value: d.advanceType === "" ? null : toNum(d.advanceValue),
    minimum: d.advanceType === "" ? null : toNum(d.advanceMinimum),
    defaultPercentage,
  };
}

export interface AdvanceDraftErrors {
  value: "percent" | "amount" | null;
  minimum: "minimum" | null;
}

export function advanceDraftErrors(d: AdvanceDraft): AdvanceDraftErrors {
  let value: AdvanceDraftErrors["value"] = null;
  if (d.advanceType === "percent") {
    const v = toNum(d.advanceValue);
    if (v === null || !Number.isFinite(v) || v < 0 || v > 100) value = "percent";
  } else if (d.advanceType === "fixed") {
    const v = toNum(d.advanceValue);
    if (v === null || !Number.isFinite(v) || v < 0) value = "amount";
  }
  let minimum: AdvanceDraftErrors["minimum"] = null;
  if (d.advanceType !== "") {
    const m = toNum(d.advanceMinimum);
    if (m !== null && (!Number.isFinite(m) || m < 0)) minimum = "minimum";
  }
  return { value, minimum };
}

/** Minutes the example uses: one hour, or the court's minimum booking when that is longer (a 90-minute court cannot book 60). */
export function exampleMinutes(unitMinutes: number): number {
  return unitMinutes > 60 ? unitMinutes : 60;
}

export interface AdvancePreview {
  minutes: number;
  total: number;
  advance: number;
  balance: number;
  capped: boolean;
}

export function advancePreview(
  draft: AdvanceDraft,
  unitPrice: number | null,
  unitMinutes: number,
  defaultPercentage: number | null,
): AdvancePreview | null {
  if (unitPrice === null || !(unitPrice > 0)) return null;
  const errors = advanceDraftErrors(draft);
  if (errors.value || errors.minimum) return null;
  const rule = advanceRuleFromDraft(draft, defaultPercentage);
  const minutes = exampleMinutes(unitMinutes);
  const ex = advanceExample(unitPrice, rule, { unitMinutes, minutes });
  const uncapped =
    rule.mode === "fixed" ? Number(rule.value ?? 0) : rule.mode === "percent" ? (unitPrice * Number(rule.value ?? 0)) / 100 : 0;
  const capped = Math.max(uncapped, Number(rule.minimum ?? 0)) > unitPrice;
  return { minutes: ex.minutes, total: ex.total, advance: ex.advance, balance: Math.max(0, Math.round((ex.total - ex.advance) * 100) / 100), capped };
}

/** What the player pays now when the owner sets NOTHING (default rule) for `minutes` on this court. */
export function nothingSetAdvance(unitPrice: number | null, unitMinutes: number, defaultPercentage: number | null): number | null {
  if (unitPrice === null || !(unitPrice > 0)) return null;
  const minutes = exampleMinutes(unitMinutes);
  return advanceExample(unitPrice, { mode: "default", value: null, minimum: null, defaultPercentage }, { unitMinutes, minutes }).advance;
}

export function effectiveDefaultPercentage(p: number | null | undefined): number {
  return p ?? DEFAULT_ADVANCE_PERCENTAGE;
}
