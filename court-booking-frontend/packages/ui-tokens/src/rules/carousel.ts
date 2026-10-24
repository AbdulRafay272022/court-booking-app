import { motion } from "../tokens";

/**
 * Venue-card photo carousel state machine (venue-card-photos-amenities-prompt.md + VenueCard.dc.html frame D). Pure: the
 * mobile and web VenueCard both drive it with events and render `index` / `activeDot`. Timers live in the components; they
 * call `tick` every AUTOPLAY_MS and the reducer decides whether that tick advances.
 *
 * 0 photos -> placeholder (no fake photo), 1 photo -> static (no dots, no animation), >= 2 -> autoplay with a cloned first
 * slide at the end so the wrap from last to first slides forward smoothly (index === count is the clone; `settle` jumps
 * back to 0 without animation).
 */
export const AUTOPLAY_MS = motion.autoplay;
export const RESUME_AFTER_TOUCH_MS = motion.resumeAfterTouch;
export const SLIDE_MS = motion.slide;
/** Mobile: a card counts as visible when at least this share of it is on screen (FlashList/FlatList viewability). */
export const VISIBLE_THRESHOLD = 0.6;

export type CarouselMode = "empty" | "static" | "auto";

export function carouselMode(count: number): CarouselMode {
  if (count <= 0) return "empty";
  if (count === 1) return "static";
  return "auto";
}

export interface CarouselState {
  count: number;
  /** 0..count; `count` is the cloned first slide shown during the wrap. */
  index: number;
  /** Whether the last index change should animate (false for the clone -> 0 jump and for reduce-motion). */
  animate: boolean;
  visible: boolean;
  reduceMotion: boolean;
  appActive: boolean;
  hovered: boolean;
  focused: boolean;
  dragging: boolean;
  /** Autoplay is held until this timestamp (ms) after the user touched / swiped. */
  resumeAt: number;
}

export type CarouselEvent =
  | { type: "count"; count: number }
  | { type: "visible"; value: boolean }
  | { type: "reduceMotion"; value: boolean }
  | { type: "appActive"; value: boolean }
  | { type: "hover"; value: boolean }
  | { type: "focus"; value: boolean }
  | { type: "touchStart"; now: number }
  | { type: "touchEnd"; now: number }
  | { type: "goTo"; index: number; now: number }
  | { type: "next"; now: number }
  | { type: "prev"; now: number }
  | { type: "tick"; now: number }
  | { type: "settle" };

export function initialCarousel(count: number, opts: Partial<Pick<CarouselState, "visible" | "reduceMotion">> = {}): CarouselState {
  return {
    count: Math.max(0, count),
    index: 0,
    animate: false,
    visible: opts.visible ?? false,
    reduceMotion: opts.reduceMotion ?? false,
    appActive: true,
    hovered: false,
    focused: false,
    dragging: false,
    resumeAt: 0,
  };
}

/** True when an autoplay tick at `now` would advance the photo. */
export function canAutoplay(s: CarouselState, now: number): boolean {
  return (
    carouselMode(s.count) === "auto" &&
    s.visible &&
    !s.reduceMotion &&
    s.appActive &&
    !s.hovered &&
    !s.focused &&
    !s.dragging &&
    now >= s.resumeAt
  );
}

/** Whether a component should keep a timer running at all (saves battery for off-screen / paused cards). */
export function timerShouldRun(s: CarouselState): boolean {
  return carouselMode(s.count) === "auto" && s.visible && !s.reduceMotion && s.appActive;
}

/** The real photo shown (0..count-1); the clone maps to 0. */
export function activeDot(s: CarouselState): number {
  if (s.count <= 0) return 0;
  return s.index % s.count;
}

/** Number of slides to render: the clone is only needed when autoplay can wrap. */
export function slideCount(count: number): number {
  return carouselMode(count) === "auto" ? count + 1 : Math.max(count, 0);
}

/** Prefetch ONLY the next photo (venue-card spec). Null when there is nothing to prefetch. */
export function prefetchIndex(s: CarouselState): number | null {
  if (s.count < 2) return null;
  return (activeDot(s) + 1) % s.count;
}

function clamp(i: number, count: number): number {
  return Math.min(Math.max(i, 0), Math.max(count - 1, 0));
}

function userMove(s: CarouselState, index: number, now: number): CarouselState {
  if (carouselMode(s.count) !== "auto") return s;
  return { ...s, index: clamp(index, s.count), animate: !s.reduceMotion, resumeAt: now + RESUME_AFTER_TOUCH_MS };
}

export function carouselReducer(s: CarouselState, e: CarouselEvent): CarouselState {
  switch (e.type) {
    case "count": {
      const count = Math.max(0, e.count);
      return { ...s, count, index: count === 0 ? 0 : Math.min(s.index, count - 1), animate: false };
    }
    case "visible":
      return { ...s, visible: e.value };
    case "reduceMotion":
      return { ...s, reduceMotion: e.value, animate: e.value ? false : s.animate };
    case "appActive":
      return { ...s, appActive: e.value };
    case "hover":
      return { ...s, hovered: e.value };
    case "focus":
      return { ...s, focused: e.value };
    case "touchStart":
      return { ...s, dragging: true, resumeAt: e.now + RESUME_AFTER_TOUCH_MS };
    case "touchEnd":
      return { ...s, dragging: false, resumeAt: e.now + RESUME_AFTER_TOUCH_MS };
    case "goTo":
      return userMove(s, e.index, e.now);
    case "next":
      return userMove(s, (activeDot(s) + 1) % Math.max(s.count, 1), e.now);
    case "prev":
      return userMove(s, (activeDot(s) - 1 + Math.max(s.count, 1)) % Math.max(s.count, 1), e.now);
    case "tick": {
      if (!canAutoplay(s, e.now)) return s;
      // From the last real photo go to the clone (forward slide); `settle` then jumps to 0 without animation.
      const next = s.index >= s.count - 1 ? s.count : s.index + 1;
      return { ...s, index: next, animate: true };
    }
    case "settle":
      return s.index >= s.count && s.count > 0 ? { ...s, index: 0, animate: false } : s;
  }
}

/** Accessibility label: "<Venue> ki N photos, photo X" (Roman Urdu) / "<Venue>, N photos, photo X" (English). */
export function carouselLabel(venueName: string, count: number, index: number, lang: "ru" | "en" = "ru"): string {
  if (count <= 0) return lang === "ru" ? `${venueName}: abhi koi photo nahi` : `${venueName}: no photos yet`;
  if (count === 1) return lang === "ru" ? `${venueName} ki photo` : `${venueName}, 1 photo`;
  const x = (index % count) + 1;
  return lang === "ru" ? `${venueName} ki ${count} photos, photo ${x}` : `${venueName}, ${count} photos, photo ${x}`;
}
