import { AMENITY_LABELS, type TextLang } from "./locale-text";

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

export function amenityLabel(key: string, langArg: TextLang | number = "en"): string {
  // a number (the index, when used as `.map(amenityLabel)`) means English
  const lang: TextLang = langArg === "ru" ? "ru" : "en";
  const known = AMENITY_LABELS[lang][key] ?? AMENITY_OPTIONS.find((a) => a.key === key)?.label;
  if (known) return known;
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
