import { amenityKey, amenityLabel } from "@court-booking/types";

/**
 * Amenity key -> icon id + label for the venue card chip / sheet / popover. Icon ids are platform-neutral: mobile maps them
 * to lucide-react-native components, web to inline lucide paths. An unknown key gets the "check" icon and its text as given.
 */
export type AmenityIcon =
  | "parking"
  | "washroom"
  | "changing"
  | "floodlight"
  | "water"
  | "cafe"
  | "indoor"
  | "seating"
  | "wifi"
  | "equipment"
  | "prayer"
  | "check";

const ICONS: Record<string, AmenityIcon> = {
  parking: "parking",
  washrooms: "washroom",
  changing_room: "changing",
  floodlights: "floodlight",
  drinking_water: "water",
  cafe: "cafe",
  indoor: "indoor",
  seating: "seating",
  wifi: "wifi",
  equipment_rent: "equipment",
  prayer_area: "prayer",
};

export interface AmenityItem {
  key: string;
  label: string;
  icon: AmenityIcon;
  known: boolean;
}

export function amenityItem(raw: string, lang: "ru" | "en" = "ru"): AmenityItem {
  const key = amenityKey(raw);
  const icon = ICONS[key];
  if (icon) return { key, label: amenityLabel(key, lang), icon, known: true };
  return { key, label: raw.trim(), icon: "check", known: false };
}

/** Deduplicated (by normalised key), empty strings dropped, owner order kept. */
export function amenityItems(raw: readonly string[] | null | undefined, lang: "ru" | "en" = "ru"): AmenityItem[] {
  const seen = new Set<string>();
  const out: AmenityItem[] = [];
  for (const r of raw ?? []) {
    if (!r || !r.trim()) continue;
    const item = amenityItem(r, lang);
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

/** "Amenities, 6 cheezein. List dekhein" (chip accessibility label). */
export function amenitiesChipLabel(count: number, lang: "ru" | "en" = "ru"): string {
  return lang === "ru" ? `Amenities, ${count} cheezein. List dekhein` : `Amenities, ${count} items. Show list`;
}
