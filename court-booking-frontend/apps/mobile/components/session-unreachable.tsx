import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { palette, space } from "@court-booking/ui-tokens";
import { Button, RoleProvider, Text } from "@/components/ui";
import { Logo } from "@/components/auth/kit";

/** Shown when a stored session couldn't be confirmed because the server was unreachable (after
 * retries) and there's no cached profile to run on. The user is NOT signed out and is
 * deliberately not sent to the login screen -- logging in again costs a WhatsApp send and
 * wouldn't fix a network problem. Mounted at the root (outside the role layouts): player theme, so the
 * primary is orange with ink text (never white on orange). */
export function SessionUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <RoleProvider role="player">
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.ground, alignItems: "center", justifyContent: "center", paddingHorizontal: space[8] }} edges={["top", "bottom"]}>
        <View style={{ alignItems: "center", gap: 22 }}>
          <Logo size={64} />
          <View style={{ alignItems: "center", gap: space[2] }}>
            <Text variant="title" align="center">
              Can't reach Khelo right now
            </Text>
            <Text variant="body" tone="muted" align="center">
              You're still signed in. Check your connection and we'll pick up where you left off.
            </Text>
          </View>
          <Button label="Try again" onPress={onRetry} />
        </View>
      </SafeAreaView>
    </RoleProvider>
  );
}
