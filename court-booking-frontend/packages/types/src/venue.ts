import type { Court } from "./court";

export type VenueStatus = "pending" | "approved" | "changes_requested" | "rejected";

export interface BankDetails {
  bank: string;
  account_title: string;
  account_number: string;
  iban?: string | null;
}

/** Shape returned by GET /venues (list) — VenueListItemOut */
export interface VenueSummary {
  id: string;
  name: string;
  slug: string;
  city: string;
  area: string | null;
  sports: string[];
  /** Amenity keys (see AMENITY_OPTIONS); empty when the venue lists none. */
  amenities: string[];
  photo_urls: string[];
  status: VenueStatus;
  average_rating: number | null;
  /** Section 32 Part 6: number of visible reviews. */
  review_count: number;
  distance_meters: number | null;
  /** Lowest starting price (PKR per slot) among the venue's active courts (of the requested sport when filtered); null if none priced. */
  min_price: number | null;
  /** Optional until the list API sends them: the venue has at least one indoor / outdoor court. */
  has_indoor?: boolean;
  has_outdoor?: boolean;
  /** Free 30-minute slots left today across the venue's courts; null when it can't be worked out. */
  today_free_slots?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Shape returned by GET /venues/:id, /venues/by-slug/:slug — VenueOut.
 * Note: latitude/longitude are OPTIONAL here: the backend now echoes the public venue point on the read shape (null if missing),
 * older API builds omit them. (Create/update still accept them as input.)
 */
export interface Venue {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string;
  city: string;
  area: string | null;
  phone: string | null;
  whatsapp: string | null;
  sports: string[];
  amenities: string[] | null;
  photo_urls: string[];
  /** Section 32 Part 6: same order as photo_urls; the owner UI reorders/deletes by key. */
  photo_keys: string[];
  status: VenueStatus;
  rejection_reason: string | null;
  auto_approve_enabled: boolean;
  auto_approve_min_bookings: number;
  /** Section 32 Part 4: ONE cancellation policy per venue (reverses Section 31's per-court policy). Can a player
   * cancel a booking they've already paid for, and if so how many hours before the start it stops being allowed
   * (null = any time before the start). */
  cancellation_allowed: boolean;
  cancellation_cutoff_hours: number | null;
  /** Section 32 Part 4b: how many days ahead a player may book at this venue (1-365, default 90). An owner's
   * walk-in is not limited by it. */
  booking_horizon_days: number;
  created_at: string;
  courts: Court[];
  average_rating: number | null;
  /** Section 32 Part 6: number of visible reviews. */
  review_count: number;
  distance_meters: number | null;
  /** Populated only when the requester is this venue's owner or an admin. */
  bank_details: BankDetails | null;
  /** Section 32 Part 9: a per-venue token meant to be printed/posted physically at the
   * venue entrance -- a player scans it (POST /bookings/:id/checkin/self) to check
   * themselves in. Populated only when the requester is this venue's owner or an admin,
   * same visibility rule as bank_details. */
  checkin_qr_token: string | null;
  /** Only populated by GET /venues/by-slug/:slug */
  available_slots_today?: number | null;
  /** Public venue coordinates (null if missing; absent on older API builds). */
  latitude?: number | null;
  longitude?: number | null;
  /** audit 2026-10-28 item 9: what the venue still needs before it can go live (owner + admin views only). */
  missing_for_approval?: VenueMissingItem[] | null;
  /** audit 2026-10-28 item 15: settings still running on a hidden default; the owner confirms them by saving. */
  unconfirmed_settings?: VenueMissingItem[] | null;
  /** audit 2026-10-28 Phase 2 item 2: why players cannot see the venue now ("cnic" = the CNIC gate is on and the owner's CNIC
   * is not approved); null = they can. Owner + admin views only. */
  player_hidden_reason?: "cnic" | "not_approved" | "inactive" | null;
}

/** One gap that stops a venue going live (backend app/services/venue_completeness.py). */
export interface VenueMissingItem {
  code: "court" | "schedule" | "pricing" | "bank_details" | "photo" | "address" | "location" | "sports" | string;
  court: string | null;
}

export interface VenueListResponse {
  venues: VenueSummary[];
  total: number;
  page: number;
}

export interface CreateVenueInput {
  name: string;
  description?: string;
  address: string;
  city: string;
  area?: string;
  latitude: number;
  longitude: number;
  phone?: string;
  whatsapp?: string;
  sports: string[];
  amenities?: string[];
  bank_details?: BankDetails;
  cancellation_allowed?: boolean;
  cancellation_cutoff_hours?: number | null;
}
