import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { BellOff, BellRing } from "lucide-react-native";
import { notificationText, type NotificationFeedItem, type NotificationFeedPage } from "@court-booking/types";
import { palette, radius, size, space } from "@court-booking/ui-tokens";

import { Banner, Button, EmptyState, ErrorState, Header, Screen, Skeleton, Text, useCopy, useLang, useRoleTheme } from "@/components/ui";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatTime } from "@/lib/format";
import { groupByDay, ms, notificationTarget } from "@/lib/notif-helpers";
import { registerForPushNotifications } from "@/lib/push-notifications";
import { safeBack } from "@/lib/safe-back";
import { PLAYER_HOME_HREF } from "@/lib/safe-back-rules";
import { fetchNotificationFeed, useUnreadNotifications } from "@/lib/use-unread-notifications";

const PAGE_SIZE = 30;

/**
 * PAccount board frame 2: the player's notifications (readable sentences from notificationText, grouped by day, unread dots
 * that never stand alone: the row also says "Naya"), "Sab parh liye", a push-off banner from the OS permission. Unread is
 * client-side only (contract B7): opening the screen moves the local read marker, same as before.
 */
export default function PlayerNotificationsScreen() {
  const copy = useCopy();
  const lang = useLang();
  const userId = useAuthStore((s) => (s.status === "signedIn" ? (s.user?.id ?? null) : null));
  const { markAllRead, readAt, loaded } = useUnreadNotifications();
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  const readAtRef = useRef(readAt);
  readAtRef.current = readAt;
  const [pushOff, setPushOff] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    setSeenBefore((cur) => (cur === null ? readAtRef.current : cur));
    markAllRead(); // opening the screen clears the bell badge
  }, [loaded, markAllRead]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    Notifications.getPermissionsAsync()
      .then((p) => setPushOff(p.status !== "granted"))
      .catch(() => undefined);
  }, []);

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
    for (const p of query.data?.pages ?? [])
      for (const it of p?.items ?? []) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
      }
    return out;
  }, [query.data]);
  const groups = useMemo(() => groupByDay(items), [items]);
  const isUnread = (it: NotificationFeedItem) => seenBefore !== null && ms(it.created_at) > seenBefore;
  const anyUnread = items.some(isUnread);

  return (
    <Screen testID="notifications-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Header
        title={copy("Notifications", "Notifications")}
        onBack={() => safeBack(PLAYER_HOME_HREF)}
        right={
          anyUnread ? (
            <Button
              label={copy("Sab parh liye", "Mark all read")}
              accessibilityLabel="Sab parh liye"
              variant="soft"
              size="sm"
              onPress={() => {
                setSeenBefore(Date.now());
                markAllRead();
              }}
            />
          ) : undefined
        }
      />
      {pushOff ? (
        <Banner
          tone="waiting"
          icon={BellOff}
          body={copy("Push band hai. On karein taake approval fori pata chale.", "Push is off. Turn it on to hear about approvals right away.")}
          action={
            <Button
              label={copy("On karein", "Turn on")}
              size="sm"
              variant="soft"
              onPress={async () => {
                const p = await Notifications.requestPermissionsAsync().catch(() => null);
                if (p?.status === "granted") {
                  setPushOff(false);
                  void registerForPushNotifications();
                }
              }}
            />
          }
        />
      ) : null}
      {query.isLoading ? (
        <View style={{ gap: space[2] }} accessibilityLabel={copy("Load ho raha hai", "Loading")}>
          <Skeleton height={68} r={radius.input} />
          <Skeleton height={68} r={radius.input} />
          <Skeleton height={68} r={radius.input} />
        </View>
      ) : query.isError && items.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} onBack={() => safeBack(PLAYER_HOME_HREF)} />
      ) : items.length === 0 ? (
        <EmptyState icon={BellRing} title={copy("Abhi kuch nahi", "Nothing yet")} body={copy("Booking ki updates aur waitlist alerts yahan nazar aayengi.", "Booking updates and waitlist alerts show up here.")} />
      ) : (
        <View style={{ gap: space[4] }}>
          {groups.map((g) => (
            <View key={g.key} style={{ gap: space[2] }}>
              <Text variant="eyebrow" tone="muted" accessibilityRole="header" testID="notif-day">
                {g.title}
              </Text>
              {g.items.map((it) => (
                <NotifRow key={it.id} item={it} unread={isUnread(it)} lang={lang} onPress={notificationTarget(it, "player") ? () => router.replace(notificationTarget(it, "player") as never) : undefined} />
              ))}
            </View>
          ))}
          {query.hasNextPage ? (
            <Button label={query.isFetchingNextPage ? copy("Load ho raha hai…", "Loading…") : copy("Aur dikhayein", "Show more")} variant="soft" size="md" block disabled={query.isFetchingNextPage} onPress={() => query.fetchNextPage()} />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function NotifRow({ item, unread, lang, onPress }: { item: NotificationFeedItem; unread: boolean; lang: "ru" | "en"; onPress?: () => void }) {
  const t = useRoleTheme();
  const text = notificationText(item, lang);
  const label = `${unread ? (lang === "en" ? "New: " : "Naya: ") : ""}${text.title}${text.context ? `. ${text.context}` : ""}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={label}
      testID="notif-row"
      style={({ pressed }) => ({ flexDirection: "row", gap: space[3], padding: 14, minHeight: size.tap + 12, borderRadius: radius.input, backgroundColor: unread ? t.selected.bg : palette.white, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width: 10, paddingTop: 6, alignItems: "center" }}>
        {unread ? <View testID="notif-unread-dot" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.badge.bg }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2] }}>
          <Text variant="bodyBold" style={{ flex: 1 }}>
            {text.title}
          </Text>
          <Text variant="caption" tone="muted">
            {formatTime(item.created_at)}
          </Text>
        </View>
        {text.context ? (
          <Text variant="meta" tone="muted">
            {text.context}
          </Text>
        ) : null}
        {text.delivery ? (
          <Text variant="caption" tone="muted" testID="notif-delivery">
            {text.delivery}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
