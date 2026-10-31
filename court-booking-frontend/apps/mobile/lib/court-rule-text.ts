import { DAY_LABELS, WEEKDAY_NUMBERS, WEEKEND_NUMBERS, formatTime24As12, type PricingRuleDraft } from "@court-booking/types";

type RuleWhen = Pick<PricingRuleDraft, "dayOfWeek" | "startTime" | "endTime">;

/** "6 PM" / "8:30 PM" (the board drops ":00"). */
function shortTime(hhmm: string): string {
  return formatTime24As12(hhmm).replace(":00 ", " ");
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && b.every((d) => a.includes(d));
}

/** OSettings board rule card line: "Rozana · 6 PM – 11 PM", "Sat, Sun · poora din", "Baqi sab waqt" (the everyday rate
 * when other rates exist). */
export function ruleWhenText(rule: RuleWhen, isBase: boolean, hasOthers: boolean): string {
  const days = rule.dayOfWeek;
  const everyDay = !days || days.length === 0 || days.length === 7;
  const start = rule.startTime || null;
  const end = rule.endTime || null;
  if (isBase && hasOthers && everyDay && !start && !end) return "Baqi sab waqt";
  const dayText = everyDay
    ? "Rozana"
    : sameSet(days!, WEEKEND_NUMBERS)
      ? "Sat, Sun"
      : sameSet(days!, WEEKDAY_NUMBERS)
        ? "Mon–Fri"
        : [...days!].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(", ");
  const timeText = start && end ? `${shortTime(start)} – ${shortTime(end)}` : start ? `${shortTime(start)} se` : end ? `${shortTime(end)} tak` : "poora din";
  return `${dayText} · ${timeText}`;
}

/** Roman Urdu for a rate that `hiddenRates` says is never charged. */
export function hiddenRateText(h: { byName: string; byNarrower: boolean }): string {
  const name = h.byName === "another rate" ? "doosra rate" : `"${h.byName}"`;
  return h.byNarrower
    ? `Ye rate kabhi nahi lagta: ${name} is se chhota hai aur isay poora dhak leta hai. Din ya waqt badlein.`
    : `Ye rule neeche wale ${name} se chhup raha hai. Isay ${name} ke neeche le jayein, ya din ya waqt badlein.`;
}
