import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ChevronLeftIcon, StarBadgeIcon, TrendingUpIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { EmptyState, VenueSwitcher } from "./_dashboard-components";

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

function formatHourRange(hour: number): string {
  const pad = (h: number) => String(h % 24).padStart(2, "0");
  return `${pad(hour)}:00–${pad(hour + 1)}:00`;
}

export default function GrowthScreen() {
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();

  const query = useQuery({
    queryKey: ["owner-growth", activeVenueId],
    queryFn: () => api.owners.growth(activeVenueId),
    enabled: !!activeVenueId,
    retry: false,
  });

  const ineligible = query.error instanceof ApiError && query.error.status === 403;
  const suggestions = query.data?.underbooked_slots ?? [];

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 pt-5 pb-4 bg-owner-surface border-b border-owner-border gap-4">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
            <ChevronLeftIcon />
          </Pressable>
          <View className="gap-0.5">
            <Text className="font-plex-bold text-owner-ink text-[19px] -tracking-[0.3px]">Fill your empty slots</Text>
            <Text className="font-plex-medium text-owner-ink-faint text-[13px]">Based on your venue's booking history</Text>
          </View>
        </View>
        {showSwitcher ? <VenueSwitcher venues={venues} activeVenueId={activeVenueId} onSelect={setVenueId} /> : null}
      </View>

      {venuesLoading || query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : ineligible ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <View className="w-[46px] h-[46px] rounded-full items-center justify-center" style={{ backgroundColor: "#FBF0DD" }}>
            <StarBadgeIcon size={22} />
          </View>
          <Text className="font-plex-bold text-owner-ink text-base text-center">Growth insights are a Pro feature</Text>
          <Text className="font-plex-medium text-owner-ink-faint text-sm text-center leading-[1.5]">
            Upgrade {activeVenue?.name ?? "this venue"} to Pro or Business to see which slots are underbooked and get
            pricing suggestions to fill them.
          </Text>
        </View>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : suggestions.length === 0 ? (
        <EmptyState
          title="Check back in a few weeks"
          subtitle="We need a bit more booking history at this venue before we can suggest anything useful."
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 pb-6 gap-3">
          {suggestions.map((s) => {
            const courtName = activeVenue?.courts.find((c) => c.id === s.court_id)?.name ?? "Court";
            return (
              <View
                key={`${s.court_id}-${s.day_of_week}-${s.hour}`}
                className="bg-owner-surface border border-owner-border rounded-2xl p-4.5 gap-3.5"
              >
                <View className="flex-row items-start gap-3">
                  <View className="w-[38px] h-[38px] rounded-[10px] items-center justify-center" style={{ backgroundColor: "#FBF0DD" }}>
                    <TrendingUpIcon />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="font-plex-bold text-owner-ink text-[15px] -tracking-[0.1px]">
                      {WEEKDAYS[s.day_of_week] ?? "This slot"} {formatHourRange(s.hour)}
                    </Text>
                    <Text className="font-plex-medium text-owner-ink-muted text-[13px] leading-[1.45]">
                      {courtName} · {s.suggestion}
                    </Text>
                  </View>
                </View>

                <View className="flex-row items-end gap-4 h-11">
                  <ComparisonBar label="THIS SLOT" fraction={s.booking_rate} tone="warn" />
                  <ComparisonBar label="VENUE AVG" fraction={s.venue_average} tone="neutral" />
                </View>

                <Text className="font-plex-medium text-owner-ink-fainter text-[11.5px]">
                  Based on {s.weeks_of_data} week{s.weeks_of_data === 1 ? "" : "s"} of data
                </Text>
              </View>
            );
          })}

          <View className="flex-row items-center gap-2.5 px-1 pt-1.5">
            <StarBadgeIcon size={15} />
            <Text className="font-plex-medium text-owner-ink-faint text-[12px] flex-1">
              These insights come with your Pro plan
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ComparisonBar({ label, fraction, tone }: { label: string; fraction: number; tone: "warn" | "neutral" }) {
  const color = tone === "warn" ? "#9C5C0A" : "#5B7079";
  return (
    <View className="flex-1 gap-1.5">
      <Text className="font-plex-semibold text-[10px] tracking-[0.09em]" style={{ color: "#8399A1" }}>
        {label}
      </Text>
      <View className="h-1.5 rounded-full" style={{ backgroundColor: "#EDF1F2" }}>
        <View
          className="h-full rounded-full"
          style={{ width: `${Math.max(4, Math.round(fraction * 100))}%`, backgroundColor: color }}
        />
      </View>
      <Text className="font-mono-semibold text-[13px]" style={{ color: "#101C21" }}>
        {Math.round(fraction * 100)}%
      </Text>
    </View>
  );
}
