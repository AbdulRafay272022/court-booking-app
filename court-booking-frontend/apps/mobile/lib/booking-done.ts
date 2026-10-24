import type { BookingStatus, CancelledBy } from "@court-booking/types";

export type DoneTone = "confirmed" | "waiting" | "ended";
export type DoneIcon = "check" | "clock" | "x";

export interface DoneCopy {
  title: string;
  subtitle: string;
  tone: DoneTone;
  icon: DoneIcon;
  /** Where the main button sends the player: a held booking still needs its payment proof. */
  action: "bookings" | "pay";
  actionLabel: string;
}

/** What the confirmation screen says for each booking status. "Court is yours / Confirmed by the venue" is ONLY for a
 * booking the venue has really confirmed: the pay screen also lands here while the owner is still reviewing the
 * screenshot, and that used to read as confirmed (docs/mobile-audit-2026-10.md P0-2). */
export function doneCopy(status: BookingStatus, cancelledBy: CancelledBy | null = null): DoneCopy {
  const toBookings = { action: "bookings" as const, actionLabel: "Done" };
  switch (status) {
    case "booked":
      return { title: "Court is yours", subtitle: "Confirmed by the venue", tone: "confirmed", icon: "check", ...toBookings };
    case "completed":
      return { title: "Game played", subtitle: "This booking is complete. Thanks for playing!", tone: "confirmed", icon: "check", ...toBookings };
    case "payment_submitted":
      return {
        title: "Payment bheji gayi",
        subtitle: "Owner approval ka intezar hai. Approve hote hi yeh screen update ho jayegi.",
        tone: "waiting",
        icon: "clock",
        ...toBookings,
      };
    case "held":
      return {
        title: "Payment baqi hai",
        subtitle: "Your slot is on hold. Send the advance and upload the screenshot to confirm it.",
        tone: "waiting",
        icon: "clock",
        action: "pay",
        actionLabel: "Upload payment screenshot",
      };
    case "no_show":
      return { title: "Marked as no-show", subtitle: "The venue marked this booking as a no-show.", tone: "ended", icon: "x", ...toBookings };
    case "cancelled":
      return {
        title: cancelledBy === "system" ? "Hold expired" : "Booking cancelled",
        subtitle:
          cancelledBy === "owner"
            ? "The venue cancelled this booking."
            : cancelledBy === "player"
              ? "You cancelled this booking."
              : cancelledBy === "system"
                ? "Payment didn't arrive in time, so the slot was released."
                : "This booking was cancelled.",
        tone: "ended",
        icon: "x",
        ...toBookings,
      };
  }
}

/** Keep checking while the venue still has to act, so "waiting" turns into "Court is yours" without a reload. */
export function donePollMs(status: BookingStatus | undefined): number | false {
  return status === "payment_submitted" || status === "held" ? 5000 : false;
}
