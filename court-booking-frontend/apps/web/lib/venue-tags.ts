import type { VenueSummary } from "@court-booking/types";

/** "Indoor" / "Outdoor" / "Indoor + Outdoor", or null when the list response doesn't say (or says neither). */
export function settingLabel(v: Pick<VenueSummary, "has_indoor" | "has_outdoor">): string | null {
  if (v.has_indoor && v.has_outdoor) return "Indoor + Outdoor";
  if (v.has_indoor) return "Indoor";
  if (v.has_outdoor) return "Outdoor";
  return null;
}

/** "Aaj khali" at 4 or more free slots today, "Kam slots" at 1 to 3, nothing for 0, null or undefined. */
export function availabilityTag(free: number | null | undefined): { label: string; tone: "plenty" | "few" } | null {
  if (free == null || !(free >= 1)) return null;
  return free >= 4 ? { label: "Aaj khali", tone: "plenty" } : { label: "Kam slots", tone: "few" };
}

/** Which of Indoor / Outdoor a venue offers, in display order; empty when the list response does not say. */
export function settingKinds(v: Pick<VenueSummary, "has_indoor" | "has_outdoor">): ("indoor" | "outdoor")[] {
  const out: ("indoor" | "outdoor")[] = [];
  if (v.has_indoor) out.push("indoor");
  if (v.has_outdoor) out.push("outdoor");
  return out;
}
