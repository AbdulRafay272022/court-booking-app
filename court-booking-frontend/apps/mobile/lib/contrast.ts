/** WCAG 2.x contrast ratio between two opaque hex colours ("#RRGGBB" or "#RGB"). 3:1 is the minimum for non-text UI
 * such as a spinner; 4.5:1 for body text. Thin wrapper over the shared Floodlight math in @court-booking/ui-tokens
 * (contrast.ts), kept so existing callers keep their unrounded ratio and hex-only validation. */
import { luminance, parseColor } from "@court-booking/ui-tokens";

export function relativeLuminance(hex: string): number {
  if (!/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) throw new Error(`Not a hex colour: ${hex}`);
  return luminance(parseColor(hex.startsWith("#") ? hex : `#${hex}`));
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
