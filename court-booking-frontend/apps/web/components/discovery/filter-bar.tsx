"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AMENITY_OPTIONS, SPORT_OPTIONS, formatTime24As12, pktDayTabs } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { activeFilterCount, filtersToParams, parseFilters, type DiscoveryFilters } from "@/lib/discovery-filters";

/** Booking horizon offered by the date list (the venue default; a venue may allow fewer days, the server decides). */
const HORIZON_DAYS = 90;
const START_TIMES = Array.from({ length: 36 }, (_, i) => {
  const mins = 6 * 60 + i * 30; // 6:00 AM ... 11:30 PM
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});
const DURATIONS = [60, 90, 120, 180];
/** The top-bar price presets; each one is just a `max_price`. */
const PRICE_PRESETS = [3000, 5000, 8000];

const field =
  "khelo-input min-h-11 w-full min-w-0 rounded-xl border-[1.5px] border-khelo-border bg-khelo-surface px-4 py-2.5 text-[15px] font-semibold text-khelo-ink disabled:bg-khelo-page disabled:text-khelo-muted-3";
const smallLabel = "text-[12px] font-extrabold uppercase tracking-[1px] text-khelo-muted-2";
const toggle = (on: boolean) =>
  `khelo-btn min-h-11 rounded-full border-[1.5px] px-4 py-2 text-[14px] font-bold ${
    on ? "border-khelo-ink bg-khelo-ink text-white" : "border-khelo-border bg-khelo-surface text-khelo-ink"
  }`;

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="10" r="3" />
      <path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

/**
 * The whole /search chrome: the compact title band, the sticky filter bar and the results header (count, active filters,
 * sort), with the result grid passed in as `children` by the server page. ALL filter state lives in the URL query string
 * (parseFilters / filtersToParams): every change pushes a new URL, which makes a search shareable and the browser's back
 * button undo a filter. The page (a server component) reads the same params and fetches; this component only edits them.
 */
