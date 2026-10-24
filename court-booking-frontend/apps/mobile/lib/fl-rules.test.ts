import test from "node:test";
import assert from "node:assert/strict";
import {
  activeDot,
  amenityItems,
  canAutoplay,
  carouselLabel,
  carouselMode,
  carouselReducer,
  countdown,
  formatPkr,
  initialCarousel,
  initials,
  isConfirmed,
  journeySteps,
  prefetchIndex,
  RESUME_AFTER_TOUCH_MS,
  ringDash,
  slideCount,
  slotChipA11y,
  slotChipCue,
  slotChipPressable,
  slotChipState,
  statusPill,
  timerShouldRun,
  windowMs,
  type CarouselEvent,
  type CarouselState,
  type SlotLike,
} from "@court-booking/ui-tokens";

const run = (s: CarouselState, ...events: CarouselEvent[]) => events.reduce(carouselReducer, s);

test("carousel: 0 / 1 / 2 / 8 photos pick empty / static / auto", () => {
  assert.equal(carouselMode(0), "empty");
  assert.equal(carouselMode(1), "static");
  assert.equal(carouselMode(2), "auto");
  assert.equal(carouselMode(8), "auto");
  assert.equal(slideCount(0), 0);
  assert.equal(slideCount(1), 1);
  assert.equal(slideCount(2), 3); // + cloned first slide
  assert.equal(slideCount(8), 9);
});

test("carousel: static and empty never autoplay or move", () => {
  for (const n of [0, 1]) {
    const s = run(initialCarousel(n, { visible: true }), { type: "tick", now: 10_000 }, { type: "next", now: 10_000 });
    assert.equal(s.index, 0);
    assert.equal(canAutoplay(s, 99_999), false);
    assert.equal(timerShouldRun(s), false);
    assert.equal(prefetchIndex(s), null);
  }
});

test("carousel: autoplay advances only when visible, and wraps through the clone", () => {
  let s = initialCarousel(3);
  s = run(s, { type: "tick", now: 1 });
  assert.equal(s.index, 0, "not visible -> paused");
  s = run(s, { type: "visible", value: true }, { type: "tick", now: 1 });
  assert.equal(s.index, 1);
  s = run(s, { type: "tick", now: 2 }, { type: "tick", now: 3 });
  assert.equal(s.index, 3, "last -> clone");
  assert.equal(activeDot(s), 0, "clone shows the first dot");
  s = run(s, { type: "settle" });
  assert.equal(s.index, 0);
  assert.equal(s.animate, false, "jump back from the clone is not animated");
  assert.equal(prefetchIndex(s), 1, "prefetch the NEXT photo only");
});

test("carousel: 8 photos cycle through every photo in order", () => {
  let s = initialCarousel(8, { visible: true });
  const seen: number[] = [];
  for (let i = 0; i < 9; i++) {
    seen.push(activeDot(s));
    s = run(s, { type: "tick", now: i });
    if (s.index === 8) s = run(s, { type: "settle" });
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 0]);
});

test("carousel: touch pauses, autoplay resumes 6 s after the last touch", () => {
  let s = initialCarousel(4, { visible: true });
  s = run(s, { type: "touchStart", now: 1000 });
  assert.equal(canAutoplay(s, 2000), false, "dragging");
  s = run(s, { type: "goTo", index: 2, now: 1500 }, { type: "touchEnd", now: 1600 });
  assert.equal(s.index, 2);
  assert.equal(canAutoplay(s, 1600 + RESUME_AFTER_TOUCH_MS - 1), false);
  assert.equal(canAutoplay(s, 1600 + RESUME_AFTER_TOUCH_MS), true);
  assert.equal(run(s, { type: "tick", now: 3000 }).index, 2, "tick inside the pause does nothing");
  assert.equal(run(s, { type: "tick", now: 1600 + RESUME_AFTER_TOUCH_MS }).index, 3);
});

