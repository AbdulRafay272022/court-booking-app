import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatShortDate, formatTime } from "@/lib/format";
import { useAuthStore } from "@/lib/auth-store";
import { confirmLogout } from "@/lib/logout";
import { SUPPORT_WHATSAPP_NUMBER, openSupportWhatsApp } from "@/lib/support";
import { WhatsAppIcon } from "@/components/icons";

export default function PlayerProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const waitlistQuery = useQuery({ queryKey: ["waitlist-mine"], queryFn: () => api.waitlist.mine() });
  const activeEntries = (waitlistQuery.data ?? []).filter((e) => e.is_active);

  async function leaveWaitlist(entryId: string) {
    try {
      await api.waitlist.leave(entryId);
      await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
    } catch (e) {
      Alert.alert("Couldn't leave the waitlist", friendlyErrorMessage(e));
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <ScrollView className="flex-1 px-5" contentContainerClassName="pb-6">
        <View className="pt-8 pb-6 gap-1">
          <Text className="font-figtree-extrabold text-player-ink text-2xl -tracking-[0.3px]">
            {user?.name ?? "Player"}
          </Text>
          <Text className="font-figtree-medium text-player-ink-muted text-base">{user?.phone}</Text>
        </View>

        {activeEntries.length > 0 ? (
          <View className="gap-3 pb-2">
            <Text className="font-figtree-bold text-[11px] tracking-[0.1em] text-player-ink-fainter">MY WAITLIST</Text>
            {activeEntries.map((entry) => (
              <View
                key={entry.id}
                className="bg-player-surface border border-player-border-light rounded-2xl p-4 flex-row items-center gap-3"
              >
                <View className="flex-1 gap-0.5">
                  <Text className="font-figtree-semibold text-player-ink text-[14.5px]">
                    {entry.venue_name} · {entry.court_name}
                  </Text>
                  <Text className="font-figtree-medium text-player-ink-faint text-xs">
                    {formatShortDate(entry.slot_starts_at)} · {formatTime(entry.slot_starts_at)} · #{entry.position} in line
                  </Text>
                </View>
                <Pressable onPress={() => leaveWaitlist(entry.id)}>
                  <Text className="font-figtree-semibold text-player-danger text-[13px]">Leave</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View className="px-5 pb-6 gap-3">
        <Pressable
          onPress={() => openSupportWhatsApp()}
          accessibilityLabel="Need help? WhatsApp us"
          className="h-14 rounded-2xl border border-player-border-light flex-row items-center justify-center gap-2"
        >
          <WhatsAppIcon size={16} color="#1F7A52" />
          <Text className="font-figtree-semibold text-player-ink text-base">
            Need help? WhatsApp us at {SUPPORT_WHATSAPP_NUMBER}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/(player)/edit-profile")}
          accessibilityRole="button"
          className="h-14 rounded-2xl border border-player-border items-center justify-center"
        >
          <Text className="font-figtree-bold text-player-ink text-base">Edit profile</Text>
        </Pressable>
        <Pressable
          onPress={confirmLogout}
          className="h-14 rounded-2xl border border-player-border items-center justify-center"
        >
          <Text className="font-figtree-bold text-player-ink text-base">Log out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
