import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { pktDateString } from "@/lib/format";

/** "Details" (opens the shared booking sheet) + "History mein dekho" (History screen with the booking open on its day).
 * Used on every Approvals and Refunds card. */
export function BookingLinks({ bookingId, startsAt, onDetails }: { bookingId: string; startsAt: string; onDetails: () => void }) {
  const day = pktDateString(startsAt);
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
        onPress={() => router.push({ pathname: "/(owner)/history", params: { from: day, to: day, booking: bookingId } })}
        accessibilityRole="link"
        accessibilityLabel="History mein dekho"
        style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 6 }}
      >
        <Text className="font-plex-bold text-owner-accent text-[13.5px] underline">History mein dekho</Text>
      </Pressable>
    </View>
  );
}
