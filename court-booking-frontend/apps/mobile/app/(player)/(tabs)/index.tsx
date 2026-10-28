import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useIsFocused } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bell, CircleDot, Feather, Goal, LayoutGrid, MapPin, QrCode, Search, Trophy } from "lucide-react-native";
import { CITY_OPTIONS, SPORT_OPTIONS, formatDateString, formatDuration, formatTime, formatTime24As12, formatTimeRange, nextBooking, pktDateString, startsInText, type Booking, type VenueSummary } from "@court-booking/types";
import { alpha, initials, palette, radius, shadow, size, space, statusPill, venueCardData } from "@court-booking/ui-tokens";

import { Avatar, Banner, Button, Card, EmptyState, Hero, IconButton, SkeletonCard, Text, VenueCard, useCopy, useLang, useRoleTheme, useVenueCardViewability, type IconComponent } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useUnreadNotifications } from "@/lib/use-unread-notifications";
import { EMPTY_FILTERS, filtersToParams, type VenueFilters } from "@/lib/venue-filters";
import { nextGame, replayList, tonightStarts } from "@/lib/player-flow";
import { DateTile, PlayerOfflineBanner, asList, sportLabel, useBookingPlace, useFavoriteToggle, useFirstName, useLightStatusBar } from "../_components";
import { DEFAULT_CITY, FiltersSheet } from "../_filters";

const TILES: { sport: (typeof SPORT_OPTIONS)[number]; icon: IconComponent }[] = [
  { sport: "Padel", icon: CircleDot },
  { sport: "Futsal", icon: Goal },
  { sport: "Cricket", icon: Trophy },
  { sport: "Badminton", icon: Feather },
];
/** Cards with real open times on Home (each costs one availability call). */
const TIMES_FOR = 3;

/**
 * Main board (Home): night hero with the 3-field search pill (Khel / Kab / Kitni der -> the existing search params), sport
 * tiles from SPORT_OPTIONS, "Next game" ONLY for a real upcoming booked booking, "Aaj raat khaali" from GET /venues?date=
 * today with real open times, "Phir se khelo" from real past bookings, empty states otherwise. Pull to refresh.
 */
