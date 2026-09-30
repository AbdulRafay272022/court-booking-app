/** Single source of truth for the sport / facility types an owner can pick and a player can filter by.
 * Stored as free strings (Court.sport, Venue.sports) -- no DB enum -- so adding one is a code-only change. */
export const SPORT_OPTIONS = [
  "Padel",
  "Futsal",
  "Football (full-field)",
  "Ground",
  "Tennis",
  "Cricket",
  "Badminton",
] as const;

/** Amenity keys stored in Venue.amenities (lowercase, stable) with their display labels. */
export const AMENITY_OPTIONS = [
  { key: "floodlights", label: "Floodlights" },
  { key: "parking", label: "Parking" },
  { key: "washrooms", label: "Washrooms" },
  { key: "changing_room", label: "Changing room" },
] as const;

export function amenityLabel(key: string): string {
  return AMENITY_OPTIONS.find((a) => a.key === key)?.label ?? key.replace(/_/g, " ");
}
