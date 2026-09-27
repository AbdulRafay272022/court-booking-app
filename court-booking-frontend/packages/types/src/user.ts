export type UserRole = "player" | "owner" | "admin" | "staff";

/** Roles selectable at signup. Admin is never self-assignable. */
export type SignupRole = "player" | "owner";

export type Gender = "male" | "female" | "other";

/** Fixed pilot city list -- keep in sync with app/models/user.py's City enum. */
export type City =
  | "karachi"
  | "lahore"
  | "islamabad"
  | "rawalpindi"
  | "faisalabad"
  | "multan"
  | "gujranwala"
  | "peshawar"
  | "kohat"
  | "hyderabad";

export const CITY_OPTIONS: { value: City; label: string }[] = [
  { value: "karachi", label: "Karachi (Sindh)" },
  { value: "lahore", label: "Lahore (Punjab)" },
  { value: "islamabad", label: "Islamabad (Punjab)" },
  { value: "rawalpindi", label: "Rawalpindi (Punjab)" },
  { value: "faisalabad", label: "Faisalabad (Punjab)" },
  { value: "multan", label: "Multan (Punjab)" },
  { value: "gujranwala", label: "Gujranwala (Punjab)" },
  { value: "peshawar", label: "Peshawar (KPK)" },
  { value: "kohat", label: "Kohat (KPK)" },
  { value: "hyderabad", label: "Hyderabad (Sindh)" },
];

/** Approximate city-centre coordinates for each pilot city. Used as a fallback pin when the
 * owner's browser refuses geolocation and the wizard's "Next" would otherwise dead-end (QA
 * signup-venue round item 2). The player search endpoint still filters by geo radius, so
 * these need to be at least in the right city -- centroid of the built-up area is fine. Owner
 * refines it later from Venue Settings' map pin (added post-approval; see item 3). */
export const CITY_CENTRES: Record<City, { latitude: number; longitude: number }> = {
  karachi:     { latitude: 24.8607, longitude: 67.0011 },
  lahore:      { latitude: 31.5204, longitude: 74.3587 },
  islamabad:   { latitude: 33.6844, longitude: 73.0479 },
  rawalpindi:  { latitude: 33.5651, longitude: 73.0169 },
  faisalabad:  { latitude: 31.4504, longitude: 73.1350 },
  multan:      { latitude: 30.1575, longitude: 71.5249 },
  gujranwala:  { latitude: 32.1877, longitude: 74.1945 },
  peshawar:    { latitude: 34.0151, longitude: 71.5249 },
  kohat:       { latitude: 33.5871, longitude: 71.4432 },
  hyderabad:   { latitude: 25.3960, longitude: 68.3578 },
};

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

/** Minimum password length (backend enforces the same 8). No complexity rules by design. */
export const PASSWORD_MIN_LENGTH = 8;

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  city: City | null;
  gender: Gender | null;
  role: UserRole;
  avatar_url: string | null;
  /** When the phone last passed an OTP; the 365-day trust window is measured from this. */
  phone_verified_at: string | null;
  reliability_score: number;
  total_bookings: number;
  total_no_shows: number;
  total_rejections: number;
  created_at: string;
}

export interface Session {
  device_id: string | null;
  device_name: string | null;
  platform: string | null;
  last_active_at: string;
  expires_at: string;
}

export interface MeOut {
  user: User;
  session: Session;
}

export interface TokenResponse {
  token: string;
  expires_at: string;
  user: User;
}

export interface RefreshResponse {
  token: string;
  expires_at: string;
}

export interface NotificationLogEntry {
  id: string;
  channel: "push" | "whatsapp" | "sms";
  event_type: string;
  status: string;
  cost_category: string | null;
  reference_id: string | null;
  created_at: string;
}
