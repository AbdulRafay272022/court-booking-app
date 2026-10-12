/**
 * Links into the filtered Search page. THE one place that knows the /search query-param names (they are parsed by `parseFilters` in
 * lib/discovery-filters.ts, and `city` is read by the Search page itself). Used by the venue breadcrumb, sport/area/Indoor-Outdoor tags,
 * venue cards and My bookings, so a label that looks like a filter always leads to that filter.
 */
export interface SearchLinkTarget {
  city?: string | null;
  area?: string | null;
  sport?: string | null;
  /** true = indoor only, false = outdoor only */
  indoor?: boolean | null;
}

export function searchHref(target: SearchLinkTarget = {}): string {
  const p = new URLSearchParams();
  if (target.city) p.set("city", target.city);
  if (target.area) p.set("area", target.area);
  if (target.sport) p.set("sport", target.sport);
  if (target.indoor === true || target.indoor === false) p.set("indoor", String(target.indoor));
  const qs = p.toString();
  return qs ? `/search?${qs}` : "/search";
}
