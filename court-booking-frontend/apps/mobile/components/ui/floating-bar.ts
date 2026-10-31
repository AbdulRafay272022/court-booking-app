import { space } from "@court-booking/ui-tokens";

/** Bottom offset of a floating bar: above the home indicator (or 12 when there is none) plus 8. */
export function floatingBarBottom(bottomInset: number): number {
  return Math.max(bottomInset, space[3]) + space[2];
}

/** Room a scroll view must leave under its last item so a floating bar never covers it: the bar's offset above the
 * home indicator + the bar's height + a 16 gap. */
export function floatingBarRoom(bottomInset: number, barHeight: number): number {
  return floatingBarBottom(bottomInset) + barHeight + space[4];
}