export default function PlayerHomeScreen() {
  const copy = useCopy();
  const lang = useLang();
  const t = useRoleTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const user = useAuthStore((s) => s.user);
  const first = useFirstName();
  const bell = useUnreadNotifications();
  const fav = useFavoriteToggle();
  const vis = useVenueCardViewability();
  const [draft, setDraft] = useState<VenueFilters>({ ...EMPTY_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const today = pktDateString();
  useLightStatusBar();

  const upcomingQ = useQuery({ queryKey: ["bookings-mine", "upcoming"], queryFn: () => api.bookings.mine("upcoming", 1, 100), subscribed: focused });
  const pastQ = useQuery({ queryKey: ["bookings-mine", "past"], queryFn: () => api.bookings.mine("past", 1, 100) });
  const tonightQ = useQuery({
    queryKey: ["venue-search", "home-tonight", today],
    queryFn: () => api.venues.list({ city: DEFAULT_CITY, date: today, per_page: 20 }),
  });
  const tonight = useMemo(
    () =>
      [...asList<VenueSummary>(tonightQ.data?.venues)]
        .filter((v) => v.today_free_slots == null || v.today_free_slots > 0)
        .sort((a, b) => (b.today_free_slots ?? -1) - (a.today_free_slots ?? -1))
        .slice(0, 6),
    [tonightQ.data],
  );
  // Real open start times for the first few cards (GET /venues/:id/availability?date=today).
  const timeQueries = useQueries({
    queries: tonight.slice(0, TIMES_FOR).map((v) => ({
      queryKey: ["venue-availability", v.id, today],
      queryFn: () => api.availability.forVenueOnDate(v.id, today),
      staleTime: 60_000,
    })),
  });
  const timesByVenue = new Map<string, string[]>();
  tonight.slice(0, TIMES_FOR).forEach((v, i) => {
    const d = timeQueries[i]?.data;
    if (d && Array.isArray(d.courts)) timesByVenue.set(v.id, tonightStarts(d.courts));
  });

  const upcoming = asList<Booking>(upcomingQ.data);
  const game = nextGame(upcoming);
  const pending = nextBooking(upcoming.filter((b) => b.status === "held" || b.status === "payment_submitted"));
  const replay = replayList(asList<Booking>(pastQ.data));
  const refreshing = upcomingQ.isRefetching || tonightQ.isRefetching;

  const kab =
    draft.date && draft.time
      ? `${draft.date === today ? copy("Aaj", "Today") : formatDateString(draft.date, new Date(), lang)} ${formatTime24As12(draft.time)}`
      : draft.date
        ? draft.date === today
          ? copy("Aaj", "Today")
          : formatDateString(draft.date, new Date(), lang)
        : copy("Koi bhi waqt", "Any time");

  function search(next: VenueFilters = draft) {
    router.push({ pathname: "/(player)/search", params: Object.fromEntries(Object.entries(filtersToParams(next)).filter(([, v]) => v !== undefined)) as Record<string, string> });
  }

  const header = (
    <View style={{ gap: space[6] }}>
      <Hero topInset={insets.top} roundedBottom testID="home-hero">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
          <Pressable
            onPress={() => router.push({ pathname: "/(player)/search", params: { open: "1" } })}
            accessibilityRole="button"
            accessibilityLabel={copy(`Ilaqa badlein, abhi ${DEFAULT_CITY}`, `Change area, now ${DEFAULT_CITY}`)}
            style={{ minHeight: size.tap, paddingLeft: space[3], paddingRight: space[4], borderRadius: radius.pill, backgroundColor: alpha.glassDark, borderWidth: 1, borderColor: alpha.glassDarkBorder, flexDirection: "row", alignItems: "center", gap: space[2], flexShrink: 1 }}
          >
            <MapPin size={17} color={palette.orange} />
            <Text variant="bodyBold" tone="onDark">
              {CITY_OPTIONS.find((c) => c.value === user?.city)?.label.replace(/\s*\(.*\)$/, "") ?? DEFAULT_CITY}
            </Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <IconButton
              icon={Bell}
              variant="onDark"
              badge={bell.unread || null}
              accessibilityLabel={bell.unread ? copy(`Notifications, ${bell.label} nayi`, `Notifications, ${bell.label} new`) : "Notifications"}
              onPress={() => router.push("/(player)/notifications")}
              testID="home-bell"
            />
            <Pressable
              onPress={() => router.push("/profile")}
              accessibilityRole="button"
              accessibilityLabel={copy("Profile", "Profile")}
              style={{ width: size.tap, height: size.tap, borderRadius: radius.pill, backgroundColor: t.primary.bg, alignItems: "center", justifyContent: "center" }}
            >
              {user?.avatar_url ? (
                <Avatar name={user.name ?? "?"} size={size.tap} uri={user.avatar_url} />
              ) : (
                <Text variant="bodyBold" weight="black" color={t.primary.fg}>
                  {initials(user?.name)}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 6 }}>
          {first ? (
            <Text variant="bodyStrong" color={palette.orange}>
              {copy(`Salam, ${first}`, `Hi, ${first}`)}
            </Text>
          ) : null}
          <Text variant="display" tone="hero" accessibilityRole="header">
            {copy("Aaj raat khelna hai?", "Playing tonight?")}
          </Text>
        </View>

        <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: 6, flexDirection: "row", alignItems: "stretch", gap: 4, boxShadow: shadow.raised, flexWrap: "wrap" }} testID="home-search">
          <SearchField label={copy("KHEL", "SPORT")} value={draft.sport ?? copy("Koi bhi", "Any")} onPress={() => setSheetOpen(true)} />
          <SearchField label={copy("KAB", "WHEN")} value={kab} onPress={() => setSheetOpen(true)} />
          <SearchField label={copy("KITNI DER", "HOW LONG")} value={draft.duration ? formatDuration(draft.duration, lang) : copy("Koi bhi", "Any")} onPress={() => setSheetOpen(true)} />
          <Pressable
            onPress={() => search()}
            accessibilityRole="button"
            accessibilityLabel={copy("Court dhoondein", "Find courts")}
            style={({ pressed }) => ({ width: 56, minHeight: 56, borderRadius: radius.button, backgroundColor: t.primary.bg, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1, marginLeft: "auto" })}
            testID="home-search-go"
          >
            <Search size={22} color={t.primary.fg} strokeWidth={2.6} />
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {TILES.map((tile) => (
            <SportTile key={tile.sport} label={tile.sport} icon={tile.icon} onPress={() => search({ ...draft, sport: tile.sport })} />
          ))}
          <SportTile label={copy("Aur", "More")} icon={LayoutGrid} onPress={() => setSheetOpen(true)} />
        </View>
      </Hero>

      <View style={{ paddingHorizontal: t.gutter, gap: space[6] }}>
        <PlayerOfflineBanner />
        {game ? <NextGameCard booking={game} /> : null}
        {!game && pending ? (
          <Banner
            tone="waiting"
            title={pending.status === "held" ? copy("Ek booking ki payment baqi hai", "A booking is waiting for payment") : copy("Venue aap ki payment check kar raha hai", "The venue is checking your payment")}
            body={`${formatTimeRange(pending.starts_at, pending.ends_at, lang)}`}
            action={
              <Button
                label={pending.status === "held" ? copy("Pay karein", "Pay now") : copy("Status dekhein", "See status")}
                size="sm"
                onPress={() => router.push({ pathname: pending.status === "held" ? "/(player)/booking/[id]/pay" : "/(player)/booking/[id]/done", params: { id: pending.id } })}
              />
            }
          />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" }}>
          <Text variant="h3" accessibilityRole="header">
            {copy("Aaj raat khaali", "Free tonight")}
          </Text>
          <Button label={copy("Sab dekho", "See all")} variant="soft" size="sm" onPress={() => search({ ...EMPTY_FILTERS })} />
        </View>
      </View>
    </View>
  );

  const footer = (
    <View style={{ paddingHorizontal: t.gutter, gap: space[3], paddingTop: space[2] }}>
      <Text variant="h3" accessibilityRole="header">
        {copy("Phir se khelo", "Play again")}
      </Text>
      {pastQ.isLoading ? (
        <SkeletonCard />
      ) : replay.length === 0 ? (
        <Text variant="meta" tone="muted" testID="home-replay-empty">
          {copy("Jab aap koi game khelenge, wo yahan dobara book karne ke liye aayegi.", "Once you've played a game, it shows here so you can book it again.")}
        </Text>
      ) : (
        replay.map((b) => <ReplayRow key={b.id} booking={b} />)
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <FlatList
        testID="home-screen"
        data={tonight}
        keyExtractor={(v: VenueSummary) => v.id}
        {...vis.listProps}
        refreshing={refreshing}
        onRefresh={() => {
          void upcomingQ.refetch();
          void pastQ.refetch();
          void tonightQ.refetch();
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + size.tabBar + space[8], gap: space[4] }}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: t.gutter }}>
            {tonightQ.isLoading ? (
              <View style={{ gap: space[4] }} accessibilityLabel={copy("Venues load ho rahe hain", "Loading venues")}>
                <SkeletonCard />
                <SkeletonCard />
              </View>
            ) : tonightQ.isError ? (
              <Banner tone="danger" title={copy("Venues load nahi hue", "Couldn't load venues")} body={copy("Neeche khench kar dobara koshish karein.", "Pull down to try again.")} />
            ) : (
              <EmptyState title={copy("Aaj raat koi slot khaali nahi", "Nothing free tonight")} body={copy("Kal ya kisi aur waqt ke liye dhoondein.", "Search for tomorrow or another time.")} actionLabel={copy("Search karein", "Search")} onAction={() => search({ ...EMPTY_FILTERS })} />
            )}
          </View>
        }
        renderItem={({ item }) => {
          const starts = timesByVenue.get(item.id);
          return (
            <View style={{ paddingHorizontal: t.gutter }}>
              <VenueCard
                venue={venueCardData(item, { sport: draft.sport })}
                visible={vis.isVisible(item.id)}
                saved={fav.isSaved(item.id)}
                onToggleSave={fav.enabled ? () => fav.toggle(item.id) : undefined}
                onPress={() => router.push({ pathname: "/(player)/venue/[slug]", params: { slug: item.slug } })}
                times={starts?.map((iso) => ({ label: formatTime(iso), onPress: () => router.push({ pathname: "/(player)/venue/[slug]", params: { slug: item.slug } }) }))}
              />
            </View>
          );
        }}
      />
      <FiltersSheet
        open={sheetOpen}
        initial={draft}
        sections={["sport", "when"]}
        title={copy("Kya, kab, kitni der?", "What, when, how long?")}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setSheetOpen(false);
          setDraft(next);
          search(next);
        }}
      />
    </View>
  );
}

