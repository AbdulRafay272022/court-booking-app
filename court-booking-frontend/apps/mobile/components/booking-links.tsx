import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

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
    <View className="flex-row items-center gap-2.5">
      <Pressable
        onPress={onDetails}
        accessibilityRole="button"
        accessibilityLabel="Details"
        style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E6", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }}
      >
        <Text className="font-plex-semibold text-owner-ink text-[13.5px]">Details</Text>
      </Pressable>
      <Pressable
        onPress={() => openInHistory(bookingId, startsAt, beforeNavigate)}
        accessibilityRole="link"
        accessibilityLabel="History mein dekhein"
        style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 6 }}
      >
        <Text className="font-plex-bold text-owner-accent text-[13.5px] underline">History mein dekhein</Text>
      </Pressable>
    </View>
  );
}
