const API_PREFIX = "/api/v1";

// No request here previously had any timeout at all -- on the patchy
// 2G/4G this app targets, a stalled fetch (or the payment-proof XHR
// upload) would spin indefinitely with the player unsure if their
// payment went through. See AUDIT_FINDINGS.md finding #18.
const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 45_000;

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
}

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
  let refreshPromise: Promise<boolean> | null = null;

  async function tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const token = await config.getToken();
      if (!token) return false;
      try {
        const res = await fetchWithTimeout(
          `${config.baseUrl}${API_PREFIX}/auth/refresh`,
          { method: "POST", headers: { Authorization: `Bearer ${token}` } },
          DEFAULT_TIMEOUT_MS,
        );
        if (!res.ok) return false;
        const body = (await res.json()) as { token: string; expires_at: string };
        await config.onTokenRefreshed(body.token, body.expires_at);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function request<T>(path: string, options: RequestInit = {}, opts: RequestOpts = {}): Promise<T> {
    const token = await config.getToken();
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
    if (!isFormData && options.body !== undefined && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const url = opts.skipApiPrefix ? `${config.baseUrl}${path}` : `${config.baseUrl}${API_PREFIX}${path}`;
    const response = await fetchWithTimeout(url, { ...options, headers }, DEFAULT_TIMEOUT_MS);

    if (response.status === 401 && !opts.retried) {
      const refreshed = await tryRefresh();
      if (refreshed) return request<T>(path, options, { ...opts, retried: true });
      await config.onUnauthorized();
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
        if (xhr.upload && onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(e.loaded / e.total);
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
            const refreshed = await tryRefresh();
            if (refreshed) {
              try {
                resolve(await requestUpload<T>(path, formData, onProgress, { ...opts, retried: true }));
              } catch (e) {
                reject(e);
              }
              return;
            }
            await config.onUnauthorized();
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
  async function requestText(path: string, options: RequestInit = {}): Promise<string> {
    const token = await config.getToken();
    const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetchWithTimeout(
      `${config.baseUrl}${API_PREFIX}${path}`,
      { ...options, headers },
      DEFAULT_TIMEOUT_MS,
    );

    if (response.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) return requestText(path, options);
      await config.onUnauthorized();
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

  return { request, requestText, requestUpload };
}

export type ApiClient = ReturnType<typeof createApiClient>;
