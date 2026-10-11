import { type Tone } from "./tone";

/**
 * The Khelo logo: the ORIGINAL brand mark (orange gradient tile, white court with centre circle; public/brand/khelo-logo-icon.svg,
 * the artwork from the old Maidan lockup, unchanged) followed by the word "Khelo" as live text in the display font. The old
 * wordmark was outlined paths, so the name is set as text rather than hand-traced. `size` is the tile height in px (the word scales
 * with it). Pass `onDark` for the white wordmark on dark backgrounds. `tone` is kept for call-site compatibility: the mark is the same
 * in the player and owner systems.
 */
export function Logo({ size = 34, onDark = false }: { tone?: Tone; size?: number; onDark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center font-khelo-display font-extrabold leading-none ${onDark ? "text-white" : "text-khelo-ink"}`}
      style={{ gap: Math.round(size * 0.3), fontSize: Math.round(size * 0.82), letterSpacing: "-0.5px" }}
      data-testid="khelo-logo"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing here */}
      <img src="/brand/khelo-logo-icon.svg" alt="" width={size} height={size} draggable={false} style={{ flexShrink: 0, width: size, height: size }} />
      Khelo
    </span>
  );
}
