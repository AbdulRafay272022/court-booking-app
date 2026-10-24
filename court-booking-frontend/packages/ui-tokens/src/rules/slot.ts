/**
 * SlotOut -> SlotChip state (docs/floodlight-contract.md section (b)). Never colour-only: every state also has a
 * glyph / border pattern / strikethrough (see `slotChipCue`) and a spoken label (`slotChipA11y`).
 */
export type SlotChipState = "open" | "selected" | "inRange" | "held" | "booked" | "noRoom" | "blocked" | "mine";

/** The subset of `Slot` (packages/types availability.ts) the mapping needs. */
export interface SlotLike {
  starts_at: string;
  status: "available" | "held" | "payment_submitted" | "booked" | "blocked";
  is_mine: boolean;
}

export interface SlotContext {
  /** ms since epoch; available slots that already started are hidden (the server still lists them as available). */
  now: number;
  /** starts_at of the chosen first slot. */
  selectedStart?: string | null;
  /** starts_at of the other slots inside the chosen booking. */
  inRange?: readonly string[];
  /** false when the chosen length does not fit from this slot (Venue board "Lambai ke liye jagah nahi"). */
  fits?: boolean;
}

/** True for an `available` slot whose start is in the past: do not render it. */
export function isPastAvailable(slot: SlotLike, now: number): boolean {
  return slot.status === "available" && Date.parse(slot.starts_at) <= now;
}

/** Map a slot to its chip state, or null when the slot must not be shown at all. */
export function slotChipState(slot: SlotLike, ctx: SlotContext): SlotChipState | null {
  const live = slot.status === "held" || slot.status === "payment_submitted" || slot.status === "booked";
  if (live && slot.is_mine) return "mine";
  if (slot.status === "blocked") return "blocked";
  if (slot.status === "held" || slot.status === "payment_submitted") return "held";
  if (slot.status === "booked") return "booked";
  if (isPastAvailable(slot, ctx.now)) return null;
  if (ctx.selectedStart && ctx.selectedStart === slot.starts_at) return "selected";
  if (ctx.inRange?.includes(slot.starts_at)) return "inRange";
  if (ctx.fits === false) return "noRoom";
  return "open";
}

/** Can the chip be pressed? (inRange: tap to shrink; mine: opens your booking.) */
export function slotChipPressable(state: SlotChipState): boolean {
  return state === "open" || state === "selected" || state === "inRange" || state === "mine";
}

/** The non-colour cue each state carries (System board). The components render exactly this. */
export function slotChipCue(state: SlotChipState): {
  prefix: "" | "✓ ";
  strike: boolean;
  dashed: boolean;
  thickOutline: boolean;
  icon: "none" | "lock" | "hourglass" | "user";
} {
  switch (state) {
    case "selected":
      return { prefix: "✓ ", strike: false, dashed: false, thickOutline: true, icon: "none" };
    case "inRange":
      return { prefix: "", strike: false, dashed: false, thickOutline: true, icon: "none" };
    case "held":
      return { prefix: "", strike: false, dashed: true, thickOutline: false, icon: "hourglass" };
    case "booked":
      return { prefix: "", strike: true, dashed: false, thickOutline: false, icon: "none" };
    case "noRoom":
      return { prefix: "", strike: false, dashed: true, thickOutline: false, icon: "none" };
    case "blocked":
      return { prefix: "", strike: true, dashed: true, thickOutline: false, icon: "lock" };
    case "mine":
      return { prefix: "", strike: false, dashed: false, thickOutline: true, icon: "user" };
    default:
      return { prefix: "", strike: false, dashed: false, thickOutline: false, icon: "none" };
  }
}

const A11Y: Record<SlotChipState, { ru: string; en: string }> = {
  open: { ru: "khaali", en: "available" },
  selected: { ru: "aap ka shuru", en: "your start time" },
  inRange: { ru: "aap ki booking mein", en: "inside your booking" },
  held: { ru: "kisi ne hold kiya", en: "held by someone else" },
  booked: { ru: "booked", en: "booked" },
  noRoom: { ru: "is lambai ke liye jagah nahi", en: "not enough room for this length" },
  blocked: { ru: "band hai", en: "closed" },
  mine: { ru: "aap ki booking", en: "your booking" },
};

/** Spoken label, e.g. "8:00 PM, khaali". `reason` (SlotOut.reason for blocked) is appended when present. */
export function slotChipA11y(state: SlotChipState, timeLabel: string, lang: "ru" | "en" = "ru", reason?: string | null): string {
  const base = `${timeLabel}, ${A11Y[state][lang]}`;
  return state === "blocked" && reason ? `${base} (${reason})` : base;
}
