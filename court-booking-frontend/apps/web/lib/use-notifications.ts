"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { ApiError } from "@court-booking/api-client";
import { notificationText, type NotificationFeedItem } from "@court-booking/types";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { effectiveReadAt, legacyToFeed, newArrivals, newestMs, unreadCount, type NotifRole } from "@/lib/notif-helpers";
import {
  currentSubscription,
  detectSupport,
  disablePush,
  enablePush,
  pushUiState,
  readPushEnv,
  refreshPush,
  shouldShowTabPopup,
  type EnableResult,
  type PushSupport,
  type PushUiState,
  type SubscriptionBody,
} from "@/lib/web-push";

const POLL_MS = 15_000;

// The owner shell mounts two bells (phone top bar + desktop strip, one hidden by CSS), so every instance runs the arrival effect below.
// Announce each notification id once per page, whichever instance sees it first.
const announced = new Set<string>();
const LIST_SIZE = 30;
const SHOWN = 30;

// Round 2 (A6): an older backend has no /users/me/notifications/feed. Remember a 404/405 for this page so every poll
// goes straight to the old log endpoint (rows folded + titled from event_type, never "New notification").
let feedMissing = false;

async function loadFeed(): Promise<{ items: NotificationFeedItem[]; source: "feed" | "legacy" }> {
  if (!feedMissing) {
    try {
      const page = await api.users.notificationsFeed(1, LIST_SIZE);
      return { items: page.items ?? [], source: "feed" };
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e;
      feedMissing = true;
    }
  }
  return { items: legacyToFeed(await api.users.notifications(1, LIST_SIZE)), source: "legacy" };
}

// ---- tiny localStorage-backed store (read state, popup choice, sound choice), one set of keys per user id ----
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeKey(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice just does not stick
  }
  emit();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function useStored(key: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (key ? readKey(key) : null),
    () => null,
  );
}

export type PopupState = "unsupported" | "default" | "denied" | "granted";

/** One short beep from Web Audio (no asset file). Silent if the browser refuses. */
export function playBeep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.27);
    osc.onended = () => void ctx.close();
  } catch {
    // ignore
  }
}

export function currentPermission(): PopupState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission as PopupState;
}

// ---- Web Push (Stage 2): one store per page, shared by both bell instances of the owner shell ----
interface PushSnap {
  /** This device's subscription is active on the server for the signed-in user. */
  subscribedHere: boolean;
  busy: boolean;
  /** Notification.permission as last read (it is not reactive). */
  perm: PopupState;
}
let pushSnap: PushSnap = { subscribedHere: false, busy: false, perm: "unsupported" };
const pushListeners = new Set<() => void>();
function setPush(patch: Partial<PushSnap>) {
  pushSnap = { ...pushSnap, ...patch };
  pushListeners.forEach((l) => l());
}
function subscribePush(cb: () => void) {
  pushListeners.add(cb);
  return () => {
    pushListeners.delete(cb);
  };
}
const SERVER_PUSH_SNAP: PushSnap = { subscribedHere: false, busy: false, perm: "unsupported" };
let supportCache: PushSupport | null = null;
function pushSupport(): PushSupport {
  if (supportCache) return supportCache;
  const env = readPushEnv();
  if (!env) return "unsupported";
  supportCache = detectSupport(env);
  return supportCache;
}
/** The user id the on-load sync already ran for (it runs once per page per user, whichever bell mounts first). */
let pushSyncedFor: string | null = null;

/**
 * Web Push for the bell (docs/web-push-plan.md section 8). Never asks on load: the only `requestPermission` is inside `enable`,
 * called from the explicit button. On load, while permission is granted and this user turned push on in this browser, the
 * subscription is re-sent (last_seen_at, browser-side rotation); otherwise the server is asked whether THIS device is subscribed.
 */
