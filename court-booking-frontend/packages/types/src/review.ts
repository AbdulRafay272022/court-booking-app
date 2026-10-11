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

export interface ReviewStats {
  /** Visible reviews only (an admin's list also carries hidden ones, which never count). */
  count: number;
  /** Mean rating, or null with no reviews. */
  average: number | null;
  /** Reviews per star, index 0 = 5 stars ... index 4 = 1 star. */
  distribution: number[];
}

/** Average and per-star breakdown of a venue's visible reviews. The backend list is uncapped, so this is exact. */
export function reviewStats(reviews: Pick<Review, "rating" | "is_hidden">[]): ReviewStats {
  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const r of reviews) {
    if (r.is_hidden || !Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) continue;
    distribution[5 - r.rating] += 1;
    sum += r.rating;
    count += 1;
  }
  return { count, average: count ? sum / count : null, distribution };
}
