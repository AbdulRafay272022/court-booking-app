import { type Tone } from "./tone";

/** The Maidan logo: the real brand lockup (icon + wordmark) from docs/maidan-logo-full-*-v2.svg, cleaned
 * and text-outlined into public/brand/ (see the frontend CLAUDE.md for exactly how). `size` is the HEIGHT in
 * px (the lockup is 720x230). Light backgrounds use the light lockup (dark wordmark); pass `onDark` for the
 * white-wordmark variant. `tone` is kept for call-site compatibility -- the lockup is the same brand mark in
 * both design systems (the icon tile is always brand orange). */
export function Logo({ size = 44, onDark = false }: { tone?: Tone; size?: number; onDark?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing here
    <img
      src={onDark ? "/brand/maidan-logo-full-dark.svg" : "/brand/maidan-logo-full-light.svg"}
      alt="Maidan"
      height={size}
      width={Math.round((size * 720) / 230)}
      style={{ height: size, width: "auto", display: "block" }}
      draggable={false}
    />
  );
}
