import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { notificationText, type NotificationFeedItem, type NotificationFeedPage } from "@court-booking/types";

import { useAuthStore } from "@/lib/auth-store";
import { formatTime } from "@/lib/format";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { groupByDay, ms, notificationTarget } from "@/lib/notif-helpers";
import { fetchNotificationFeed, useUnreadNotifications } from "@/lib/use-unread-notifications";
import { ErrorState } from "@/components/error-state";

export type NotifTone = "owner" | "player";

const TONE = {
  owner: { ink: "#101C21", faint: "#5B7079", muted: "#8399A1", border: "#DCE3E6", surface: "#FFFFFF", unreadBg: "#EEF6F7", dot: "#D8421F", title: "font-plex-semibold", body: "font-plex-medium", radius: 12 },
  player: { ink: "#141A1D", faint: "#5C544D", muted: "#7A7068", border: "#EBE5E1", surface: "#FFFFFF", unreadBg: "#FFF4EE", dot: "#D8421F", title: "font-figtree-semibold", body: "font-figtree-medium", radius: 16 },
} as const;

/**
 * One bell item (Owner Round 2, A6): the readable sentence from the shared `notificationText(item, "ru")`
 * (packages/types; never "New notification"), its context line, the time, and a small muted delivery line
 * ("WhatsApp par bheja gaya"). Unread = a dot AND the words "Naya" for screen readers (colour is never the only signal).
 */
export function NotificationRow({ item, unread, tone, onPress }: { item: NotificationFeedItem; unread: boolean; tone: NotifTone; onPress?: () => void }) {
  const t = TONE[tone];
  const text = notificationText(item, "ru");
  const label = `${unread ? "Naya: " : ""}${text.title}${text.context ? `. ${text.context}` : ""}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={label}
      testID="notif-row"
      className="flex-row gap-3 p-3.5"
      style={{ minHeight: 56, borderRadius: t.radius, borderWidth: 1, borderColor: t.border, backgroundColor: unread ? t.unreadBg : t.surface }}
    >
      <View style={{ width: 10, paddingTop: 6, alignItems: "center" }}>
        {unread ? <View testID="notif-unread-dot" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.dot }} /> : null}
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-start gap-2">
          <Text className={`${t.title} text-[14px] flex-1`} style={{ color: t.ink }}>
            {text.title}
          </Text>
          <Text className={`${t.body} text-[11.5px]`} style={{ color: t.muted }}>
            {formatTime(item.created_at)}
          </Text>
        </View>
        {text.context ? (
          <Text className={`${t.body} text-[13px]`} style={{ color: t.faint }}>
            {text.context}
          </Text>
        ) : null}
        {text.delivery ? (
          <Text testID="notif-delivery" className={`${t.body} text-[11.5px]`} style={{ color: t.muted }}>
            {text.delivery}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The list behind the bell (owner and player screens): feed pages grouped by day ("Aaj" / "Kal" / date), unread dots,
 * "Sab parh liye", "Aur dikhayein" when the feed has more, and a tap that closes this screen and opens the item's
 * destination (`notificationTarget`, by `link.kind`). Opening the screen still clears the bell badge (the read marker);
 * the dots keep showing what was new when the screen opened until "Sab parh liye" is tapped.
 */
export function NotificationsList({ tone }: { tone: NotifTone }) {
  const t = TONE[tone];
  const userId = useAuthStore((s) => (s.status === "signedIn" ? (s.user?.id ?? null) : null));
  const { markAllRead, readAt, loaded } = useUnreadNotifications();
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  // The marker as it was when the screen opened (read through a ref so marking below does not re-run the effect).
  const readAtRef = useRef(readAt);
  readAtRef.current = readAt;

  useEffect(() => {
    if (!loaded) return;
    setSeenBefore((cur) => (cur === null ? readAtRef.current : cur));
    markAllRead(); // opening the screen clears the bell badge (and again when a poll brings newer rows in)
  }, [loaded, markAllRead]);

  const query = useInfiniteQuery({
    queryKey: ["notif-feed-list", userId],
    queryFn: ({ pageParam }) => fetchNotificationFeed(pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last: NotificationFeedPage) => (last.has_more ? last.page + 1 : undefined),
    enabled: !!userId,
    refetchInterval: 15_000,
    subscribed: useIsFocused(),
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: NotificationFeedItem[] = [];
    for (const p of query.data?.pages ?? []) for (const it of p?.items ?? []) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
      }
    return out;
  }, [query.data]);
  const groups = useMemo(() => groupByDay(items), [items]);
  const isUnread = (it: NotificationFeedItem) => seenBefore !== null && ms(it.created_at) > seenBefore;
  const anyUnread = items.some(isUnread);

  function open(it: NotificationFeedItem) {
    const target = notificationTarget(it, tone);
    if (!target) return;
    router.replace(target as never);
  }

  if (query.isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={tone === "owner" ? "#0E6274" : "#EF5A2C"} />
      </View>
    );
  }
  if (query.isError && items.length === 0) {
    return <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone={tone} />;
  }
  if (items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-2 px-8">
        <Text className={`${t.title} text-base text-center`} style={{ color: t.ink }}>
          Abhi kuch nahi
        </Text>
        <Text className={`${t.body} text-[13px] text-center`} style={{ color: t.faint }}>
          {tone === "owner"
            ? "Naye payments, bookings, refunds aur venue ki khabrein yahan nazar aayengi."
            : "Booking ki updates aur waitlist alerts yahan nazar aayengi."}
        </Text>
      </View>
    );
  }
  return (
    <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 32, gap: 8 }}>
      {anyUnread ? (
        <Pressable
          onPress={() => {
            setSeenBefore(Date.now());
            markAllRead();
          }}
          accessibilityRole="button"
          accessibilityLabel="Sab parh liye"
          className="self-end justify-center px-2"
          style={{ minHeight: 44 }}
        >
          <Text className={`${t.title} text-[13.5px] underline`} style={{ color: tone === "owner" ? "#0E6274" : "#C2410C" }}>
            Sab parh liye
          </Text>
        </Pressable>
      ) : null}
      {groups.map((g) => (
        <View key={g.key} className="gap-2">
          <Text accessibilityRole="header" testID="notif-day" className={`${t.title} text-[12.5px] mt-2`} style={{ color: t.faint }}>
            {g.title}
          </Text>
          {g.items.map((it) => (
            <NotificationRow key={it.id} item={it} unread={isUnread(it)} tone={tone} onPress={notificationTarget(it, tone) ? () => open(it) : undefined} />
          ))}
        </View>
      ))}
      {query.hasNextPage ? (
        <Pressable
          onPress={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          accessibilityRole="button"
          className="items-center justify-center rounded-xl mt-2"
          style={{ minHeight: 44, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}
        >
          <Text className={`${t.title} text-[13.5px]`} style={{ color: t.ink }}>
            {query.isFetchingNextPage ? "Load ho raha hai..." : "Aur dikhayein"}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const PAGE_SIZE = 30;
