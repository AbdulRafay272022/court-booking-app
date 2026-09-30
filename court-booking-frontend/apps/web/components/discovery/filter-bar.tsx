"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AMENITY_OPTIONS, SPORT_OPTIONS, addDays, amenityLabel, formatDuration, formatTime24As12, pktDateString } from "@court-booking/types";
import { formatDayHeader } from "@/lib/format";
import { activeFilterCount, filtersToParams, parseFilters, type DiscoveryFilters } from "@/lib/discovery-filters";

/** Booking horizon offered by the date picker (the venue default; a venue may allow fewer days, the server decides). */
const HORIZON_DAYS = 90;
const START_TIMES = Array.from({ length: 36 }, (_, i) => {
  const mins = 6 * 60 + i * 30; // 6:00 AM ... 11:30 PM
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});
const DURATIONS = [60, 90, 120, 180];

const pill = (on: boolean) =>
  `px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
    on ? "bg-player-ink text-white border-player-ink" : "bg-player-surface text-player-ink-muted border-player-border"
  }`;
const control = "h-10 px-3 rounded-lg border border-player-border bg-player-surface text-[13.5px] text-player-ink outline-none focus:border-player-ink";

/**
 * Discovery filters for /search. ALL state lives in the URL query string (parseFilters / filtersToParams): every change
 * pushes a new URL, which makes a search shareable and the browser's back button undo a filter. The page (a server
 * component) reads the same params and fetches; this component only edits them.
 */