export function FilterBar({ areas, city, total, children }: { areas: string[]; city: string; total: number | null; children: ReactNode }) {
  const t = useT();
  const fmt = useFmt();
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

  // What lives in the More-filters panel: setting, amenities, start time, exact price range. If a loaded URL already
  // uses any of them, the panel starts open so the controls visibly match the URL.
  const inPanel =
    (filters.indoor !== undefined ? 1 : 0) +
    filters.amenities.length +
    (filters.startTime ? 1 : 0) +
    (filters.minPrice !== undefined || (filters.maxPrice !== undefined && !PRICE_PRESETS.includes(filters.maxPrice)) ? 1 : 0);
  const [moreOpen, setMoreOpen] = useState(inPanel > 0);

  // The date picker is a plain list (Today, Tomorrow, Wed 14 Oct...): a native date box prints the device's own format
  // ("dd/mm/yyyy"), which this app avoids everywhere. Pakistan calendar days, same as the venue page's day tabs.
  const dayOptions = pktDayTabs(HORIZON_DAYS);

  function apply(next: DiscoveryFilters) {
    const qs = filtersToParams(next, city).toString();
    startTransition(() => router.push(`/search?${qs}`, { scroll: false }));
  }
  const set = (patch: Partial<DiscoveryFilters>) => apply({ ...filters, ...patch });

  function commitPrice() {
    const lo = minText !== null ? (minText.trim() === "" ? undefined : Number(minText)) : filters.minPrice;
    const hi = maxText !== null ? (maxText.trim() === "" ? undefined : Number(maxText)) : filters.maxPrice;
    if ((lo !== undefined && (!Number.isFinite(lo) || lo < 0)) || (hi !== undefined && (!Number.isFinite(hi) || hi < 0))) {
      setPriceError(t("search.price.errorNumbers"));
      return;
    }
    if (lo !== undefined && hi !== undefined && lo > hi) {
      setPriceError(t("search.price.errorOrder"));
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
      setLocError(t("search.location.noGeo"));
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
            ? t("search.location.denied")
            : t("search.location.failed"),
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // The preset select mirrors max_price: no price filter = "any", max equal to a preset (and no min) = that preset,
  // anything else (a min, or a typed max) = "custom", so the select never lies about the exact inputs.
  const priceValue =
    filters.minPrice === undefined && filters.maxPrice === undefined
      ? ""
      : filters.minPrice === undefined && filters.maxPrice !== undefined && PRICE_PRESETS.includes(filters.maxPrice)
        ? String(filters.maxPrice)
        : "custom";

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.sport) chips.push({ key: "sport", label: filters.sport, clear: () => set({ sport: undefined }) });
  if (filters.area) chips.push({ key: "area", label: filters.area, clear: () => set({ area: undefined }) });
  if (filters.lat !== undefined)
    chips.push({ key: "near", label: t("search.chip.nearMe"), clear: () => set({ lat: undefined, lng: undefined, sort: filters.sort === "distance" ? undefined : filters.sort }) });
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const label =
      filters.minPrice !== undefined && filters.maxPrice !== undefined
        ? t("search.chip.priceRange", { min: filters.minPrice.toLocaleString("en-US"), max: filters.maxPrice.toLocaleString("en-US") })
        : filters.minPrice !== undefined
          ? t("search.chip.priceFrom", { min: filters.minPrice.toLocaleString("en-US") })
          : t("search.chip.priceUpTo", { max: filters.maxPrice!.toLocaleString("en-US") });
    chips.push({ key: "price", label, clear: () => set({ minPrice: undefined, maxPrice: undefined }) });
  }
  if (filters.indoor !== undefined) chips.push({ key: "indoor", label: filters.indoor ? t("search.more.indoor") : t("search.more.outdoor"), clear: () => set({ indoor: undefined }) });
  for (const a of filters.amenities) chips.push({ key: `am-${a}`, label: fmt.amenity(a), clear: () => set({ amenities: filters.amenities.filter((x) => x !== a) }) });
  if (filters.date) {
    const when = `${fmt.dateString(filters.date)}${filters.startTime ? `, ${formatTime24As12(filters.startTime)}` : ""}${
      filters.startTime && filters.durationMinutes ? ` · ${fmt.duration(filters.durationMinutes)}` : ""
    }`;
    chips.push({ key: "when", label: when, clear: () => set({ date: undefined, startTime: undefined, durationMinutes: undefined }) });
  }
  const count = activeFilterCount(filters);

  return (
    <>
      {/* COMPACT TITLE BAND */}
      <section aria-label={t("search.findCourt")} className="bg-khelo-ink text-white">
        <div className="mx-auto flex w-full max-w-[1288px] flex-wrap items-end justify-between gap-4 px-6 pb-[30px] pt-7">
          <div>
            <div className="text-[12px] font-extrabold uppercase tracking-[1.5px] text-khelo-orange">{t("search.findCourt")}</div>
            <h1 className="mt-2 font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1.2px] sm:text-[38px]">{t("search.title", { city })}</h1>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="khelo-btn box-border inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-white/35 px-[18px] py-3 text-[14px] font-bold text-white disabled:opacity-60"
            >
              <PinIcon />
              {locating ? t("search.location.locating") : filters.lat !== undefined ? t("search.location.update") : t("search.location.use")}
            </button>
            {locError ? (
              <p role="alert" className="max-w-xs text-[13px] font-semibold text-khelo-warning sm:text-right" data-testid="location-error">
                {locError}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* STICKY FILTER BAR */}
      <div className="sticky top-0 z-10 border-b border-khelo-divider bg-khelo-surface shadow-[0_6px_20px_rgba(12,31,29,0.06)]" data-testid="filter-bar" aria-busy={pending}>
        <div className="mx-auto w-full max-w-[1288px] px-6 py-3.5">
          <div className="-mx-0.5 flex gap-2.5 overflow-x-auto -my-1 px-0.5 py-1.5 [scrollbar-width:none]" role="group" aria-label={t("search.sport.group")}>
            <button type="button" className={`${toggle(!filters.sport)} shrink-0 !px-5 !py-3 !text-[15px] ${!filters.sport ? "!border-khelo-orange !bg-khelo-orange !text-khelo-ink" : ""}`} aria-pressed={!filters.sport} onClick={() => set({ sport: undefined })}>
              {t("search.sport.all")}
            </button>
            {SPORT_OPTIONS.map((s) => {
              const on = filters.sport?.toLowerCase() === s.toLowerCase();
              return (
                <button
                  key={s}
                  type="button"
                  className={`${toggle(on)} shrink-0 !px-5 !py-3 !text-[15px] ${on ? "!border-khelo-orange !bg-khelo-orange !text-khelo-ink" : ""}`}
                  aria-pressed={on}
                  onClick={() => set({ sport: s })}
                >
                  {s}
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 grid grid-cols-2 items-center gap-2.5 min-[900px]:flex min-[900px]:flex-wrap">
            <select aria-label={t("search.area.label")} className={`${field} min-[900px]:w-auto`} value={filters.area ?? ""} onChange={(e) => set({ area: e.target.value || undefined })}>
              <option value="">{t("search.area.all")}</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              {filters.area && !areas.includes(filters.area) ? <option value={filters.area}>{filters.area}</option> : null}
            </select>
            <select
              aria-label={t("search.price.label")}
              className={`${field} min-[900px]:w-auto`}
              value={priceValue}
              onChange={(e) => {
                const v = e.target.value;
                setPriceError(null);
                setMinText(null);
                setMaxText(null);
                if (v === "custom") return;
                set({ minPrice: undefined, maxPrice: v ? Number(v) : undefined });
              }}
            >
              <option value="">{t("search.price.any")}</option>
              {PRICE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t("search.price.upTo", { price: p.toLocaleString("en-US") })}
                </option>
              ))}
              {priceValue === "custom" ? <option value="custom">{t("search.price.custom")}</option> : null}
            </select>
            <select
              aria-label={t("search.date.label")}
              className={`${field} min-[900px]:w-auto`}
              value={filters.date ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return set({ date: undefined, startTime: undefined, durationMinutes: undefined });
                set({ date: v });
              }}
            >
              <option value="">{t("search.date.any")}</option>
              {filters.date && !dayOptions.some((d) => d.date === filters.date) ? <option value={filters.date}>{fmt.dateString(filters.date)}</option> : null}
              {dayOptions.map((d, i) => (
                <option key={d.date} value={d.date}>
                  {i === 0 ? t("search.date.today") : i === 1 ? t("search.date.tomorrow") : fmt.dateString(d.date)}
                  {i < 2 ? ` · ${fmt.dateString(d.date)}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls="more-filters"
              onClick={() => setMoreOpen((o) => !o)}
              className={`khelo-btn inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-khelo-ink px-[18px] py-3 text-[15px] font-extrabold ${
                moreOpen ? "bg-khelo-ink text-white" : "bg-khelo-surface text-khelo-ink"
              }`}
            >
              <SlidersIcon />
              {inPanel > 0 ? t("search.more.buttonCount", { count: inPanel }) : t("search.more.button")}
            </button>
          </div>

          {moreOpen ? (
            <div id="more-filters" className="mt-3.5 flex max-h-[55vh] flex-wrap gap-x-7 gap-y-5 overflow-y-auto rounded-[18px] bg-khelo-page p-[18px]">
              <div>
                <div className={smallLabel}>{t("search.more.setting")}</div>
                <div className="mt-2 flex gap-2" role="group" aria-label={t("search.more.settingGroup")}>
                  {(
                    [
                      [t("search.more.any"), undefined],
                      [t("search.more.indoor"), true],
                      [t("search.more.outdoor"), false],
                    ] as const
                  ).map(([label, value]) => (
                    <button key={label} type="button" className={toggle(filters.indoor === value)} aria-pressed={filters.indoor === value} onClick={() => set({ indoor: value })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className={smallLabel}>
                  {t("search.more.amenities")} <span className="font-medium normal-case tracking-normal">{t("search.more.amenitiesHint")}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("search.more.amenities")}>
                  {AMENITY_OPTIONS.map((a) => {
                    const on = filters.amenities.includes(a.key);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        className={toggle(on)}
                        aria-pressed={on}
                        onClick={() => set({ amenities: on ? filters.amenities.filter((k) => k !== a.key) : [...filters.amenities, a.key] })}
                      >
                        {fmt.amenity(a.key)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className={smallLabel}>{t("search.more.startTime")}</div>
                {filters.date ? (
                  <div className="mt-2 flex flex-wrap gap-2.5">
                    <select
                      aria-label={t("search.more.startTime")}
                      className={`${field} !w-auto`}
                      value={filters.startTime ?? ""}
                      onChange={(e) => set({ startTime: e.target.value || undefined, durationMinutes: e.target.value ? filters.durationMinutes : undefined })}
                    >
                      <option value="">{t("search.more.anyStart")}</option>
                      {START_TIMES.map((st) => (
                        <option key={st} value={st}>
                          {formatTime24As12(st)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("search.more.duration")}
                      className={`${field} !w-auto`}
                      disabled={!filters.startTime}
                      value={filters.durationMinutes ?? ""}
                      onChange={(e) => set({ durationMinutes: e.target.value ? Number(e.target.value) : undefined })}
                    >
                      <option value="">{t("search.more.minBooking")}</option>
                      {DURATIONS.map((d) => (
                        <option key={d} value={d}>
                          {fmt.duration(d)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="mt-2 max-w-[220px] text-[14px] leading-normal text-khelo-muted-2">{t("search.more.pickDate")}</div>
                )}
              </div>

              <div>
                <div className={smallLabel}>{t("search.more.pricePerSlot")}</div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    aria-label={t("search.more.minPrice")}
                    inputMode="numeric"
                    placeholder={t("search.more.minPlaceholder")}
                    className={`${field} !w-28`}
                    value={minText ?? (filters.minPrice !== undefined ? String(filters.minPrice) : "")}
                    onChange={(e) => setMinText(e.target.value.replace(/[^\d]/g, ""))}
                    onBlur={commitPrice}
                    onKeyDown={(e) => e.key === "Enter" && commitPrice()}
                  />
                  <span className="text-khelo-muted-3" aria-hidden="true">
                    –
                  </span>
                  <input
                    aria-label={t("search.more.maxPrice")}
                    inputMode="numeric"
                    placeholder={t("search.more.maxPlaceholder")}
                    className={`${field} !w-28`}
                    value={maxText ?? (filters.maxPrice !== undefined ? String(filters.maxPrice) : "")}
                    onChange={(e) => setMaxText(e.target.value.replace(/[^\d]/g, ""))}
                    onBlur={commitPrice}
                    onKeyDown={(e) => e.key === "Enter" && commitPrice()}
                  />
                </div>
                {priceError ? (
                  <p role="alert" className="mt-1.5 max-w-xs text-[13px] font-semibold text-khelo-danger">
                    {priceError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* RESULTS */}
      <div className="mx-auto w-full max-w-[1288px] px-6 pb-[72px] pt-7">
        <div className="flex flex-wrap items-center justify-between gap-3.5" data-testid="active-filters">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="mr-1 text-[18px] font-extrabold" data-testid="result-count" aria-live="polite">
              {total === null ? "" : t(total === 1 ? "search.count.one" : "search.count.other", { count: total })}
            </span>
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={c.clear}
                aria-label={t("search.chip.remove", { label: c.label })}
                className="khelo-btn inline-flex min-h-11 items-center gap-1.5 rounded-full bg-khelo-warm px-3.5 py-1.5 text-[13px] font-bold text-khelo-orange-label"
              >
                {c.label} <span aria-hidden="true">✕</span>
              </button>
            ))}
            {count > 0 ? (
              <button type="button" onClick={() => apply({ amenities: [] })} className="min-h-11 px-2 text-[14px] font-bold text-khelo-muted underline" data-testid="clear-all">
                {t("search.clearAll")}
              </button>
            ) : null}
            {pending ? <span className="text-[13px] text-khelo-muted-2">{t("search.updating")}</span> : null}
          </div>
          <select aria-label={t("search.sort.label")} className={`${field} !w-auto`} value={filters.sort ?? ""} onChange={(e) => set({ sort: (e.target.value || undefined) as DiscoveryFilters["sort"] })}>
            <option value="">{t("search.sort.best")}</option>
            <option value="price">{t("search.sort.price")}</option>
            <option value="rating">{t("search.sort.rating")}</option>
            {filters.lat !== undefined ? <option value="distance">{t("search.sort.nearest")}</option> : null}
          </select>
        </div>

        <div className={`mt-[22px] transition-opacity ${pending ? "opacity-60" : ""}`}>{children}</div>
      </div>
    </>
  );
}