test("carousel: hover and keyboard focus pause (web), user arrows still move", () => {
  let s = run(initialCarousel(3, { visible: true }), { type: "hover", value: true });
  assert.equal(run(s, { type: "tick", now: 1 }).index, 0);
  s = run(s, { type: "next", now: 1 });
  assert.equal(s.index, 1);
  s = run(s, { type: "prev", now: 2 }, { type: "prev", now: 3 });
  assert.equal(s.index, 2, "prev from 0 wraps to the last photo");
  s = run(s, { type: "hover", value: false }, { type: "focus", value: true });
  assert.equal(canAutoplay(s, 1e9), false);
});

test("carousel: reduce motion = no autoplay, swipe still works, no animation", () => {
  let s = initialCarousel(3, { visible: true, reduceMotion: true });
  assert.equal(timerShouldRun(s), false);
  assert.equal(run(s, { type: "tick", now: 1e9 }).index, 0);
  s = run(s, { type: "next", now: 1 });
  assert.equal(s.index, 1);
  assert.equal(s.animate, false);
});

test("carousel: app background / hidden tab pauses", () => {
  const s = run(initialCarousel(3, { visible: true }), { type: "appActive", value: false });
  assert.equal(timerShouldRun(s), false);
  assert.equal(run(s, { type: "tick", now: 1 }).index, 0);
  assert.equal(run(s, { type: "appActive", value: true }, { type: "tick", now: 1 }).index, 1);
});

test("carousel: count shrinking keeps index in range; label says which photo", () => {
  const s = run(initialCarousel(5, { visible: true }), { type: "goTo", index: 4, now: 0 }, { type: "count", count: 2 });
  assert.equal(s.index, 1);
  assert.equal(carouselLabel("Demo Arena", 4, 1), "Demo Arena ki 4 photos, photo 2");
  assert.equal(carouselLabel("Demo Arena", 0, 0), "Demo Arena: abhi koi photo nahi");
  assert.equal(carouselLabel("Demo Arena", 3, 0, "en"), "Demo Arena, 3 photos, photo 1");
});

const NOW = Date.parse("2026-10-24T15:00:00Z");
const slot = (over: Partial<SlotLike>): SlotLike => ({ starts_at: "2026-10-24T16:00:00Z", status: "available", is_mine: false, ...over });

test("slot chip: maps every SlotOut status per the BE contract", () => {
  assert.equal(slotChipState(slot({}), { now: NOW }), "open");
  assert.equal(slotChipState(slot({ status: "held" }), { now: NOW }), "held");
  assert.equal(slotChipState(slot({ status: "payment_submitted" }), { now: NOW }), "held");
  assert.equal(slotChipState(slot({ status: "booked" }), { now: NOW }), "booked");
  assert.equal(slotChipState(slot({ status: "blocked" }), { now: NOW }), "blocked");
  for (const status of ["held", "payment_submitted", "booked"] as const) {
    assert.equal(slotChipState(slot({ status, is_mine: true }), { now: NOW }), "mine");
  }
  assert.equal(slotChipState(slot({ starts_at: "2026-10-24T14:30:00Z" }), { now: NOW }), null, "past available is hidden");
  assert.equal(slotChipState(slot({ starts_at: "2026-10-24T14:30:00Z", status: "booked" }), { now: NOW }), "booked");
});

test("slot chip: selection, range and no-room", () => {
  const s = slot({});
  assert.equal(slotChipState(s, { now: NOW, selectedStart: s.starts_at }), "selected");
  assert.equal(slotChipState(s, { now: NOW, inRange: [s.starts_at] }), "inRange");
  assert.equal(slotChipState(s, { now: NOW, fits: false }), "noRoom");
  assert.equal(slotChipState(slot({ status: "booked" }), { now: NOW, selectedStart: s.starts_at }), "booked", "never select a taken slot");
});

