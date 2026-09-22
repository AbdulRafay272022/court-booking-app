import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";

import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { ChevronLeftIcon, LocationPinIcon } from "@/components/icons";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { capitalize } from "@/lib/format";
import { EmptyState, SportChip, VenueCard } from "./_components";

const SPORTS = ["padel", "futsal", "cricket", "tennis"];
const DEFAULT_CITY = "Karachi";

export default function SearchScreen() {
  const params = useLocalSearchParams<{ sport?: string }>();
  const [sport, setSport] = useState<string | undefined>(params.sport);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [areaLabel, setAreaLabel] = useState(DEFAULT_CITY);
  const [locating, setLocating] = useState(false);

  const query = useQuery({
    queryKey: ["venue-search", sport, coords?.lat, coords?.lng],
    queryFn: () =>
      api.venues.list({
        sport,
        city: coords ? undefined : DEFAULT_CITY,
        lat: coords?.lat,
        lng: coords?.lng,
        radius_km: 15,
        per_page: 30,
      }),
  });

  async function useMyLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const position = await Location.getCurrentPositionAsync({});
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
      const places = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const place = places[0];
      if (place) setAreaLabel([place.district ?? place.subregion, place.city].filter(Boolean).join(", "));
    } finally {
      setLocating(false);
    }
  }

  const venues = query.data?.venues ?? [];

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 pt-5.5 pb-3.5 bg-player-surface border-b border-player-border-light gap-3.5">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
            <ChevronLeftIcon />
          </Pressable>
          <View className="flex-1 gap-0.5">
            <Text className="font-figtree-bold text-player-ink text-[17px] -tracking-[0.2px]">
              {sport ? `${capitalize(sport)} · ` : "Courts · "}
              {query.isLoading ? "Searching…" : `${venues.length} venue${venues.length === 1 ? "" : "s"}`}
            </Text>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px]">{areaLabel}</Text>
          </View>
        </View>

        <Pressable
          onPress={useMyLocation}
          disabled={locating}
          className="flex-row items-center gap-2 self-start px-3.5 h-9 rounded-full bg-player-surface-2"
        >
          <LocationPinIcon size={15} />
          <Text className="font-figtree-semibold text-player-ink-muted text-[12.5px]">
            {locating ? "Locating…" : "Use my location"}
          </Text>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {SPORTS.map((s) => (
            <SportChip key={s} label={capitalize(s)} selected={sport === s} onPress={() => setSport(sport === s ? undefined : s)} />
          ))}
        </ScrollView>
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EF5A2C" />
        </View>
      ) : query.isError && venues.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="player" />
      ) : venues.length === 0 ? (
        <EmptyState
          title={`No ${sport ?? "courts"} in ${areaLabel} yet`}
          subtitle="We're opening one area at a time so every listing is real. Right now we're live in DHA and Clifton, Karachi."
          action={sport ? { label: "Show all sports", onPress: () => setSport(undefined) } : undefined}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-8 gap-3">
          {venues.map((v) => (
            <VenueCard
              key={v.id}
              venue={v}
              onPress={() => router.push({ pathname: "/(player)/venue/[slug]", params: sport ? { slug: v.slug, sport } : { slug: v.slug } })}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
