"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { EMPTY_ADVANCE_DRAFT, type AdvanceDraft } from "./advance-preview";

/**
 * Round 2 A11: the wizard's per-court advance choice, kept beside (not inside) the main venue-setup draft so the main
 * draft's persisted shape and migrations stay untouched. Keyed by court index, re-keyed the same way the main store
 * re-keys createdCourtIds when a tab is removed. Cleared together with the main draft.
 */
interface AdvanceDraftState {
  byCourt: Record<number, AdvanceDraft>;
  get: (index: number) => AdvanceDraft;
  update: (index: number, patch: Partial<AdvanceDraft>) => void;
  /** A new court starts as a copy of the previous one (same as its hours and prices). */
  copyTo: (from: number, to: number) => void;
  remove: (index: number) => void;
  reset: () => void;
}

export const useAdvanceDraftStore = create<AdvanceDraftState>()(
  persist(
    (set, get) => ({
      byCourt: {},
      get: (index) => get().byCourt[index] ?? EMPTY_ADVANCE_DRAFT,
      update: (index, patch) => set({ byCourt: { ...get().byCourt, [index]: { ...(get().byCourt[index] ?? EMPTY_ADVANCE_DRAFT), ...patch } } }),
      copyTo: (from, to) => {
        const src = get().byCourt[from];
        if (src) set({ byCourt: { ...get().byCourt, [to]: { ...src } } });
      },
      remove: (index) => {
        const shifted: Record<number, AdvanceDraft> = {};
        for (const [k, v] of Object.entries(get().byCourt)) {
          const i = Number(k);
          if (i < index) shifted[i] = v;
          else if (i > index) shifted[i - 1] = v;
        }
        set({ byCourt: shifted });
      },
      reset: () => set({ byCourt: {} }),
    }),
    {
      name: "khelo.venue-setup-advance",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ byCourt: s.byCourt }),
    },
  ),
);

/** API fields for a court from its draft (null type = the price rule's own percentage). */
export function advanceApiFields(d: AdvanceDraft): { advance_type: "fixed" | "percent" | null; advance_value: number | null; advance_minimum: number | null } {
  if (d.advanceType === "") return { advance_type: null, advance_value: null, advance_minimum: null };
  return {
    advance_type: d.advanceType,
    advance_value: d.advanceValue.trim() === "" ? 0 : Number(d.advanceValue),
    advance_minimum: d.advanceMinimum.trim() === "" ? null : Number(d.advanceMinimum),
  };
}
