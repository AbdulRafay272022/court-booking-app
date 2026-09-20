import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import type { Venue } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { CheckIcon, WhatsAppIcon } from "@/components/icons";
import { confirmLogout } from "@/lib/logout";
import { useOwnerVenues } from "@/lib/use-owner-venues";

function TimelineRow({
  state,
  title,
  subtitle,
  isLast,
}: {
  state: "done" | "active" | "upcoming";
  title: string;
  subtitle: string;
  isLast?: boolean;
}) {
  const dotColor = state === "done" ? "#1F7A52" : state === "active" ? "#9C5C0A" : "#F4F6F7";
  return (
    <View className="flex-row gap-3.5">
      <View className="items-center">
        <View
          className="w-[26px] h-[26px] rounded-full items-center justify-center"
          style={{
            backgroundColor: dotColor,
            borderWidth: state === "upcoming" ? 1.5 : 0,
            borderColor: "#DCE3E6",
          }}
        >
          {state === "done" ? (
            <CheckIcon size={14} strokeWidth={3} />
          ) : state === "active" ? (
            <View className="w-[9px] h-[9px] rounded-full bg-white" />
          ) : null}
        </View>
        {!isLast ? (
          <View
            className="w-0.5 flex-1 min-h-[26px]"
            style={{ backgroundColor: state === "done" ? "#1F7A52" : "#DCE3E6" }}
          />
        ) : null}
      </View>
      <View className={`gap-0.5 flex-1 ${isLast ? "" : "pb-5"}`}>
        <Text
          className="font-plex-semibold text-[14.5px]"
          style={{ color: state === "upcoming" ? "#8399A1" : state === "active" ? "#9C5C0A" : "#101C21" }}
        >
          {title}
        </Text>
        <Text
          className="font-plex-medium text-[12.5px] leading-[18px]"
          style={{ color: state === "upcoming" ? "#A6B6BC" : "#8399A1" }}
        >
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

export default function VenuePendingScreen() {
  const { venues: ownerVenues } = useOwnerVenues();
  const hasLiveVenue = ownerVenues.some((v) => v.status === "approved");
  const { venueId } = useLocalSearchParams<{ venueId: string }>();
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

  function handleAddBooking() {
    router.push("/(owner)/walkin");
  }

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

  const isChangesRequested = venue.status === "changes_requested";
  const courtCount = venue.courts?.length ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="bg-owner-surface border-b border-owner-border px-5 pt-6 pb-[22px] gap-3.5">
        <View className="flex-row items-center justify-between">
          <Text className="font-plex-bold text-owner-ink text-[18px] tracking-tight">{venue.name}</Text>
          <View
            className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full"
            style={{
              backgroundColor: isChangesRequested ? "#FBF0DD" : "#FBF0DD",
              borderWidth: 1,
              borderColor: "#E8D3A8",
            }}
          >
            <View className="w-1.5 h-1.5 rounded-full bg-owner-warn" />
            <Text className="font-plex-semibold text-owner-warn text-xs">
              {isChangesRequested ? "Changes requested" : "Under review"}
            </Text>
          </View>
        </View>
        <Text className="font-plex-medium text-owner-ink-muted text-sm leading-5">
          {isChangesRequested
            ? venue.rejection_reason ?? "We asked for a few changes — check WhatsApp for details."
            : "Submitted just now. We review every venue by hand — usually within a day."}
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-5 pb-8 gap-4">
        {hasLiveVenue ? (
          <Pressable onPress={() => router.replace("/(owner)/today")} accessibilityRole="button" className="min-h-11 justify-center self-start">
            <Text className="font-plex-bold text-owner-accent text-[13.5px] underline">← Back to your dashboard</Text>
          </Pressable>
        ) : null}
        <View className="bg-owner-surface border border-owner-border rounded-[13px] p-5">
          <TimelineRow
            state="done"
            title="You sent it in"
            subtitle={`${courtCount} court${courtCount === 1 ? "" : "s"}, hours and prices received`}
          />
          <TimelineRow
            state={isChangesRequested ? "upcoming" : "active"}
            title={isChangesRequested ? "Waiting on your changes" : "We're checking it now"}
            subtitle={
              isChangesRequested
                ? "Update the details we flagged and resubmit"
                : "Confirming your details are complete and accurate"
            }
          />
          <TimelineRow
            state="upcoming"
            title="You go live"
            subtitle="Players nearby can find and book you"
            isLast
          />
        </View>

        <View className="bg-owner-accent-soft border border-owner-accent-soft-border rounded-[13px] p-[18px] gap-3">
          <View className="gap-1">
            <Text className="font-plex-bold text-owner-accent-hover text-[15px]">
              You don't have to wait to start
            </Text>
            <Text className="font-plex-medium text-[13px] leading-5" style={{ color: "#316B7A" }}>
              Add today's phone and walk-in bookings now. When you go live, your calendar is
              already correct.
            </Text>
          </View>
          <Pressable
            onPress={handleAddBooking}
            className="min-h-11 rounded-[9px] bg-owner-accent items-center justify-center"
          >
            <Text className="font-plex-semibold text-white text-sm">Add a booking</Text>
          </Pressable>
        </View>

        <View className="bg-owner-surface border border-owner-border rounded-[13px] p-[18px] flex-row items-center gap-3">
          <View className="w-9 h-9 rounded-full bg-owner-accent-soft items-center justify-center">
            <WhatsAppIcon size={17} color="#0E6274" />
          </View>
          <Text className="font-plex-medium text-owner-ink-muted text-[13px] leading-[18px] flex-1">
            Taking too long? Message us and we'll look straight away.
          </Text>
        </View>

        <Pressable onPress={confirmLogout} className="min-h-11 rounded-[9px] border border-owner-border items-center justify-center">
          <Text className="font-plex-semibold text-owner-ink-muted text-sm">Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
