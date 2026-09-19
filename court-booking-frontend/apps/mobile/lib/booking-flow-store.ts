import { create } from "zustand";
import type { PaymentInstructions } from "@court-booking/types";

/** Payment instructions only ever come back once, in POST /bookings/hold's response
 * (the backend never exposes a venue's bank details to a player any other way) --
 * stash them here, keyed by booking id, so the pay screen can render them after
 * navigating away from the chat screen that created the hold. */
interface BookingFlowState {
  paymentInstructionsByBookingId: Record<string, PaymentInstructions>;
  setPaymentInstructions: (bookingId: string, instructions: PaymentInstructions) => void;
}

export const useBookingFlowStore = create<BookingFlowState>((set) => ({
  paymentInstructionsByBookingId: {},
  setPaymentInstructions: (bookingId, instructions) =>
    set((s) => ({ paymentInstructionsByBookingId: { ...s.paymentInstructionsByBookingId, [bookingId]: instructions } })),
}));
