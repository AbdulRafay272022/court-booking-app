export interface Review {
  id: string;
  booking_id: string;
  venue_id: string;
  player_id: string;
  rating: number;
  comment: string | null;
  owner_reply: string | null;
  owner_replied_at: string | null;
  created_at: string;
}

export interface CreateReviewInput {
  booking_id: string;
  rating: number;
  comment?: string;
}
