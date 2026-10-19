"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { EMPTY_TIMER_DRAFT, type TimerDraft } from "./venue-timers";

/**
 * Round 2 Stage 2: the wizard's venue timers, kept beside the main venue-setup draft (like the
 * advance draft) so the main draft's persisted shape and migrations stay untouched. The venue does not exist until
 * "Send for review", so the values live here and are PUT right after the venue is created. Not sensitive (plain numbers).
 */
interface TimerDraftState {
  timers: TimerDraft;
  setTimers: (patch: Partial<TimerDraft>) => void;
  reset: () => void;
}

export const useTimerDraftStore = create<TimerDraftState>()(
  persist(
    (set, get) => ({
      timers: EMPTY_TIMER_DRAFT,
      setTimers: (patch) => set({ timers: { ...get().timers, ...patch } }),
      reset: () => set({ timers: EMPTY_TIMER_DRAFT }),
    }),
    {
      name: "khelo.venue-setup-timers",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ timers: s.timers }),
    },
  ),
);
