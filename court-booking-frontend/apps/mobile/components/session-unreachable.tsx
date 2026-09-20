import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Logo } from "@/components/auth/kit";
import { playerColors } from "@/lib/colors";

/** Shown when a stored session couldn't be confirmed because the server was unreachable (after
 * retries) and there's no cached profile to run on. The user is NOT signed out and is
 * deliberately not sent to the login screen -- logging in again costs a WhatsApp send and
 * wouldn't fix a network problem. */
export function SessionUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <SafeAreaView className="flex-1 bg-player-bg items-center justify-center px-8" edges={["top", "bottom"]}>
      <View style={{ alignItems: "center", gap: 22 }}>
        <Logo size={64} />
        <View style={{ alignItems: "center", gap: 8 }}>
          <Text className="font-figtree-extrabold" style={{ fontSize: 21, color: playerColors.ink }}>
            Can't reach Maidan right now
          </Text>
          <Text className="font-figtree-medium" style={{ fontSize: 15, lineHeight: 22, textAlign: "center", color: playerColors.inkMuted }}>
            You're still signed in. Check your connection and we'll pick up where you left off.
          </Text>
        </View>
        <Pressable onPress={onRetry} style={{ height: 50, paddingHorizontal: 32, borderRadius: 14, backgroundColor: playerColors.accent, justifyContent: "center" }}>
          <Text className="font-figtree-bold" style={{ fontSize: 15, color: "#FFFFFF" }}>
            Try again
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
