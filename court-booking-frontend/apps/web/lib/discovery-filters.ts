import { AMENITY_OPTIONS } from "@court-booking/types";
import type { ListVenuesParams } from "@court-booking/api-client";
import { canonicalSport } from "./format";

/** The discovery filters, as they live in the /search URL (so a search is shareable and back-button friendly). */
export interface DiscoveryFilters {
  sport?: string;
  area?: string;
  lat?: number;
  lng?: number;
  minPrice?: number;
  maxPrice?: number;
  /** true = indoor only, false = outdoor only, undefined = either */
  indoor?: boolean;
  amenities: string[];
  date?: string;
  startTime?: string;
  durationMinutes?: number;
  sort?: "distance" | "price";
}

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function get(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Read filters from URL params, ignoring anything malformed. Sport is matched case-insensitively and normalised to
 * its canonical spelling ("football (full-field)" -> "Football (full-field)"). */
export function parseFilters(raw: RawParams): DiscoveryFilters {
  const known = new Set<string>(AMENITY_OPTIONS.map((a) => a.key));
  const date = get(raw, "date");
  const start = get(raw, "start_time");
  const sort = get(raw, "sort");
  const indoor = get(raw, "indoor");
  const lat = num(get(raw, "lat"));
  const lng = num(get(raw, "lng"));
  return {
    sport: canonicalSport(get(raw, "sport")),
    area: get(raw, "area")?.trim() || undefined,
    lat: lat !== undefined && lng !== undefined ? lat : undefined,
    lng: lat !== undefined && lng !== undefined ? lng : undefined,
    minPrice: num(get(raw, "min_price")),
    maxPrice: num(get(raw, "max_price")),
    indoor: indoor === "true" ? true : indoor === "false" ? false : undefined,
    amenities: (get(raw, "amenities") ?? "").split(",").map((a) => a.trim().toLowerCase()).filter((a) => known.has(a)),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    startTime: date && start && /^\d{2}:\d{2}$/.test(start) ? start : undefined,
    durationMinutes: start ? num(get(raw, "duration_minutes")) : undefined,
    sort: sort === "price" || (sort === "distance" && lat !== undefined && lng !== undefined) ? sort : undefined,
  };
}

/** Filters -> the /search query string (city is carried separately). */
export function filtersToParams(f: DiscoveryFilters, city?: string): URLSearchParams {
  const p = new URLSearchParams();
  if (city) p.set("city", city);
  if (f.sport) p.set("sport", f.sport);
  if (f.area) p.set("area", f.area);
  if (f.lat !== undefined && f.lng !== undefined) {
    p.set("lat", String(f.lat));
    p.set("lng", String(f.lng));
  }
  if (f.minPrice !== undefined) p.set("min_price", String(f.minPrice));
  if (f.maxPrice !== undefined) p.set("max_price", String(f.maxPrice));
  if (f.indoor !== undefined) p.set("indoor", String(f.indoor));
  if (f.amenities.length > 0) p.set("amenities", f.amenities.join(","));
  if (f.date) p.set("date", f.date);
  if (f.date && f.startTime) p.set("start_time", f.startTime);
  if (f.startTime && f.durationMinutes) p.set("duration_minutes", String(f.durationMinutes));
  if (f.sort) p.set("sort", f.sort);
  return p;
}

/** Filters -> the GET /venues params (see ListVenuesParams). */
export function filtersToApiParams(f: DiscoveryFilters): ListVenuesParams {
  return {
    sport: f.sport,
    area: f.area,
    lat: f.lat,
    lng: f.lng,
    radius_km: f.lat !== undefined ? 15 : undefined,
    min_price: f.minPrice,
    max_price: f.maxPrice,
    indoor: f.indoor,
    amenities: f.amenities.length > 0 ? f.amenities.join(",") : undefined,
    date: f.date,
    start_time: f.startTime,
    duration_minutes: f.durationMinutes,
    sort: f.sort,
  };
}

/** Number of narrowing filters in effect (the "Clear all" button and the empty state key off this). */
export function activeFilterCount(f: DiscoveryFilters): number {
  return (
    (f.sport ? 1 : 0) +
    (f.area ? 1 : 0) +
    (f.lat !== undefined ? 1 : 0) +
    (f.minPrice !== undefined || f.maxPrice !== undefined ? 1 : 0) +
    (f.indoor !== undefined ? 1 : 0) +
    f.amenities.length +
    (f.date ? 1 : 0)
  );
}
