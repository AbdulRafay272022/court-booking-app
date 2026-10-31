import type { BookingSource, BookingStatus } from "./booking";
import type { UserRole } from "./user";
import type { VenueStatus } from "./venue";

/** GET /admin/dashboard */
export interface AdminDashboard {
  total_venues: number;
  active_venues: number;
  pending_approval: number;
  total_bookings_today: number;
  total_revenue_today: number;
  total_users: number;
  disputes_open: number;
}

/** GET /admin/overview -- the read-only cross-platform picture (days are Pakistan days, money whole PKR). */
export interface AdminCourtActivity {
  venue_id: string;
  venue_name: string;
  venue_status: string;
  court_id: string;
  court_name: string;
  sport: string;
  owner_id: string;
  owner_name: string | null;
  owner_phone: string;
  state: "active" | "suspended" | "not_live";
  bookings_today: number;
  bookings_7_days: number;
  last_booking_at: string | null;
  idle: boolean;
  days_since_last_booking: number | null;
}

export interface AdminPeriodFigures {
  today: number;
  last_7_days: number;
  last_30_days: number;
}

export interface AdminOverview {
  generated_at: string;
  idle_days: number;
  window_days: number;
  courts: AdminCourtActivity[];
  users: {
    total_players: number;
    total_owners: number;
    total_staff: number;
    total_admins: number;
    new_players_7_days: number;
    new_players_30_days: number;
    new_owners_7_days: number;
    new_owners_30_days: number;
    active_30_days: number;
    active_30_days_of_total: number;
  };
  usage: {
    bookings: AdminPeriodFigures;
    gmv_pkr: AdminPeriodFigures;
    collected_pkr: AdminPeriodFigures;
    chat_messages_app: AdminPeriodFigures;
    chat_messages_whatsapp: AdminPeriodFigures;
    ai_model_calls_30_days: number;
    ai_tokens_30_days: number;
    payments_approved_30_days: number;
    payments_rejected_30_days: number;
    payments_pending_30_days: number;
    payments_auto_approved_30_days: number;
    payment_approval_rate: number | null;
  };
  underperforming: Array<{
    venue_id: string;
    venue_name: string;
    court_id: string;
    court_name: string;
    sport: string;
    owner_name: string | null;
    booking_rate: number;
    booked_hours: number;
    open_hours: number;
    days_measured: number;
    weakest_slots: Array<{ day_of_week: number; hour: number; booking_rate: number }>;
  }>;
  notes: string[];
}

/** GET /admin/stats */
export interface PlatformStats {
  total_users: number;
  total_venues: number;
  approved_venues: number;
  total_courts: number;
  total_bookings: number;
  booked_bookings: number;
  bookings_last_30_days: number;
  revenue_last_30_days: number;
}

export interface VenueReviewInput {
  status: VenueStatus;
  rejection_reason?: string | null;
}

export interface AdminBooking {
  id: string;
  court_id: string;
  court_name: string;
  venue_id: string;
  venue_name: string;
  player_name: string | null;
  player_phone: string | null;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  source: BookingSource;
  price: number;
  amount_paid: number;
}

export interface AdminUser {
  id: string;
  phone: string;
  name: string | null;
  role: UserRole;
  is_active: boolean;
  suspension_reason: string | null;
  reliability_score: number;
  total_bookings: number;
  total_no_shows: number;
  total_rejections: number;
  created_at: string;
}

export interface DisputeRejection {
  booking_id: string;
  court_name: string;
  venue_name: string;
  reason: string | null;
  rejected_at: string | null;
}

export interface Dispute {
  player_id: string;
  player_name: string | null;
  player_phone: string;
  rejection_count: number;
  recent_rejections: DisputeRejection[];
}

/** GET /admin/disputes/refund-queue (app/schemas/admin.py RefundQueueEntryOut); audit 2026-10-28 Phase 2 item 4 (admin in the app). */
export interface RefundQueueEntry {
  id: string;
  booking_id: string;
  payment_id: string | null;
  player_id: string | null;
  player_name: string | null;
  player_phone: string | null;
  court_name: string;
  venue_name: string;
  amount_claimed: number | null;
  reason: string;
  resolved: boolean;
  created_at: string;
  refund_amount: number | null;
  refund_status: string;
  refunded_amount: number | null;
  refund_reference: string | null;
  refunded_at: string | null;
  remaining_amount: number;
  is_overdue: boolean;
}
