import type { Tone } from "../roles";

/**
 * Honest booking status labels (docs/floodlight-contract.md "Honest status mapping"). "Pakki" / "Confirmed" appears ONLY
 * for status === "booked". The journey is Hold -> Screenshot bheja -> Venue check -> Pakki ✓.
 */
export type BookingStatusLike = "held" | "payment_submitted" | "booked" | "completed" | "no_show" | "cancelled";

export interface StatusInput {
  status: BookingStatusLike;
  cancelled_by?: "player" | "owner" | "system" | null;
  cancellation_reason?: string | null;
}

export interface StatusPillSpec {
  key:
    | "held"
    | "venueCheck"
    | "booked"
    | "completed"
    | "noShow"
    | "cancelledByPlayer"
    | "rejectedByOwner"
    | "holdExpired"
    | "reviewExpired"
    | "cancelled";
  label: string;
  tone: Tone;
}

const LABELS: Record<StatusPillSpec["key"], { ru: string; en: string; tone: Tone }> = {
  held: { ru: "Hold · Pay baqi", en: "On hold · Pay now", tone: "waiting" },
  venueCheck: { ru: "Venue check", en: "Venue checking", tone: "waiting" },
  booked: { ru: "Pakki ✓", en: "Confirmed ✓", tone: "open" },
  completed: { ru: "Khel liya", en: "Completed", tone: "neutral" },
  noShow: { ru: "No-show", en: "No-show", tone: "danger" },
  cancelledByPlayer: { ru: "Aap ne cancel kiya", en: "You cancelled", tone: "neutral" },
  rejectedByOwner: { ru: "Venue ne reject/cancel kiya", en: "Rejected by venue", tone: "danger" },
  holdExpired: { ru: "Hold khatam", en: "Hold expired", tone: "danger" },
  reviewExpired: { ru: "Check ka waqt khatam", en: "Review expired", tone: "danger" },
  cancelled: { ru: "Cancel", en: "Cancelled", tone: "neutral" },
};

export function statusKey(b: StatusInput): StatusPillSpec["key"] {
  switch (b.status) {
    case "held":
      return "held";
    case "payment_submitted":
      return "venueCheck";
    case "booked":
      return "booked";
    case "completed":
      return "completed";
    case "no_show":
      return "noShow";
    case "cancelled":
      if (b.cancelled_by === "player") return "cancelledByPlayer";
      if (b.cancelled_by === "owner") return "rejectedByOwner";
      if (b.cancelled_by === "system" && b.cancellation_reason === "hold_expired") return "holdExpired";
      if (b.cancelled_by === "system" && b.cancellation_reason === "payment_review_expired") return "reviewExpired";
      return "cancelled";
  }
}

export function statusPill(b: StatusInput, lang: "ru" | "en" = "ru"): StatusPillSpec {
  const key = statusKey(b);
  const l = LABELS[key];
  return { key, label: l[lang], tone: l.tone };
}

/** The ONLY gate for "Pakki" / "Court aap ka hai" / "confirmed" copy and the celebration + QR ticket. */
export function isConfirmed(status: string | null | undefined): boolean {
  return status === "booked";
}

export type JourneyStepState = "done" | "now" | "next" | "failed";
export interface JourneyStep {
  key: "hold" | "proof" | "check" | "booked";
  label: string;
  state: JourneyStepState;
}

const STEP_LABELS = {
  hold: { ru: "Slot hold hua", en: "Slot held" },
  proof: { ru: "Screenshot bheja", en: "Screenshot sent" },
  check: { ru: "Venue check kar raha hai", en: "Venue is checking" },
  booked: { ru: "Booking pakki", en: "Booking confirmed" },
} as const;

/**
 * Timeline steps for a booking. `proofSent` says whether a payment screenshot exists (for a cancelled booking we cannot tell
 * from the status alone). A cancelled / expired booking marks the step it stopped at as failed.
 */
export function journeySteps(b: StatusInput & { proofSent?: boolean }, lang: "ru" | "en" = "ru"): JourneyStep[] {
  const keys: JourneyStep["key"][] = ["hold", "proof", "check", "booked"];
  let states: JourneyStepState[];
  switch (b.status) {
    case "held":
      states = ["done", "now", "next", "next"];
      break;
    case "payment_submitted":
      states = ["done", "done", "now", "next"];
      break;
    case "booked":
    case "completed":
      states = ["done", "done", "done", "done"];
      break;
    case "no_show":
      states = ["done", "done", "done", "done"];
      break;
    case "cancelled":
      states = b.proofSent ? ["done", "done", "failed", "next"] : ["done", "failed", "next", "next"];
      break;
  }
  return keys.map((key, i) => ({ key, label: STEP_LABELS[key][lang], state: states[i] }));
}