test("slot chip: never colour-only, honest pressability and labels", () => {
  assert.equal(slotChipCue("selected").prefix, "✓ ");
  assert.equal(slotChipCue("booked").strike, true);
  assert.equal(slotChipCue("held").dashed, true);
  assert.equal(slotChipCue("noRoom").dashed, true);
  assert.equal(slotChipCue("blocked").icon, "lock");
  for (const st of ["open", "selected", "inRange", "held", "booked", "noRoom", "blocked", "mine"] as const) {
    const c = slotChipCue(st);
    if (st !== "open") assert.ok(c.prefix || c.strike || c.dashed || c.thickOutline || c.icon !== "none", `${st} has a non-colour cue`);
  }
  assert.deepEqual(
    (["open", "held", "booked", "noRoom", "blocked"] as const).map(slotChipPressable),
    [true, false, false, false, false],
  );
  assert.equal(slotChipA11y("held", "9:00 PM"), "9:00 PM, kisi ne hold kiya");
  assert.equal(slotChipA11y("blocked", "9:00 PM", "en", "Maintenance"), "9:00 PM, closed (Maintenance)");
});

test("status pill: Pakki only for booked", () => {
  const all = ["held", "payment_submitted", "booked", "completed", "no_show", "cancelled"] as const;
  for (const status of all) {
    for (const lang of ["ru", "en"] as const) {
      const p = statusPill({ status }, lang);
      const claims = /pakki|confirmed|aap ka hai/i.test(p.label);
      assert.equal(claims, status === "booked", `${status}/${lang}: ${p.label}`);
    }
  }
  assert.equal(statusPill({ status: "payment_submitted" }).label, "Venue check");
  assert.equal(statusPill({ status: "cancelled", cancelled_by: "owner" }).tone, "danger");
  assert.equal(statusPill({ status: "cancelled", cancelled_by: "system", cancellation_reason: "hold_expired" }).key, "holdExpired");
  assert.equal(statusPill({ status: "cancelled", cancelled_by: "player" }).key, "cancelledByPlayer");
  assert.equal(isConfirmed("booked"), true);
  assert.equal(isConfirmed("payment_submitted"), false);
});

test("journey steps: Hold -> Screenshot -> Venue check -> Pakki", () => {
  const st = (s: Parameters<typeof journeySteps>[0]) => journeySteps(s).map((x) => x.state).join(",");
  assert.equal(st({ status: "held" }), "done,now,next,next");
  assert.equal(st({ status: "payment_submitted" }), "done,done,now,next");
  assert.equal(st({ status: "booked" }), "done,done,done,done");
  assert.equal(st({ status: "cancelled", proofSent: true }), "done,done,failed,next");
  assert.equal(st({ status: "cancelled" }), "done,failed,next,next");
  assert.equal(journeySteps({ status: "held" })[3].label, "Booking pakki");
});

test("journey steps: a failed step names what went wrong (never 'checking' next to a cross)", () => {
  const rej = journeySteps({ status: "cancelled", proofSent: true });
  assert.equal(rej[2].state, "failed");
  assert.equal(rej[2].label, "Venue ne booking nahi li");
  assert.equal(journeySteps({ status: "cancelled", proofSent: true }, "en")[2].label, "The venue did not accept it");
  const exp = journeySteps({ status: "cancelled" });
  assert.equal(exp[1].label, "Screenshot waqt par nahi aaya");
  assert.equal(journeySteps({ status: "payment_submitted" })[2].label, "Venue check kar raha hai");
});

test("countdown: from a real expiry timestamp", () => {
  const exp = "2026-10-24T15:15:00Z";
  const c = countdown(exp, NOW);
  assert.equal(c.label, "15:00");
  assert.equal(c.fraction, 1);
  assert.equal(countdown(exp, NOW + 4 * 1000).label, "14:56");
  assert.equal(countdown(exp, NOW + 15 * 60 * 1000).expired, true);
  assert.equal(countdown(exp, NOW + 20 * 60 * 1000).label, "0:00");
  assert.equal(countdown(null, NOW).expired, true);
  assert.equal(countdown(NOW + 3_725_000, NOW).label, "1:02:05");
  assert.equal(countdown(exp, NOW + 7.5 * 60 * 1000).fraction, 0.5);
  assert.equal(windowMs("2026-10-24T15:00:00Z", "2026-10-24T15:30:00Z"), 30 * 60 * 1000);
  assert.equal(windowMs(null, exp), 15 * 60 * 1000);
  const d = ringDash(64, 0.5);
  assert.ok(Math.abs(d.offset - d.circumference / 2) < 1e-9);
});

