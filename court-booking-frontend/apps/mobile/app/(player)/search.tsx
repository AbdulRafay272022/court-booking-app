import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, SearchX, SlidersHorizontal, X } from "lucide-react-native";
import { addDays, formatDateString, formatDuration, formatTime24As12, pktDateString, type VenueSummary } from "@court-booking/types";
import { palette, radius, size, space, venueCardData } from "@court-booking/ui-tokens";

import { Button, EmptyState, ErrorState, IconButton, SkeletonCard, Text, VenueCard, useCopy, useLang, useRoleTheme, useVenueCardViewability } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { safeBack } from "@/lib/safe-back";
import { PLAYER_HOME_HREF } from "@/lib/safe-back-rules";
import { EMPTY_FILTERS, activeFilterChips, filtersToParams, filtersToQuery, parseFilters, type VenueFilters } from "@/lib/venue-filters";
import { PlayerOfflineBanner, asList, useFavoriteToggle } from "./_components";
import { DEFAULT_CITY, FiltersSheet } from "./_filters";

/**
 * PSearch board: results list of the shared VenueCard (all photos, autoplay only for the visible card, ONE Amenities chip),
 * active-filter chips, the Filters bottom sheet and an honest empty state. The map ("Naqsha") is not offered: the app has
 * no map module (needs a native dependency, see the M1 report).
 */
