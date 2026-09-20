import { ApiError } from "./client";

/** Sessions last 8h (Section 26). Refresh when this little is left, so a user who
 * opens the app at hour 7.2 gets a new window instead of a login screen. */
export const REFRESH_WHEN_LESS_THAN_MS = 60 * 60 * 1000;
/** How often a foregrounded app re-checks whether it's time to refresh. */
export const REFRESH_CHECK_INTERVAL_MS = 60 * 1000;

export function msUntilExpiry(expiresAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) ? null : t - now;
}

/** True when the session is inside the refresh window (or already past it -- the
 * server will then say so, which is the right time to find out). Unknown expiry
 * (a session stored before expiry was tracked) counts as "refresh now". */
export function shouldRefreshSoon(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
  thresholdMs: number = REFRESH_WHEN_LESS_THAN_MS,
): boolean {
  const left = msUntilExpiry(expiresAt, now);
  return left === null || left < thresholdMs;
}

export type RestoreResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthorized" }
  /** The server couldn't be reached (or errored) on every attempt. Says NOTHING about
   * whether the stored session is still valid -- callers must not treat it as a logout. */
  | { kind: "unreachable"; error: unknown };

const DEFAULT_RETRY_DELAYS_MS = [800, 2000, 4500];

/** Cold-start session check with retries. A flaky network on launch used to drop a
 * perfectly valid stored session onto the login screen; OTP now costs a real WhatsApp
 * send (and may not be deliverable), so "couldn't reach the server" must never be
 * conflated with "session invalid". Only an actual 401 is `unauthorized`. */
export async function restoreSession<T>(
  fetchMe: () => Promise<T>,
  opts: { retryDelaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RestoreResult<T>> {
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return { kind: "ok", data: await fetchMe() };
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return { kind: "unauthorized" };
      lastError = e;
      if (attempt < delays.length) await sleep(delays[attempt]);
    }
  }
  return { kind: "unreachable", error: lastError };
}
