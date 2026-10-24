/**
 * Floodlight design tokens. Source of truth: design/khelo-mobile-floodlight/System.dc.html (+ README role table).
 * This package is the ONLY place in the frontend where Floodlight hex values live. Components read these tokens
 * (mobile: `useFl()` / StyleSheet values; web: the `fl-*` Tailwind utilities generated into theme.css).
 *
 * Hard rules encoded here (and asserted by the contrast test in apps/mobile/lib/fl-contrast.test.ts):
 * - orange buttons use ink text (5.98:1); white on orange (2.86:1) is banned.
 * - teal buttons use white text (5.06:1).
 * - small text is never #8A9996 (2.97:1); use muted (#4A5D5A) or muted2 (#5B6E6B).
 * - teal text on a teal tint uses tealDeep (#0A5F59).
 * - owner role never uses orange for a primary action (only the notification badge and the "now" line).
 */

/** Every solid colour the boards use for UI (ColorLab-only sample colours are not here on purpose). */
export const palette = {
  /** Night / ink: hero stage, body text, dark buttons. */
  night: "#0C1F1D",
  white: "#FFFFFF",
  /** Ground: the calm 60% surface. */
  ground: "#F4F6F5",
  /** Mist: board background, close-button fill, neutral pill. */
  mist: "#E8ECEB",
  /** Lines. `line` = card/divider borders, `lineStrong` = input / chip borders. */
  line: "#DDE3E1",
  lineStrong: "#CFD8D6",
  divider: "#EEF2F1",
  /** Booked slot fill / skeleton block. */
  bookedBg: "#E1E7E5",

  /** Text greys (all pass 4.5:1 on white AND ground). */
  body: "#3B4B48",
  muted: "#4A5D5A",
  muted2: "#5B6E6B",
  /** Text on night. */
  onDarkMuted: "#B9C6C3",
  onDarkSoft: "#D5E0DE",

  /** Action orange: the ONE next step per player screen. Always ink text. */
  orange: "#FF6A2B",
  orangeTint: "#FFE7DB",
  orangePeach: "#FFB48F",
  /** Orange-family text/links on light. */
  orangeDeep: "#B83E00",
  orangeDeeper: "#8F3000",

  /** Teal: brand secondary, owner-led. */
  teal: "#0E7C74",
  tealDeep: "#0A5F59",
  tealTint: "#E3F4F1",
  /** Growth heatmap "half full" cell. */
  tealHalf: "#CFE9E5",
  /** QR scanner frame on night. */
  scanFrame: "#1C3B38",

  /** Status families (text on tint all pass 4.5:1). */
  open: "#0B6B43",
  openTint: "#DFF5EA",
  waiting: "#8A5A00",
  waitingTint: "#FFF1D6",
  /** Dashed border of a slot somebody else holds. */
  waitingBorder: "#B87300",
  danger: "#B42318",
  dangerTint: "#FDE8E5",
  dangerBorder: "#F0C3BD",

  /** Accents that are NEVER text on light: live dot on dark, hold hourglass / border. */
  mint: "#3DDC97",
  amber: "#FFB020",
  /** Floodlight glow behind night heroes (decorative, low opacity). */
  glow: "#FFF1D0",

  /** Documented as banned for text (2.97:1 on white). Present only so the contrast test can assert it is unused. */
  bannedGrey: "#8A9996",
} as const;

export type PaletteKey = keyof typeof palette;

