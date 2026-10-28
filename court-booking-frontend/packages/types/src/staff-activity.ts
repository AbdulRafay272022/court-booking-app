/** Audit 2026-10-28 item 16: GET /owners/staff-activity and GET /admin/staff-activity (app/schemas/staff_activity.py). */
export interface StaffActivityCounts {
  bookings_marked: number;
  no_shows: number;
  check_ins: number;
  walkins: number;
  short_payments: number;
  short_amount_pkr: number;
  cash_entries: number;
  cash_pkr: number;
  transfers: number;
  transfers_pkr: number;
  refunds_paid_pkr: number;
  total_recorded_pkr: number;
}

export interface StaffActivityRow extends StaffActivityCounts {
  user_id: string | null;
  name: string | null;
  role: "owner" | "staff" | "admin" | string;
}

export interface StaffNoShow {
  booking_id: string;
  player_name: string | null;
  court_name: string | null;
  starts_at: string | null;
  marked_by_name: string | null;
  marked_by_role: string | null;
  marked_at: string;
  /** audit Phase 3 item 6 (flag noshow_reply): the player's "Main aaya tha" and the "Pohanch gaya" GPS check. */
  reply_id?: string | null;
  player_replied?: boolean;
  player_note?: string | null;
  owner_decision?: "keep" | "reverse" | null;
  arrival_verdict?: "near" | "far" | "pin_unreliable" | null;
  arrival_distance_m?: number | null;
  /** GPS says the player WAS there: show this no-show in red. */
  highlight?: boolean;
}

export interface StaffActivity {
  venue_id: string;
  date_from: string;
  date_to: string;
  people: StaffActivityRow[];
  totals: StaffActivityCounts;
  no_shows: StaffNoShow[];
}
