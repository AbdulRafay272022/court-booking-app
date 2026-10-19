/** Owner Round 2 (docs/round2-contract.md). Mirrors the backend schemas; every field is additive. */
import type { PendingApproval } from "./owner";

export type ApprovalState = "awaiting" | "cancelled_by_player" | "expired" | "cancelled_by_owner";

export interface ApprovalQueueItem extends PendingApproval {
  state: ApprovalState;
  cancelled_at: string | null;
  has_screenshot: boolean;
  overpayment: { expected: number; ocr_amount: number; excess: number } | null;
  /** Stage 2: the screenshot was already used on other bookings; approve needs confirm_duplicate. */
  duplicate?: { used_on_bookings: number } | null;
}

export interface ApprovalsQueuePage {
  items: ApprovalQueueItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AcknowledgeResult {
  ok: true;
  refund_dispute_id: string | null;
}

export type ApproveAcceptMode = "advance_only" | "full";

export type NotificationKind =
  | "payment_waiting"
  | "late_payment"
  | "payment_approved"
  | "payment_rejected"
  | "player_cancelled"
  | "refund_owed"
  | "refund_sent"
  | "new_booking"
  | "slot_freed"
  | "daily_summary"
  | "venue_approved"
  | "venue_rejected"
  | "venue_changes"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_reminder"
  | "hold_expiring"
  /** Stage 2: owner reminder for a screenshot still waiting (event payment_reminder_<n>). */
  | "payment_reminder"
  /** Stage 2: "this booking will be cancelled in N minutes" (event payment_final_warning). */
  | "payment_final_warning"
  /** Stage 2: auto-cancelled with a screenshot on file; money may have to go back (event owner_payment_auto_cancelled). */
  | "payment_auto_cancelled"
  | "other";

export interface NotificationFeedItem {
  id: string;
  event_type: string;
  kind: NotificationKind;
  created_at: string;
  params: {
    player_name?: string;
    court_name?: string;
    sport?: string;
    venue_name?: string;
    starts_at?: string;
    ends_at?: string;
    amount?: number;
    reason?: string;
    /** Stage 2 (from notification_log.payload): digest totals, reminder details, announcement title. */
    count?: number;
    status_pending?: number;
    reminder_no?: number;
    minutes_waiting?: number;
    minutes_to_cancel?: number;
    title?: string;
  };
  link: { kind: "approvals" | "refunds" | "booking" | "bookings" | "overview" | "venue_status" | "none"; booking_id?: string };
  deliveries: { channel: "push" | "whatsapp" | "sms" | "web_push"; status: "sent" | "failed" }[];
}

export interface NotificationFeedPage {
  items: NotificationFeedItem[];
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface PendingAll {
  count: number;
  awaiting_approval: number;
  awaiting_payment: number;
}

export interface AdvanceExplain {
  mode: "default" | "fixed" | "percent";
  value: number | null;
  minimum: number | null;
  hourly_price: number | null;
  example_minutes: number;
  example_total: number;
  example_advance: number;
  default_rule: { source: "pricing_rule" | "none"; percentage: number | null; value_if_nothing_set: number };
}