function useWebPush(userId: string | undefined) {
  const support = useSyncExternalStore(
    subscribePush,
    pushSupport,
    () => "unsupported" as PushSupport,
  );
  const snap = useSyncExternalStore(subscribePush, () => pushSnap, () => SERVER_PUSH_SNAP);
  const choiceKey = userId ? `khelo.push.${userId}` : null;

  const config = useQuery({
    queryKey: ["web-push-config", userId],
    queryFn: () => api.users.webPushConfig(),
    enabled: !!userId && support !== "unsupported",
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const publicKey = config.data?.enabled && config.data.public_key ? config.data.public_key : null;
  const backendEnabled = config.data ? !!publicKey : config.isError ? false : null;

  useEffect(() => {
    if (!userId || !choiceKey || !publicKey || support !== "supported") return;
    if (pushSyncedFor === userId) return;
    pushSyncedFor = userId;
    setPush({ perm: currentPermission() });
    void (async () => {
      try {
        if (currentPermission() === "granted" && readKey(choiceKey) === "1") {
          await refreshPush(api.users, publicKey);
          setPush({ subscribedHere: true });
          return;
        }
        const sub = await currentSubscription();
        if (!sub) {
          setPush({ subscribedHere: false });
          return;
        }
        const status = await api.users.webPushStatus(sub.endpoint);
        setPush({ subscribedHere: !!status.subscribed && currentPermission() === "granted" });
      } catch {
        setPush({ subscribedHere: false });
      }
    })();
    // the worker asks an open tab to POST a rotated subscription (only the page holds the session token)
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; subscription?: SubscriptionBody } | null;
      if (d?.type !== "khelo-push-resubscribe" || !d.subscription?.endpoint || !d.subscription.keys) return;
      void api.users.webPushSubscribe({ endpoint: d.subscription.endpoint, keys: d.subscription.keys, user_agent: navigator.userAgent.slice(0, 500) }).catch(() => undefined);
    };
    navigator.serviceWorker?.addEventListener?.("message", onMessage);
  }, [userId, choiceKey, publicKey, support]);

  const state: PushUiState = pushUiState({ support, backendEnabled, permission: snap.perm === "unsupported" ? currentPermission() : snap.perm, subscribedHere: snap.subscribedHere });

  const enable = useCallback(async (): Promise<EnableResult> => {
    if (!publicKey || !choiceKey) return { ok: false, reason: "error" };
    setPush({ busy: true });
    const res = await enablePush(api.users, publicKey);
    if (res.ok) writeKey(choiceKey, "1");
    setPush({ busy: false, perm: currentPermission(), subscribedHere: res.ok ? true : pushSnap.subscribedHere });
    return res;
  }, [publicKey, choiceKey]);

  const disable = useCallback(async () => {
    if (!choiceKey) return;
    setPush({ busy: true });
    try {
      await disablePush(api.users);
    } finally {
      writeKey(choiceKey, "0");
      setPush({ busy: false, subscribedHere: false, perm: currentPermission() });
    }
  }, [choiceKey]);

  const recheck = useCallback(() => setPush({ perm: currentPermission() }), []);

  return { state, busy: snap.busy, activeHere: snap.subscribedHere, enable, disable, recheck };
}

/** The bell's data: the user's notification log (polled every 15 s while the tab is visible), the unread count, "mark all as read",
 * and the opt-in browser popup + sound. Read state lives in this browser, keyed by user id (there is no server read flag). */
