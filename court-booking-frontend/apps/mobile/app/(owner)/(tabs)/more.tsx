import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useAuthStore } from "@/lib/auth-store";
import { confirmLogout } from "@/lib/logout";
import { openSupportWhatsApp } from "@/lib/support";
import { OV } from "@/lib/overview";
import { ChevronRightIcon } from "@/components/icons";
import { moreItemAllowed, type MoreItemKey } from "@/lib/owner-access";
import { useMyPermissions } from "@/lib/use-my-permissions";

interface Item {
  label: string;
  sub?: string;
  onPress: () => void;
  ownerOnly?: boolean;
  /** Staff see it only with the matching permission (lib/owner-access.ts). */
  gate?: MoreItemKey;
  danger?: boolean;
}

/** "Aur": everything that is not one of the four tabs (the old Today icon row lives here now). */
export default function OwnerMoreScreen() {
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const staff = useAuthStore((s) => s.user?.role) === "staff";
  const { can, settled } = useMyPermissions();
  const go = (path: string) => () => router.push(path as never);
  const items: Item[] = [
    { label: "Bookings history", sub: "Purani bookings, filters aur search", gate: "history", onPress: go("/(owner)/history") },
    { label: "Add booking", sub: "Walk-in booking", gate: "walkin", onPress: go("/(owner)/walkin") },
    { label: "Check-in", sub: "QR scan ya booking code", gate: "checkin", onPress: go("/(owner)/checkin") },
    { label: "Notifications", onPress: go("/(owner)/notifications") },
    { label: "Growth", gate: "growth", onPress: go("/(owner)/growth") },
    { label: "Reviews", gate: "reviews", onPress: go("/(owner)/reviews") },
    { label: "Staff", ownerOnly: true, onPress: go("/(owner)/staff") },
    { label: "Premium", ownerOnly: true, onPress: go("/(owner)/premium") },
    { label: "Venue settings", sub: "Hold, reminders, cancellation, courts", gate: "venueSettings", onPress: go("/(owner)/venue-settings") },
    { label: "Shanakhti card (CNIC)", sub: "Venue settings mein", ownerOnly: true, onPress: go("/(owner)/venue-settings") },
    { label: "Account", onPress: go("/(owner)/account") },
    { label: "Madad chahiye? WhatsApp karein", onPress: () => openSupportWhatsApp() },
    { label: "Log out", danger: true, onPress: () => confirmLogout() },
  ];
  return (
    <View className="flex-1 bg-owner-bg">
      <SafeAreaView edges={["top"]} className="bg-owner-surface border-b border-owner-border">
        <View className="px-4 py-4">
          <Text className="font-plex-bold text-owner-ink text-[24px] -tracking-[0.4px]" accessibilityRole="header">
            Aur
          </Text>
        </View>
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-8 gap-2.5">
        {items
          .filter((i) => !i.ownerOnly || isOwner)
          // A staff member's list waits for the permissions answer, so a forbidden entry never flashes.
          .filter((i) => !i.gate || (staff && !settled ? false : moreItemAllowed(i.gate, can, staff)))
          .map((i) => (
            <Pressable
              key={i.label}
              onPress={i.onPress}
              accessibilityRole="button"
              className="flex-row items-center justify-between rounded-2xl bg-owner-surface px-4"
              style={{ minHeight: 58, borderWidth: 1.5, borderColor: OV.border }}
            >
              <View className="flex-1">
                <Text className="font-plex-semibold text-[15.5px]" style={{ color: i.danger ? OV.red : OV.ink }}>
                  {i.label}
                </Text>
                {i.sub ? <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">{i.sub}</Text> : null}
              </View>
              <ChevronRightIcon />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}
