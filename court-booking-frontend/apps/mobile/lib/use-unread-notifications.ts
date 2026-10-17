import { useCallback, useEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { badgeLabel, dedupeEntries, effectiveReadAt, newestMs, unreadCount, type LogEntry } from "@/lib/notif-helpers";

const POLL_MS = 15_000;
const LIST_SIZE = 100; // the API caps a page at 100, which is also what lets the badge reach "99+"
const keyFor = (userId: string) => `khelo.notif.readAt.${userId}`;

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

/** The bell badge: unread count from the user's notification log, polled every 15 s (TanStack pauses interval
 * polling while the app is backgrounded via focusManager, see lib/query-client.ts). Read state is local per user. */
export function useUnreadNotifications() {
  const userId = useAuthStore((s) => (s.status === "signedIn" ? (s.user?.id ?? null) : null));
  const stored = useReadStore((s) => (userId ? s.readAt[userId] : undefined));
  const load = useReadStore((s) => s.load);
  const setRead = useReadStore((s) => s.set);

  useEffect(() => {
    if (userId) void load(userId);
  }, [userId, load]);

  const query = useQuery({
    queryKey: ["my-notifications", userId],
    queryFn: () => api.users.notifications(1, LIST_SIZE),
    enabled: !!userId,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const items = useMemo<LogEntry[]>(() => dedupeEntries((query.data ?? []) as LogEntry[]), [query.data]);
  const loaded = stored !== undefined;
  const dataUpdatedAt = query.dataUpdatedAt;
  const readAt = useMemo(() => effectiveReadAt(stored ?? null, dataUpdatedAt || Date.now()), [stored, dataUpdatedAt]);
  const unread = loaded && query.data ? unreadCount(items, readAt) : 0;

  const markAllRead = useCallback(() => {
    if (!userId) return;
    setRead(userId, Math.max(newestMs(items), Date.now()));
  }, [userId, items, setRead]);

  return { unread, label: badgeLabel(unread), markAllRead };
}