export function useNotifications() {
  const t = useT();
  const lang = useLang();
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const userId = status === "signedIn" ? user?.id : undefined;
  const role = (user?.role ?? "player") as NotifRole;

  const readKeyName = userId ? `khelo.notif.readAt.${userId}` : null;
  const popupKey = userId ? `khelo.notif.popup.${userId}` : null;
  const soundKey = userId ? `khelo.notif.sound.${userId}` : null;
  const readStored = useStored(readKeyName);
  const popupStored = useStored(popupKey);
  const soundStored = useStored(soundKey);

  const query = useQuery({
    queryKey: ["my-notifications-feed", userId],
    queryFn: loadFeed,
    enabled: !!userId,
    refetchInterval: POLL_MS, // TanStack pauses interval refetching while the tab is hidden (refetchIntervalInBackground defaults to false)
    refetchOnWindowFocus: true,
  });

  const items = useMemo<NotificationFeedItem[]>(() => (query.data?.items ?? []).slice(0, SHOWN), [query.data]);
  // "now" only matters when nothing was ever marked read (24 h window); it is stable per data load
  const dataUpdatedAt = query.dataUpdatedAt;
  const readAt = useMemo(() => effectiveReadAt(readStored, dataUpdatedAt || 0), [readStored, dataUpdatedAt]);
  const unread = unreadCount(items, readAt);

  const markAllRead = useCallback(() => {
    if (!readKeyName) return;
    writeKey(readKeyName, String(Math.max(newestMs(items), Date.now())));
  }, [readKeyName, items]);

  const popupEnabled = popupStored === "1";
  const soundOn = soundStored === "1";
  const push = useWebPush(userId);
  const pushActiveHere = push.activeHere;

  // Popup + beep for rows that arrived after the previous poll. The first load of a session is never "new".
  const seen = useRef<{ user?: string; newest: number | null }>({ newest: null });
  useEffect(() => {
    if (!userId || !query.data) return;
    if (seen.current.user !== userId) seen.current = { user: userId, newest: null };
    const all = query.data.items;
    const fresh = newArrivals(all, seen.current.newest).filter((e) => !announced.has(e.id));
    seen.current.newest = Math.max(seen.current.newest ?? 0, newestMs(all));
    if (fresh.length === 0) return;
    fresh.forEach((e) => announced.add(e.id));
    // Web Push delivers to this device already (even with the tab closed): no second, tab-open popup.
    if (shouldShowTabPopup(popupEnabled, currentPermission(), pushActiveHere)) {
      for (const e of fresh.slice(0, 3)) {
        try {
          const text = notificationText(e, lang);
          new Notification(text.title, { body: text.context || t("notif.popup.body"), tag: e.id });
        } catch {
          // some browsers (Android Chrome) only allow notifications via a service worker: no popup there
        }
      }
    }
    if (soundOn) playBeep();
  }, [query.data, userId, popupEnabled, pushActiveHere, soundOn, t, lang]);

  /** Click handler: asks the browser for permission (only ever called from the explicit button) and remembers the choice. */
  const enablePopups = useCallback(async (): Promise<PopupState> => {
    if (!popupKey || typeof Notification === "undefined") return "unsupported";
    let result: string = Notification.permission;
    if (result === "default") {
      try {
        result = await Notification.requestPermission();
      } catch {
        result = Notification.permission;
      }
    }
    if (result === "granted") writeKey(popupKey, "1");
    return result as PopupState;
  }, [popupKey]);
  const disablePopups = useCallback(() => {
    if (popupKey) writeKey(popupKey, "0");
  }, [popupKey]);
  const setSound = useCallback(
    (on: boolean) => {
      if (!soundKey) return;
      writeKey(soundKey, on ? "1" : "0");
      if (on) playBeep(); // the click is the user gesture that lets audio play; it doubles as a preview
    },
    [soundKey],
  );

  return {
    signedIn: !!userId,
    role,
    items,
    source: query.data?.source ?? null,
    /** When the list was fetched: "today"/"yesterday" headings are relative to it (stable per load, no impure render). */
    fetchedAt: dataUpdatedAt,
    unread,
    readAt,
    isLoading: query.isLoading,
    isError: query.isError && items.length === 0,
    refetch: () => void query.refetch(),
    markAllRead,
    popupEnabled,
    soundOn,
    enablePopups,
    disablePopups,
    setSound,
    /** Stage 2 Web Push: the bell's push section (state machine in lib/web-push.ts). */
    push,
  };
}
