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
  slot_minutes: number; // 15-240, default 60
  surface_type: string | null;
  is_indoor: boolean;
  has_floodlights: boolean;
  capacity: number | null;
  // Section 29 Part C: per-court, not global -- some courts don't allow a player to cancel an
  // already-paid (booked) booking at all; others allow it up to cancellation_cutoff_hours
  // before start (null = no cutoff, cancellable any time before start).
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
  cancellation_allowed?: boolean;
  cancellation_cutoff_hours?: number | null;
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
