import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDistance, formatPKR } from "@/lib/format";
import { formatDuration } from "@court-booking/types";
import { ChevronLeftIcon, StarIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { CourtMonthCalendar } from "@/components/court-month-calendar";
import { CourtDayPopup } from "@/components/court-day-popup";
import { EmptyState, gradientFor, SportChip } from "../_components";

/**
 * Calendar-first venue page (Section 32 Part 4b UPDATE, 2026-09-22 -- replaces the earlier slot-list-first
 * design). Per sport tab, each active court renders its own always-visible month calendar (no page-level week
 * strip anymore, and no "View calendar" button -- the calendar IS the default view). Tapping a date opens a
 * popup scoped to that one court.
 */
export default function VenueDetailScreen() {
  const { slug, sport: sportParam } = useLocalSearchParams<{ slug: string; sport?: string }>();
  const [sport, setSport] = useState<string | undefined>(undefined);
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [popup, setPopup] = useState<{ courtId: string; courtName: string; slotMinutes: number; date: string } | null>(null);

  const venueQuery = useQuery({
    queryKey: ["venue-detail", slug],
    queryFn: () => api.venues.getBySlug(slug!),
    enabled: !!slug,
  });
  const venue = venueQuery.data;

  // Default sport: the one the player arrived from (?sport=, if this venue actually offers it), else the
  // venue's first sport. Computed at render time, not stored via an effect (venue loads asynchronously, but
  // this recomputes correctly on its own once it does), so an explicit tab click always wins.
  const activeSport = sport ?? (venue && (sportParam && venue.sports.includes(sportParam) ? sportParam : venue.sports[0]));
  const courts = (venue?.courts ?? []).filter((c) => c.is_active && c.sport === activeSport);

  if (venueQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg items-center justify-center" edges={["top", "bottom"]}>
        <ActivityIndicator color="#EF5A2C" />
      </SafeAreaView>
    );
  }

  if (!venue && venueQuery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
        <ErrorState message={friendlyErrorMessage(venueQuery.error)} onRetry={() => venueQuery.refetch()} tone="player" />
      </SafeAreaView>
    );
  }

  if (!venue) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
        <EmptyState title="Venue not found" subtitle="This listing may have been removed." />
      </SafeAreaView>
    );
  }

  const photos = venue.photo_urls ?? [];

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      {photos.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ height: 180 }}>
          {photos.map((url, i) => (
            <Image key={i} source={{ uri: url }} style={{ width: 393, height: 180 }} resizeMode="cover" />
          ))}
        </ScrollView>
      ) : (
        <View className="h-[100px] items-start justify-end p-4" style={{ backgroundColor: gradientFor(venue.id) }}>
          <Text className="font-figtree-bold text-white text-[13px]" style={{ opacity: 0.85 }}>
            {venue.sports.join(" · ")}
          </Text>
        </View>
      )}
      <View className="px-5 pt-5 pb-3.5 bg-player-surface border-b border-player-border-light gap-3">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
            <ChevronLeftIcon />
          </Pressable>
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Text className="font-figtree-bold text-player-ink text-[18px] -tracking-[0.2px]">{venue.name}</Text>
              {venue.average_rating != null ? (
                <View className="flex-row items-center gap-1">
                  <StarIcon />
                  <Text className="font-figtree-bold text-player-ink text-[13px]">{venue.average_rating.toFixed(1)}</Text>
                </View>
              ) : null}
            </View>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px]">
              {[venue.area ?? venue.city, formatDistance(venue.distance_meters)].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>

        {venue.sports.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {venue.sports.map((s) => (
              <SportChip key={s} label={s[0].toUpperCase() + s.slice(1)} selected={activeSport === s} onPress={() => setSport(s)} />
            ))}
          </ScrollView>
        ) : null}
      </View>

      {courts.length === 0 ? (
        <EmptyState title="No active courts" subtitle="This venue hasn't published any courts for this sport yet." />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-6 gap-3.5">
          {courts.map((court) => {
            const price = prices[court.id];
            return (
              <View key={court.id} className="bg-player-surface border border-player-border-light rounded-[18px] p-4 gap-3.5">
                <View className="items-center gap-0.5">
                  <Text className="font-figtree-bold text-player-ink text-[16px] -tracking-[0.2px]">{court.name}</Text>
                  <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">
                    {formatDuration(court.slot_minutes)} slots{price != null ? ` · From PKR ${formatPKR(price)}` : ""}
                  </Text>
                </View>
                <CourtMonthCalendar
                  courtId={court.id}
                  onSummary={(s) => setPrices((p) => ({ ...p, [court.id]: s.starts_from_price }))}
                  onSelectDate={(date) => setPopup({ courtId: court.id, courtName: court.name, slotMinutes: court.slot_minutes, date })}
                />
              </View>
            );
          })}
        </ScrollView>
      )}

      {popup ? (
        <CourtDayPopup
          courtId={popup.courtId}
          courtName={popup.courtName}
          slotMinutes={popup.slotMinutes}
          venueId={venue.id}
          venueName={venue.name}
          initialDate={popup.date}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}
