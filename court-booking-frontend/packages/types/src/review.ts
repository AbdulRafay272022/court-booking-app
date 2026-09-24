export interface Review {
  id: string;
  booking_id: string;
  venue_id: string;
  player_id: string;
  /** Section 32 Part 6: only the player's first name is shown publicly (privacy). */
  player_first_name: string | null;
  rating: number;
  comment: string | null;
  owner_reply: string | null;
  owner_replied_at: string | null;
  /** Section 32 Part 6: admin can hide an abusive review. */
  is_hidden: boolean;
  created_at: string;
  /** Section 32 Part 6: set when the player edits within the 7-day window. */
  updated_at: string | null;
}

export interface CreateReviewInput {
  booking_id: string;
  rating: number;
  comment?: string;
}

export interface UpdateReviewInput {
  rating: number;
  comment?: string;
}
