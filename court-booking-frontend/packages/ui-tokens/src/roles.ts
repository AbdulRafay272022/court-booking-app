import { alpha, gutter, palette, shadow } from "./tokens";

/**
 * Role themes (README role table). Picked by ROUTE GROUP, never per screen:
 * mobile (player)/(auth) -> player, (owner) -> owner; web player pages -> player, /dashboard/owner + /venue-setup -> owner.
 */
export type Role = "player" | "owner";

export interface RoleTheme {
  role: Role;
  /** Primary button (the one main action). */
  primary: { bg: string; fg: string; border: string; shadow: string };
  /** Active tab pill. */
  tabActive: { bg: string; fg: string };
  /** Tab label/icon when not active. */
  tabIdle: { fg: string };
  /** Selected chip / court / day / option. */
  selected: { bg: string; fg: string; border: string };
  /** Slot chip "your start" and "inside your booking". */
  slotSelected: { bg: string; fg: string; border: string };
  slotInRange: { bg: string; fg: string; border: string };
  /** Hero background: a solid colour (player) or a gradient (owner). `gradient` is CSS; `stops` for expo-linear-gradient. */
  hero: { bg: string; fg: string; fgMuted: string; gradient: string | null; stops: readonly string[] | null; angle: number };
  /** Text links and small accent text on light surfaces. */
  link: string;
  /** Accent text / icon colour on light (eyebrows, small highlights). */
  accentText: string;
  /** Input focus border and checkbox/radio "on" fill. */
  focusBorder: string;
  control: { onBg: string; onFg: string };
  /** Switch track when on. */
  switchOn: string;
  /** Floating action button (owner only; null on player). */
  fab: { bg: string; fg: string; shadow: string } | null;
  /** Notification count badge (orange + ink on both sides: the one orange accent allowed on owner). */
  badge: { bg: string; fg: string };
  /** Timeline "now" line. */
  nowLine: string;
  /** Countdown ring progress colour on light surfaces, and on the role hero (`ringOnHero`). */
  ring: string;
  ringOnHero: string;
  /** Page gutter. */
  gutter: number;
}

export const role: Record<Role, RoleTheme> = {
  player: {
    role: "player",
    primary: { bg: palette.orange, fg: palette.night, border: palette.orange, shadow: shadow.ctaOrange },
    tabActive: { bg: palette.orange, fg: palette.night },
    tabIdle: { fg: palette.muted },
    selected: { bg: palette.orangeTint, fg: palette.night, border: palette.orange },
    slotSelected: { bg: palette.orange, fg: palette.night, border: palette.night },
    slotInRange: { bg: palette.orangeTint, fg: palette.orangeDeep, border: palette.orangePeach },
    hero: { bg: palette.night, fg: palette.white, fgMuted: palette.onDarkMuted, gradient: null, stops: null, angle: 0 },
    link: palette.orangeDeep,
    accentText: palette.orangeDeep,
    focusBorder: palette.orange,
    control: { onBg: palette.orange, onFg: palette.night },
    switchOn: palette.night,
    fab: null,
    badge: { bg: palette.orange, fg: palette.night },
    nowLine: palette.orange,
    ring: palette.orange,
    ringOnHero: palette.orange,
    gutter: gutter.player,
  },
  owner: {
    role: "owner",
    primary: { bg: palette.teal, fg: palette.white, border: palette.teal, shadow: shadow.ctaTeal },
    tabActive: { bg: palette.teal, fg: palette.white },
    tabIdle: { fg: palette.body },
    selected: { bg: palette.tealTint, fg: palette.tealDeep, border: palette.teal },
    slotSelected: { bg: palette.teal, fg: palette.white, border: palette.night },
    slotInRange: { bg: palette.tealTint, fg: palette.tealDeep, border: palette.teal },
    hero: {
      bg: palette.tealDeep,
      fg: palette.white,
      /** White, not onDarkSoft: #D5E0DE on the gradient's teal top is only 3.74:1. Hierarchy comes from size/weight. */
      fgMuted: palette.white,
      gradient: `linear-gradient(165deg, ${palette.teal} 0%, ${palette.tealDeep} 55%, ${palette.night} 100%)`,
      stops: [palette.teal, palette.tealDeep, palette.night],
      angle: 165,
    },
    link: palette.tealDeep,
    accentText: palette.tealDeep,
    focusBorder: palette.teal,
    control: { onBg: palette.teal, onFg: palette.white },
    switchOn: palette.teal,
    fab: { bg: palette.teal, fg: palette.white, shadow: shadow.ctaTeal },
    badge: { bg: palette.orange, fg: palette.night },
    nowLine: palette.orange,
    ring: palette.teal,
    /** Teal on the teal gradient hero is invisible: white there. */
    ringOnHero: palette.white,
    gutter: gutter.owner,
  },
};

