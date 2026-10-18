import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ChevronLeftIcon } from "@/components/icons";
import { NotificationsList } from "@/components/notification-row";

/** The player's list behind the bell (Owner Round 2, A6): readable sentences from the notification feed. */
export default function PlayerNotificationsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 py-4.5 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Wapas"
          className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center"
        >
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-figtree-bold text-player-ink text-[17px]" accessibilityRole="header">
          Notifications
        </Text>
      </View>
      <NotificationsList tone="player" />
    </SafeAreaView>
  );
}
