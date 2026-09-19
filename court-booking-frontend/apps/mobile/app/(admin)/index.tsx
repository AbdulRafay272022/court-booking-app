import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { confirmLogout } from "@/lib/logout";

/** Per the build prompt: admins use the web console — mobile just deep-links them there. */
export default function AdminHandoffScreen() {
  return (
    <SafeAreaView className="flex-1 bg-owner-bg px-6" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center gap-4">
        <Text className="font-plex-bold text-owner-ink text-2xl text-center">
          Use the web console
        </Text>
        <Text className="font-plex-medium text-owner-ink-muted text-base text-center">
          The admin tools (venue approvals, disputes, platform metrics) live on the web
          dashboard, not in this app.
        </Text>
      </View>
      <Pressable
        onPress={confirmLogout}
        className="h-14 rounded-xl border border-owner-border items-center justify-center mb-6"
      >
        <Text className="font-plex-bold text-owner-ink text-base">Log out</Text>
      </Pressable>
    </SafeAreaView>
  );
}
