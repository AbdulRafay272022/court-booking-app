export type UserRole = "player" | "owner" | "admin";

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
