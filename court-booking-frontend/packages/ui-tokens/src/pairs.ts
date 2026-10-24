import { alpha, palette } from "./tokens";
import { buttonVariant, role, slot, text, tone, type Role } from "./roles";

/**
 * Every foreground/background pair the Floodlight components render, so the contrast test can check them all.
 * kind "text" must reach 4.5:1, kind "ui" (icons, state-bearing borders, rings, tracks, large display text) 3:1.
 * Translucent backgrounds are listed with the opaque surface they sit on (`over`).
 * When a component starts using a new colour pair, add it here (the contrast test is only as good as this list).
 */
export interface ColorPair {
  name: string;
  fg: string;
  bg: string;
  /** Opaque surface under a translucent `bg`. */
  over?: string;
  kind: "text" | "ui";
}

/**
 * Pairs that are deliberately below 3:1 and why that is acceptable (state is carried by something else). The test prints
 * them so nobody mistakes them for a pass, and fails if one is ever used as a text pair.
 */
export const EXEMPT_PAIRS: (ColorPair & { why: string })[] = [
  { name: "input resting border", fg: palette.lineStrong, bg: palette.white, kind: "ui", why: "Field identity comes from the always-visible label above it (never placeholder-only)." },
  { name: "card / divider lines", fg: palette.line, bg: palette.white, kind: "ui", why: "Decorative grouping; no information." },
  { name: "player selected border on tint", fg: palette.orange, bg: palette.orangeTint, kind: "ui", why: "Selection is also a ✓ tick prefix + aria-selected/pressed (System board: never colour-only)." },
  { name: "player focus ring on white", fg: palette.orange, bg: palette.white, kind: "ui", why: "WCAG 2.4.7 (AA) requires a visible focus indicator, no ratio; ring is 2px and the label stays visible." },
  { name: "player checkbox fill vs white", fg: palette.orange, bg: palette.white, kind: "ui", why: "The ink ✓ glyph on the orange box (5.98) carries the state, plus accessibilityState.checked / aria-checked. Owner teal fill passes 5.06." },
  { name: "switch off track", fg: palette.lineStrong, bg: palette.white, kind: "ui", why: "State also carried by knob position + accessibilityState/aria-checked." },
  { name: "slot noRoom dashed border", fg: palette.lineStrong, bg: palette.ground, kind: "ui", why: "Disabled control (WCAG 1.4.11 exempts inactive components); the reason is in the label." },
  { name: "held slot dashed border", fg: palette.waitingBorder, bg: palette.waitingTint, kind: "ui", why: "Disabled control; text (#8A5A00, 5.31) and dashed pattern carry the state." },
  { name: "carousel idle dot", fg: alpha.dotIdle, bg: palette.night, kind: "ui", why: "Decorative (aria-hidden); the carousel label states 'photo X of N'." },
];

function roleTextPairs(r: Role): ColorPair[] {
  const t = role[r];
  const out: ColorPair[] = [
    { name: `${r} primary button`, fg: t.primary.fg, bg: t.primary.bg, kind: "text" },
    { name: `${r} active tab`, fg: t.tabActive.fg, bg: t.tabActive.bg, kind: "text" },
    { name: `${r} idle tab on light glass`, fg: t.tabIdle.fg, bg: alpha.glassLight, over: palette.ground, kind: "text" },
    { name: `${r} idle tab on solid bar`, fg: t.tabIdle.fg, bg: palette.white, kind: "text" },
    { name: `${r} selected chip`, fg: t.selected.fg, bg: t.selected.bg, kind: "text" },
    { name: `${r} slot selected`, fg: t.slotSelected.fg, bg: t.slotSelected.bg, kind: "text" },
    { name: `${r} slot selected outline vs ground`, fg: t.slotSelected.border, bg: palette.ground, kind: "ui" },
    { name: `${r} slot in range`, fg: t.slotInRange.fg, bg: t.slotInRange.bg, kind: "text" },
    { name: `${r} hero text`, fg: t.hero.fg, bg: t.hero.bg, kind: "text" },
    { name: `${r} hero muted text`, fg: t.hero.fgMuted, bg: t.hero.bg, kind: "text" },
    { name: `${r} link on white`, fg: t.link, bg: palette.white, kind: "text" },
    { name: `${r} link on ground`, fg: t.link, bg: palette.ground, kind: "text" },
    { name: `${r} accent text on white`, fg: t.accentText, bg: palette.white, kind: "text" },
    { name: `${r} checkbox/radio on`, fg: t.control.onFg, bg: t.control.onBg, kind: "text" },
    { name: `${r} switch on vs white`, fg: t.switchOn, bg: palette.white, kind: "ui" },
    ...(r === "owner" ? [{ name: "owner checkbox fill vs white", fg: t.control.onBg, bg: palette.white, kind: "ui" as const }] : []),
    { name: `${r} badge`, fg: t.badge.fg, bg: t.badge.bg, kind: "text" },
    { name: `${r} countdown ring on night`, fg: t.ringOnHero, bg: palette.night, kind: "ui" },
    { name: `${r} countdown ring on hero`, fg: t.ringOnHero, bg: t.hero.bg, kind: "ui" },
  ];
  if (t.hero.stops) {
    for (const stop of t.hero.stops) {
      out.push({ name: `${r} hero text on gradient stop ${stop}`, fg: t.hero.fg, bg: stop, kind: "text" });
      out.push({ name: `${r} hero muted text on gradient stop ${stop}`, fg: t.hero.fgMuted, bg: stop, kind: "text" });
    }
  }
  if (t.fab) out.push({ name: `${r} FAB icon`, fg: t.fab.fg, bg: t.fab.bg, kind: "ui" });
  if (r === "owner") out.push({ name: "owner countdown ring on white", fg: t.ring, bg: palette.white, kind: "ui" });
  return out;
}

