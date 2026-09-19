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
