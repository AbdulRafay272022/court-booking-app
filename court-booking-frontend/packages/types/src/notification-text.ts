/**
 * Round 2 (A6): the readable sentence behind every bell item, one implementation for web and mobile.
 * title   = what happened ("Naya payment approval ke liye")
 * context = who / where / when / how much, from params ("Abbas Zafar - Futsal 1 - Aaj 9 PM - PKR 2,000")
 * delivery = how it went out, shown small and muted ("WhatsApp par bheja gaya"), null when nothing is known.
 * Never "New notification": an unknown kind gets a readable title built from its raw event_type.
 */
import type { NotificationFeedItem, NotificationKind } from "./round2";
import type { TextLang } from "./locale-text";
import { formatDateRelative, pktParts } from "./datetime";
import { formatPkrAmount } from "./advance-example";

type Lang = TextLang;

const TITLES: Record<Exclude<NotificationKind, "other">, Record<Lang, string>> = {
  payment_waiting: { ru: "Naya payment approval ke liye", en: "New payment waiting for approval" },
  late_payment: {
    ru: "Screenshot hold khatam hone ke baad aaya",
    en: "Screenshot arrived after the hold had expired",
  },
  payment_approved: { ru: "Payment manzoor ho gayi", en: "Payment approved" },
  payment_rejected: { ru: "Payment reject ho gayi", en: "Payment rejected" },
  player_cancelled: { ru: "Player ne booking cancel kar di", en: "Player cancelled the booking" },
  refund_owed: { ru: "Player ko refund dena hai", en: "Refund owed to a player" },
  refund_sent: { ru: "Refund wapas bhej diya gaya", en: "Refund sent" },
  new_booking: { ru: "Nayi booking aayi", en: "New booking" },
  slot_freed: { ru: "Ek slot khali ho gaya", en: "A slot is free again" },
  daily_summary: { ru: "Aaj ka khulasa", en: "Daily summary" },
  venue_approved: { ru: "Venue approve ho gaya", en: "Venue approved" },
  venue_rejected: { ru: "Venue approve nahi hua", en: "Venue not approved" },
  venue_changes: { ru: "Venue mein tabdeeli chahiye", en: "Changes requested for your venue" },
  booking_confirmed: { ru: "Booking confirm ho gayi", en: "Booking confirmed" },
  booking_cancelled: { ru: "Booking cancel ho gayi", en: "Booking cancelled" },
  booking_reminder: { ru: "Booking ki yaad-dehani", en: "Booking reminder" },
  hold_expiring: { ru: "Booking ka waqt khatam hone wala hai", en: "Booking hold is about to expire" },
  payment_reminder: { ru: "Payment abhi tak approval ke intezar mein hai", en: "Payment still waiting for approval" },
  payment_final_warning: {
    ru: "Approve na kiya to booking jaldi cancel ho jayegi",
    en: "Booking will be cancelled soon unless you approve it",
  },
  payment_auto_cancelled: {
    ru: "Booking auto-cancel ho gayi, paisa aaya hai to wapas dena hai",
    en: "Booking auto-cancelled; return the money if it arrived",
  },
};

