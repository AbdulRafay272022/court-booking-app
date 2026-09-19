import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatRelativeTime, notificationLabel } from "@/lib/format";
import { ChevronLeftIcon, WhatsAppIcon, BellIcon, PhoneIcon } from "@/components/icons";
import { EmptyState } from "./_components";

export default function PlayerNotificationsScreen() {
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => api.users.notifications(1, 50) });
  const items = query.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 py-4.5 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-figtree-bold text-player-ink text-[17px]">Notifications</Text>
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EF5A2C" />
        </View>
      ) : query.isError && items.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="player" />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing yet" subtitle="Booking updates and waitlist alerts will show up here." />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-6 gap-2.5">
          {items.map((n) => (
            <View key={n.id} className="flex-row items-center gap-3 p-4 rounded-2xl bg-player-surface border border-player-border-light">
              <View className="w-9 h-9 rounded-full bg-player-surface-2 items-center justify-center">
                {n.channel === "whatsapp" ? <WhatsAppIcon /> : n.channel === "sms" ? <PhoneIcon /> : <BellIcon size={16} color="#141A1D" />}
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-figtree-semibold text-player-ink text-sm">{notificationLabel(n.event_type)}</Text>
                <Text className="font-figtree-medium text-player-ink-faint text-xs">{formatRelativeTime(n.created_at)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
