import { type Tone } from "./tone";

/**
 * The Khelo logo: an accent-coloured rounded square with the court mark, then the "Khelo" wordmark in the display font.
 * `size` is the height of the mark in px (the wordmark scales with it). Pass `onDark` for the white wordmark on dark
 * backgrounds. The tile is brand orange in the player system and teal in the owner system (`tone="owner"`); the court
 * lines are always ink. Same geometry as the design's 34px header logo.
 */
export function Logo({ size = 34, onDark = false, tone = "player" }: { tone?: Tone; size?: number; onDark?: boolean }) {
  const accent = tone === "owner" ? "#0E7C74" : "#FF6A2B";
  const lines = tone === "owner" ? "#FFFFFF" : "#0C1F1D";
  return (
    <span
      className={`inline-flex items-center font-khelo-display font-extrabold leading-none ${onDark ? "text-white" : "text-khelo-ink"}`}
      style={{ gap: Math.round(size * 0.3), fontSize: Math.round(size * 0.82), letterSpacing: "-0.5px" }}
      data-testid="khelo-logo"
    >
      <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect width="34" height="34" rx="10" fill={accent} />
        <rect x="7" y="9" width="20" height="16" rx="2" stroke={lines} strokeWidth="2.2" />
        <path d="M17 9v16M7 17h20" stroke={lines} strokeWidth="2.2" />
      </svg>
      Khelo
    </span>
  );
}