/** Raw event types the backend logs (notification_log.event_type), for the old endpoint and the "other" kind. */
const EVENT_TITLES: Record<string, Record<Lang, string>> = {
  payment_submitted: TITLES.payment_waiting,
  payment_submitted_owner: TITLES.payment_waiting,
  payment_approved: TITLES.payment_approved,
  payment_rejected: TITLES.payment_rejected,
  booking_confirmed: TITLES.booking_confirmed,
  booking_cancelled: TITLES.booking_cancelled,
  booking_reminder: TITLES.booking_reminder,
  player_cancelled: TITLES.player_cancelled,
  refund_owed: TITLES.refund_owed,
  refund_paid: TITLES.refund_sent,
  refund_sent: TITLES.refund_sent,
  slot_reopened: TITLES.slot_freed,
  new_booking: TITLES.new_booking,
  owner_daily_digest: TITLES.daily_summary,
  venue_approved: TITLES.venue_approved,
  venue_rejected: TITLES.venue_rejected,
  venue_changes_requested: TITLES.venue_changes,
  venue_pending_review: { ru: "Venue review mein hai", en: "Venue is under review" },
  court_deactivated: { ru: "Ek court band kar diya gaya", en: "A court was switched off" },
  tournament_announcement: { ru: "Tournament ka elaan", en: "Tournament announcement" },
  hold_expiring: TITLES.hold_expiring,
  hold_expired: { ru: "Booking ka waqt khatam ho gaya", en: "Booking hold expired" },
  payment_review_expired: { ru: "Payment review ka waqt khatam ho gaya", en: "Payment review time ran out" },
  payment_late: TITLES.late_payment,
  late_payment_proof: TITLES.late_payment,
  approval_reminder: { ru: "Payment abhi tak approval ke intezar mein hai", en: "Payment still waiting for approval" },
  payment_final_warning: TITLES.payment_final_warning,
  owner_payment_auto_cancelled: TITLES.payment_auto_cancelled,
  phone_changed: { ru: "Phone number badal gaya", en: "Phone number changed" },
  // audit 2026-10-28 items 17 + 18
  owner_staff_action: { ru: "Staff ne booking mark ki", en: "Staff marked a booking" },
  player_no_show: { ru: "Booking no-show mark hui", en: "Booking marked as no-show" },
  player_short: { ru: "Booking par paisa baqi hai", en: "Money still due on a booking" },
};

