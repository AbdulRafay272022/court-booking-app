import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import QRCode from "react-native-qrcode-svg";

import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ChevronLeftIcon } from "@/components/icons";
import { EmptyState } from "./_dashboard-components";

/** Section 32 Part 9. Encodes the venue's own `checkin_qr_token` -- a player scans it with their
 * own phone camera and the app calls POST /bookings/{id}/checkin/self. One QR per venue location
 * (not per court), same as the token itself is scoped on the backend. */
export default function CheckinQrScreen() {
  const { activeVenue, isLoading } = useOwnerVenues();
  const token = activeVenue?.checkin_qr_token;

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 pt-5 pb-4 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[19px] -tracking-[0.3px]">Venue check-in QR</Text>
      </View>

      {isLoading ? null : !token ? (
        <EmptyState title="No venue selected" subtitle="Choose a venue from Today first." />
      ) : (
        <View className="flex-1 items-center justify-center px-6 gap-6">
          <View className="p-5 bg-white rounded-2xl border border-owner-border">
            <QRCode value={token} size={240} />
          </View>
          <View className="items-center gap-1.5">
            <Text className="font-plex-bold text-owner-ink text-[17px] text-center">{activeVenue?.name}</Text>
            <Text className="font-plex-medium text-owner-ink-faint text-[13px] text-center max-w-[280px]">
              Print or display this at your entrance. Players open Maidan, tap "Scan to check in" on their
              booking, and scan this code -- no owner action needed.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
