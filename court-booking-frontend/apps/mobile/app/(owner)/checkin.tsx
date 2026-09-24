import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ChevronLeftIcon, ChevronRightIcon, QrIcon } from "@/components/icons";

/** Section 32 Part 9: a hub for the two check-in paths that don't happen directly on Today's slot
 * list -- printing the venue's own QR (players scan it to self-check-in) and scanning a player's
 * booking QR (or typing their booking code) as a faster front-desk alternative to finding their row
 * on Today. Today's own "Check in" / "No-show" buttons on each booked slot stay the primary path. */
export default function CheckinHubScreen() {
  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 pt-5 pb-4 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[19px] -tracking-[0.3px]">Check-in tools</Text>
      </View>

      <View className="px-4.5 pt-5 gap-3">
        <Pressable
          onPress={() => router.push("/(owner)/checkin-qr")}
          className="bg-owner-surface border border-owner-border rounded-xl p-4 flex-row items-center gap-3.5"
        >
          <View className="w-11 h-11 rounded-[10px] items-center justify-center" style={{ backgroundColor: "#F4F6F7" }}>
            <QrIcon size={22} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-plex-semibold text-owner-ink text-[15px]">Show venue QR code</Text>
            <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
              Print or display this at your entrance -- players scan it to check themselves in.
            </Text>
          </View>
          <ChevronRightIcon />
        </Pressable>

        <Pressable
          onPress={() => router.push("/(owner)/checkin-scan")}
          className="bg-owner-surface border border-owner-border rounded-xl p-4 flex-row items-center gap-3.5"
        >
          <View className="w-11 h-11 rounded-[10px] items-center justify-center" style={{ backgroundColor: "#F4F6F7" }}>
            <QrIcon size={22} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-plex-semibold text-owner-ink text-[15px]">Scan a player's code</Text>
            <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
              Scan the code from a player's booking, or enter their booking code by hand.
            </Text>
          </View>
          <ChevronRightIcon />
        </Pressable>

        <Text className="font-plex-medium text-owner-ink-faint text-[12px] px-1">
          Most check-ins are faster from Today: tap Check in on a player's row directly.
        </Text>
      </View>
    </SafeAreaView>
  );
}
