import { ApiError } from "@court-booking/api-client";

/** Long side of an uploaded payment screenshot. A phone screenshot (1080x2400) becomes 720x1600: the amount, name and
 * reference stay easily readable for the OCR and the owner, and the file drops from several MB to a few hundred KB, which
 * is what lets it finish on a slow 3G connection inside the 45 s upload timeout. */
export const PROOF_MAX_SIDE = 1600;
export const PROOF_JPEG_QUALITY = 0.7;

/** The resize action for an image, or null when it is already small enough (never upscale). Only one side is given so
 * the aspect ratio is kept. */
export function proofResize(width: number, height: number, maxSide = PROOF_MAX_SIDE): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (Math.max(width, height) <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}

export function jpegName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]+$/, "");
  return `${base || "proof"}.jpg`;
}

/** A failure worth offering "Try again" for: the request timed out or never reached the server. A real refusal from the
 * server (wrong state, file too big, ...) is shown as-is instead. */
export function isRetryableUploadError(e: unknown): boolean {
  if (e instanceof ApiError) return e.code === "REQUEST_TIMEOUT" || e.status === 0;
  return true;
}
