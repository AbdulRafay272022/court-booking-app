import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Which of an owner's venues the dashboard is currently managing -- ONE shared value for the whole
 * owner section, remembered per owner on this device.
 *
 * Before this, every dashboard screen kept its own private `useState` for the selected venue, so
 * picking venue B on Today left Approvals, Ledger and Walk-in on venue A: an owner could approve,
 * export or (worst) record a walk-in against the wrong venue without noticing. If the saved venue no
 * longer exists, `useOwnerVenues` falls back to their first approved venue.
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
    { name: "maidan.selected_venue", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