/** Translucent colours (glass, scrims, overlays on photos). Values are from the boards' rgba() styles. */
export const alpha = {
  /** Sheet / modal backdrop. */
  scrim: "rgba(12,31,29,0.5)",
  /** Light glass: tab bar, book bar (blur behind). */
  glassLight: "rgba(255,255,255,0.74)",
  /** Light glass without blur support: still readable, used as the "frosted" fallback before going fully solid. */
  glassLightStrong: "rgba(255,255,255,0.86)",
  glassLightBorder: "rgba(255,255,255,0.9)",
  /** Dark glass on night heroes / photos. */
  glassDark: "rgba(255,255,255,0.1)",
  glassDarkBorder: "rgba(255,255,255,0.16)",
  /** Glass on the TEAL owner hero (chips, tiles, venue switch): a night tint, not white. White text on the white 0.1
   * glass over the lightest teal stop was 4.21:1 (QA); on this tint it is >= 5.9:1. */
  glassOnTeal: "rgba(12,31,29,0.16)",
  glassOnTealBorder: "rgba(255,255,255,0.22)",
  /** Chips and buttons sitting on photos. */
  /** Text chips on photos. Board: 0.38 with blur; raised to 0.62 so white text passes 4.5:1 even on a white photo. */
  onPhoto: "rgba(12,31,29,0.62)",
  onPhotoStrong: "rgba(12,31,29,0.42)",
  onPhotoBorder: "rgba(255,255,255,0.3)",
  /** Icon buttons on photos. Board: 0.32; raised to 0.5 so a white icon passes 3:1 even on a white photo. */
  heartOnPhoto: "rgba(12,31,29,0.5)",
  /** Carousel dot (inactive) and photo arrows. */
  dotIdle: "rgba(255,255,255,0.45)",
  arrowOnPhoto: "rgba(255,255,255,0.9)",
  /** Placeholder court-line art. */
  courtLines: "rgba(255,255,255,0.5)",
  /** Hero ring on the pay countdown (track). */
  ringTrackOnDark: "rgba(255,255,255,0.12)",
  ringTrackOnLight: "rgba(12,31,29,0.08)",
  /** Pay step bar idle segment on night. */
  stepIdleOnDark: "rgba(255,255,255,0.18)",
  /** Dashed prototype outline on dark (dev page only). */
  dashedOnDark: "rgba(255,255,255,0.4)",
  /** Neutral pressed / soft icon button fill on light. */
  softOnLight: "rgba(14,20,18,0.06)",
} as const;

/** The 4px spacing scale. Keys match Tailwind numbering (space[4] = 16 = `p-4`). Only these values. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export type SpaceKey = keyof typeof space;

/** Page gutters (System board: 20 player · 16 owner). */
export const gutter = { player: 20, owner: 16 } as const;

/** Radius: chip 999 · button 18 · card 24–28 · sheet 30. */
export const radius = {
  xs: 8,
  sm: 12,
  md: 14,
  input: 16,
  button: 18,
  tile: 20,
  card: 24,
  cardL: 28,
  sheet: 30,
  pill: 999,
} as const;

/** Sizes: tap target 44 min · CTA 52–58. */
export const size = {
  tap: 44,
  ctaS: 44,
  ctaM: 52,
  cta: 56,
  input: 56,
  tabBar: 70,
  tabBarOwner: 72,
  fab: 52,
  icon: 20,
  iconS: 16,
  iconL: 24,
} as const;

/** Box shadows as CSS strings (web, and RN >= 0.76 `boxShadow` style). */
export const shadow = {
  card: "0 8px 22px rgba(12,31,29,0.06)",
  cardSoft: "0 4px 12px rgba(14,20,18,0.05)",
  raised: "0 16px 40px rgba(12,31,29,0.18)",
  ticket: "0 16px 40px rgba(14,20,18,0.12)",
  popover: "0 18px 40px rgba(12,31,29,0.18)",
  ctaOrange: "0 10px 22px rgba(255,106,43,0.35)",
  ctaTeal: "0 8px 18px rgba(14,124,116,0.4)",
  segment: "0 2px 8px rgba(12,31,29,0.1)",
  knob: "0 1px 3px rgba(0,0,0,0.25)",
  none: "none",
} as const;

