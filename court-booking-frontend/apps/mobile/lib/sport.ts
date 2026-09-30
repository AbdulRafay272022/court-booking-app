import { SPORT_OPTIONS } from "@court-booking/types";

/** Case-insensitive, whitespace-tolerant sport equality ("padel" == "Padel", "football (full-field)" == "Football (full-field)"). */
export function sameSport(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Find the entry in `sports` that matches `wanted` ignoring case. Returns the entry with the venue's own casing. */
export function findSport(sports: readonly string[], wanted: string | null | undefined): string | undefined {
  if (!wanted) return undefined;
  return sports.find((s) => sameSport(s, wanted));
}

/** Expo Router hands route params back already URL-decoded on native, but on web a value with spaces/parentheses can come back
 * still percent-encoded (or double-encoded). Decode defensively; never throw on a stray "%". */
export function decodeSportParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  let out = value;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out.trim() || undefined;
}

/** Canonical spelling of a sport from the shared list ("padel" -> "Padel"); unknown values are returned unchanged. */
export function canonicalSport(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return findSport(SPORT_OPTIONS, raw) ?? raw;
}
