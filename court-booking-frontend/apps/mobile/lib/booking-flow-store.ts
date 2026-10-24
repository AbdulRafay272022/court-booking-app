import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PaymentInstructions } from "@court-booking/types";

import { pruneSavedInstructions, type SavedInstructions } from "./booking-flow-rules";

/** Payment instructions only ever come back once, in POST /bookings/hold's response
 * (the backend never exposes a venue's bank details to a player any other way) --
 * stash them here, keyed by booking id, so the pay screen can render them after
 * navigating away from the chat screen that created the hold. Persisted (AsyncStorage), so leaving the pay screen,
 * killing the app or a reload still shows where to send the money; entries older than 2 days are dropped. */
interface BookingFlowState {
  paymentInstructionsByBookingId: Record<string, SavedInstructions>;
  setPaymentInstructions: (bookingId: string, instructions: PaymentInstructions) => void;
}

export const useBookingFlowStore = create<BookingFlowState>()(
  persist(
    (set) => ({
      paymentInstructionsByBookingId: {},
      setPaymentInstructions: (bookingId, instructions) =>
        set((s) => ({
          paymentInstructionsByBookingId: {
            ...pruneSavedInstructions(s.paymentInstructionsByBookingId, Date.now()),
            [bookingId]: { ...instructions, saved_at: Date.now() },
          },
        })),
    }),
    {
      name: "maidan.payment_instructions",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ paymentInstructionsByBookingId: pruneSavedInstructions(s.paymentInstructionsByBookingId, Date.now()) }),
    },
  ),
);