export function FilterBar({ areas, city, total }: { areas: string[]; city: string; total: number | null }) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const filters = parseFilters(search);
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // price boxes hold typed text until committed (Enter / leaving the box), so a half-typed number never fires a search
  const [minText, setMinText] = useState<string | null>(null);
  const [maxText, setMaxText] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const today = pktDateString();
  const lastDay = addDays(today, HORIZON_DAYS - 1);

  function apply(next: DiscoveryFilters) {
    const qs = filtersToParams(next, city).toString();
    startTransition(() => router.push(`/search?${qs}`, { scroll: false }));
  }
  const set = (patch: Partial<DiscoveryFilters>) => apply({ ...filters, ...patch });

  function commitPrice() {
    const lo = minText !== null ? (minText.trim() === "" ? undefined : Number(minText)) : filters.minPrice;
    const hi = maxText !== null ? (maxText.trim() === "" ? undefined : Number(maxText)) : filters.maxPrice;
    if ((lo !== undefined && (!Number.isFinite(lo) || lo < 0)) || (hi !== undefined && (!Number.isFinite(hi) || hi < 0))) {
      setPriceError("Enter prices as positive numbers.");
      return;
    }
    if (lo !== undefined && hi !== undefined && lo > hi) {
      setPriceError("The minimum price can't be higher than the maximum.");
      return;
    }
    setPriceError(null);
    setMinText(null);
    setMaxText(null);
    if (lo !== filters.minPrice || hi !== filters.maxPrice) set({ minPrice: lo, maxPrice: hi });
  }

  function useMyLocation() {
    setLocError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocError("This browser can't share a location. Pick an area instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        set({ lat: Number(pos.coords.latitude.toFixed(5)), lng: Number(pos.coords.longitude.toFixed(5)), sort: "distance" });
      },
      (err) => {
        setLocating(false);
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in your browser, or pick an area instead."
            : "Couldn't get your location right now. Pick an area instead, or try again.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.sport) chips.push({ key: "sport", label: filters.sport, clear: () => set({ sport: undefined }) });
  if (filters.area) chips.push({ key: "area", label: filters.area, clear: () => set({ area: undefined }) });
  if (filters.lat !== undefined)
    chips.push({ key: "near", label: "Near me", clear: () => set({ lat: undefined, lng: undefined, sort: filters.sort === "distance" ? undefined : filters.sort }) });
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const label =
      filters.minPrice !== undefined && filters.maxPrice !== undefined
        ? `PKR ${filters.minPrice.toLocaleString("en-US")} – ${filters.maxPrice.toLocaleString("en-US")}`
        : filters.minPrice !== undefined
          ? `From PKR ${filters.minPrice.toLocaleString("en-US")}`
          : `Up to PKR ${filters.maxPrice!.toLocaleString("en-US")}`;
    chips.push({ key: "price", label, clear: () => set({ minPrice: undefined, maxPrice: undefined }) });
  }
  if (filters.indoor !== undefined) chips.push({ key: "indoor", label: filters.indoor ? "Indoor" : "Outdoor", clear: () => set({ indoor: undefined }) });
  for (const a of filters.amenities) chips.push({ key: `am-${a}`, label: amenityLabel(a), clear: () => set({ amenities: filters.amenities.filter((x) => x !== a) }) });
  if (filters.date) {
    const when = `${formatDayHeader(filters.date)}${filters.startTime ? `, ${formatTime24As12(filters.startTime)}` : ""}${
      filters.startTime && filters.durationMinutes ? ` · ${formatDuration(filters.durationMinutes)}` : ""
    }`;
    chips.push({ key: "when", label: when, clear: () => set({ date: undefined, startTime: undefined, durationMinutes: undefined }) });
  }
  const count = activeFilterCount(filters);

  return (
    <section aria-label="Filters" className="flex flex-col gap-4" data-testid="filter-bar" aria-busy={pending}>
      {/* sport */}
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Sport">
        <button type="button" className={pill(!filters.sport)} aria-pressed={!filters.sport} onClick={() => set({ sport: undefined })}>
          All sports
        </button>
        {SPORT_OPTIONS.map((s) => (
          <button key={s} type="button" className={pill(filters.sport?.toLowerCase() === s.toLowerCase())} aria-pressed={filters.sport?.toLowerCase() === s.toLowerCase()} onClick={() => set({ sport: s })}>
            {s}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* area + near me */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-area" className="text-[12px] font-bold tracking-wide text-player-ink-faint">AREA</label>
          <select id="f-area" className={control} value={filters.area ?? ""} onChange={(e) => set({ area: e.target.value || undefined })}>
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
            {filters.area && !areas.includes(filters.area) ? <option value={filters.area}>{filters.area}</option> : null}
          </select>
          <button type="button" onClick={useMyLocation} disabled={locating} className="self-start text-[13px] font-semibold text-player-accent-hover underline disabled:opacity-50">
            {locating ? "Locating…" : filters.lat !== undefined ? "Update my location" : "Use my current location"}
          </button>
          {locError ? <p role="alert" className="text-[12.5px] font-medium text-player-danger" data-testid="location-error">{locError}</p> : null}
        </div>

        {/* price */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold tracking-wide text-player-ink-faint">PRICE PER SLOT (PKR)</span>
          <div className="flex items-center gap-2">
            <input
              aria-label="Minimum price"
              inputMode="numeric"
              placeholder="Min"
              className={`${control} w-full font-mono`}
              value={minText ?? (filters.minPrice !== undefined ? String(filters.minPrice) : "")}
              onChange={(e) => setMinText(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={commitPrice}
              onKeyDown={(e) => e.key === "Enter" && commitPrice()}
            />
            <span className="text-player-ink-faint">–</span>
            <input
              aria-label="Maximum price"
              inputMode="numeric"
              placeholder="Max"
              className={`${control} w-full font-mono`}
              value={maxText ?? (filters.maxPrice !== undefined ? String(filters.maxPrice) : "")}
              onChange={(e) => setMaxText(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={commitPrice}
              onKeyDown={(e) => e.key === "Enter" && commitPrice()}
            />
          </div>
          {priceError ? <p role="alert" className="text-[12.5px] font-medium text-player-danger">{priceError}</p> : null}
        </div>

        {/* indoor / outdoor */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold tracking-wide text-player-ink-faint">SETTING</span>
          <div className="flex gap-2" role="group" aria-label="Indoor or outdoor">
            {(
              [
                ["Any", undefined],
                ["Indoor", true],
                ["Outdoor", false],
              ] as const
            ).map(([label, value]) => (
              <button key={label} type="button" className={pill(filters.indoor === value)} aria-pressed={filters.indoor === value} onClick={() => set({ indoor: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* sort */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-sort" className="text-[12px] font-bold tracking-wide text-player-ink-faint">SORT BY</label>
          <select id="f-sort" className={control} value={filters.sort ?? ""} onChange={(e) => set({ sort: (e.target.value || undefined) as DiscoveryFilters["sort"] })}>
            <option value="">Best match</option>
            <option value="price">Lowest price</option>
            {filters.lat !== undefined ? <option value="distance">Nearest</option> : null}
          </select>
        </div>
      </div>

      {/* amenities */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-bold tracking-wide text-player-ink-faint">AMENITIES (venue has all you pick)</span>
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Amenities">
          {AMENITY_OPTIONS.map((a) => {
            const on = filters.amenities.includes(a.key);
            return (
              <button
                key={a.key}
                type="button"
                className={pill(on)}
                aria-pressed={on}
                onClick={() => set({ amenities: on ? filters.amenities.filter((k) => k !== a.key) : [...filters.amenities, a.key] })}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* date + time slot */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-bold tracking-wide text-player-ink-faint">AVAILABLE ON</span>
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="date"
            aria-label="Date"
            className={control}
            min={today}
            max={lastDay}
            value={filters.date ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return set({ date: undefined, startTime: undefined, durationMinutes: undefined });
              if (v < today || v > lastDay) return; // typed out of range: ignore, the picker's own min/max guide the rest
              set({ date: v });
            }}
          />
          <select
            aria-label="Start time"
            className={control}
            disabled={!filters.date}
            value={filters.startTime ?? ""}
            onChange={(e) => set({ startTime: e.target.value || undefined, durationMinutes: e.target.value ? filters.durationMinutes : undefined })}
          >
            <option value="">Any start time</option>
            {START_TIMES.map((t) => (
              <option key={t} value={t}>{formatTime24As12(t)}</option>
            ))}
          </select>
          <select
            aria-label="Duration"
            className={control}
            disabled={!filters.startTime}
            value={filters.durationMinutes ?? ""}
            onChange={(e) => set({ durationMinutes: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Court&apos;s slot length</option>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>{formatDuration(d)}</option>
            ))}
          </select>
          {!filters.date ? <span className="text-[12.5px] text-player-ink-faint">Pick a date to see only venues with a free court.</span> : null}
        </div>
      </div>

      {/* active filters + count */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="active-filters">
        <span className="text-[14px] font-bold" data-testid="result-count">
          {total === null ? "" : `${total} venue${total === 1 ? "" : "s"}`}
        </span>
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-player-accent-soft border border-player-accent-soft-border text-[12.5px] font-semibold text-player-accent-hover">
            {c.label} <span aria-hidden>✕</span>
          </button>
        ))}
        {count > 0 ? (
          <button type="button" onClick={() => apply({ amenities: [] })} className="text-[13px] font-semibold underline text-player-ink-muted" data-testid="clear-all">
            Clear all
          </button>
        ) : null}
        {pending ? <span className="text-[12.5px] text-player-ink-faint">Updating…</span> : null}
      </div>
    </section>
  );
}
