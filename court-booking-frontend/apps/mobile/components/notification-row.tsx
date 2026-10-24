import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Bell } from "lucide-react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Button, EmptyState, ErrorState, SkeletonList, Text } from "@/components/ui";
import { router, useIsFocused } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { notificationText, type NotificationFeedItem, type NotificationFeedPage } from "@court-booking/types";

import { useAuthStore } from "@/lib/auth-store";
import { formatTime } from "@/lib/format";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { groupByDay, ms, notificationTarget } from "@/lib/notif-helpers";
import { fetchNotificationFeed, useUnreadNotifications } from "@/lib/use-unread-notifications";

export type NotifTone = "owner" | "player";

/** Floodlight tokens per side (no hex here): owner unread rows sit on the teal tint, player rows on the orange tint. */
const TONE = {
  owner: { unreadBg: palette.tealTint, link: "link" as const },
  player: { unreadBg: palette.orangeTint, link: "link" as const },
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
      style={{ flexDirection: "row", gap: space[3], padding: 14, minHeight: 56, borderRadius: radius.tile, backgroundColor: unread ? t.unreadBg : palette.white }}
    >
      <View style={{ width: 10, paddingTop: 6, alignItems: "center" }}>
        {/* the unread dot is the role accent (orange + ink rule: a dot carries no text); "Naya" is in the label */}
        {unread ? <View testID="notif-unread-dot" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: palette.orange }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2], flexWrap: "wrap" }}>
          <Text variant="bodyBold" style={{ flex: 1, minWidth: 140 }}>
            {text.title}
          </Text>
          <Text variant="caption" tone="muted">
            {formatTime(item.created_at)}
          </Text>
        </View>
        {text.context ? (
          <Text variant="meta" tone="body">
            {text.context}
          </Text>
        ) : null}
        {text.delivery ? (
          <Text testID="notif-delivery" variant="caption" tone="muted">
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
      <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
        <SkeletonList cards={3} />
      </View>
    );
  }
  if (query.isError && items.length === 0) {
    return (
      <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="Abhi kuch nahi"
        body={tone === "owner" ? "Naye payments, bookings, refunds aur venue ki khabrein yahan nazar aayengi." : "Booking ki updates aur waitlist alerts yahan nazar aayengi."}
      />
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[8], gap: space[2] }}>
      {anyUnread ? (
        <Pressable
          onPress={() => {
            setSeenBefore(Date.now());
            markAllRead();
          }}
          accessibilityRole="button"
          accessibilityLabel="Sab parh liye"
          style={{ alignSelf: "flex-end", justifyContent: "center", paddingHorizontal: space[2], minHeight: 44 }}
        >
          <Text variant="label" tone={t.link} style={{ textDecorationLine: "underline" }}>
            Sab parh liye
          </Text>
        </Pressable>
      ) : null}
      {groups.map((g) => (
        <View key={g.key} style={{ gap: space[2] }}>
          <Text accessibilityRole="header" testID="notif-day" variant="eyebrow" tone="muted" style={{ marginTop: space[2] }}>
            {g.title}
          </Text>
          {g.items.map((it) => (
            <NotificationRow key={it.id} item={it} unread={isUnread(it)} tone={tone} onPress={notificationTarget(it, tone) ? () => open(it) : undefined} />
          ))}
        </View>
      ))}
      {query.hasNextPage ? (
        <Button label={query.isFetchingNextPage ? "Load ho raha hai..." : "Aur dikhayein"} variant="secondary" size="md" block onPress={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} />
      ) : null}
    </ScrollView>
  );
}

const PAGE_SIZE = 30;
