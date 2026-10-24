import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronRight, MessageCircle } from "lucide-react-native";
import { formatDate, formatTime, formatTimeRange, type Booking, type ChatHistoryItem } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";

import { Avatar, Banner, EmptyState, ErrorState, Screen, SkeletonCard, StatusPill, Text, useCopy, useLang } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { chatCandidates, shownStatus } from "@/lib/player-flow";
import { PlayerOfflineBanner, asList, useBookingPlace } from "../_components";

/**
 * PChat board frame 1 (Chat tab). The backend has NO conversation list or unread state (contract dependency B1), so this
 * tab is built honestly from real data: one row per live / recent booking (GET /bookings/mine) linking to that booking's
 * chat thread, with the last real message from GET /chat/history?booking_id= when there is one. No unread dots, no
 * invented previews. New questions about a venue start from the venue page's chat button.
 */
export default function ChatTabScreen() {
  const copy = useCopy();
  const focused = useIsFocused();
  const upcomingQ = useQuery({ queryKey: ["bookings-mine", "upcoming"], queryFn: () => api.bookings.mine("upcoming", 1, 100), subscribed: focused });
  const pastQ = useQuery({ queryKey: ["bookings-mine", "past"], queryFn: () => api.bookings.mine("past", 1, 100), subscribed: focused });
  const rows = useMemo(() => chatCandidates([...asList<Booking>(upcomingQ.data), ...asList<Booking>(pastQ.data)]), [upcomingQ.data, pastQ.data]);
  const histories = useQueries({
    queries: rows.map((b) => ({
      queryKey: ["chat-history", b.id],
      queryFn: () => api.chat.history({ booking_id: b.id, page_size: 50 }),
      staleTime: 30_000,
      subscribed: focused,
    })),
  });
  const loading = upcomingQ.isLoading || pastQ.isLoading;
  const failed = upcomingQ.isError && pastQ.isError;

  return (
    <Screen floatingBar="tabs" refreshing={upcomingQ.isRefetching} onRefresh={() => {
      void upcomingQ.refetch();
      void pastQ.refetch();
      histories.forEach((h) => void h.refetch());
    }} testID="chat-tab">
      <PlayerOfflineBanner />
      <Text variant="h1" accessibilityRole="header">
        {copy("Chat", "Chat")}
      </Text>
      <Text variant="meta" tone="muted">
        {copy("Har booking ki apni chat hai: waqt, raasta ya payment ke baare mein poochein.", "Each booking has its own chat: ask about the time, directions or payment.")}
      </Text>
      {loading ? (
        <View style={{ gap: space[3] }}>
          <SkeletonCard />
        </View>
      ) : failed ? (
        <ErrorState message={friendlyErrorMessage(upcomingQ.error)} onRetry={() => upcomingQ.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title={copy("Abhi koi chat nahi", "No chats yet")}
          body={copy("Booking karte hi us ki chat yahan aa jayegi. Kisi venue ke baare mein poochna ho to venue page par chat ka button dabayein.", "Once you book, its chat shows up here. To ask about a venue, tap the chat button on its page.")}
          actionLabel={copy("Court dhoondo", "Find a court")}
          onAction={() => router.push("/(player)/search")}
        />
      ) : (
        <View style={{ backgroundColor: palette.white, borderRadius: radius.card, overflow: "hidden" }} testID="chat-rows">
          {rows.map((b, i) => (
            <ChatRow key={b.id} booking={b} history={histories[i]?.data} loadingHistory={!!histories[i]?.isLoading} divider={i < rows.length - 1} />
          ))}
        </View>
      )}
      <Banner tone="info" body={copy("Ye booking assistant hai jo fori jawab deta hai. Venue se seedhi baat ke liye venue page par WhatsApp dabayein.", "This is the booking assistant and it replies instantly. To reach the venue directly, use WhatsApp on the venue page.")} />
    </Screen>
  );
}

function ChatRow({ booking, history, loadingHistory, divider }: { booking: Booking; history: ChatHistoryItem[] | undefined; loadingHistory: boolean; divider: boolean }) {
  const copy = useCopy();
  const lang = useLang();
  const place = useBookingPlace(booking);
  const last = history && history.length ? history[history.length - 1] : null;
  const name = place.venue?.name ?? copy("Venue", "Venue");
  const when = `${formatDate(booking.starts_at, new Date(), lang)} · ${formatTimeRange(booking.starts_at, booking.ends_at, lang)}`;
  return (
    <Pressable
      testID="chat-row"
      onPress={() => router.push({ pathname: "/(player)/booking/[id]/chat", params: { id: booking.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${when}${last ? `, ${last.content}` : ""}`}
      style={({ pressed }) => ({ flexDirection: "row", gap: space[3], padding: space[4], alignItems: "center", backgroundColor: pressed ? palette.ground : palette.white, borderBottomWidth: divider ? 1 : 0, borderBottomColor: palette.divider, minHeight: 72 })}
    >
      <Avatar name={name} tone="night" />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
          <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {last ? (
            <Text variant="caption" tone="muted">
              {formatTime(last.created_at)}
            </Text>
          ) : null}
        </View>
        <Text variant="meta" tone="muted" numberOfLines={2}>
          {loadingHistory ? " " : last ? `${last.sender_type === "player" ? copy("Aap: ", "You: ") : ""}${last.content}` : copy("Abhi koi baat nahi hui. Poochne ke liye kholein.", "No messages yet. Open to ask.")}
        </Text>
        <View style={{ flexDirection: "row", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
          <StatusPill booking={shownStatus(booking)} size="sm" />
          <Text variant="caption" tone="muted">
            {when}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={palette.muted} />
    </Pressable>
  );
}
