/** WCAG 2.x contrast math (pure). Used by the contrast test and available to screens that compute colours. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse "#RGB", "#RRGGBB" or "rgba(r,g,b,a)" / "rgb(r,g,b)". Throws on anything else. */
export function parseColor(input: string): Rgba {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
  throw new Error(`Unsupported colour: ${input}`);
}

/** Composite a (possibly translucent) colour over an opaque background. */
export function over(fg: string, bg: string): Rgba {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (b.a !== 1) throw new Error(`Background must be opaque: ${bg}`);
  return { r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Contrast ratio of fg on bg (fg may be translucent; bg must be opaque). Rounded to 2 decimals. */
export function contrast(fg: string, bg: string): number {
  const f = over(fg, bg);
  const b = parseColor(bg);
  const l1 = luminance(f);
  const l2 = luminance(b);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** WCAG AA minimums: 4.5 for text, 3 for UI parts (icons, state-bearing borders) and large text (>= 24px or >= 18.66px bold). */
export const MIN_TEXT = 4.5;
export const MIN_UI = 3;
