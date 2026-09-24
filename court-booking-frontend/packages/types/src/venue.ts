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
  photo_urls: string[];
  status: VenueStatus;
  average_rating: number | null;
  /** Section 32 Part 6: number of visible reviews. */
  review_count: number;
  distance_meters: number | null;
}

/**
 * Shape returned by GET /venues/:id, /venues/by-slug/:slug — VenueOut.
 * Note: latitude/longitude are write-only (accepted by create/update) and are
 * NOT echoed back on this read shape per the backend's actual VenueOut schema.
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
  /** Only populated by GET /venues/by-slug/:slug */
  available_slots_today?: number | null;
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
