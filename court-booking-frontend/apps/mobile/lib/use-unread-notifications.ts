import { useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { ApiError } from "@court-booking/api-client";
import type { NotificationFeedPage } from "@court-booking/types";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { badgeLabel, effectiveReadAt, feedFromLog, newestMs, unreadCount, type LogEntry } from "@/lib/notif-helpers";

const POLL_MS = 15_000;
const LIST_SIZE = 100; // the API caps a page at 100, which is also what lets the badge reach "99+"
const keyFor = (userId: string) => `khelo.notif.readAt.${userId}`;

/** Set once the feed endpoint answered 404 (a backend from before Owner Round 2): from then on this app session reads the
 * old log endpoint and folds it locally, instead of asking for the missing feed every 15 seconds. */
let feedMissing = false;

/** One page of the readable notification feed. Falls back to the old `/users/me/notifications` log (folded into the same
 * item shape, kind "other") when the backend has no feed yet. Shared by the bell badge and both notification screens. */
export async function fetchNotificationFeed(page: number, pageSize: number): Promise<NotificationFeedPage> {
  if (!feedMissing) {
    try {
      const res = await api.users.notificationsFeed(page, pageSize);
      // Anything that is not a feed page (no items array) is treated like a missing feed rather than as "no notifications".
      if (res && Array.isArray(res.items)) return res;
      feedMissing = true;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      feedMissing = true;
    }
  }
  // The old endpoint has one row per channel; ask for a few more rows so a full page survives the folding.
  const rows = (await api.users.notifications(page, Math.min(100, pageSize * 2))) as LogEntry[];
  return { items: feedFromLog(rows), page, page_size: pageSize, has_more: rows.length >= Math.min(100, pageSize * 2) };
}

interface ReadState {
  /** userId -> stored marker (ms as string) or null when never read. Absent = not loaded from storage yet. */
  readAt: Record<string, string | null>;
  load: (userId: string) => Promise<void>;
  set: (userId: string, ms: number) => void;
}

const useReadStore = create<ReadState>((set, get) => ({
  readAt: {},
  load: async (userId) => {
    if (userId in get().readAt) return;
    let v: string | null = null;
    try {
      v = await AsyncStorage.getItem(keyFor(userId));
    } catch {
      v = null;
    }
    set((s) => (userId in s.readAt ? s : { readAt: { ...s.readAt, [userId]: v } }));
  },
  set: (userId, ms) => {
    const v = String(ms);
    set((s) => ({ readAt: { ...s.readAt, [userId]: v } }));
    AsyncStorage.setItem(keyFor(userId), v).catch(() => undefined); // not sticking is harmless
  },
}));

/** The bell badge: unread count from the user's notification feed, polled every 15 s (TanStack pauses interval
 * polling while the app is backgrounded via focusManager, see lib/query-client.ts). Read state is local per user.
 * `readAt` is the effective marker (ms) the notification screens use for their unread dots. */
export function useUnreadNotifications() {
  const userId = useAuthStore((s) => (s.status === "signedIn" ? (s.user?.id ?? null) : null));
  const stored = useReadStore((s) => (userId ? s.readAt[userId] : undefined));
  const load = useReadStore((s) => s.load);
  const setRead = useReadStore((s) => s.set);

  useEffect(() => {
    if (userId) void load(userId);
  }, [userId, load]);

  const query = useQuery({
    queryKey: ["my-notifications-feed", userId],
    queryFn: () => fetchNotificationFeed(1, LIST_SIZE),
    enabled: !!userId,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const loaded = stored !== undefined;
  const dataUpdatedAt = query.dataUpdatedAt;
  const readAt = useMemo(() => effectiveReadAt(stored ?? null, dataUpdatedAt || Date.now()), [stored, dataUpdatedAt]);
  const unread = loaded && query.data ? unreadCount(items, readAt) : 0;

  const markAllRead = useCallback(() => {
    if (!userId) return;
    setRead(userId, Math.max(newestMs(items), Date.now()));
  }, [userId, items, setRead]);

  return { unread, label: badgeLabel(unread), markAllRead, readAt, loaded };
}
