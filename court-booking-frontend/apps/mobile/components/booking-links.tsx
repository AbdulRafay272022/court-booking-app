import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { size, space } from "@court-booking/ui-tokens";
import { Button, Text } from "@/components/ui";

import { pktDateString } from "@/lib/format";

/** Opens History on the booking's own day with that booking highlighted (no popup on History). `beforeNavigate`
 * closes whatever sheet the link sits in FIRST, then navigates (A2). */
export function openInHistory(bookingId: string, startsAt: string, beforeNavigate?: () => void) {
  const day = pktDateString(startsAt);
  beforeNavigate?.();
  router.push({ pathname: "/(owner)/history", params: { from: day, to: day, booking: bookingId } });
}

/** "Details" (opens the shared booking sheet) + "History mein dekhein". Used on every Approvals and Refunds card. */
export function BookingLinks({ bookingId, startsAt, onDetails, beforeNavigate }: { bookingId: string; startsAt: string; onDetails: () => void; beforeNavigate?: () => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <Button label="Details" variant="soft" size="sm" onPress={onDetails} accessibilityLabel="Details" />
      <Pressable
        onPress={() => openInHistory(bookingId, startsAt, beforeNavigate)}
        accessibilityRole="link"
        accessibilityLabel="History mein dekhein"
        style={{ minHeight: size.tap, justifyContent: "center", paddingHorizontal: space[2] }}
      >
        <Text variant="bodyBold" tone="link" style={{ textDecorationLine: "underline" }}>
          History mein dekhein
        </Text>
      </Pressable>
    </View>
  );
}