/** Motion: 150–250 ms, OFF when reduce-motion is on. Carousel timings come from the venue-card spec. */
export const motion = {
  fast: 150,
  base: 200,
  slow: 250,
  /** Photo slide (venue card spec: ~400 ms). The only animation longer than 250 ms. */
  slide: 400,
  /** Venue card photo autoplay interval. */
  autoplay: 3500,
  /** Autoplay resumes this long after the last touch. */
  resumeAfterTouch: 6000,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

/** Font families. Mobile names are the expo-google-fonts keys loaded in app/_layout.tsx; web uses next/font variables. */
export const fontFamily = {
  mobile: {
    display: "BricolageGrotesque_800ExtraBold",
    displayBold: "BricolageGrotesque_700Bold",
    displaySemi: "BricolageGrotesque_600SemiBold",
    body: "PlusJakartaSans_400Regular",
    bodyMedium: "PlusJakartaSans_500Medium",
    bodySemi: "PlusJakartaSans_600SemiBold",
    bodyBold: "PlusJakartaSans_700Bold",
    bodyBlack: "PlusJakartaSans_800ExtraBold",
  },
  web: {
    display: "var(--font-khelo-display-x), 'Bricolage Grotesque', system-ui, sans-serif",
    body: "var(--font-khelo-body-x), 'Plus Jakarta Sans', system-ui, sans-serif",
  },
} as const;

export type FontWeightKey = "regular" | "medium" | "semi" | "bold" | "black";

/**
 * Type scale (System board: 12 · 14 · 16 · 20 · 24 · 34 · 44, plus the 11/13/15/17/26/36 sizes the boards use for tab labels,
 * meta lines, secondary buttons, CTA labels and hero titles). Display styles use Bricolage; everything else Jakarta.
 * Numbers are always tabular (never monospace).
 */
export const type = {
  displayXL: { size: 44, lineHeight: 46, weight: "black", display: true, letterSpacing: -1.3 },
  display: { size: 36, lineHeight: 38, weight: "black", display: true, letterSpacing: -1.08 },
  h1: { size: 34, lineHeight: 36, weight: "black", display: true, letterSpacing: -1 },
  h2: { size: 26, lineHeight: 30, weight: "black", display: true, letterSpacing: -0.5 },
  h3: { size: 24, lineHeight: 28, weight: "black", display: true, letterSpacing: -0.4 },
  title: { size: 20, lineHeight: 25, weight: "black", display: true, letterSpacing: 0 },
  cta: { size: 17, lineHeight: 22, weight: "black", display: false, letterSpacing: 0 },
  bodyL: { size: 16, lineHeight: 24, weight: "regular", display: false, letterSpacing: 0 },
  bodyStrong: { size: 16, lineHeight: 22, weight: "black", display: false, letterSpacing: 0 },
  button: { size: 15, lineHeight: 20, weight: "black", display: false, letterSpacing: 0 },
  body: { size: 14, lineHeight: 20, weight: "regular", display: false, letterSpacing: 0 },
  bodyBold: { size: 14, lineHeight: 20, weight: "black", display: false, letterSpacing: 0 },
  meta: { size: 13, lineHeight: 18, weight: "regular", display: false, letterSpacing: 0 },
  label: { size: 13, lineHeight: 18, weight: "black", display: false, letterSpacing: 0 },
  caption: { size: 12, lineHeight: 17, weight: "regular", display: false, letterSpacing: 0 },
  eyebrow: { size: 12, lineHeight: 16, weight: "black", display: false, letterSpacing: 1.2 },
  tab: { size: 11, lineHeight: 14, weight: "black", display: false, letterSpacing: 0 },
} as const satisfies Record<
  string,
  { size: number; lineHeight: number; weight: FontWeightKey; display: boolean; letterSpacing: number }
>;

export type TypeVariant = keyof typeof type;

/** Map a type variant to the mobile font family name. */
export function mobileFontFor(variant: TypeVariant, weightOverride?: FontWeightKey): string {
  const t = type[variant];
  const w = weightOverride ?? t.weight;
  if (t.display) {
    if (w === "semi" || w === "medium" || w === "regular") return fontFamily.mobile.displaySemi;
    if (w === "bold") return fontFamily.mobile.displayBold;
    return fontFamily.mobile.display;
  }
  switch (w) {
    case "regular":
      return fontFamily.mobile.body;
    case "medium":
      return fontFamily.mobile.bodyMedium;
    case "semi":
      return fontFamily.mobile.bodySemi;
    case "bold":
      return fontFamily.mobile.bodyBold;
    default:
      return fontFamily.mobile.bodyBlack;
  }
}

/** CSS font-weight number for a weight key (web). */
export const cssWeight: Record<FontWeightKey, number> = { regular: 400, medium: 500, semi: 600, bold: 700, black: 800 };
