/** GET /public/stats: platform-wide counts for the marketing home page. No personal data; cached server-side for 5 minutes. */
export interface PublicStats {
  /** Approved venues. */
  venues: number;
  /** Courts that belong to approved venues. */
  courts: number;
  /** Confirmed and completed bookings. */
  bookings: number;
  /** Registered players. */
  players: number;
}
