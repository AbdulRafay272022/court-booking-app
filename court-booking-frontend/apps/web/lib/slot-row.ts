import { slotChipState, statusPill, type SlotChipState, type SlotLike } from "@court-booking/ui-tokens";
import type { MessageKey } from "@/lib/i18n";

/**
 * One row of the venue day list (court-day-popup), from the REAL slot fields only (docs/floodlight-contract.md (b)):
 * held by someone else = status held|payment_submitted && !is_mine; "your booking" = any live status && is_mine.
 * The label for your own booking is the honest status pill ("Pakki ✓" only when the slot status is booked).
 */
export interface SlotRowSpec {
  state: SlotChipState;
  /** Fixed copy key, or null when `statusLabel` carries the text (your own booking). */
  labelKey: MessageKey | null;
  statusLabel: string | null;
  /** open = start a booking here; mine = open your booking. */
  pressable: boolean;
  /** Booked by someone else: offer "Notify me" (waitlist). */
  waitlist: boolean;
  /** Where tapping your own booking goes. */
  mineHref: "pay" | "done" | null;
}

const LABEL: Partial<Record<SlotChipState, MessageKey>> = {
  open: "venue.pop.open",
  held: "venue.pop.heldByOther",
  booked: "venue.pop.booked",
  blocked: "venue.pop.closed",
  noRoom: "venue.pop.tooShort",
};

export function slotRowSpec(slot: SlotLike, ctx: { now: number; fits: boolean }, lang: "ru" | "en" = "ru"): SlotRowSpec | null {
  const state = slotChipState(slot, { now: ctx.now, fits: slot.status === "available" ? ctx.fits : undefined });
  if (state === null) return null;
  if (state === "mine") {
    const status = slot.status === "booked" ? "booked" : slot.status === "payment_submitted" ? "payment_submitted" : "held";
    return { state, labelKey: null, statusLabel: statusPill({ status }, lang).label, pressable: true, waitlist: false, mineHref: status === "booked" ? "done" : "pay" };
  }
  return { state, labelKey: LABEL[state] ?? null, statusLabel: null, pressable: state === "open", waitlist: state === "booked", mineHref: null };
}
