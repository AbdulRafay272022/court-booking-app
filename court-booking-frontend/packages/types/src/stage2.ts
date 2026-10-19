/** Round 2 Stage 2 (docs/stage2-contract.md). Mirrors the backend schemas; every field is additive. */

export interface VenueTimerValues {
  hold_minutes: number | null;
  reminders_enabled: boolean | null;
  first_reminder_after_min: number | null;
  repeat_every_min: number | null;
  max_reminders: number | null;
  auto_cancel_enabled: boolean | null;
  auto_cancel_after_min: number | null;
}

export type VenueTimerEffective = { [K in keyof VenueTimerValues]: NonNullable<VenueTimerValues[K]> };

export interface VenueTimers {
  values: VenueTimerValues;
  defaults: VenueTimerEffective;
  effective: VenueTimerEffective;
}

/** null = these. Must equal backend app/services/venue_timers.py DEFAULTS (checked via fixtures/venue-timer-defaults.json). */
export const VENUE_TIMER_DEFAULTS: VenueTimerEffective = {
  hold_minutes: 15,
  reminders_enabled: true,
  first_reminder_after_min: 10,
  repeat_every_min: 30,
  max_reminders: 5,
  auto_cancel_enabled: true,
  auto_cancel_after_min: 120,
};

export interface MyPermissions {
  role: "owner" | "staff" | "admin";
  venue_permissions: { venue_id: string; permissions: string[] }[];
}

export type IdentityStatus = "missing" | "submitted" | "verified";

export interface OwnerIdentity {
  status: IdentityStatus;
  masked: string | null;
  flags: string[];
}

export interface AdminIdentityRow {
  user_id: string;
  owner_name: string | null;
  phone_last4: string | null;
  status: IdentityStatus;
  masked: string | null;
  flags: string[];
  submitted_at: string | null;
}

export interface AdminIdentityPage {
  items: AdminIdentityRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminIdentityFull extends AdminIdentityRow {
  number: string;
  front_url: string;
  back_url: string;
  verified_at: string | null;
}

export interface WebPushConfig {
  enabled: boolean;
  public_key: string | null;
}
