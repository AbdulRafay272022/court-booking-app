export interface ScheduleTemplate {
  id: string;
  day_of_week: number; // 0-6
  open_time: string; // "HH:MM:SS"
  close_time: string;
  /** The day belongs to the day it OPENS; true when the court is still open past midnight (close_time <= open_time). */
  closes_next_day: boolean;
  is_active: boolean;
}

export interface PricingRule {
  id: string;
  name: string;
  priority: number;
  day_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  price_per_slot: number;
  floodlight_surcharge: number;
  advance_percentage: number;
  is_active: boolean;
}

export interface Blackout {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null; // maintenance | weather | private_event | other
}

export type CourtAdvanceType = "fixed" | "percent";

export interface Court {
  id: string;
  venue_id: string;
  name: string;
  sport: string;
  slot_minutes: number; // 30, 60, 90 or 120 (SLOT_MINUTES_OPTIONS); default 60
  surface_type: string | null;
  is_indoor: boolean;
  has_floodlights: boolean;
  capacity: number | null;
  /** DEPRECATED read-only mirror of the VENUE's cancellation policy, kept for app builds from before Section 32
   * Part 4. New code reads `venue.cancellation_allowed` / `venue.cancellation_cutoff_hours` instead. */
  cancellation_allowed: boolean;
  cancellation_cutoff_hours: number | null;
  /** Section 32 Part 5: the owner's advance rule for this court -- a fixed PKR amount or a percentage of
   * the total, with an optional minimum floor. Null advance_type falls back to the matched pricing rule's
   * own advance_percentage (the pre-Part-5 behavior). */
  advance_type: CourtAdvanceType | null;
  advance_value: number | null;
  advance_minimum: number | null;
  /** @deprecated use photo_urls */
  photo_url: string | null;
  /** Section 32 Part 6: court photo gallery (public URLs), cover first. */
  photo_urls: string[];
  /** Section 32 Part 6: same order as photo_urls; owner UI reorders/deletes by key. */
  photo_keys: string[];
  sort_order: number;
  is_active: boolean;
  schedule_templates: ScheduleTemplate[];
  pricing_rules: PricingRule[];
}

export interface CreateCourtInput {
  name: string;
  sport: string;
  slot_minutes?: number;
  surface_type?: string;
  is_indoor?: boolean;
  has_floodlights?: boolean;
  capacity?: number;
  // Section 32 Part 5: null advance_type falls back to the pricing rule's own advance_percentage.
  advance_type?: CourtAdvanceType | null;
  advance_value?: number | null;
  advance_minimum?: number | null;
}

export interface ScheduleTemplateInput {
  day_of_week: number;
  open_time: string;
  close_time: string;
}

export interface PricingRuleInput {
  name: string;
  priority?: number;
  day_of_week?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  price_per_slot: number;
  floodlight_surcharge?: number;
  advance_percentage?: number;
}
