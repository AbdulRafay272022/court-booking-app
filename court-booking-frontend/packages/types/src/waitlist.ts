export interface WaitlistJoinInput {
  court_id: string;
  slot_starts_at: string;
}

export interface WaitlistJoinOut {
  position: number;
}

export interface WaitlistEntry {
  id: string;
  court_id: string;
  court_name: string;
  venue_id: string;
  venue_name: string;
  player_id: string;
  slot_starts_at: string;
  position: number;
  notified_at: string | null;
  is_active: boolean;
  created_at: string;
}
