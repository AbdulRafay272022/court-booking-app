export interface ScheduleTemplate {
  id: string;
  day_of_week: number; // 0-6
  open_time: string; // "HH:MM:SS"
  close_time: string;
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
  photo_url: string | null;
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
