// Section 32 Part 12 -- admin global feature flags. Keys mirror the backend's
// FeatureFlagKey (app/models/feature_flag.py).
export type FeatureFlagKey =
  | "ocr_verification"
  | "qr_checkin"
  | "split_payments"
  | "refunds"
  | "ai_chat_booking"
  | "photos"
  | "reviews"
  | "growth_suggestions"
  | "push_notifications"
  | "auto_approve"
  | "waitlist"
  | "marketing_announcements"
  | "digest_reminders";

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  label: string;
  description: string | null;
  updated_at: string;
}

/** The on/off state of every flag (GET /feature-flags), for gating UI. */
export interface PublicFlags {
  flags: Record<string, boolean>;
}

/** A missing key is treated as ON (fail-open), matching the backend. */
export function isFeatureOn(flags: Record<string, boolean> | undefined, key: FeatureFlagKey): boolean {
  if (!flags) return true;
  return flags[key] !== false;
}
