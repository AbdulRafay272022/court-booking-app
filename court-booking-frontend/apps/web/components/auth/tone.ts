/** The two deliberate design systems (never unified): player-facing = orange/Figtree,
 * owner-facing = teal/IBM Plex Sans. Values are the theme tokens declared in
 * app/globals.css's @theme block, referenced as CSS variables so nothing here
 * hardcodes a hex. */
export type Tone = "player" | "owner";

export interface ToneTokens {
  bg: string;
  surface: string;
  border: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentSoftBorder: string;
  danger: string;
  dangerSoft: string;
  dangerSoftBorder: string;
  success: string;
  successSoft: string;
  successSoftBorder: string;
  fontClass: string;
}

const v = (name: string) => `var(--color-${name})`;

export const TONES: Record<Tone, ToneTokens> = {
  player: {
    bg: v("player-bg"),
    surface: v("player-surface"),
    border: v("player-border"),
    ink: v("player-ink"),
    muted: v("player-ink-muted"),
    faint: v("player-ink-fainter"),
    accent: v("player-accent"),
    accentHover: v("player-accent-hover"),
    accentSoft: v("player-accent-soft"),
    accentSoftBorder: v("player-accent-soft-border"),
    danger: v("player-danger"),
    dangerSoft: v("player-danger-soft"),
    dangerSoftBorder: v("player-danger-soft-border"),
    success: v("player-success"),
    successSoft: v("player-success-soft"),
    successSoftBorder: v("player-success-soft-border"),
    fontClass: "font-[family-name:var(--font-figtree-x)]",
  },
  owner: {
    bg: v("owner-bg"),
    surface: v("owner-surface"),
    border: v("owner-border"),
    ink: v("owner-ink"),
    muted: v("owner-ink-muted"),
    faint: v("owner-ink-faint"),
    accent: v("owner-accent"),
    accentHover: v("owner-accent-hover"),
    accentSoft: v("owner-accent-soft"),
    accentSoftBorder: v("owner-accent-soft-border"),
    danger: v("owner-danger"),
    dangerSoft: v("owner-danger-soft"),
    dangerSoftBorder: v("owner-danger-soft-border"),
    success: v("owner-success"),
    successSoft: v("owner-success-soft"),
    successSoftBorder: v("owner-success-soft-border"),
    fontClass: "font-[family-name:var(--font-plex-x)]",
  },
};
