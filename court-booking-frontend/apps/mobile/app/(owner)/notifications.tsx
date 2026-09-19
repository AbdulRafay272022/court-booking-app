import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatRelativeTime, notificationLabel } from "@/lib/format";
import { ChevronLeftIcon, WhatsAppIcon, BellIcon, PhoneIcon } from "@/components/icons";
import { EmptyState } from "./_dashboard-components";

export default function OwnerNotificationsScreen() {
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => api.users.notifications(1, 50) });
  const items = query.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16.5px]">Notifications</Text>
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : query.isError && items.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          subtitle="Approvals, new bookings, and venue updates will show up here — this list is more reliable than push right now."
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-3.5 pb-6 gap-2">
          {items.map((n) => (
            <View key={n.id} className="flex-row items-center gap-3 p-3.5 rounded-xl bg-owner-surface border border-owner-border">
              <View className="w-9 h-9 rounded-full bg-owner-bg items-center justify-center">
                {n.channel === "whatsapp" ? <WhatsAppIcon /> : n.channel === "sms" ? <PhoneIcon /> : <BellIcon size={16} />}
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-plex-semibold text-owner-ink text-[13.5px]">{notificationLabel(n.event_type)}</Text>
                <Text className="font-plex-medium text-owner-ink-faint text-xs">{formatRelativeTime(n.created_at)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
