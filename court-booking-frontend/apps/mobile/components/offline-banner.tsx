import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetworkStatus } from "@/lib/network-status";

/** Section 12: "airplane mode mid-session -> clear 'you're offline' state ... reconnecting
 * resumes normal operation without requiring an app restart." Sits above the routed
 * stacks in the root layout so it's visible regardless of role. */
export function OfflineBanner() {
  const online = useNetworkStatus();
  if (online) return null;

  return (
    <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 999 }}>
      <View className="mx-3 mt-2 px-3.5 py-2.5 rounded-xl flex-row items-center gap-2" style={{ backgroundColor: "#141A1D" }}>
        <View className="w-2 h-2 rounded-full" style={{ backgroundColor: "#E29B8A" }} />
        <Text className="font-figtree-semibold text-white text-[12.5px] flex-1">
          You're offline — check your connection. We'll reconnect automatically.
        </Text>
      </View>
    </SafeAreaView>
  );
}
