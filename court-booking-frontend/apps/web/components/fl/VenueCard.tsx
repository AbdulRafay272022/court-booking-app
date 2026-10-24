"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  activeDot,
  amenitiesChipLabel,
  amenityItems,
  AUTOPLAY_MS,
  carouselLabel,
  carouselMode,
  carouselReducer,
  initialCarousel,
  placeholderIndex,
  prefetchIndex,
  slideCount,
  timerShouldRun,
  VISIBLE_THRESHOLD,
  type AmenityIcon,
  type VenueCardData,
} from "@court-booking/ui-tokens";
import { Armchair, Check, ChevronLeft, ChevronRight, Coffee, Droplet, Heart, Lightbulb, List, Moon, Shirt, SquareParking, Toilet, Volleyball, Warehouse, Wifi, type FlIcon } from "./icons";
import { cx, useFlCopy, useFlLang, useFlRole, useReducedMotion } from "./role";

export type { VenueCardData };

export const AMENITY_ICONS: Record<AmenityIcon, FlIcon> = {
  parking: SquareParking,
  washroom: Toilet,
  changing: Shirt,
  floodlight: Lightbulb,
  water: Droplet,
  cafe: Coffee,
  indoor: Warehouse,
  seating: Armchair,
  wifi: Wifi,
  equipment: Volleyball,
  prayer: Moon,
  check: Check,
};

/* ---------------- AmenitiesPopover ---------------- */

/**
 * ONE "Amenities [n]" chip. Hover or keyboard focus opens the full list ABOVE the chip (role="dialog"); click toggles it
 * (touch); Esc closes. Hidden when there are no amenities. The card must not clip it (overflow is hidden only on the photo).
 */
