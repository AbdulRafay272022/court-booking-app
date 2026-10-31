import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WifiOff } from "lucide-react-native";
import { palette, space } from "@court-booking/ui-tokens";
import { Button, LangProvider, RoleProvider, Text, useCopy } from "@/components/ui";
import { usePlayerLang } from "@/lib/player-lang";

/** Shown when a stored session couldn't be confirmed because the server was unreachable (after
 * retries) and there's no cached profile to run on. The user is NOT signed out and is
 * deliberately not sent to the login screen -- logging in again costs a WhatsApp send and
 * wouldn't fix a network problem. Mounted at the root (outside the role layouts): player theme, so the
 * primary is orange with ink text (never white on orange). Laid out like the PStates "Error" board (88px tinted icon
 * tile, 26px title, full-width "Dobara koshish"); the role is unknown here, so the language is the device's player
 * choice (Roman Urdu by default). */
export function SessionUnreachable({ onRetry }: { onRetry: () => void }) {
  const lang = usePlayerLang((s) => s.lang);
  return (
    <RoleProvider role="player">
      <LangProvider lang={lang}>
        <UnreachableBody onRetry={onRetry} />
      </LangProvider>
    </RoleProvider>
  );
}

function UnreachableBody({ onRetry }: { onRetry: () => void }) {
  const copy = useCopy();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.ground, justifyContent: "center", paddingHorizontal: space[5] }} edges={["top", "bottom"]} testID="session-unreachable">
      <View style={{ alignItems: "center", gap: 14 }}>
        <View
          style={{ width: 88, height: 88, borderRadius: 28, backgroundColor: palette.dangerTint, alignItems: "center", justifyContent: "center" }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <WifiOff size={40} color={palette.danger} strokeWidth={2} />
        </View>
        <Text variant="h2" align="center" accessibilityRole="header">
          {copy("Abhi Khelo tak nahi pohanch sake", "Can't reach Khelo right now")}
        </Text>
        <Text variant="bodyL" tone="muted" align="center">
          {copy(
            "Aap abhi bhi signed in hain. Internet check karein, phir wahin se shuru karenge jahan chhora tha.",
            "You're still signed in. Check your connection and we'll pick up where you left off.",
          )}
        </Text>
        <View style={{ alignSelf: "stretch" }}>
          <Button label={copy("Dobara koshish", "Try again")} block onPress={onRetry} testID="session-retry" />
        </View>
        <Text variant="caption" tone="subtle" align="center">
          {copy("Aap ki bookings aur paisa mehfooz hain.", "Your bookings and money are safe.")}
        </Text>
      </View>
    </SafeAreaView>
  );
}
