/**
 * Web Push (Round 2 Stage 2, docs/web-push-plan.md sections 4 and 8): key conversion, browser support detection, the UI state
 * machine and the enable / disable / refresh steps. No React and no app imports here, so the logic is unit-tested with plain
 * `npx tsx --test` (lib/web-push.test.ts); `lib/use-notifications.ts` wires it to the bell.
 */

/** base64url (the VAPID public key from GET /users/me/web-push/config) -> the bytes `applicationServerKey` wants. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const clean = base64Url.trim().replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(clean)) throw new Error("not base64url");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Bytes -> base64url without padding (the encoding the backend stores p256dh / auth in). */
export function arrayBufferToBase64Url(buf: ArrayBuffer | Uint8Array | null | undefined): string {
  if (!buf) return "";
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** True when `sub` was made for this public key (a rotated VAPID key needs a fresh subscription). Unknown = true. */
export function sameKey(subKey: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!subKey) return true;
  try {
    return arrayBufferToBase64Url(subKey) === arrayBufferToBase64Url(urlBase64ToUint8Array(publicKey));
  } catch {
    return true;
  }
}

export type PushSupport = "supported" | "unsupported" | "ios-install";

export interface PushEnv {
  hasNotification: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  /** Secure context (https or localhost): service workers need it. */
  secure: boolean;
  userAgent: string;
  /** iPadOS 13+ says "Macintosh"; touch points tell it apart from a Mac. */
  maxTouchPoints: number;
  /** Opened from the Home Screen (display-mode standalone or navigator.standalone). */
  standalone: boolean;
}

export function isIos(env: Pick<PushEnv, "userAgent" | "maxTouchPoints">): boolean {
  if (/iPhone|iPad|iPod/i.test(env.userAgent)) return true;
  return /Macintosh/i.test(env.userAgent) && env.maxTouchPoints > 1;
}

/**
 * Can this browser receive Web Push? iPhone/iPad Safari only can once Khelo is added to the Home Screen (iOS 16.4+): a plain
 * Safari tab has no PushManager, so it gets the install hint instead of "unsupported".
 */
export function detectSupport(env: PushEnv): PushSupport {
  const full = env.secure && env.hasNotification && env.hasServiceWorker && env.hasPushManager;
  if (full) return "supported";
  if (isIos(env) && !env.standalone && env.hasServiceWorker) return "ios-install";
  return "unsupported";
}

export function readPushEnv(): PushEnv | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  try {
    standalone = standalone || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    // ignore
  }
  return {
    hasNotification: typeof Notification !== "undefined",
    hasServiceWorker: "serviceWorker" in navigator && !!navigator.serviceWorker,
    hasPushManager: "PushManager" in window,
    secure: window.isSecureContext !== false,
    userAgent: navigator.userAgent || "",
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone,
  };
}

/** What the bell's push section shows (docs/web-push-plan.md section 8). "hidden" = nothing at all. */
export type PushUiState = "hidden" | "unsupported" | "ios-install" | "denied" | "not-asked" | "granted-not-subscribed" | "subscribed";

export interface PushInputs {
  support: PushSupport;
  /** null = config not loaded (or the backend has no such endpoint yet). */
  backendEnabled: boolean | null;
  permission: "default" | "granted" | "denied" | "unsupported";
  /** This device has an active subscription that the server has for this user. */
  subscribedHere: boolean;
}

export function pushUiState(i: PushInputs): PushUiState {
  if (i.backendEnabled !== true) return "hidden";
  if (i.support === "unsupported") return "unsupported";
  if (i.support === "ios-install") return "ios-install";
  if (i.permission === "unsupported") return "unsupported";
  if (i.permission === "denied") return "denied";
  if (i.permission === "granted") return i.subscribedHere ? "subscribed" : "granted-not-subscribed";
  return "not-asked";
}

/** The tab-open `new Notification()` popup is the fallback; it is suppressed while this device has a push subscription. */
export function shouldShowTabPopup(popupEnabled: boolean, permission: string, pushActiveHere: boolean): boolean {
  return popupEnabled && permission === "granted" && !pushActiveHere;
}

export interface SubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
}

/** The POST body from a PushSubscription (toJSON when available, else the raw keys). */
export function subscriptionBody(sub: PushSubscription, userAgent?: string): SubscriptionBody {
  let p256dh = "";
  let auth = "";
  try {
    const j = sub.toJSON?.();
    p256dh = j?.keys?.p256dh ?? "";
    auth = j?.keys?.auth ?? "";
  } catch {
    // fall through to getKey
  }
  if (!p256dh) p256dh = arrayBufferToBase64Url(sub.getKey?.("p256dh") ?? null);
  if (!auth) auth = arrayBufferToBase64Url(sub.getKey?.("auth") ?? null);
  const body: SubscriptionBody = { endpoint: sub.endpoint, keys: { p256dh, auth } };
  if (userAgent) body.user_agent = userAgent.slice(0, 500);
  return body;
}

/** The slice of the api-client this module needs (lets tests pass a fake). */
export interface PushApi {
  webPushSubscribe: (sub: SubscriptionBody) => Promise<unknown>;
  webPushUnsubscribe: (endpoint: string) => Promise<unknown>;
}

export const SW_URL = "/sw.js";

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  try {
    return await navigator.serviceWorker.getRegistration("/");
  } catch {
    return undefined;
  }
}

/** The subscription this browser holds for Khelo, or null (never registers a worker, never prompts). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await registration();
  if (!reg || !reg.pushManager) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Register /sw.js (scope /), then get or create a subscription for `publicKey`. Assumes permission is already granted. */
export async function ensureSubscription(publicKey: string): Promise<PushSubscription> {
  const reg = (await registration()) ?? (await navigator.serviceWorker.register(SW_URL, { scope: "/" }));
  await navigator.serviceWorker.ready.catch(() => undefined);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, publicKey)) {
    // made for an older VAPID key: it can never deliver again
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  return sub;
}

export type EnableResult = { ok: true; endpoint: string } | { ok: false; reason: "denied" | "dismissed" | "error" };

/** The "Notifications on karein" tap: permission (the only prompt, from this explicit tap) -> /sw.js -> subscribe -> POST. */
export async function enablePush(api: PushApi, publicKey: string): Promise<EnableResult> {
  let perm: NotificationPermission = Notification.permission;
  if (perm === "default") {
    try {
      perm = await Notification.requestPermission();
    } catch {
      perm = Notification.permission;
    }
  }
  if (perm === "denied") return { ok: false, reason: "denied" };
  if (perm !== "granted") return { ok: false, reason: "dismissed" };
  try {
    const sub = await ensureSubscription(publicKey);
    await api.webPushSubscribe(subscriptionBody(sub, navigator.userAgent));
    return { ok: true, endpoint: sub.endpoint };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** "Band karein": unsubscribe in the browser and tell the server (DELETE is idempotent, so a stale state always clears). */
export async function disablePush(api: PushApi): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await api.webPushUnsubscribe(endpoint).catch(() => undefined);
}

/** On load while permission is granted and the user chose push on this device: re-send the subscription (last_seen, rotation). */
export async function refreshPush(api: PushApi, publicKey: string): Promise<string | null> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return null;
  const sub = await ensureSubscription(publicKey);
  await api.webPushSubscribe(subscriptionBody(sub, navigator.userAgent));
  return sub.endpoint;
}
