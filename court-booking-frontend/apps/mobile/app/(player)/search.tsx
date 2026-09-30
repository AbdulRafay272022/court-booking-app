import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SPORT_OPTIONS } from "@court-booking/types";

import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { FilterSheet } from "@/components/filter-sheet";
import { ChevronLeftIcon } from "@/components/icons";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { EMPTY_FILTERS, activeFilterChips, filtersToParams, filtersToQuery, parseFilters, type VenueFilters } from "@/lib/venue-filters";
import { EmptyState, SportChip, VenueCard } from "./_components";

const DEFAULT_CITY = "Karachi";

export default function SearchScreen() {
  // ALL filter state lives in the route params, so returning from a venue (or reloading) keeps it.
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const filters = useMemo(() => parseFilters(params), [params]);
  const [sheetOpen, setSheetOpen] = useState(false);

  function applyFilters(next: VenueFilters) {
    router.setParams({ ...filtersToParams(next), open: undefined });
  }

  // Home's "Filters" chip opens this screen with ?open=1 so the sheet is already up.
  const openParam = Array.isArray(params.open) ? params.open[0] : params.open;
  useEffect(() => {
    if (openParam === "1") {
      setSheetOpen(true);
      router.setParams({ open: undefined });
    }
  }, [openParam]);

  const areasQuery = useQuery({ queryKey: ["venue-areas"], queryFn: () => api.venues.areas(), staleTime: 5 * 60_000 });
  const query = useQuery({
    queryKey: ["venue-search", filtersToQuery(filters, DEFAULT_CITY)],
    queryFn: () => api.venues.list(filtersToQuery(filters, DEFAULT_CITY)),
  });

  const venues = query.data?.venues ?? [];
  const chips = activeFilterChips(filters);
  const nonSportChips = chips.filter((c) => c.key !== "sport");
  const areaLabel = filters.near ? "Near your location" : filters.area ?? DEFAULT_CITY;

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 pt-5.5 pb-3.5 bg-player-surface border-b border-player-border-light gap-3.5">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
            <ChevronLeftIcon />
          </Pressable>
          <View className="flex-1 gap-0.5">
            <Text className="font-figtree-bold text-player-ink text-[17px] -tracking-[0.2px]" accessibilityLabel="Result count">
              {filters.sport ? `${filters.sport} · ` : "Courts · "}
              {query.isLoading ? "Searching…" : `${venues.length} venue${venues.length === 1 ? "" : "s"}`}
            </Text>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px]">{areaLabel}</Text>
          </View>
          <Pressable
            onPress={() => setSheetOpen(true)}
            accessibilityLabel="Open filters"
            className="h-11 px-4 rounded-full flex-row items-center gap-1.5"
            style={{ backgroundColor: nonSportChips.length > 0 ? "#141A1D" : "#F4EFEC" }}
          >
            <Text className="font-figtree-bold text-[13px]" style={{ color: nonSportChips.length > 0 ? "#FFFFFF" : "#5C544D" }}>
              Filters{nonSportChips.length > 0 ? ` (${nonSportChips.length})` : ""}
            </Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {SPORT_OPTIONS.map((s) => (
            <SportChip key={s} label={s} selected={filters.sport === s} onPress={() => applyFilters({ ...filters, sport: filters.sport === s ? undefined : s })} />
          ))}
        </ScrollView>

        {nonSportChips.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 items-center">
            {nonSportChips.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => applyFilters({ ...filters, ...c.clear })}
                accessibilityLabel={`Remove filter ${c.label}`}
                className="flex-row items-center gap-1.5 pl-3 pr-2.5 h-8 rounded-full"
                style={{ backgroundColor: "#FDEBE4" }}
              >
                <Text className="font-figtree-semibold text-[12.5px]" style={{ color: "#C8431C" }}>{c.label}</Text>
                <Text className="font-figtree-bold text-[12px]" style={{ color: "#C8431C" }}>✕</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => applyFilters({ ...EMPTY_FILTERS, sport: filters.sport })} accessibilityLabel="Clear all filters" className="h-8 px-2 justify-center">
              <Text className="font-figtree-bold text-player-ink-muted text-[12.5px]">Clear all</Text>
            </Pressable>
          </ScrollView>
        ) : null}
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EF5A2C" />
        </View>
      ) : query.isError && venues.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="player" />
      ) : venues.length === 0 ? (
        <EmptyState
          title={chips.length > 0 ? "No venues match these filters" : `No courts in ${areaLabel} yet`}
          subtitle={
            chips.length > 0
              ? "Try removing a filter, or widening the price range or time."
              : "We're opening one area at a time so every listing is real. Right now we're live in DHA and Clifton, Karachi."
          }
          action={chips.length > 0 ? { label: "Clear all filters", onPress: () => applyFilters(EMPTY_FILTERS) } : undefined}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-8 gap-3">
          {venues.map((v) => (
            <VenueCard
              key={v.id}
              venue={v}
              onPress={() =>
                router.push({
                  pathname: "/(player)/venue/[slug]",
                  // the sport the player is looking at goes with them, so the venue opens on that sport's courts
                  params: filters.sport ? { slug: v.slug, sport: filters.sport } : { slug: v.slug },
                })
              }
            />
          ))}
        </ScrollView>
      )}

      {sheetOpen ? (
        <FilterSheet
          initial={filters}
          areas={areasQuery.data?.areas ?? []}
          onClose={() => setSheetOpen(false)}
          onApply={(next) => {
            setSheetOpen(false);
            applyFilters(next);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