export default function SearchScreen() {
  const copy = useCopy();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const t = useRoleTheme();
  // ALL filter state lives in the route params, so returning from a venue (or reloading) keeps it.
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const filters = useMemo(() => parseFilters(params), [params]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fav = useFavoriteToggle();
  const vis = useVenueCardViewability();

  function applyFilters(next: VenueFilters) {
    router.setParams({ ...filtersToParams(next), open: undefined });
  }

  // Home's "Filters" entry opens this screen with ?open=1 so the sheet is already up.
  const openParam = Array.isArray(params.open) ? params.open[0] : params.open;
  useEffect(() => {
    if (openParam === "1") {
      setSheetOpen(true);
      router.setParams({ open: undefined });
    }
  }, [openParam]);

  const query = useQuery({
    queryKey: ["venue-search", filtersToQuery(filters, DEFAULT_CITY)],
    queryFn: () => api.venues.list(filtersToQuery(filters, DEFAULT_CITY)),
  });
  const venues = asList<VenueSummary>(query.data?.venues);
  const chips = activeFilterChips(filters);
  const nonSport = chips.filter((c) => c.key !== "sport");
  const place = filters.near ? copy("Aap ke qareeb", "Near you") : filters.area ?? DEFAULT_CITY;
  const whenLine =
    filters.date && filters.time
      ? `${filters.date === pktDateString() ? copy("Aaj", "Today") : formatDateString(filters.date, new Date(), lang)} ${formatTime24As12(filters.time)}${filters.duration ? ` · ${formatDuration(filters.duration, lang)}` : ""}`
      : filters.date
        ? formatDateString(filters.date, new Date(), lang)
        : copy("Koi bhi waqt", "Any time");

  const header = (
    <View style={{ gap: space[3], paddingBottom: space[2] }}>
      <PlayerOfflineBanner />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <IconButton icon={ArrowLeft} accessibilityLabel={copy("Wapas", "Back")} onPress={() => safeBack(PLAYER_HOME_HREF)} testID="search-back" />
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={copy(`Search badlein: ${filters.sport ?? "Koi bhi khel"}, ${place}, ${whenLine}`, `Change search: ${filters.sport ?? "Any sport"}, ${place}, ${whenLine}`)}
          style={({ pressed }) => ({ flex: 1, minHeight: 52, borderRadius: radius.input, backgroundColor: palette.white, paddingHorizontal: space[4], paddingVertical: 6, justifyContent: "center", opacity: pressed ? 0.85 : 1 })}
          testID="search-summary"
        >
          <Text variant="bodyBold" weight="black">
            {`${filters.sport ?? copy("Sab khel", "All sports")} · ${place}`}
          </Text>
          <Text variant="caption" tone="muted">
            {whenLine}
          </Text>
        </Pressable>
        <IconButton
          icon={SlidersHorizontal}
          accessibilityLabel={nonSport.length ? copy(`Filters, ${nonSport.length} lage hue`, `Filters, ${nonSport.length} on`) : copy("Filters", "Filters")}
          badge={nonSport.length || null}
          onPress={() => setSheetOpen(true)}
          testID="search-filters"
        />
      </View>
      {chips.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {chips.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => applyFilters({ ...filters, ...c.clear })}
              accessibilityRole="button"
              accessibilityLabel={copy(`Filter hatayein: ${c.label}`, `Remove filter ${c.label}`)}
              style={{ minHeight: size.tap, paddingLeft: space[3], paddingRight: space[2], borderRadius: radius.pill, backgroundColor: t.selected.bg, borderWidth: 2, borderColor: t.selected.border, flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Text variant="label" color={t.selected.fg}>
                {c.label}
              </Text>
              <X size={14} color={t.selected.fg} strokeWidth={2.6} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {!query.isLoading && venues.length > 0 ? (
        <Text variant="meta" tone="muted" testID="search-count">
          <Text variant="meta" weight="black">
            {copy(`${venues.length} venues`, `${venues.length} venue${venues.length === 1 ? "" : "s"}`)}
          </Text>
          {filters.near ? copy(" · qareeb pehle", " · nearest first") : ""}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <FlatList
        testID="search-screen"
        data={query.isLoading || (query.isError && venues.length === 0) ? [] : venues}
        keyExtractor={(v) => v.id}
        {...vis.listProps}
        contentContainerStyle={{ paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[8], paddingHorizontal: t.gutter, gap: space[4] }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={{ gap: space[4] }} accessibilityLabel={copy("Venues dhoond rahe hain", "Searching venues")}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : query.isError ? (
            <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} onBack={() => safeBack(PLAYER_HOME_HREF)} backLabel={copy("Home par jayein", "Go home")} />
          ) : (
            <View testID="search-empty">
              <EmptyState
                icon={SearchX}
                title={chips.length > 0 ? copy("Is waqt koi court khaali nahi", "No court matches right now") : copy(`${place} mein abhi koi venue nahi`, `No venues in ${place} yet`)}
                body={
                  chips.length > 0
                    ? `${[filters.sport, place, whenLine].filter(Boolean).join(" · ")}. ${copy("Doosra waqt ya qareebi ilaqa dekh lein.", "Try another time or a nearby area.")}`
                    : copy("Hum ek ek ilaqa khol rahe hain taake har listing asli ho.", "We open one area at a time so every listing is real.")
                }
              />
              <View style={{ gap: space[2] }}>
                {filters.date ? (
                  <Button label={copy("Agle din ke slots dekhein", "See the next day")} block onPress={() => applyFilters({ ...filters, date: addDays(filters.date!, 1) })} testID="search-next-day" />
                ) : null}
                {nonSport.length > 0 ? (
                  <Button label={copy("Filters kam karein", "Use fewer filters")} variant="soft" size="md" block onPress={() => applyFilters({ ...EMPTY_FILTERS, sport: filters.sport })} testID="search-clear" />
                ) : null}
              </View>
            </View>
          )
        }
        renderItem={({ item }) => (
          <VenueCard
            venue={venueCardData(item, { sport: filters.sport })}
            visible={vis.isVisible(item.id)}
            saved={fav.isSaved(item.id)}
            onToggleSave={fav.enabled ? () => fav.toggle(item.id) : undefined}
            onPress={() => router.push({ pathname: "/(player)/venue/[slug]", params: filters.sport ? { slug: item.slug, sport: filters.sport } : { slug: item.slug } })}
          />
        )}
      />
      <FiltersSheet
        open={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setSheetOpen(false);
          applyFilters(next);
        }}
      />
    </View>
  );
}
