import { AMENITY_OPTIONS, amenityLabel, formatDateString, formatDuration, formatTime24As12, pktDateString } from "@court-booking/types";
import type { ListVenuesParams } from "@court-booking/api-client";

import { canonicalSport, decodeSportParam } from "./sport";

/** The player discovery filters. They live in the ROUTE PARAMS of the search screen (so going back from a venue, or a
 * reload, keeps them) -- these helpers convert between that flat string map, a typed object, and the API query. */
export interface VenueFilters {
  sport?: string;
  area?: string;
  /** "Use my current location": lat/lng below are set and results sort by distance. */
  near: boolean;
  lat?: number;
  lng?: number;
  /** PKR strings as typed (validated on use). */
  minPrice: string;
  maxPrice: string;
  indoor?: "indoor" | "outdoor";
  amenities: string[];
  /** "YYYY-MM-DD" Pakistan date. */
  date?: string;
  /** "HH:MM" 24-hour Pakistan time. */
  time?: string;
  duration?: number;
}

export const EMPTY_FILTERS: VenueFilters = { near: false, minPrice: "", maxPrice: "", amenities: [] };

/** How many days ahead the date filter offers. 90 is the default per-venue booking horizon; a venue with a shorter one simply
 * shows no free slot beyond it. */
export const FILTER_DATE_DAYS = 90;
export const DURATION_OPTIONS = [60, 90, 120] as const;
/** Start times offered (24h "HH:MM"), 6 AM to 11 PM on the hour. */
export const START_TIME_OPTIONS = Array.from({ length: 18 }, (_, i) => `${String(i + 6).padStart(2, "0")}:00`);

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function parseFilters(raw: Raw): VenueFilters {
  const lat = num(one(raw.lat));
  const lng = num(one(raw.lng));
  const near = one(raw.near) === "1" && lat !== undefined && lng !== undefined;
  const indoorRaw = one(raw.indoor);
  const keys = new Set<string>(AMENITY_OPTIONS.map((a) => a.key));
  return {
    sport: canonicalSport(decodeSportParam(raw.sport)),
    area: one(raw.area)?.trim() || undefined,
    near,
    lat: near ? lat : undefined,
    lng: near ? lng : undefined,
    minPrice: one(raw.min) ?? "",
    maxPrice: one(raw.max) ?? "",
    indoor: indoorRaw === "1" ? "indoor" : indoorRaw === "0" ? "outdoor" : undefined,
    amenities: (one(raw.amen) ?? "").split(",").filter((k) => keys.has(k)),
    date: /^\d{4}-\d{2}-\d{2}$/.test(one(raw.date) ?? "") ? one(raw.date) : undefined,
    time: /^\d{2}:\d{2}$/.test(one(raw.time) ?? "") ? one(raw.time) : undefined,
    duration: num(one(raw.dur)),
  };
}

/** Params for router.setParams / router.push. `undefined` values REMOVE a param. */
export function filtersToParams(f: VenueFilters): Record<string, string | undefined> {
  return {
    sport: f.sport,
    area: f.area,
    near: f.near ? "1" : undefined,
    lat: f.near && f.lat !== undefined ? String(f.lat) : undefined,
    lng: f.near && f.lng !== undefined ? String(f.lng) : undefined,
    min: f.minPrice.trim() || undefined,
    max: f.maxPrice.trim() || undefined,
    indoor: f.indoor === "indoor" ? "1" : f.indoor === "outdoor" ? "0" : undefined,
    amen: f.amenities.length ? f.amenities.join(",") : undefined,
    date: f.date,
    time: f.date && f.time ? f.time : undefined,
    dur: f.date && f.time && f.duration ? String(f.duration) : undefined,
  };
}

/** Problems with the typed values, shown in the sheet (Apply is blocked while any exist). */
export function filterProblems(f: VenueFilters): { price?: string; date?: string } {
  const out: { price?: string; date?: string } = {};
  const min = f.minPrice.trim() === "" ? undefined : Number(f.minPrice);
  const max = f.maxPrice.trim() === "" ? undefined : Number(f.maxPrice);
  if ((min !== undefined && (!Number.isFinite(min) || min < 0)) || (max !== undefined && (!Number.isFinite(max) || max < 0))) {
    out.price = "Enter prices as plain numbers in PKR.";
  } else if (min !== undefined && max !== undefined && min > max) {
    out.price = "Minimum price is higher than the maximum.";
  }
  if (f.time && !f.date) out.date = "Pick a date to filter by time.";
  return out;
}

export function filtersToQuery(f: VenueFilters, defaultCity: string): ListVenuesParams {
  const min = f.minPrice.trim() ? Number(f.minPrice) : undefined;
  const max = f.maxPrice.trim() ? Number(f.maxPrice) : undefined;
  const withTime = !!(f.date && f.time);
  return {
    sport: f.sport,
    area: f.area,
    // city applies unless the player is searching around their own position
    city: f.near ? undefined : defaultCity,
    lat: f.near ? f.lat : undefined,
    lng: f.near ? f.lng : undefined,
    radius_km: f.near ? 15 : undefined,
    sort: f.near ? "distance" : undefined,
    min_price: min !== undefined && Number.isFinite(min) ? min : undefined,
    max_price: max !== undefined && Number.isFinite(max) ? max : undefined,
    indoor: f.indoor === undefined ? undefined : f.indoor === "indoor",
    amenities: f.amenities.length ? f.amenities.join(",") : undefined,
    // The backend needs date AND start_time together; a date alone is not an availability filter.
    date: withTime ? f.date : undefined,
    start_time: withTime ? f.time : undefined,
    duration_minutes: withTime ? f.duration : undefined,
    per_page: 30,
  };
}

export interface FilterChip {
  key: string;
  label: string;
  /** What to change on the filters to remove this chip. */
  clear: Partial<VenueFilters>;
}

export function activeFilterChips(f: VenueFilters, placeLabel?: string): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.sport) chips.push({ key: "sport", label: f.sport, clear: { sport: undefined } });
  if (f.near) chips.push({ key: "near", label: placeLabel ? `Near ${placeLabel}` : "Near me", clear: { near: false, lat: undefined, lng: undefined } });
  if (f.area) chips.push({ key: "area", label: f.area, clear: { area: undefined } });
  if (f.minPrice.trim() || f.maxPrice.trim()) {
    const label =
      f.minPrice.trim() && f.maxPrice.trim()
        ? `PKR ${f.minPrice.trim()} - ${f.maxPrice.trim()}`
        : f.minPrice.trim()
          ? `From PKR ${f.minPrice.trim()}`
          : `Up to PKR ${f.maxPrice.trim()}`;
    chips.push({ key: "price", label, clear: { minPrice: "", maxPrice: "" } });
  }
  if (f.indoor) chips.push({ key: "indoor", label: f.indoor === "indoor" ? "Indoor" : "Outdoor", clear: { indoor: undefined } });
  for (const a of f.amenities) chips.push({ key: `amen-${a}`, label: amenityLabel(a), clear: { amenities: f.amenities.filter((x) => x !== a) } });
  if (f.date && f.time) {
    const today = pktDateString();
    const day = f.date === today ? "Today" : formatDateString(f.date);
    const dur = f.duration ? ` · ${formatDuration(f.duration)}` : "";
    chips.push({ key: "when", label: `${day}, ${formatTime24As12(f.time)}${dur}`, clear: { date: undefined, time: undefined, duration: undefined } });
  } else if (f.date) {
    chips.push({ key: "date", label: formatDateString(f.date), clear: { date: undefined, time: undefined, duration: undefined } });
  }
  return chips;
}
