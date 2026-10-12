/**
 * Map links and share text for a venue's location. Public data only: the venue name, its area and the map point of the venue
 * itself. Nothing about the visitor (no account, no phone, no booking) ever goes into a shared link or text.
 */
export interface Coords {
  lat: number;
  lng: number;
}

/** The venue's map point, or null when it has none (missing, not a number, or outside the valid range). */
export function coordsOf(v: { latitude?: number | null; longitude?: number | null }): Coords | null {
  const { latitude: lat, longitude: lng } = v;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Google Maps directions to the venue (opens the Maps app on a phone). */
export function directionsUrl(c: Coords): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
}

/** Google Maps showing the venue's pin; this is the link people share. */
export function pointUrl(c: Coords): string {
  return `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
}

/** "Test Arena 1, North Nazimabad": the venue name and its area (city when there is no area). */
export function shareText(name: string, area: string | null | undefined, city?: string | null): string {
  const place = (area ?? "").trim() || (city ?? "").trim();
  return place ? `${name}, ${place}` : name;
}

/** WhatsApp "send to a chat" link carrying the text and the map link. */
export function whatsappShareUrl(text: string, mapUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${mapUrl}`)}`;
}
