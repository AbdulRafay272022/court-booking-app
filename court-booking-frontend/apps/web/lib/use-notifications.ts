"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { ApiError } from "@court-booking/api-client";
import { notificationText, type NotificationFeedItem } from "@court-booking/types";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { effectiveReadAt, legacyToFeed, newArrivals, newestMs, unreadCount, type NotifRole } from "@/lib/notif-helpers";

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
    if (popupEnabled && currentPermission() === "granted") {
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
  }, [query.data, userId, popupEnabled, soundOn, t, lang]);

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
  };
}
