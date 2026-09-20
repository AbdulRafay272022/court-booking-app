import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import type { Venue } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { confirmLogout } from "@/lib/logout";
import { openSupportWhatsApp } from "@/lib/support";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { WhatsAppIcon } from "@/components/icons";

/** The "rejected" state. Before Section 26 an owner whose only venue was rejected was silently
 * dropped onto the normal Today screen with no message at all. Now they see the reason and real
 * next steps: talk to us (there's no owner-side resubmit endpoint, so a person has to look) or
 * register the venue again with the details corrected. */
export default function VenueRejectedScreen() {
  const { venueId } = useLocalSearchParams<{ venueId: string }>();
  const resetDraft = useVenueSetupStore((s) => s.reset);
  const { venues: ownerVenues } = useOwnerVenues();
  const hasLiveVenue = ownerVenues.some((v) => v.status === "approved");
  const [venue, setVenue] = useState<Venue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setVenue(await api.venues.get(venueId));
      } catch (e) {
        setError(friendlyErrorMessage(e));
      }
    })();
  }, [venueId]);

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-owner-bg items-center justify-center px-6">
        <Text className="font-plex-medium text-owner-danger text-center">{error}</Text>
      </SafeAreaView>
    );
  }
  if (!venue) {
    return (
      <SafeAreaView className="flex-1 bg-owner-bg items-center justify-center">
        <ActivityIndicator color="#0E6274" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-6 pb-8 gap-4">
        {hasLiveVenue ? (
          <Pressable onPress={() => router.replace("/(owner)/today")} accessibilityRole="button" className="min-h-11 justify-center self-start">
            <Text className="font-plex-bold text-owner-accent text-[13.5px] underline">← Back to your dashboard</Text>
          </Pressable>
        ) : null}
        <View className="bg-owner-danger-soft border border-owner-danger-soft-border rounded-[13px] p-5 gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="font-plex-bold text-owner-ink text-[18px] tracking-tight flex-1">{venue.name}</Text>
            <View className="px-3 py-1.5 rounded-full bg-owner-surface border border-owner-danger-soft-border">
              <Text className="font-plex-semibold text-owner-danger text-xs">Not approved</Text>
            </View>
          </View>
          <Text className="font-plex-medium text-owner-danger text-sm leading-5">
            {venue.rejection_reason ?? "We couldn't approve this venue as submitted."}
          </Text>
        </View>

        <View className="bg-owner-surface border border-owner-border rounded-[13px] p-5 gap-3">
          <Text className="font-plex-bold text-owner-ink text-[15px]">What you can do next</Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[13.5px] leading-6">
            • Message us and we'll tell you exactly what would change the decision.{"\n"}• Or register the venue
            again with the details corrected.
          </Text>
          <Pressable
            onPress={() => openSupportWhatsApp(`Hi, my venue "${venue.name}" wasn't approved. Can you help?`)}
            className="min-h-12 rounded-[10px] bg-owner-accent flex-row items-center justify-center gap-2"
          >
            <WhatsAppIcon size={17} color="#FFFFFF" />
            <Text className="font-plex-bold text-white text-[15px]">Message support on WhatsApp</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              resetDraft();
              router.replace("/(owner)/venue-setup/register");
            }}
            className="min-h-12 rounded-[10px] border border-owner-border items-center justify-center"
          >
            <Text className="font-plex-semibold text-owner-ink text-[14.5px]">Register a new venue</Text>
          </Pressable>
        </View>

        <Pressable onPress={confirmLogout} className="min-h-11 rounded-[9px] border border-owner-border items-center justify-center">
          <Text className="font-plex-semibold text-owner-ink-muted text-sm">Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
