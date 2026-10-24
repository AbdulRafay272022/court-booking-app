import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ChevronLeftIcon } from "@/components/icons";
import { NotificationsList } from "@/components/notification-row";

/** The owner's list behind the bell (Owner Round 2, A6): readable sentences from the notification feed. */
export default function OwnerNotificationsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Wapas"
          className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center"
        >
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16.5px]" accessibilityRole="header">
          Notifications
        </Text>
      </View>
      <NotificationsList tone="owner" />
    </SafeAreaView>
  );
}
