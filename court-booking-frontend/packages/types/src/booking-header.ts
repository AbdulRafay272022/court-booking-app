/**
 * fix/nov-8: the ONE place that decides what the top of a player's booking page says and what its QR area shows, per
 * status (web `app/booking/[id]/done/page.tsx`, mobile `app/(player)/booking/[id]/done.tsx`). Before this, every status that
 * was not `booked` fell into the "Booking abhi pakki nahi / QR pakki booking par milega" waiting copy, so a completed,
 * no-show or cancelled booking still told the player to wait for the venue.
 *
 *   held / payment_submitted -> waiting copy, QR placeholder ("QR pakki booking par milega") while the slot is ahead
 *   booked                   -> "Court aapka hai" + the QR (no QR once the slot has ended)
 *   completed                -> "Khel ho gaya", no QR area
 *   no_show                  -> "No-show mark hui", no QR area; `askNoShow` ("Aap aaye the? Batayein") only when the
 *                               server says the player may still reply (the noshow_reply flag is on and no reply yet)
 *   cancelled                -> who cancelled it, no QR area
 * A booking whose slot has ended never shows the placeholder.
 */
import type { BookingStatus, CancelledBy } from "./booking";
import type { TextLang } from "./locale-text";

export type BookingHeaderKind = "waiting" | "booked" | "completed" | "no_show" | "cancelled";
/** `show` = the check-in QR, `placeholder` = "QR pakki booking par milega", `none` = no QR area at all. */
export type TicketQrMode = "show" | "placeholder" | "none";

export interface BookingHeader {
  kind: BookingHeaderKind;
  title: string;
  body: string;
  qr: TicketQrMode;
  /** "Aap aaye the? Batayein" link under a no-show header. */
  askNoShow: string | null;
}

export interface BookingHeaderInput {
  status: BookingStatus;
  cancelled_by?: CancelledBy | null;
  ends_at: string;
}

/** What the ticket's QR area shows for this booking right now. */
export function ticketQrMode(booking: { status: BookingStatus; ends_at: string }, now: number = Date.now()): TicketQrMode {
  const over = Date.parse(booking.ends_at) <= now;
  if (over) return "none";
  if (booking.status === "booked") return "show";
  if (booking.status === "held" || booking.status === "payment_submitted") return "placeholder";
  return "none";
}

const COPY = {
  ru: {
    waiting: ["Booking abhi pakki nahi", "Venue ke approve karne par hi booking pakki hogi. Yeh page khud update hota rahega."],
    booked: ["Court aapka hai", "Venue ne booking pakki kar di."],
    completed: ["Khel ho gaya", "Ye booking mukammal ho gayi. Khelne ka shukriya!"],
    no_show: ["No-show mark hui", "Venue ne is booking ko no-show mark kiya."],
    askNoShow: "Aap aaye the? Batayein",
    cancelled: {
      owner: ["Venue ne booking cancel kar di", "Venue ne ye booking reject ya cancel kar di."],
      player: ["Booking cancel ho gayi", "Aap ne ye booking cancel ki."],
      system: ["Waqt khatam ho gaya", "Waqt par payment ya check nahi hua, is liye slot chhor diya gaya."],
      other: ["Booking cancel ho gayi", "Ye booking cancel ho gayi."],
    },
  },
  en: {
    waiting: ["Not confirmed yet", "The booking is confirmed only when the venue approves it. This page keeps updating by itself."],
    booked: ["Court is yours", "Confirmed by the venue."],
    completed: ["Game played", "This booking is complete. Thanks for playing!"],
    no_show: ["Marked as no-show", "The venue marked this booking as a no-show."],
    askNoShow: "Were you there? Tell the venue",
    cancelled: {
      owner: ["The venue cancelled this booking", "The venue rejected or cancelled this booking."],
      player: ["Booking cancelled", "You cancelled this booking."],
      system: ["Hold expired", "Payment or the check didn't happen in time, so the slot was released."],
      other: ["Booking cancelled", "This booking was cancelled."],
    },
  },
} as const;

/**
 * The header and QR area for a player's booking page. `canReplyNoShow` comes from GET /bookings/{id}/extras
 * (`arrival.can_reply_noshow`), which is false while the noshow_reply flag is off.
 */
export function bookingHeader(booking: BookingHeaderInput, opts: { now?: number; canReplyNoShow?: boolean; lang?: TextLang } = {}): BookingHeader {
  const c = COPY[opts.lang ?? "en"];
  const qr = ticketQrMode(booking, opts.now ?? Date.now());
  switch (booking.status) {
    case "booked":
      return { kind: "booked", title: c.booked[0], body: c.booked[1], qr, askNoShow: null };
    case "completed":
      return { kind: "completed", title: c.completed[0], body: c.completed[1], qr: "none", askNoShow: null };
    case "no_show":
      return { kind: "no_show", title: c.no_show[0], body: c.no_show[1], qr: "none", askNoShow: opts.canReplyNoShow ? c.askNoShow : null };
    case "cancelled": {
      const by = booking.cancelled_by === "owner" || booking.cancelled_by === "player" || booking.cancelled_by === "system" ? booking.cancelled_by : "other";
      const [title, body] = c.cancelled[by];
      return { kind: "cancelled", title, body, qr: "none", askNoShow: null };
    }
    default:
      return { kind: "waiting", title: c.waiting[0], body: c.waiting[1], qr, askNoShow: null };
  }
}
