export type UserRole = "player" | "owner" | "admin";

export interface User {
  id: string;
  phone: string;
  name: string | null;
  role: UserRole;
  avatar_url: string | null;
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
  is_new_user: boolean;
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
