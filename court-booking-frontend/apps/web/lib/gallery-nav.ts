/** Pure helpers for the venue photo gallery (no autoplay on the detail page: the photo moves only when the player asks). */

/** Next index after moving `delta` photos, wrapping at both ends. 0 photos -> 0. */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  const i = Math.min(Math.max(0, index), count - 1);
  return (((i + delta) % count) + count) % count;
}

/** Horizontal swipe -> -1 (previous), +1 (next) or 0 (a tap / mostly vertical move, which must stay a scroll or a click). */
export function swipeDelta(start: { x: number; y: number } | null, end: { x: number; y: number } | null, threshold = 40): -1 | 0 | 1 {
  if (!start || !end) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** "1/6" counter text, hidden (null) for 0 or 1 photo. */
export function counterText(index: number, count: number): string | null {
  if (count < 2) return null;
  return `${stepIndex(index, 0, count) + 1}/${count}`;
}
