const API_PREFIX = "/api/v1";

/** Sent on EVERY request: tells the backend this client speaks the fixed 30-minute grid (`slot_count` counts 30-minute slots,
 * slots are 30 minutes long). A request without it is treated as an app build from before that change and gets the old
 * per-court-slot-length units. TRANSITION: the backend's compat layer (app/services/slot_compat.py) goes away once the new
 * build is out everywhere, but keep sending the header; it is harmless. */
export const SLOT_GRID_HEADER = "X-Slot-Grid";
export const SLOT_GRID_VALUE = "30";

// No request here previously had any timeout at all -- on the patchy
// 2G/4G this app targets, a stalled fetch (or the payment-proof XHR
// upload) would spin indefinitely with the player unsure if their
// payment went through. See AUDIT_FINDINGS.md finding #18.
const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 45_000;

/** Upload progress as a 0..1 fraction of bytes sent.
 *
 * The denominator is the total bytes to send. On web that's the XHR
 * ProgressEvent's `total` (the full multipart body), and `loaded <= total`
 * always. But React Native's FormData can't stat a file passed as a `{uri}`
 * descriptor (how native uploads a picked image), so it reports a `total` that
 * EXCLUDES the file's bytes -- `loaded` then races past it and the progress bar
 * showed >100% (e.g. "173%"). The true total can never be less than the bytes
 * already sent, so the correct denominator is `max(total, loaded)`. This fixes
 * the wrong denominator, not the displayed number -- on web (correct `total`)
 * it's a no-op. */
