import { create } from "zustand";
import type { PaymentInstructions } from "@court-booking/types";

interface BookingFlowState {
  paymentInstructionsByBookingId: Record<string, PaymentInstructions>;
  setPaymentInstructions: (bookingId: string, instructions: PaymentInstructions) => void;
}

export const useBookingFlowStore = create<BookingFlowState>((set) => ({
  paymentInstructionsByBookingId: {},
  setPaymentInstructions: (bookingId, instructions) =>
    set((s) => ({ paymentInstructionsByBookingId: { ...s.paymentInstructionsByBookingId, [bookingId]: instructions } })),
}));
