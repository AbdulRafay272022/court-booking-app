/**
 * "Back to results": remembers the Search URL (with its filters) a visitor opened a venue from, so the venue page can send them
 * back to exactly that list. The URL is the only state Search has, so remembering it IS remembering the filters.
 */
export const LAST_SEARCH_KEY = "khelo:last-search";
export const FALLBACK_SEARCH = "/search";

/** Accepts only a same-site Search path ("/search" or "/search?..."); anything else (another site, another page) is null. */
export function asSearchPath(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  if (!/^\/search(\?[^#]*)?(#.*)?$/.test(candidate)) return null;
  return candidate.replace(/#.*$/, "");
}

/** The JSON stored when a venue card is clicked on /search. */
export function encodeLastSearch(slug: string, searchPath: string): string {
  return JSON.stringify({ slug, href: searchPath });
}

/** The stored Search URL, only if it was stored for THIS venue (so an old visit to a different venue never leaks in). */
export function decodeLastSearch(raw: string | null, slug: string): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { slug?: unknown; href?: unknown };
    if (v.slug !== slug || typeof v.href !== "string") return null;
    return asSearchPath(v.href);
  } catch {
    return null;
  }
}

/** A same-origin document.referrer that is a Search page, as a path; null otherwise (other site, other page, empty, malformed). */
export function searchPathFromReferrer(referrer: string | null | undefined, origin: string): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (u.origin !== origin) return null;
    return asSearchPath(u.pathname + u.search);
  } catch {
    return null;
  }
}

/** Where "Back to results" goes: the Search URL stored for this venue, else a Search referrer, else plain /search. */
export function resolveBackHref(args: { stored: string | null; slug: string; referrer: string | null | undefined; origin: string }): string {
  return decodeLastSearch(args.stored, args.slug) ?? searchPathFromReferrer(args.referrer, args.origin) ?? FALLBACK_SEARCH;
}