export function uploadProgressFraction(loaded: number, total: number): number {
  if (!(loaded > 0) || !(total > 0)) return 0;
  return loaded / Math.max(total, loaded);
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiClientConfig {
  /** Origin only, e.g. "http://localhost:8000" — no trailing slash, no /api/v1. */
  baseUrl: string;
  getToken: () => Promise<string | null>;
  /** Called after a successful silent refresh so the caller can persist the new token. */
  onTokenRefreshed: (token: string, expiresAt: string) => Promise<void>;
  /** Called once a 401 survives a refresh attempt — should clear the session and route to login. */
  onUnauthorized: () => Promise<void>;
}

interface RequestOpts {
  /** Hit baseUrl directly, skipping the /api/v1 prefix (only /health, /health/ready today). */
  skipApiPrefix?: boolean;
  retried?: boolean;
  /** For the unauthenticated auth endpoints (signup, login, OTP, password reset): never
   * attach a stored token and never treat a 401 as "session expired, refresh it". A
   * failed login is a 401 INVALID_CREDENTIALS, and must not trigger a refresh or a
   * sign-out just because a stale token happens to still be in storage. */
  skipAuth?: boolean;
}

/** "ok": token rotated. "rejected": the server answered and refused (session expired,
 * revoked, or phone re-verification needed) -- the user really is signed out.
 * "network": couldn't reach the server -- says nothing about the session, so it must
 * NOT sign anyone out. */
export type RefreshOutcome = "ok" | "rejected" | "network";

/** A request that never resolves (dropped connection, dead-air 2G) rejects
 * with this distinct, recognizable error instead of hanging forever. */
function timeoutError(): ApiError {
  return new ApiError("REQUEST_TIMEOUT", "Request timed out. Check your connection and try again.", 0);
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw timeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function createApiClient(config: ApiClientConfig) {
  let refreshPromise: Promise<RefreshOutcome> | null = null;

  async function tryRefresh(): Promise<RefreshOutcome> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const token = await config.getToken();
      if (!token) return "rejected" as const;
      try {
        const res = await fetchWithTimeout(
          `${config.baseUrl}${API_PREFIX}/auth/refresh`,
          { method: "POST", headers: { Authorization: `Bearer ${token}`, [SLOT_GRID_HEADER]: SLOT_GRID_VALUE } },
          DEFAULT_TIMEOUT_MS,
        );
        if (!res.ok) return res.status >= 500 ? ("network" as const) : ("rejected" as const);
        const body = (await res.json()) as { token: string; expires_at: string };
        await config.onTokenRefreshed(body.token, body.expires_at);
        return "ok" as const;
      } catch {
        return "network" as const;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  /** What to do with a 401 for a request that was sent with `sentToken` (audit 2026-10-28 item 1).
   * - The token changed while the request was in flight (the page hydrated it, or another request already refreshed
   *   it): just retry with the current token. Refreshing again would rotate a session that is fine and 401 every
   *   other request still carrying it, which is what logged a second owner tab out on every page load.
   * - No token was sent and none exists: the caller is simply signed out; nothing to refresh, nobody to sign out.
   * - The same token was refused: refresh once (shared by every concurrent caller). */
  async function on401(sentToken: string | null): Promise<"retry" | RefreshOutcome | "none"> {
    const current = await config.getToken();
    if (current && current !== sentToken) return "retry";
    if (!sentToken) return "none";
    return tryRefresh();
  }

  /** Proactive refresh (Section 26): sessions last 8h, so callers refresh BEFORE expiry --
   * on app foreground / tab focus and on a timer -- rather than waiting for a 401, by which
   * time the token is already dead and there is nothing left to refresh. */
  async function refreshSession(): Promise<RefreshOutcome> {
    const outcome = await tryRefresh();
    if (outcome === "rejected") await config.onUnauthorized();
    return outcome;
  }

  async function request<T>(path: string, options: RequestInit = {}, opts: RequestOpts = {}): Promise<T> {
    const token = opts.skipAuth ? null : await config.getToken();
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      [SLOT_GRID_HEADER]: SLOT_GRID_VALUE,
    };
    if (!isFormData && options.body !== undefined && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const url = opts.skipApiPrefix ? `${config.baseUrl}${path}` : `${config.baseUrl}${API_PREFIX}${path}`;
    const response = await fetchWithTimeout(url, { ...options, headers }, DEFAULT_TIMEOUT_MS);

    if (response.status === 401 && !opts.retried && !opts.skipAuth) {
      const outcome = await on401(token);
      if (outcome === "ok" || outcome === "retry") return request<T>(path, options, { ...opts, retried: true });
      // Only a server-side refusal means the session is gone; a network blip must not log anyone out.
      if (outcome === "rejected") await config.onUnauthorized();
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(
        body?.error?.code ?? "UNKNOWN_ERROR",
        body?.error?.message ?? response.statusText,
        response.status,
        body?.error?.details,
      );
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** For a `FormData` upload where the caller wants real progress (Section 12: an image
   * upload over 3G needs a progress indicator, not just a spinner) — `fetch` has no
   * reliable cross-platform upload-progress event, so this uses `XMLHttpRequest`
   * (supported by both browsers and React Native's XHR polyfill) instead. Mirrors
   * `request()`'s auth header injection, 401-refresh-retry, and ApiError envelope. */
  function requestUpload<T>(
    path: string,
    formData: FormData,
    onProgress?: (fraction: number) => void,
    opts: RequestOpts = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      (async () => {
        const token = await config.getToken();
        const xhr = new XMLHttpRequest();
        const url = opts.skipApiPrefix ? `${config.baseUrl}${path}` : `${config.baseUrl}${API_PREFIX}${path}`;
        xhr.open("POST", url);
        xhr.timeout = UPLOAD_TIMEOUT_MS;
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader(SLOT_GRID_HEADER, SLOT_GRID_VALUE);
        if (xhr.upload && onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(uploadProgressFraction(e.loaded, e.total));
          };
        }
        xhr.onerror = () => reject(new ApiError("UNKNOWN_ERROR", "Network request failed", 0));
        // The single highest-stakes gap this finding covers: a stalled
        // payment-proof upload previously spun the progress bar
        // indefinitely with no error, leaving the player unsure whether
        // their money went through.
        xhr.ontimeout = () => reject(timeoutError());
        xhr.onload = async () => {
          if (xhr.status === 401 && !opts.retried) {
            const outcome = await on401(token);
            if (outcome === "ok" || outcome === "retry") {
              try {
                resolve(await requestUpload<T>(path, formData, onProgress, { ...opts, retried: true }));
              } catch (e) {
                reject(e);
              }
              return;
            }
            if (outcome === "rejected") await config.onUnauthorized();
          }
          let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null =
            null;
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            body = null;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(
              new ApiError(
                body?.error?.code ?? "UNKNOWN_ERROR",
                body?.error?.message ?? xhr.statusText,
                xhr.status,
                body?.error?.details,
              ),
            );
            return;
          }
          resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
        };
        xhr.send(formData);
      })();
    });
  }

  /** For non-JSON responses (e.g. CSV export) — returns the raw response body as text. */
  async function requestText(path: string, options: RequestInit = {}, retried = false): Promise<string> {
    const token = await config.getToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      [SLOT_GRID_HEADER]: SLOT_GRID_VALUE,
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetchWithTimeout(
      `${config.baseUrl}${API_PREFIX}${path}`,
      { ...options, headers },
      DEFAULT_TIMEOUT_MS,
    );

    if (response.status === 401 && !retried) {
      const outcome = await on401(token);
      if (outcome === "ok" || outcome === "retry") return requestText(path, options, true);
      if (outcome === "rejected") await config.onUnauthorized();
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(
        body?.error?.code ?? "UNKNOWN_ERROR",
        body?.error?.message ?? response.statusText,
        response.status,
        body?.error?.details,
      );
    }

    return response.text();
  }

  return { request, requestText, requestUpload, refreshSession };
}

export type ApiClient = ReturnType<typeof createApiClient>;