function SearchField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: 72, minHeight: 56, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.button, justifyContent: "center", gap: 2, backgroundColor: pressed ? palette.ground : "transparent" })}
    >
      <Text variant="tab" weight="black" tone="subtle">
        {label}
      </Text>
      <Text variant="bodyBold" weight="black">
        {value}
      </Text>
    </Pressable>
  );
}

function SportTile({ label, icon: Icon, onPress }: { label: string; icon: IconComponent; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: 60, minHeight: 74, borderRadius: radius.button, backgroundColor: alpha.glassDark, borderWidth: 1, borderColor: alpha.glassDarkBorder, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 4, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon size={24} color={palette.white} strokeWidth={1.9} />
      <Text variant="caption" weight="black" tone="onDark" align="center">
        {label}
      </Text>
    </Pressable>
  );
}

function NextGameCard({ booking }: { booking: Booking }) {
  const copy = useCopy();
  const lang = useLang();
  const place = useBookingPlace(booking);
  return (
    <Card padding={4} radiusSize="card" testID="home-next-game">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <Pressable
          onPress={() => router.push({ pathname: "/(player)/booking/[id]/done", params: { id: booking.id } })}
          accessibilityRole="button"
          accessibilityLabel={copy("Aap ki agli game", "Your next game")}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[3] }}
        >
        <DateTile iso={booking.starts_at} variant="orange" />
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="caption" weight="black" tone="open">
            {`${statusPill(booking, lang).label.toUpperCase()} · ${startsInText(booking.starts_at, booking.ends_at, Date.now(), lang).toUpperCase()}`}
          </Text>
          <Text variant="bodyStrong">{[place.venue?.name, place.court?.name].filter(Boolean).join(" · ") || " "}</Text>
          <Text variant="meta" tone="muted">
            {[formatTimeRange(booking.starts_at, booking.ends_at, lang), place.court ? sportLabel(place.court.sport) : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
        </Pressable>
        <IconButton icon={QrCode} variant="mist" diameter={48} accessibilityLabel={copy("Check-in QR dikhayein", "Show check-in QR")} onPress={() => router.push({ pathname: "/(player)/booking/[id]/done", params: { id: booking.id } })} />
      </View>
    </Card>
  );
}

function ReplayRow({ booking }: { booking: Booking }) {
  const copy = useCopy();
  const place = useBookingPlace(booking);
  if (!place.venue && !place.loading) return null;
  return (
    <Card padding={4} radiusSize="card" style={{ flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
        <Text variant="bodyStrong">{[place.venue?.name, place.court ? sportLabel(place.court.sport) : null].filter(Boolean).join(" · ") || " "}</Text>
        <Text variant="meta" tone="muted">
          {copy(`Pichli baar: ${formatTime(booking.starts_at)}`, `Last time: ${formatTime(booking.starts_at)}`)}
        </Text>
      </View>
      {place.venue ? (
        <Button
          label={copy("Phir book karo", "Book again")}
          variant="soft"
          size="sm"
          onPress={() => router.push({ pathname: "/(player)/venue/[slug]", params: place.court ? { slug: place.venue!.slug, sport: place.court.sport } : { slug: place.venue!.slug } })}
        />
      ) : null}
    </Card>
  );
}