/** Role-independent semantic surfaces and text colours. */
export const surface = {
  page: palette.ground,
  card: palette.white,
  sunken: palette.ground,
  mist: palette.mist,
  night: palette.night,
  border: palette.line,
  borderStrong: palette.lineStrong,
  divider: palette.divider,
  scrim: alpha.scrim,
} as const;

export const text = {
  primary: palette.night,
  body: palette.body,
  muted: palette.muted,
  subtle: palette.muted2,
  onDark: palette.white,
  onDarkMuted: palette.onDarkMuted,
  onDarkSoft: palette.onDarkSoft,
  danger: palette.danger,
  open: palette.open,
  waiting: palette.waiting,
  info: palette.tealDeep,
} as const;

/** Tones for pills, banners and badges. `fg` on `bg` always passes 4.5:1. `icon` passes 3:1 on `bg`. */
export type Tone = "open" | "waiting" | "danger" | "neutral" | "info" | "night" | "accent";
export const tone: Record<Tone, { bg: string; fg: string; border: string; icon: string }> = {
  open: { bg: palette.openTint, fg: palette.open, border: palette.openTint, icon: palette.open },
  waiting: { bg: palette.waitingTint, fg: palette.waiting, border: palette.waitingTint, icon: palette.waiting },
  danger: { bg: palette.dangerTint, fg: palette.danger, border: palette.dangerBorder, icon: palette.danger },
  neutral: { bg: palette.mist, fg: palette.body, border: palette.line, icon: palette.body },
  info: { bg: palette.tealTint, fg: palette.tealDeep, border: palette.tealTint, icon: palette.tealDeep },
  night: { bg: palette.night, fg: palette.white, border: palette.night, icon: palette.amber },
  accent: { bg: palette.orangeTint, fg: palette.orangeDeep, border: palette.orangeTint, icon: palette.orangeDeep },
};

/** Button variants other than primary (primary comes from the role). */
export const buttonVariant = {
  /** Dark, calm secondary action ("Wahi slot", "Meri bookings"). */
  secondary: { bg: palette.night, fg: palette.white, border: palette.night },
  /** Light outline ("Home par jayein"). */
  soft: { bg: palette.white, fg: palette.night, border: palette.lineStrong },
  /** Destructive ("Reject", "Cancel karein"). */
  danger: { bg: palette.white, fg: palette.danger, border: palette.dangerBorder },
  /** Destructive filled (the confirm step of a cancel sheet). */
  dangerSolid: { bg: palette.danger, fg: palette.white, border: palette.danger },
  /** Disabled (any variant). */
  disabled: { bg: palette.bookedBg, fg: palette.muted, border: palette.bookedBg },
} as const;

/** Slot chip states that do not depend on role (System board "every state, never by colour alone"). */
export const slot = {
  open: { bg: palette.ground, fg: palette.night, border: palette.line, borderStyle: "solid", borderWidth: 1 },
  held: { bg: palette.waitingTint, fg: palette.waiting, border: palette.waitingBorder, borderStyle: "dashed", borderWidth: 1 },
  booked: { bg: palette.bookedBg, fg: palette.muted, border: palette.bookedBg, borderStyle: "solid", borderWidth: 0 },
  noRoom: { bg: "transparent", fg: palette.muted2, border: palette.lineStrong, borderStyle: "dashed", borderWidth: 1 },
  blocked: { bg: palette.mist, fg: palette.muted, border: palette.lineStrong, borderStyle: "dashed", borderWidth: 1 },
  mine: { bg: palette.openTint, fg: palette.open, border: palette.open, borderStyle: "solid", borderWidth: 2 },
} as const;

/** Glass (floating bars only). `solid` is the fallback for reduce-transparency, web without backdrop-filter, low-end Android. */
export const glass = {
  light: { bg: alpha.glassLight, border: alpha.glassLightBorder, solid: palette.white, solidBorder: palette.line },
  dark: { bg: alpha.glassDark, border: alpha.glassDarkBorder, solid: palette.night, solidBorder: palette.night },
} as const;
