/** Pure zoom / pan math for the screenshot Lightbox (unit-tested in zoom.test.ts).
 * Coordinates: the image is centred in the stage and then moved by (x, y) px; `scale` is image px -> screen px. */

export interface Size {
  w: number;
  h: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

/** Largest zoom compared to fit. */
export const MAX_FACTOR = 4;
/** One "+" / "-" press. */
export const STEP = 1.5;

/** Scale at which the whole image fits inside the stage (never 0). */
export function fitScale(stage: Size, image: Size): number {
  if (stage.w <= 0 || stage.h <= 0 || image.w <= 0 || image.h <= 0) return 1;
  return Math.min(stage.w / image.w, stage.h / image.h);
}

export function fitView(stage: Size, image: Size): View {
  return { scale: fitScale(stage, image), x: 0, y: 0 };
}

/** Keeps the image covering the stage when it is larger, and centred along an axis where it is smaller. */
export function clampPan(view: View, stage: Size, image: Size): View {
  const dw = image.w * view.scale;
  const dh = image.h * view.scale;
  const maxX = Math.max(0, (dw - stage.w) / 2);
  const maxY = Math.max(0, (dh - stage.h) / 2);
  return { scale: view.scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}

/** Zoom to `nextScale` (clamped to fit..fit*MAX_FACTOR) keeping the point `focus` (px from the stage centre) still. */
export function zoomAt(view: View, nextScale: number, focus: { x: number; y: number }, stage: Size, image: Size): View {
  const fit = fitScale(stage, image);
  const scale = clamp(nextScale, fit, fit * MAX_FACTOR);
  if (scale === fit) return fitView(stage, image);
  const ratio = scale / view.scale;
  const x = focus.x - (focus.x - view.x) * ratio;
  const y = focus.y - (focus.y - view.y) * ratio;
  return clampPan({ scale, x, y }, stage, image);
}

export function isFit(view: View, stage: Size, image: Size): boolean {
  return view.scale <= fitScale(stage, image) * 1.001;
}

export function isMax(view: View, stage: Size, image: Size): boolean {
  return view.scale >= fitScale(stage, image) * MAX_FACTOR * 0.999;
}

/** Zoom level compared to fit, as a whole percentage ("100" = fit). */
export function zoomPercent(view: View, stage: Size, image: Size): number {
  return Math.round((view.scale / fitScale(stage, image)) * 100);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
