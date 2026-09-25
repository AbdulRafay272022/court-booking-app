// Section 32 Part 12 -- owner staff/manager accounts with per-feature permissions.

export type StaffPermissionKey =
  | "approve_payments"
  | "record_payments"
  | "check_in"
  | "walkin"
  | "cancel_booking"
  | "edit_court_settings"
  | "manage_photos"
  | "respond_reviews"
  | "mark_refunds"
  | "view_ledger"
  | "view_growth";

/** One grantable permission for the owner's staff-permissions screen. `available`
 * is false when the permission's global feature flag is off (greyed out). */
export interface StaffPermissionCatalogItem {
  key: string;
  label: string;
  flag_required: string | null;
  available: boolean;
}

export interface StaffMember {
  id: string;
  venue_id: string;
  venue_name: string;
  staff_user_id: string;
  name: string | null;
  phone: string;
  is_active: boolean;
  permissions: string[];
  created_at: string;
}

export interface StaffCreateInput {
  venue_id: string;
  name: string;
  phone: string;
  password: string;
  permissions: string[];
}