test("format: PKR money and initials", () => {
  assert.equal(formatPkr(4000), "PKR 4,000");
  assert.equal(formatPkr(1234567), "PKR 1,234,567");
  assert.equal(formatPkr(0), "PKR 0");
  assert.equal(formatPkr(null), "PKR –");
  assert.equal(initials("Demo Arena"), "DA");
  assert.equal(initials("khelo"), "K");
  assert.equal(initials(""), "?");
});

test("amenities: known keys get icons, unknown keep their text with a check icon", () => {
  const items = amenityItems(["parking", "Washroom", "changing room", "Rooftop lounge", "", "parking"], "en");
  assert.deepEqual(
    items.map((i) => [i.key, i.icon, i.label]),
    [
      ["parking", "parking", "Parking"],
      ["washrooms", "washroom", "Washrooms"],
      ["changing_room", "changing", "Changing room"],
      ["rooftop_lounge", "check", "Rooftop lounge"],
    ],
  );
  assert.equal(amenityItems(["prayer_area"], "ru")[0].label, "Namaz ki jagah");
  assert.equal(amenityItems(null).length, 0);
});

import { glassMode, venueCardData, formatDistance, placeholderIndex } from "@court-booking/ui-tokens";
import type { VenueSummary } from "@court-booking/types";

test("glass: solid on web, reduce-transparency and low-end Android; blur otherwise", () => {
  assert.equal(glassMode({ os: "ios", reduceTransparency: false }), "blur");
  assert.equal(glassMode({ os: "ios", reduceTransparency: true }), "solid");
  assert.equal(glassMode({ os: "web", reduceTransparency: false }), "solid");
  assert.equal(glassMode({ os: "android", reduceTransparency: false, androidApi: 29, totalMemory: 8e9 }), "solid");
  assert.equal(glassMode({ os: "android", reduceTransparency: false, androidApi: 34, totalMemory: 3e9 }), "solid");
  assert.equal(glassMode({ os: "android", reduceTransparency: false, androidApi: 34, totalMemory: 8e9 }), "blur");
});

test("venue card data: real fields only, rating hidden without reviews, null price stays null", () => {
  const v: VenueSummary = {
    id: "v1", name: "Demo Arena", slug: "demo-arena", city: "Karachi", area: null, sports: ["Padel", "Futsal"],
    amenities: ["parking"], photo_urls: ["a.jpg", "b.jpg"], status: "approved", average_rating: 4.2, review_count: 0,
    distance_meters: 1234, min_price: null,
  };
  const d = venueCardData(v, { sport: "futsal" });
  assert.equal(d.sport, "Futsal");
  assert.equal(d.area, "Karachi");
  assert.equal(d.rating, null);
  assert.equal(d.priceFrom, null);
  assert.equal(d.distance, "1.2 km");
  assert.equal(d.nextFree, null);
  assert.deepEqual(d.photos, ["a.jpg", "b.jpg"]);
  assert.equal(venueCardData({ ...v, review_count: 3, min_price: 2000 }).rating, 4.2);
  assert.equal(venueCardData({ ...v, min_price: 2000 }).priceFrom, "PKR 2,000");
  assert.equal(venueCardData(v, { sport: "Cricket" }).sport, "Padel", "unknown search sport falls back to the venue's");
  assert.equal(formatDistance(640), "640 m");
  assert.equal(formatDistance(null), null);
  assert.equal(formatDistance(23_400), "23 km");
  assert.ok(placeholderIndex("v1") >= 0 && placeholderIndex("v1") < 4);
});