/** "payment_review_expired" -> "Payment review expired" (both languages; used only for an event we have no copy for). */
function humanize(eventType: string): string {
  const words = eventType
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Readable title for a raw event_type (old endpoint fallback / unknown kind). Never "New notification". */
export function eventTypeTitle(eventType: string, lang: Lang): string {
  const known =
    EVENT_TITLES[eventType] ??
    EVENT_TITLES[eventType.replace(/_(whatsapp|sms|push|web_push)$/, "")] ??
    (/^payment_reminder(_\d+)?$/.test(eventType) ? TITLES.payment_reminder : undefined);
  if (known) return known[lang];
  const h = humanize(eventType);
  if (h) return `Update: ${h}`;
  return lang === "ru" ? "Khelo se update" : "Update from Khelo";
}

/** "9 PM" / "9:30 PM" (compact, Pakistan time). */
function shortTime(iso: string): string {
  const p = pktParts(iso);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  return p.minute === 0 ? `${h12} ${ampm}` : `${h12}:${String(p.minute).padStart(2, "0")} ${ampm}`;
}

function validIso(v: string | undefined): v is string {
  return typeof v === "string" && Number.isFinite(new Date(v).getTime());
}

const SEP = " - ";

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Stage 2 feed params (from notification_log.payload): reminder number, minutes to the cancel, digest status line. */
function stage2Parts(item: NotificationFeedItem, lang: Lang): string[] {
  const p = item.params ?? {};
  const out: string[] = [];
  if (item.kind === "payment_reminder") {
    if (posInt(p.reminder_no)) out.push(lang === "ru" ? `Reminder ${p.reminder_no}` : `Reminder ${p.reminder_no}`);
    if (posInt(p.minutes_waiting)) out.push(lang === "ru" ? `${p.minutes_waiting} minute se intezar` : `waiting ${p.minutes_waiting} min`);
  } else if (item.kind === "payment_final_warning") {
    if (posInt(p.minutes_to_cancel)) out.push(lang === "ru" ? `${p.minutes_to_cancel} minute mein cancel` : `cancels in ${p.minutes_to_cancel} min`);
  } else if (item.kind === "payment_auto_cancelled") {
    out.push(lang === "ru" ? "Approve nahi hui" : "Not approved in time");
  } else if (item.kind === "daily_summary") {
    if (posInt(p.status_pending)) {
      const n = p.status_pending;
      out.push(lang === "ru" ? `${n} ${n === 1 ? "booking" : "bookings"} ka status baqi hai` : `${n} ${n === 1 ? "booking needs" : "bookings need"} a status`);
    }
  }
  return out;
}

function contextFor(item: NotificationFeedItem, lang: Lang, now: Date): string {
  const p = item.params ?? {};
  const parts: string[] = [];
  const venueKind = item.kind === "venue_approved" || item.kind === "venue_rejected" || item.kind === "venue_changes";
  if (venueKind || item.kind === "daily_summary") {
    if (p.venue_name) parts.push(p.venue_name);
  } else {
    if (p.player_name) parts.push(p.player_name);
    if (p.court_name) parts.push(p.court_name);
    else if (p.venue_name) parts.push(p.venue_name);
  }
  if (validIso(p.starts_at)) parts.push(`${formatDateRelative(p.starts_at, now, lang)} ${shortTime(p.starts_at)}`);
  // Stage 2: the daily digest's booking count goes before its revenue
  if (item.kind === "daily_summary" && posInt(p.count)) {
    parts.push(lang === "ru" ? `${p.count} ${p.count === 1 ? "booking" : "bookings"} aaj` : `${p.count} ${p.count === 1 ? "booking" : "bookings"} today`);
  }
  if (typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount > 0) parts.push(formatPkrAmount(p.amount));
  parts.push(...stage2Parts(item, lang));
  if (p.reason && (venueKind || item.kind === "payment_rejected" || item.kind === "booking_cancelled")) {
    parts.push(p.reason);
  }
  return parts.join(SEP);
}

const CHANNEL_LABEL: Record<NotificationFeedItem["deliveries"][number]["channel"], Record<Lang, string>> = {
  whatsapp: { ru: "WhatsApp", en: "WhatsApp" },
  sms: { ru: "SMS", en: "SMS" },
  push: { ru: "App", en: "the app" },
  web_push: { ru: "Browser", en: "the browser" },
};

const CHANNEL_ORDER = ["whatsapp", "sms", "push", "web_push"] as const;

function joinNames(names: string[], lang: Lang): string {
  if (names.length <= 1) return names.join("");
  const and = lang === "ru" ? "aur" : "and";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/** "WhatsApp par bheja gaya" / "SMS par bheja gaya (WhatsApp nahi gaya)" / "WhatsApp nahi ja saka"; null if unknown. */
export function deliveryText(deliveries: NotificationFeedItem["deliveries"] | undefined, lang: Lang): string | null {
  if (!deliveries || deliveries.length === 0) return null;
  const sentSet = new Set(deliveries.filter((d) => d.status === "sent").map((d) => d.channel));
  const failedSet = new Set(deliveries.filter((d) => d.status === "failed" && !sentSet.has(d.channel)).map((d) => d.channel));
  const sent = CHANNEL_ORDER.filter((c) => sentSet.has(c)).map((c) => CHANNEL_LABEL[c][lang]);
  const failed = CHANNEL_ORDER.filter((c) => failedSet.has(c)).map((c) => CHANNEL_LABEL[c][lang]);
  if (sent.length === 0 && failed.length === 0) return null;
  if (lang === "ru") {
    if (sent.length === 0) return `${joinNames(failed, lang)} par nahi ja saka`;
    const base = `${joinNames(sent, lang)} par bheja gaya`;
    return failed.length ? `${base} (${joinNames(failed, lang)} par nahi gaya)` : base;
  }
  if (sent.length === 0) return `Could not be sent by ${joinNames(failed, lang)}`;
  const base = `Sent by ${joinNames(sent, lang)}`;
  return failed.length ? `${base} (${joinNames(failed, lang)} failed)` : base;
}

export interface NotificationText {
  title: string;
  context: string;
  delivery: string | null;
}

export function notificationText(item: NotificationFeedItem, lang: Lang, now: Date = new Date()): NotificationText {
  const title =
    item.kind !== "other" && TITLES[item.kind as Exclude<NotificationKind, "other">]
      ? TITLES[item.kind as Exclude<NotificationKind, "other">][lang]
      : eventTypeTitle(item.event_type ?? "", lang);
  return { title, context: contextFor(item, lang, now), delivery: deliveryText(item.deliveries, lang) };
}

/** Every kind with its own copy (tests iterate it). */
export const NOTIFICATION_KINDS: NotificationKind[] = [...(Object.keys(TITLES) as NotificationKind[]), "other"];
