/** Countdown math for CountdownRing / hold timers. Always from a REAL expiry timestamp (booking.held_until), never a local guess. */
export interface Countdown {
  msLeft: number;
  expired: boolean;
  /** "14:56" (mm:ss), or "1:02:05" past an hour. */
  label: string;
  /** Remaining share 0..1 of the whole window (1 = full ring). */
  fraction: number;
}

/** Default window when the start of the hold is unknown (venue default hold = 15 min, docs/floodlight-contract.md). */
export const DEFAULT_HOLD_MS = 15 * 60 * 1000;

export function countdown(expiresAt: string | number | null | undefined, now: number, totalMs: number = DEFAULT_HOLD_MS): Countdown {
  const end = typeof expiresAt === "number" ? expiresAt : expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(end)) return { msLeft: 0, expired: true, label: "0:00", fraction: 0 };
  const msLeft = Math.max(0, end - now);
  const totalSec = Math.ceil(msLeft / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  const label = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, msLeft / totalMs)) : 0;
  return { msLeft, expired: msLeft === 0, label, fraction };
}

/** Total window from a start and an expiry (e.g. booking.created_at -> held_until), falling back to the default. */
export function windowMs(startedAt: string | null | undefined, expiresAt: string | null | undefined): number {
  const a = startedAt ? Date.parse(startedAt) : NaN;
  const b = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) return b - a;
  return DEFAULT_HOLD_MS;
}

/** SVG ring geometry: dash offset for a circle of radius r showing `fraction` remaining. */
export function ringDash(r: number, fraction: number): { circumference: number; offset: number } {
  const circumference = 2 * Math.PI * r;
  return { circumference, offset: circumference * (1 - Math.min(1, Math.max(0, fraction))) };
}
