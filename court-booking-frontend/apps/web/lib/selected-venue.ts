"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Which of an owner's venues the dashboard is currently managing -- ONE shared value for the
 * whole owner section.
 *
 * Before this, every dashboard screen kept its own private `useState` for the selected venue, so
 * picking venue B on Today left Approvals, Ledger and Add-booking on venue A: an owner could
 * approve, export or (worst) record a walk-in against the wrong venue without noticing. Now the
 * choice is global, and it is also persisted per owner on this device so a relaunch returns to
 * the venue they were last on. If the saved venue no longer exists (or the owner is someone
 * else), `useOwnerVenues` falls back to their first approved venue.
 */
interface SelectedVenueState {
  /** owner user id -> venue id */
  byUser: Record<string, string>;
  select: (userId: string, venueId: string) => void;
}

export const useSelectedVenueStore = create<SelectedVenueState>()(
  persist(
    (set, get) => ({
      byUser: {},
      select: (userId, venueId) => set({ byUser: { ...get().byUser, [userId]: venueId } }),
    }),
    { name: "maidan.selected_venue", storage: createJSONStorage(() => window.localStorage) },
  ),
);
