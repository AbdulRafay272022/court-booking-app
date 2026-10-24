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

/** Every amenity key the venue card knows an icon for: the picker's AMENITY_OPTIONS plus the frontend-only keys from the
 * Floodlight venue-card spec. AMENITY_OPTIONS (what owners can tick) is deliberately unchanged; a screen agent may adopt
 * this list in the pickers later. */
export const AMENITY_KEYS_ALL = [
  "floodlights",
  "parking",
  "washrooms",
  "changing_room",
  "drinking_water",
  "cafe",
  "indoor",
  "seating",
  "wifi",
  "equipment_rent",
  "prayer_area",
] as const;

const AMENITY_ALIASES: Record<string, string> = {
  washroom: "washrooms",
  toilet: "washrooms",
  wi_fi: "wifi",
  prayer_room: "prayer_area",
  water: "drinking_water",
  floodlight: "floodlights",
  lights: "floodlights",
};

/** Normalise a stored amenity string to a key: "Changing Room" / "changing-room" -> "changing_room", "washroom" -> "washrooms". */
export function amenityKey(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return AMENITY_ALIASES[k] ?? k;
}

export function amenityLabel(key: string, langArg: TextLang | number = "en"): string {
  // a number (the index, when used as `.map(amenityLabel)`) means English
  const lang: TextLang = langArg === "ru" ? "ru" : "en";
  const known = AMENITY_LABELS[lang][key] ?? AMENITY_OPTIONS.find((a) => a.key === key)?.label;
  if (known) return known;
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