export function colorPairs(): ColorPair[] {
  const pairs: ColorPair[] = [...roleTextPairs("player"), ...roleTextPairs("owner")];

  for (const [k, v] of Object.entries(buttonVariant)) {
    if (k === "disabled") continue;
    pairs.push({ name: `button ${k}`, fg: v.fg, bg: v.bg, kind: "text" });
  }
  // Disabled buttons are exempt from contrast by WCAG, but we keep their label readable anyway.
  pairs.push({ name: "button disabled label", fg: buttonVariant.disabled.fg, bg: buttonVariant.disabled.bg, kind: "text" });

  for (const [k, v] of Object.entries(slot)) {
    const bg = v.bg === "transparent" ? palette.ground : v.bg;
    pairs.push({ name: `slot ${k}`, fg: v.fg, bg, kind: "text" });
    if (v.bg === "transparent") pairs.push({ name: `slot ${k} on white`, fg: v.fg, bg: palette.white, kind: "text" });
  }
  pairs.push({ name: "slot mine outline vs ground", fg: slot.mine.border, bg: palette.ground, kind: "ui" });

  for (const [k, v] of Object.entries(tone)) {
    pairs.push({ name: `tone ${k} text`, fg: v.fg, bg: v.bg, kind: "text" });
    pairs.push({ name: `tone ${k} icon`, fg: v.icon, bg: v.bg, kind: "ui" });
  }

  for (const surfaceName of ["white", "ground"] as const) {
    const bg = palette[surfaceName];
    pairs.push({ name: `primary text on ${surfaceName}`, fg: text.primary, bg, kind: "text" });
    pairs.push({ name: `body text on ${surfaceName}`, fg: text.body, bg, kind: "text" });
    pairs.push({ name: `muted text on ${surfaceName}`, fg: text.muted, bg, kind: "text" });
    pairs.push({ name: `subtle text on ${surfaceName}`, fg: text.subtle, bg, kind: "text" });
    pairs.push({ name: `danger text on ${surfaceName}`, fg: text.danger, bg, kind: "text" });
    pairs.push({ name: `teal icon on ${surfaceName}`, fg: palette.teal, bg, kind: "ui" });
    pairs.push({ name: `tealDeep text on ${surfaceName}`, fg: palette.tealDeep, bg, kind: "text" });
  }
  pairs.push({ name: "muted text on mist", fg: text.muted, bg: palette.mist, kind: "text" });
  pairs.push({ name: "primary text on mist", fg: text.primary, bg: palette.mist, kind: "text" });
  pairs.push({ name: "white on night", fg: text.onDark, bg: palette.night, kind: "text" });
  pairs.push({ name: "onDarkMuted on night", fg: text.onDarkMuted, bg: palette.night, kind: "text" });
  pairs.push({ name: "onDarkSoft on night", fg: text.onDarkSoft, bg: palette.night, kind: "text" });
  pairs.push({ name: "white on dark glass (night)", fg: text.onDark, bg: alpha.glassDark, over: palette.night, kind: "text" });
  pairs.push({ name: "white on teal-hero glass (lightest stop)", fg: text.onDark, bg: alpha.glassOnTeal, over: palette.teal, kind: "text" });
  pairs.push({ name: "amber icon on night (offline banner, hourglass)", fg: palette.amber, bg: palette.night, kind: "ui" });
  pairs.push({ name: "mint step label on night (pay step bar)", fg: palette.mint, bg: palette.night, kind: "text" });
  pairs.push({ name: "waiting title on white (timeline now)", fg: palette.waiting, bg: palette.white, kind: "text" });
  pairs.push({ name: "white tick on teal / danger dot", fg: palette.white, bg: palette.danger, kind: "ui" });
  pairs.push({ name: "mint live dot on night", fg: palette.mint, bg: palette.night, kind: "ui" });
  pairs.push({ name: "orange text on night (eyebrow, 404)", fg: palette.orange, bg: palette.night, kind: "text" });
  pairs.push({ name: "amenity count badge", fg: palette.tealDeep, bg: palette.tealTint, kind: "text" });
  pairs.push({ name: "ink on amber dot (status hero)", fg: palette.night, bg: palette.amber, kind: "ui" });
  // Photo overlays: worst case is a pure white photo under the translucent chip.
  pairs.push({ name: "white text on photo chip (worst case: white photo)", fg: palette.white, bg: alpha.onPhoto, over: palette.white, kind: "text" });
  pairs.push({ name: "white icon on photo button (worst case: white photo)", fg: palette.white, bg: alpha.heartOnPhoto, over: palette.white, kind: "ui" });
  pairs.push({ name: "ink on photo arrow button", fg: palette.night, bg: alpha.arrowOnPhoto, over: palette.night, kind: "ui" });
  pairs.push({ name: "ink on white next-free pill", fg: palette.night, bg: palette.white, kind: "text" });
  return pairs;
}
