import type { PaymentInstructions } from "@court-booking/types";

export type SavedInstructions = PaymentInstructions & { saved_at?: number };

/** A hold lasts minutes and a submitted payment is reviewed within hours; two days is plenty and keeps the stored bank
 * details from piling up on the phone. */
export const INSTRUCTIONS_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export function pruneSavedInstructions(map: Record<string, SavedInstructions>, now: number): Record<string, SavedInstructions> {
  const out: Record<string, SavedInstructions> = {};
  for (const [id, v] of Object.entries(map ?? {})) {
    if (v.saved_at !== undefined && now - v.saved_at < INSTRUCTIONS_TTL_MS) out[id] = v;
  }
  return out;
}

/** True when there is at least one detail the player can actually send money to. */
export function hasPayableDetails(i: PaymentInstructions | undefined | null): i is PaymentInstructions {
  return !!i && !!(i.account_number || i.iban);
}
