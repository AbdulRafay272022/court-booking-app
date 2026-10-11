import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
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
import { CourtHoursPanel } from "@/components/court-hours-panel";
import { FavoriteButton } from "@/components/favorite-button";
import { PhotoGallery } from "@/components/photo-gallery";
import { VenueReviews } from "@/components/venue-reviews";
import { courtLabel } from "@/components/court-label";
import { decodeSportParam, findSport, sameSport } from "@/lib/sport";
import { AmenityBadges } from "@/components/amenity-badges";
import { BrandGradient, EmptyState, SportChip } from "../_components";

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
  const [popup, setPopup] = useState<{ courtId: string; courtName: string; courtSport: string; slotMinutes: number; date: string } | null>(null);

  const venueQuery = useQuery({
    queryKey: ["venue-detail", slug],
    queryFn: () => api.venues.getBySlug(slug!),
    enabled: !!slug,
  });
  const venue = venueQuery.data;

  // Default sport: the one the player arrived from (?sport=, if this venue actually offers it), else the
  // venue's first sport. Computed at render time, not stored via an effect (venue loads asynchronously, but
  // this recomputes correctly on its own once it does), so an explicit tab click always wins.
  // Matching is case-insensitive and the param is decoded defensively ("Football%20(full-field)", "padel" vs "Padel").
  const activeSport = sport ?? (venue && (findSport(venue.sports, decodeSportParam(sportParam)) ?? venue.sports[0]));
  const courts = (venue?.courts ?? []).filter((c) => c.is_active && sameSport(c.sport, activeSport));

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
                  <Text className="font-figtree-medium text-player-ink-faint text-[12px]">({venue.review_count})</Text>
                </View>
              ) : null}
            </View>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px]">
              {[venue.area ?? venue.city, formatDistance(venue.distance_meters)].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <FavoriteButton venueId={venue.id} venueName={venue.name} variant="pill" />
        </View>

        {venue.sports.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {venue.sports.map((s) => (
              <SportChip key={s} label={s[0].toUpperCase() + s.slice(1)} selected={activeSport === s} onPress={() => setSport(s)} />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-6 gap-3.5">
        {photos.length > 0 ? (
          <PhotoGallery photos={photos} label={venue.name} />
        ) : (
          <View className="h-[120px] rounded-[16px] overflow-hidden items-start justify-end p-4">
            <BrandGradient />
            <Text className="font-figtree-bold text-white text-[13px] capitalize" style={{ opacity: 0.9 }}>
              {venue.sports.join(" · ")}
            </Text>
          </View>
        )}
        <AmenityBadges amenities={venue.amenities} size="md" />
        {courts.length === 0 ? (
          <EmptyState title="No active courts" subtitle="This venue hasn't published any courts for this sport yet." />
        ) : (
          courts.map((court) => {
            const price = prices[court.id];
            return (
              <View key={court.id} className="bg-player-surface border border-player-border-light rounded-[18px] p-4 gap-3.5">
                <View className="items-center gap-0.5 rounded-xl px-4 py-3" style={{ backgroundColor: "#F3EEE9" }}>
                  <Text className="font-figtree-bold text-player-ink text-[16px] -tracking-[0.2px]">{courtLabel(court.name, court.sport)}</Text>
                  <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">
                    {court.is_indoor ? "Indoor · " : ""}{formatDuration(court.slot_minutes)} minimum{price != null ? ` · From PKR ${formatPKR(price)}` : ""}
                  </Text>
                </View>
                {/* this court's OWN photos, attached to its card (not the venue's) */}
                {court.photo_urls && court.photo_urls.length > 0 ? (
                  <PhotoGallery photos={court.photo_urls} aspectRatio={16 / 9} label={court.name} />
                ) : null}
                <CourtHoursPanel court={court} horizonDays={venue.booking_horizon_days} />
                <CourtMonthCalendar
                  courtId={court.id}
                  onSummary={(s) => setPrices((p) => ({ ...p, [court.id]: s.starts_from_price }))}
                  onSelectDate={(date) => setPopup({ courtId: court.id, courtName: court.name, courtSport: court.sport, slotMinutes: court.slot_minutes, date })}
                />
              </View>
            );
          })
        )}
        <VenueReviews venueId={venue.id} />
      </ScrollView>

      {popup ? (
        <CourtDayPopup
          courtId={popup.courtId}
          courtName={popup.courtName}
          courtSport={popup.courtSport}
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