export function AmenitiesPopover({ venueName, amenities, className }: { venueName: string; amenities: readonly string[]; className?: string }) {
  const lang = useFlLang();
  const copy = useFlCopy();
  const items = useMemo(() => amenityItems(amenities, lang), [amenities, lang]);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const id = useId();
  const open = !dismissed && (hover || focus || pinned);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setDismissed(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div
      className={cx("relative", className)}
      onMouseEnter={() => {
        setDismissed(false);
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      onFocus={() => {
        setDismissed(false);
        setFocus(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocus(false);
          setPinned(false);
        }
      }}
    >
      <button
        type="button"
        data-testid="venue-card-amenities"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={amenitiesChipLabel(items.length, lang)}
        onClick={() => {
          setDismissed(false);
          setPinned((p) => !p);
        }}
        className="relative z-10 inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-fl-line bg-fl-ground pl-3 pr-2 text-[13px] font-extrabold text-fl-night focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night"
      >
        <List size={16} strokeWidth={2.2} className="text-fl-teal-deep" />
        Amenities
        <span className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-fl-teal-tint px-1.5 text-[12px] text-fl-teal-deep">{items.length}</span>
      </button>
      {open ? (
        <div id={id} role="dialog" aria-label={copy(`${venueName} amenities`, `${venueName} amenities`)} className="absolute bottom-[52px] left-0 z-30 flex w-64 flex-col gap-0.5 rounded-[18px] border border-fl-line bg-fl-white px-3.5 py-3 shadow-fl-popover">
          <b className="pb-1.5 text-[13px]">{copy(`${items.length} amenities`, `${items.length} amenities`)}</b>
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map((a) => {
              const Icon = AMENITY_ICONS[a.icon];
              return (
                <li key={a.key} className="flex min-h-[30px] items-center gap-2.5 text-[14px] font-semibold text-fl-night">
                  <Icon size={16} strokeWidth={2.4} className="flex-none text-fl-teal" />
                  {a.label}
                </li>
              );
            })}
          </ul>
          <span className="pt-1.5 text-[12px] text-fl-muted">{copy("Ye list venue owner ne khud dali hai.", "The venue owner entered this list.")}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- VenueCard ---------------- */

const ARTS = ["M70 140 100 40h158l30 100zM179 40v100M86 90h186", "M20 120h318M40 120V60h278v60M179 60v60", "M40 130 179 20l139 110zM179 20v110M110 75h138", "M30 40h298v80H30zM179 40v80M30 80h298"];
const PLACEHOLDER = ["bg-fl-teal", "bg-fl-night", "bg-fl-teal-deep", "bg-fl-orange-deep"];

export interface VenueCardProps {
  /** venueCardData(summary, { sport }) from @court-booking/ui-tokens. */
  venue: VenueCardData;
  /** Venue page link (the whole card is a stretched link). */
  href: string;
  saved?: boolean;
  onToggleSave?: () => void;
  /** First 2 cards on a page: load photos eagerly; the rest lazy. */
  eager?: boolean;
  /** Optional right-side action ("Slots dekho"), role primary. */
  action?: { label: string; href: string };
  /** Optional real open times. */
  times?: { label: string; href: string }[];
  photoHeight?: number;
  children?: ReactNode;
}

/**
 * Web venue card (VenueCard.dc.html frame C): photos auto-advance every 3.5 s only while >= 60% visible (IntersectionObserver),
 * pause on hover (+ 44px arrows) and keyboard focus, stop in a hidden tab (visibilitychange) and with prefers-reduced-motion.
 */
export function VenueCard({ venue, href, saved, onToggleSave, eager, action, times, photoHeight = 210 }: VenueCardProps) {
  const role = useFlRole();
  const lang = useFlLang();
  const copy = useFlCopy();
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const photos = venue.photos;
  const count = photos.length;
  const mode = carouselMode(count);
  const [s, dispatch] = useReducer(carouselReducer, count, (c: number) => initialCarousel(c));
  const touchX = useRef<number | null>(null);

  useEffect(() => dispatch({ type: "count", count }), [count]);
  useEffect(() => dispatch({ type: "reduceMotion", value: reduce }), [reduce]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => dispatch({ type: "visible", value: e.intersectionRatio >= VISIBLE_THRESHOLD }), { threshold: [0, VISIBLE_THRESHOLD, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const fn = () => dispatch({ type: "appActive", value: document.visibilityState === "visible" });
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);
  const running = timerShouldRun(s);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => dispatch({ type: "tick", now: Date.now() }), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    const n = prefetchIndex(s);
    if (n !== null && s.visible && typeof window !== "undefined") {
      const img = new window.Image();
      img.src = photos[n];
    }
  }, [s, photos]);

  const dot = activeDot(s);
  const total = slideCount(count);
  const meta = [venue.area, venue.distance].filter(Boolean).join(" · ");
  const k = placeholderIndex(venue.id);

  return (
    <div
      ref={rootRef}
      data-fl-role={role}
      data-testid="fl-venue-card"
      className="group relative flex flex-col rounded-fl-card bg-fl-white shadow-fl-card hover:z-[5] focus-within:z-[5]"
      onMouseEnter={() => dispatch({ type: "hover", value: true })}
      onMouseLeave={() => dispatch({ type: "hover", value: false })}
      onFocus={() => dispatch({ type: "focus", value: true })}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dispatch({ type: "focus", value: false });
      }}
    >
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={carouselLabel(venue.name, count, dot, lang)}
        className={cx("relative overflow-hidden rounded-t-fl-card", mode === "empty" ? PLACEHOLDER[k] : "bg-fl-night")}
        style={{ height: photoHeight }}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
          dispatch({ type: "touchStart", now: Date.now() });
        }}
        onTouchEnd={(e) => {
          const x0 = touchX.current;
          const x1 = e.changedTouches[0]?.clientX;
          if (x0 != null && x1 != null && Math.abs(x1 - x0) > 40) dispatch({ type: x1 < x0 ? "next" : "prev", now: Date.now() });
          dispatch({ type: "touchEnd", now: Date.now() });
        }}
      >
        {mode === "empty" ? (
          <svg aria-hidden width="100%" height="100%" viewBox="0 0 358 150" preserveAspectRatio="none" fill="none" strokeWidth={2} className="absolute inset-0 stroke-fl-a-court-lines">
            <path d={ARTS[k]} />
          </svg>
        ) : (
          <div
            className={cx("flex h-full", s.animate && !reduce ? "transition-transform duration-[400ms] ease-in-out" : "")}
            style={{ width: `${total * 100}%`, transform: `translateX(-${(s.index * 100) / Math.max(total, 1)}%)` }}
            onTransitionEnd={() => dispatch({ type: "settle" })}
          >
            {Array.from({ length: total }, (_, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- remote S3/CloudFront URLs; no thumbnails exist (contract B4)
              <img
                key={i}
                src={photos[i % count]}
                alt=""
                aria-hidden
                draggable={false}
                loading={eager && i < 2 ? "eager" : "lazy"}
                decoding="async"
                sizes="(max-width: 640px) 100vw, 400px"
                className="h-full flex-none object-cover"
                style={{ width: `${100 / total}%` }}
              />
            ))}
          </div>
        )}
        {venue.sport ? <span className="pointer-events-none absolute left-3.5 top-3.5 z-[2] flex h-[30px] items-center rounded-full border border-fl-a-on-photo-border bg-fl-a-on-photo px-3 text-[12px] font-extrabold text-fl-white">{venue.sport}</span> : null}
        {venue.nextFree ? (
          <span className="pointer-events-none absolute bottom-3.5 left-3.5 z-[2] flex h-[30px] items-center gap-1.5 rounded-full bg-fl-white px-3 text-[12px] font-extrabold text-fl-night">
            <span className="h-[7px] w-[7px] rounded-full bg-fl-orange" />
            {venue.nextFree}
          </span>
        ) : null}
        {mode === "auto" ? (
          <>
            <button
              type="button"
              aria-label={copy("Pichhli photo", "Previous photo")}
              onClick={() => dispatch({ type: "prev", now: Date.now() })}
              className="absolute left-2.5 top-1/2 z-[3] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-fl-a-arrow-on-photo text-fl-night opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <ChevronLeft size={18} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              aria-label={copy("Agli photo", "Next photo")}
              onClick={() => dispatch({ type: "next", now: Date.now() })}
              className="absolute right-2.5 top-1/2 z-[3] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-fl-a-arrow-on-photo text-fl-night opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <ChevronRight size={18} strokeWidth={2.4} />
            </button>
            <span aria-hidden className="pointer-events-none absolute bottom-4 right-3.5 z-[2] flex h-[22px] items-center gap-[5px] rounded-full bg-fl-a-on-photo-strong px-2">
              {photos.map((p, i) => (
                <span key={`${p}-${i}`} className={cx("h-1.5 w-1.5 rounded-full", i === dot ? "bg-fl-white" : "bg-fl-a-dot-idle")} />
              ))}
            </span>
          </>
        ) : null}
        {onToggleSave ? (
          <button
            type="button"
            aria-pressed={!!saved}
            aria-label={saved ? copy(`${venue.name} saved hai, hatayein`, `Remove ${venue.name} from saved`) : copy(`${venue.name} save karein`, `Save ${venue.name}`)}
            onClick={onToggleSave}
            className="absolute right-2.5 top-2.5 z-[3] flex h-11 w-11 items-center justify-center rounded-full border border-fl-a-on-photo-border bg-fl-a-heart-on-photo text-fl-white backdrop-blur-md focus-visible:outline-2 focus-visible:outline-fl-white"
          >
            <Heart size={18} fill={saved ? "currentColor" : "none"} />
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5 px-[18px] pb-[18px] pt-4">
        <div className="flex flex-wrap justify-between gap-2.5">
          <div className="flex min-w-40 flex-1 flex-col gap-[3px]">
            <Link href={href} className="font-fl-display text-[21px] font-extrabold text-fl-night after:absolute after:inset-0 after:z-[1] after:rounded-fl-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-fl-night">
              {venue.name}
            </Link>
            {venue.rating !== null || meta ? (
              <span className="text-[13px] leading-snug text-fl-muted">
                {venue.rating !== null ? (
                  <>
                    ★ <b className="text-fl-night">{venue.rating.toFixed(1)}</b>
                    {meta ? " · " : ""}
                  </>
                ) : null}
                {meta}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col items-end tabular-nums">
            {venue.priceFrom ? (
              <>
                <span className="text-[12px] text-fl-muted2">{copy("shuru", "from")}</span>
                <span className="text-[17px] font-extrabold">{venue.priceFrom}</span>
              </>
            ) : (
              <span className="text-[12px] text-fl-muted2">{copy("Price abhi nahi", "No price yet")}</span>
            )}
          </div>
        </div>
        {times && times.length > 0 ? (
          <div className="relative z-[2] flex flex-wrap gap-2">
            {times.slice(0, 3).map((t) => (
              <Link key={t.label} href={t.href} className="flex min-h-11 min-w-[76px] items-center justify-center rounded-fl-sm border-[1.5px] border-fl-role-selected-border bg-fl-role-selected px-3 text-[14px] font-extrabold text-fl-role-on-selected">
                {t.label}
              </Link>
            ))}
            {times.length > 3 ? (
              <Link href={href} className="flex min-h-11 min-w-14 items-center justify-center rounded-fl-sm bg-fl-ground px-3 text-[14px] font-extrabold text-fl-night">
                +{times.length - 3}
              </Link>
            ) : null}
          </div>
        ) : null}
        <div className="relative z-[4] flex flex-wrap items-center justify-between gap-2.5">
          <AmenitiesPopover venueName={venue.name} amenities={venue.amenities} />
          {action ? (
            <Link href={action.href} className="ml-auto flex h-11 items-center rounded-fl-md bg-fl-role-primary px-[18px] text-[14px] font-extrabold text-fl-role-on-primary">
              {action.label}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
